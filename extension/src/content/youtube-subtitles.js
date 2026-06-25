/* ═══════════════════════════════════════════════
   youtube-subtitles.js — 字幕获取、解析、清洗
   ═══════════════════════════════════════════════ */

const TRANSLATION_GROUP_MAX_CUES = 10;
const TRANSLATION_GROUP_MAX_SECONDS = 25;
const TRANSLATION_GROUP_MAX_CHARS = 600;
const TRANSLATION_REQUEST_TIMEOUT_MS = 60000;
const TRANSLATION_GROUP_MAX_TOKENS = 1024;
const TRANSLATION_CACHE_MAX_SIZE = 600;
const TRANSLATION_MAX_RETRIES = 2;
const TRANSLATION_RETRY_BASE_DELAY_MS = 1200;
const subtitleTranslationCache = new Map();

// 自适应限速器：动态调整并发度和请求间隔，响应 API 429 限速
const RateLimiter = {
  maxConcurrency: 6,
  minConcurrency: 1,
  currentConcurrency: 4,
  inFlight: 0,
  waiters: [],
  consecutive429s: 0,
  consecutiveSuccesses: 0,
  baseDelayMs: 30,
  currentDelayMs: 30,
  rampUpThreshold: 20,

  async acquire() {
    while (this.inFlight >= this.currentConcurrency) {
      await new Promise(function (r) { RateLimiter.waiters.push(r); });
    }
    this.inFlight++;
  },

  release() {
    this.inFlight--;
    var next = this.waiters.shift();
    if (next) next();
  },

  report429() {
    this.consecutive429s++;
    this.consecutiveSuccesses = 0;
    if (this.currentConcurrency > this.minConcurrency) {
      this.currentConcurrency--;
      debugLog('YT-Subs', 'RateLimiter: reduced concurrency to ' + this.currentConcurrency + ' after 429');
    }
    this.currentDelayMs = Math.min(5000, this.currentDelayMs * 2);
  },

  reportSuccess() {
    this.consecutiveSuccesses++;
    this.consecutive429s = 0;
    if (this.consecutiveSuccesses > this.rampUpThreshold && this.currentConcurrency < this.maxConcurrency) {
      this.currentConcurrency++;
      this.consecutiveSuccesses = 0;
      this.currentDelayMs = Math.max(this.baseDelayMs, Math.floor(this.currentDelayMs / 2));
      debugLog('YT-Subs', 'RateLimiter: increased concurrency to ' + this.currentConcurrency);
    }
  },

  getDelay() {
    return this.consecutive429s > 0 ? this.currentDelayMs : this.baseDelayMs;
  },
};

// translate-prompt.js 已由 manifest 加载，提供 window.TranslatePrompt



/**
 * 从 YouTube 页面提取字幕数据
 */
async function fetchSubtitles(videoId) {
  debugLog('YT-Subs', 'fetchSubtitles start: ' + videoId);

  // 方法1: 从 ytInitialPlayerResponse 提取
  let captionsData = extractFromPlayerResponse();
  debugLog('YT-Subs', 'extractFromPlayerResponse: ' + (captionsData ? 'found' : 'not found'));

  // 方法2: 重新请求页面 HTML（fallback）
  if (!captionsData) {
    debugLog('YT-Subs', 'trying fetchFromPage fallback...');
    captionsData = await fetchFromPage(videoId);
    debugLog('YT-Subs', 'fetchFromPage: ' + (captionsData ? 'found' : 'not found'));
  }

  let rawData = '';
  let language = captionsData ? captionsData.language : 'unknown';

  // 如果有 baseUrl，先尝试直接获取字幕文件
  if (captionsData) {
    const trackUrl = captionsData.baseUrl;
    debugLog('YT-Subs', 'track URL: ' + trackUrl + ' lang: ' + language);
    rawData = await fetchSubtitleFile(trackUrl);
  }

  // 方法3: 拦截 YouTube 播放器自己的字幕请求（绕过 PoToken）
  // 当直接获取失败（空内容）或根本拿不到 baseUrl 时使用
  if (!rawData || rawData.length === 0) {
    debugLog('YT-Subs', 'trying fetch via interceptor (bypass PoToken)...');
    try {
      const intercepted = await waitForInterceptedTimedtext(60000, videoId);
      debugLog('YT-Subs', 'interceptor got data: textLen=' + intercepted.text.length + ' url=' + intercepted.url);
      rawData = intercepted.text;
      // 从拦截到的 URL 中提取语言
      const langMatch = intercepted.url.match(/[?&]lang=([^&]+)/);
      if (langMatch) {
        language = decodeURIComponent(langMatch[1]);
      }
    } catch (interceptorErr) {
      debugLog('YT-Subs', 'interceptor failed: ' + interceptorErr.message);
    }
  }

  if (!rawData || rawData.length === 0) {
    console.error('[YT-Subs] FAILED: no subtitle data from any method');
    throw new Error('No subtitles available for this video');
  }

  // 解析为时间轴 cue 数组
  const cues = parseSubtitleData(rawData);
  debugLog('YT-Subs', 'parsed cues: ' + cues.length);

  // 清洗
  const cleaned = cleanCues(cues);
  debugLog('YT-Subs', 'after cleanCues: ' + cleaned.length);

  return { cues: cleaned, language: language };
}

/**
 * 快速检测字幕是否可用（仅检查元数据，不下载字幕文件）
 * 用于 popup 的初始视频扫描，大幅提升速度
 */
async function quickDetectSubtitles(videoId) {
  debugLog('YT-Subs', 'quickDetectSubtitles start: ' + videoId);

  // 方法1: 从 ytInitialPlayerResponse 提取（同步，最快）
  let captionsData = extractFromPlayerResponse();
  debugLog('YT-Subs', 'quickDetect extractFromPlayerResponse: ' + (captionsData ? 'found' : 'not found'));

  // 方法2: 快速请求页面 HTML（fallback，2s 超时）
  if (!captionsData) {
    debugLog('YT-Subs', 'quickDetect trying fetchFromPage...');
    try {
      captionsData = await fetchFromPage(videoId);
      debugLog('YT-Subs', 'quickDetect fetchFromPage: ' + (captionsData ? 'found' : 'not found'));
    } catch (e) {
      debugLog('YT-Subs', 'quickDetect fetchFromPage failed: ' + e.message);
    }
  }

  if (!captionsData) {
    debugLog('YT-Subs', 'quickDetect: no captions data found');
    return { available: false };
  }

  return {
    available: true,
    language: captionsData.language || 'unknown',
    baseUrl: captionsData.baseUrl,
  };
}

async function getSubtitleTrackInfo(videoId) {
  let captionsData = extractFromPlayerResponse();
  if (!captionsData) {
    captionsData = await fetchFromPage(videoId);
  }
  if (!captionsData) return null;
  return {
    language: captionsData.language || 'unknown',
    baseUrl: captionsData.baseUrl || '',
  };
}

/**
 * 从页面嵌入的 ytInitialPlayerResponse 中提取字幕数据
 */
function extractFromPlayerResponse() {
  try {
    const scriptTag = document.querySelector('script');
    // 查找 window.ytInitialPlayerResponse 的赋值
    const scripts = document.querySelectorAll('script');
    debugLog('YT-Subs', 'extractFromPlayerResponse: checking ' + scripts.length + ' script tags');
    for (const script of scripts) {
      const text = script.textContent || '';
      const match = text.match(/ytInitialPlayerResponse\s*=\s*({.*?});\s*\n/);
      if (match) {
        debugLog('YT-Subs', 'regex matched, match[1] length: ' + match[1].length);
        try {
          const data = JSON.parse(match[1]);
          const captions = data?.captions?.playerCaptionsTracklistRenderer;
          debugLog('YT-Subs', 'parsed data: ' + JSON.stringify({ hasCaptions: !!captions, trackCount: captions?.captionTracks?.length }));
          if (captions?.captionTracks?.length > 0) {
            const track = captions.captionTracks[0];
            debugLog('YT-Subs', 'found track: ' + (track.languageCode || '?') + ' baseUrl: ' + !!track.baseUrl);
            return {
              baseUrl: track.baseUrl,
              language: track.languageCode || track.name?.simpleText || 'unknown',
            };
          }
        } catch (parseErr) {
          console.warn('[YT-Subs] JSON parse failed:', parseErr.message, 'try fetchFromPage instead');
        }
      }
    }
    debugLog('YT-Subs', 'extractFromPlayerResponse: no match found in any script');
  } catch (e) {
    console.warn('[YT-Subs] extractFromPlayerResponse error:', e);
  }
  return null;
}

/**
 * 通过重新请求视频页面获取字幕数据（fallback）
 */
async function fetchFromPage(videoId) {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    debugLog('YT-Subs', 'fetchFromPage: fetching ' + url);
    const resp = await fetch(url);
    debugLog('YT-Subs', 'fetchFromPage: response status ' + resp.status);
    const html = await resp.text();
    debugLog('YT-Subs', 'fetchFromPage: HTML length ' + html.length);
    const match = html.match(/"captionTracks":(\[.*?\])/);
    debugLog('YT-Subs', 'fetchFromPage regex match: ' + (match ? 'found, match[1] len:' + match[1].length : 'not found'));
    // Debug: log snippet around captionTracks
    const snippet = html.includes('captionTracks') ? html.substring(Math.max(0, html.indexOf('captionTracks') - 200), html.indexOf('captionTracks') + 800) : html.substring(0, 500);
    debugLog('YT-Subs', 'fetchFromPage: HTML snippet: ' + snippet);
    if (match) {
      const tracks = JSON.parse(match[1]);
      debugLog('YT-Subs', 'fetchFromPage: parsed ' + tracks.length + ' tracks');
      if (tracks.length > 0) {
        debugLog('YT-Subs', 'fetchFromPage: first track: ' + (tracks[0].languageCode || '?') + ' baseUrl: ' + !!tracks[0].baseUrl);
        return {
          baseUrl: tracks[0].baseUrl,
          language: tracks[0].languageCode || 'unknown',
        };
      }
    }
  } catch (e) {
    console.warn('[YT-Subs] fetchFromPage error:', e);
  }
  return null;
}

/**
 * 获取字幕文件内容
 * 通过 content script 直接调用 InnerTube player API（不受页面 CSP 限制）
 */
async function fetchSubtitleFile(trackUrl) {
  debugLog('YT-Subs', 'fetchSubtitleFile for track: ' + trackUrl.slice(0, 80) + '...');
  
  const videoId = extractVideoId(trackUrl);
  
  // 方法1: 尝试多种 InnerTube 客户端获取字幕（IOS 优先，Gemini 字幕需要 IOS 客户端）
  const clients = ['IOS', 'WEB_EMBEDDED_PLAYER', 'ANDROID', 'WEB'];
  for (const clientName of clients) {
    try {
      const data = await fetchPlayerResponse(videoId, clientName);
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      const hasCaptions = !!(tracks && tracks.length > 0);
      debugLog('YT-Subs', 'InnerTube player response [' + clientName + ']: hasCaptions=' + hasCaptions);
      
      if (hasCaptions) {
        const bu = tracks[0].baseUrl;
        debugLog('YT-Subs', 'fetchSubtitleFile: fetching from ' + clientName + ' baseUrl as json3');
        const text = await fetchTimedtextJsonFirst(bu, clientName);
        if (text) return text;
      }
    } catch (e) {
      debugLog('YT-Subs', 'fetchSubtitleFile InnerTube [' + clientName + '] failed: ' + e.message);
    }
  }
  
  // 方法2: 直接用 timedtext URL（备用），优先 JSON3 时间轴
  debugLog('YT-Subs', 'fetchSubtitleFile: trying direct timedtext URL with fmt=json3');
  try {
    const text = await fetchTimedtextJsonFirst(trackUrl, 'direct');
    if (text) return text;
  } catch (e) {
    debugLog('YT-Subs', 'fetchSubtitleFile direct failed: ' + e.message);
  }

  debugLog('YT-Subs', 'fetchSubtitleFile: all methods returned empty');
  return '';
}

async function fetchTimedtextJsonFirst(url, label) {
  const jsonUrl = appendQueryParam(url, 'fmt', 'json3');
  try {
    const jsonResp = await fetch(jsonUrl, {
      headers: { 'Accept': 'application/json,*/*' },
    });
    if (jsonResp.ok) {
      const jsonText = await jsonResp.text();
      debugLog('YT-Subs', 'fetchTimedtext [' + label + '] json3 response: textLen=' + jsonText.length + ' preview=' + jsonText.slice(0, 120).replace(/\n/g, '\\n'));
      if (jsonText && jsonText.trim().startsWith('{')) return jsonText;
    }
  } catch (e) {
    debugLog('YT-Subs', 'fetchTimedtext [' + label + '] json3 failed: ' + e.message);
  }

  const resp = await fetch(url, {
    headers: { 'Accept': 'application/xml,text/xml,application/json,*/*' },
  });
  if (resp.ok) {
    const text = await resp.text();
    debugLog('YT-Subs', 'fetchTimedtext [' + label + '] fallback response: textLen=' + text.length + ' preview=' + text.slice(0, 120).replace(/\n/g, '\\n'));
    if (text && text.length > 0) return text;
  }
  return '';
}

function appendQueryParam(url, key, value) {
  const cleanUrl = url.replace(new RegExp('([?&])' + key + '=[^&]*&?'), '$1').replace(/[?&]$/, '');
  const sep = cleanUrl.includes('?') ? '&' : '?';
  return cleanUrl + sep + encodeURIComponent(key) + '=' + encodeURIComponent(value);
}

/**
 * 尝试多种 InnerTube 客户端获取 player 响应
 * @param {string} videoId
 * @param {string} clientName 客户端名称
 */
async function fetchPlayerResponse(videoId, clientName) {
  // 每个客户端的版本号
  const clientVersions = {
    'WEB_EMBEDDED_PLAYER': '2.20260623.01.00',
    'ANDROID': '21.02.35',
    'IOS': '21.02.3',
    'WEB': '2.20250101.00.00',
  };
  
  const context = {
    client: {
      clientName: clientName,
      clientVersion: clientVersions[clientName] || '2.20260623.01.00',
      hl: 'en',
      gl: 'US',
    },
  };
  
  // WEB_EMBEDDED_PLAYER 需要 thirdParty 字段
  if (clientName === 'WEB_EMBEDDED_PLAYER') {
    context.thirdParty = { embedUrl: 'https://www.youtube.com' };
  }

  // 移动端客户端需要设备信息（缺少会导致 400 错误）
  if (clientName === 'IOS') {
    context.client.deviceMake = 'Apple';
    context.client.deviceModel = 'iPhone16,2';
    context.client.osName = 'iPhone';
    context.client.osVersion = '18.3.2.22D82';
    context.client.platform = 'MOBILE';
  }
  if (clientName === 'ANDROID') {
    context.client.osName = 'Android';
    context.client.osVersion = '11';
    context.client.androidSdkVersion = 30;
    context.client.platform = 'MOBILE';
  }
  
  const body = {
    videoId: videoId,
    context: context,
  };
  
  const resp = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('Player API [' + clientName + '] ' + resp.status + ': ' + errText.slice(0, 200));
  }
  
  return resp.json();
}

function extractVideoId(url) {
  const m = url.match(/[?&]v=([^&]+)/);
  return m ? m[1] : '';
}

/**
 * 解析 YouTube 字幕为 cue 数组
 * 支持 XML 格式（<text start="seconds" dur="seconds">text content</text>）
 * 和 JSON3 格式（{"events":[{"tStartMs":0,"segs":[{"utf8":"text"}]}]}）
 */
function parseSubtitleData(rawData) {
  if (!rawData || rawData.length === 0) return [];

  // 尝试 JSON3 格式
  if (rawData.trim().startsWith('{')) {
    try {
      const json = JSON.parse(rawData);
      if (json && json.events && Array.isArray(json.events)) {
        return parseJson3(json);
      }
    } catch (e) {
      // 不是 JSON，继续尝试 XML
    }
  }

  // XML 格式（原有逻辑）
  return parseXmlSubtitle(rawData);
}

/**
 * 解析 JSON3 格式字幕
 */
function parseJson3(json) {
  const cues = [];
  const events = json.events || [];

  for (const event of events) {
    const startMs = event.tStartMs;
    const durMs = event.dDurationMs || 0;
    if (startMs == null) continue;

    // 提取文本
    let text = '';
    if (event.segs && Array.isArray(event.segs)) {
      text = event.segs.map(function (seg) {
        return seg.utf8 || '';
      }).join('');
    }

    if (text.trim()) {
      cues.push({
        start: startMs / 1000,
        end: (startMs + durMs) / 1000,
        text: text.trim(),
      });
    }
  }

  return cues;
}

/**
 * 解析 XML 格式字幕
 * 支持两种格式：
 * 1. 旧格式：<text start="seconds" dur="seconds">text content</text>
 * 2. srv3 格式：<wp id="0" ws="1" t="0" d="7800"><text>text content</text></wp>
 */
function parseXmlSubtitle(xmlText) {
  const cues = [];
  let doc;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(xmlText, 'text/xml');
    // 检查解析错误
    var parseErr = doc.querySelector('parsererror');
    if (parseErr) {
      debugLog('YT-Subs', 'parseXmlSubtitle: DOMParser error: ' + parseErr.textContent.slice(0, 200));
    }
  } catch (e) {
    debugLog('YT-Subs', 'parseXmlSubtitle: DOMParser threw: ' + e.message);
    return cues;
  }

  // 尝试 srv3 格式（<p> 或 <wp> 元素带 t/d 属性，内含 <text>）
  var timedEls = doc.querySelectorAll('p[t], wp[t]');
  debugLog('YT-Subs', 'parseXmlSubtitle: root=' + (doc.documentElement ? doc.documentElement.nodeName : 'no-root') + ' p/timedEls=' + timedEls.length);
  if (timedEls.length > 0) {
    // 调试：打印第一个元素的完整内容
    try {
      var firstElXml = new XMLSerializer().serializeToString(timedEls[0]);
      debugLog('YT-Subs', 'srv3 first element: ' + firstElXml.slice(0, 300));
    } catch(e) {
      debugLog('YT-Subs', 'srv3 serialize error: ' + e.message);
    }

    timedEls.forEach(function (el) {
      var t = parseFloat(el.getAttribute('t'));
      var d = parseFloat(el.getAttribute('d'));
      if (isNaN(t)) return;
      // srv3 文本可能在 <text> 子元素中，也可能直接在元素的 textContent 里
      var textEl = el.querySelector('text');
      var text = textEl ? textEl.textContent : el.textContent;
      if (!text) {
        debugLog('YT-Subs', 'srv3 empty text at t=' + t + ' childNodes=' + el.childNodes.length);
        return;
      }
      text = text
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      if (text) {
        cues.push({
          start: t / 1000,
          end: (t + (d || 0)) / 1000,
          text: text,
        });
      }
    });
    debugLog('YT-Subs', 'parseXmlSubtitle: srv3 parsed ' + cues.length + ' cues');
    return cues;
  }

  // 旧格式：<text start="seconds" dur="seconds">
  const textEls = doc.querySelectorAll('text');
  textEls.forEach(function (el) {
    var start = parseFloat(el.getAttribute('start'));
    var dur = parseFloat(el.getAttribute('dur') || '2');
    var text = el.textContent
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    if (text) {
      cues.push({ start: start, end: start + dur, text: text });
    }
  });

  return cues;
}

/**
 * 清洗字幕 cue
 */
function cleanCues(cues) {
  return cues.map(cue => {
    const text = cleanCueText(cue.text, { forTranslation: false });
    return { ...cue, text };
  }).filter(cue => cue.text.length > 0);
}

function cleanCueText(text, options) {
  return TranslatePrompt.cleanCueText(text, options || {});
}

function buildTranslationGroups(cues) {
  const groups = [];
  let current = createTranslationGroup();

  cues.forEach(function (cue, index) {
    const text = TranslatePrompt.cleanCueText(cue.text, { forTranslation: true });
    if (!text) return;

    if (current.cueIndices.length > 0 && wouldOverflowTranslationGroup(current, cue, text)) {
      groups.push(finalizeTranslationGroup(current));
      current = createTranslationGroup();
    }

    current.cueIndices.push(index);
    current.texts.push(text);
    current.start = current.start == null ? cue.start : current.start;
    current.end = cue.end;

    if (isSentenceEnd(text)) {
      groups.push(finalizeTranslationGroup(current));
      current = createTranslationGroup();
    }
  });

  if (current.cueIndices.length > 0) {
    groups.push(finalizeTranslationGroup(current));
  }

  return groups;
}

function createTranslationGroup() {
  return { cueIndices: [], texts: [], start: null, end: null, text: '' };
}

function finalizeTranslationGroup(group) {
  return {
    cueIndices: group.cueIndices.slice(),
    texts: group.texts.slice(),
    start: group.start,
    end: group.end,
    text: group.texts.join(' '),
  };
}

function wouldOverflowTranslationGroup(group, cue, text) {
  const nextText = group.texts.concat(text).join(' ');
  return group.cueIndices.length >= TRANSLATION_GROUP_MAX_CUES ||
    nextText.length > TRANSLATION_GROUP_MAX_CHARS ||
    (cue.end - group.start) > TRANSLATION_GROUP_MAX_SECONDS;
}

function isSentenceEnd(text) {
  return /[.?!。？！]$/.test(text);
}

/**
 * 翻译字幕 cue 数组
 */
async function translateCues(cues, settings, onProgress) {
  if (!settings.translationEnabled) {
    debugLog('YT-Subs', 'translateCues: translation disabled, returning original');
    return cues;
  }

  const modelKey = settings.defaultModel || 'agnes-ai';
  const texts = cues.map(c => c.text);
  debugLog('YT-Subs', 'translateCues: sending ' + texts.length + ' texts directly, modelKey: ' + modelKey);

  // 直接做 AI 翻译，不经过 Service Worker（避免 SW 超时关闭消息通道）
  try {
    const results = [];
    const targetLang = settings.targetLanguage || 'zh-CN';
    const models = settings.models || {};
    const model = models[modelKey];
    
    if (!model || !model.apiKey) {
      const message = getSubtitleMessage('noApiKey', '请先在设置中配置 API Key');
      debugLog('YT-Subs', 'translateCues: model not configured');
      cues.forEach(function (_cue, index) {
        if (onProgress) onProgress(index, message);
      });
      return cues.map(function (cue) {
        return { ...cue, translated: message };
      });
    }

    // 使用共享 prompt 构建器（单条字幕 — 简化版）
    var floatPrompt = TranslatePrompt.buildFloatingPrompt({
      text: texts[i],
      targetLanguage: targetLang,
    });
    const apiUrl = model.apiUrl.replace(/\/+$/, '') + '/chat/completions';

    for (let i = 0; i < texts.length; i++) {
      try {
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + model.apiKey,
          },
          body: JSON.stringify({
            model: model.modelId,
            messages: [
              { role: 'system', content: floatPrompt.system },
              { role: 'user', content: floatPrompt.user },
            ],
            max_tokens: 2048,
            temperature: 0.3,
          }),
        });
        if (!resp.ok) {
          const errTxt = await resp.text().catch(() => '');
          debugLog('YT-Subs', 'translateCues API error ' + resp.status + ': ' + errTxt.slice(0, 200));
          const message = getSubtitleMessage('translateError', '翻译失败');
          results.push(message);
          if (onProgress) onProgress(i, message);
        } else {
          const data = await resp.json();
          const translated = data.choices?.[0]?.message?.content?.trim() || '';
          results.push(translated);
          if (onProgress) onProgress(i, translated);
        }
      } catch (e) {
        debugLog('YT-Subs', 'translateCues fetch error: ' + e.message);
        const message = getSubtitleMessage('translateError', '翻译失败');
        results.push(message);
        if (onProgress) onProgress(i, message);
      }
      if (i < texts.length - 1) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    debugLog('YT-Subs', 'translateCues direct results: ' + results.length);
    return cues.map((cue, i) => ({
      ...cue,
      translated: results[i] || '',
    }));
  } catch (err) {
    debugLog('YT-Subs', 'translateCues direct failed: ' + err.message + ', falling back to SW');
    const port = chrome.runtime.connect({ name: 'translate-session' });
    try {
      const translatedTexts = await sendMessage({
        type: 'TRANSLATE_BATCH', texts, modelKey,
      });
      return cues.map((c, i) => ({
        ...c,
        translated: (translatedTexts.results && translatedTexts.results[i]) || '',
      }));
    } finally {
      port.disconnect();
    }
  }
}

async function translateCueGroups(groups, settings, prevContext, onProgress) {
  if (!settings.translationEnabled) {
    debugLog('YT-Subs', 'translateCueGroups: translation disabled');
    return groups;
  }

  const modelKey = settings.defaultModel || 'agnes-ai';
  const targetLang = settings.targetLanguage || 'zh-CN';
  const models = settings.models || {};
  const model = models[modelKey];

  if (!model || !model.apiKey) {
    const message = getSubtitleMessage('noApiKey', '请先在设置中配置 API Key');
    groups.forEach(function (group) {
      group.cueIndices.forEach(function (cueIndex) {
        if (onProgress) onProgress(cueIndex, message, group);
      });
      group.translations = group.cueIndices.map(function () { return message; });
    });
    return groups;
  }

  const apiUrl = model.apiUrl.replace(/\/+$/, '') + '/chat/completions';
  const translatedGroups = [];
  // 上下文窗口：收集前 N 组已翻译的组作为上下文
  var contextWindowSize = TranslatePrompt.getContextWindowSize(settings.sourceLanguage);
  var prevContexts = prevContext ? [prevContext] : [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const groupText = group.text || group.texts.join(' ');
    const cacheKey = getSubtitleTranslationCacheKey(groupText, {
      videoId: settings.videoId,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: targetLang,
      modelKey,
      modelId: model.modelId,
    });
    let translated;

    translated = await getCachedSubtitleTranslation(cacheKey);
    if (typeof translated === 'string' && group.cueIndices.length > 1) {
      translated = '';
    }
    if (translated) {
      debugLog('YT-Subs', 'translateCueGroups cache hit: start=' + group.start);
    } else {
      try {
        translated = await translateSubtitleGroupWithRetry(group.texts, {
          apiUrl: apiUrl,
          model: model,
          targetLanguage: targetLang,
          sourceLanguage: settings.sourceLanguage,
          prevContexts: prevContexts.length > 0 ? prevContexts.slice() : null,
          videoTitle: settings.videoTitle || null,
        });
        await rememberSubtitleTranslation(cacheKey, translated);
      } catch (err) {
        debugLog('YT-Subs', 'translateCueGroups group failed, splitting: start=' + group.start + ' ' + err.message);
        translated = await translateSplitGroup(group, {
          apiUrl: apiUrl,
          model: model,
          targetLanguage: targetLang,
          targetLang: targetLang,
          modelKey: modelKey,
          videoId: settings.videoId,
          sourceLanguage: settings.sourceLanguage,
          prevContexts: prevContexts.length > 0 ? prevContexts.slice() : null,
        }).catch(function (splitErr) {
          debugLog('YT-Subs', 'translateCueGroups split failed: start=' + group.start + ' ' + splitErr.message);
          return null;
        });
      }
    }

    if (Array.isArray(translated)) {
      group.translations = normalizeTranslationArray(translated, group.cueIndices.length);
    } else {
      const finalText = translated || getSubtitleMessage('translateError', '翻译失败');
      group.translations = group.cueIndices.map(function () { return finalText; });
    }

    // 记录当前组，加入上下文窗口
    var currentCtx = {
      texts: group.texts.slice(),
      translations: group.translations.slice(),
    };
    prevContexts.push(currentCtx);
    // 保持窗口大小
    while (prevContexts.length > contextWindowSize) {
      prevContexts.shift();
    }

    group.cueIndices.forEach(function (cueIndex, idx) {
      if (onProgress) onProgress(cueIndex, group.translations[idx], group);
    });
    translatedGroups.push(group);

    if (i < groups.length - 1) {
      await new Promise(function (r) { setTimeout(r, RateLimiter.getDelay()); });
    }
  }

  debugLog('YT-Subs', 'translateCueGroups done: ' + translatedGroups.length + ' groups');
  return translatedGroups;
}

async function translateSubtitleGroupWithRetry(text, options) {
  let lastError = null;
  for (let attempt = 0; attempt <= TRANSLATION_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        await delay(TRANSLATION_RETRY_BASE_DELAY_MS * attempt);
      }
      return await translateSubtitleGroup(text, options);
    } catch (err) {
      lastError = err;
      debugLog('YT-Subs', 'translateSubtitleGroup retry ' + attempt + ' failed: ' + err.message);
    }
  }
  throw lastError || new Error('Translation failed');
}

async function translateSplitGroup(group, options) {
  const translations = [];

  for (let i = 0; i < group.texts.length; i++) {
    const text = group.texts[i];
    const cacheKey = getSubtitleTranslationCacheKey(text, {
      videoId: options.videoId,
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLang,
      modelKey: options.modelKey,
      modelId: options.model.modelId,
    });
    const cached = await getCachedSubtitleTranslation(cacheKey);
    if (cached) {
      translations.push(cached);
      continue;
    }

    const translated = await translateSubtitleGroupWithRetry(text, options);
    await rememberSubtitleTranslation(cacheKey, translated);
    translations.push(translated);
    if (i < group.texts.length - 1) {
      await delay(RateLimiter.getDelay());
    }
  }

  return translations;
}

async function translateSubtitleGroup(text, options) {
  const startedAt = Date.now();
  const isBatch = Array.isArray(text);
  const inputTexts = isBatch ? text : [text];

  // 使用共享 prompt 构建器
  var prompt = TranslatePrompt.buildSubtitlePrompt({
    texts: inputTexts,
    targetLanguage: options.targetLanguage,
    sourceLanguage: options.sourceLanguage,
    prevContexts: options.prevContexts || null,
    videoTitle: options.videoTitle || null,
  });

  try {
    await RateLimiter.acquire();
    var response;
    try {
      response = await fetchWithTimeout(options.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + options.model.apiKey,
        },
        body: JSON.stringify({
          model: options.model.modelId,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          max_tokens: TRANSLATION_GROUP_MAX_TOKENS,
          temperature: 0.35,
        }),
      }, TRANSLATION_REQUEST_TIMEOUT_MS);
    } finally {
      RateLimiter.release();
    }

    if (response.status === 429) {
      RateLimiter.report429();
      var retryAfter = response.headers.get('Retry-After');
      var waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : RateLimiter.getDelay();
      debugLog('YT-Subs', 'translateSubtitleGroup 429, waiting ' + waitMs + 'ms');
      await new Promise(function (r) { setTimeout(r, waitMs); });
      throw new Error('API rate limited (429)');
    }

    if (!response.ok) {
      var errTxt = await response.text().catch(function () { return ''; });
      throw new Error('API error ' + response.status + ': ' + errTxt.slice(0, 200));
    }

    RateLimiter.reportSuccess();

    const data = await response.json();
    const translated = (data.choices?.[0]?.message?.content || '').trim();
    debugLog('YT-Subs', 'translateSubtitleGroup ok: ' + (Date.now() - startedAt) + 'ms text="' + String(isBatch ? inputTexts.join(' ') : text).slice(0, 40) + '"');
    if (isBatch) {
      return parseTranslationArray(translated, inputTexts.length);
    }
    return translated;
  } catch (err) {
    debugLog('YT-Subs', 'translateSubtitleGroup failed: ' + (Date.now() - startedAt) + 'ms text="' + String(isBatch ? inputTexts.join(' ') : text).slice(0, 40) + '" ' + err.message);
    throw err;
  }
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function getSubtitleTranslationCacheKey(text, options) {
  const opts = options || {};
  const normalized = cleanCueText(text, { forTranslation: true }).toLowerCase();
  return [
    'ytSubCache',
    opts.videoId || '',
    opts.sourceLanguage || '',
    opts.targetLanguage || '',
    opts.modelKey || '',
    opts.modelId || '',
    hashSubtitleText(normalized),
  ].join(':');
}

async function getCachedSubtitleTranslation(cacheKey) {
  if (subtitleTranslationCache.has(cacheKey)) {
    return subtitleTranslationCache.get(cacheKey);
  }
  const stored = await storageLocalGet(cacheKey);
  if ((typeof stored === 'string' && stored) || Array.isArray(stored)) {
    subtitleTranslationCache.set(cacheKey, stored);
    return stored;
  }
  return '';
}

async function rememberSubtitleTranslation(cacheKey, translated) {
  if (!translated) return;
  subtitleTranslationCache.set(cacheKey, translated);
  storageLocalSet(cacheKey, translated).catch(function (err) {
    debugLog('YT-Subs', 'subtitle cache write failed: ' + err.message);
  });
  if (subtitleTranslationCache.size > TRANSLATION_CACHE_MAX_SIZE) {
    const oldestKey = subtitleTranslationCache.keys().next().value;
    subtitleTranslationCache.delete(oldestKey);
  }
}

async function getSubtitleCacheCoverage(groups, settings) {
  const modelKey = settings.defaultModel || 'agnes-ai';
  const targetLang = settings.targetLanguage || 'zh-CN';
  const models = settings.models || {};
  const model = models[modelKey] || {};
  let cached = 0;

  for (const group of groups) {
    const groupText = group.text || group.texts.join(' ');
    const cacheKey = getSubtitleTranslationCacheKey(groupText, {
      videoId: settings.videoId,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: targetLang,
      modelKey,
      modelId: model.modelId,
    });
    const value = await getCachedSubtitleTranslation(cacheKey);
    if (Array.isArray(value) && value.length >= group.cueIndices.length) {
      cached += 1;
    } else if (typeof value === 'string' && value && group.cueIndices.length === 1) {
      cached += 1;
    }
  }

  return {
    cachedGroups: cached,
    totalGroups: groups.length,
    complete: groups.length > 0 && cached === groups.length,
    progress: groups.length > 0 ? Math.round(cached / groups.length * 100) : 0,
  };
}

async function hydrateCachedTranslations(cues, groups, settings) {
  const nextCues = cues.map(function (cue) { return { ...cue }; });
  const modelKey = settings.defaultModel || 'agnes-ai';
  const targetLang = settings.targetLanguage || 'zh-CN';
  const models = settings.models || {};
  const model = models[modelKey] || {};

  for (const group of groups) {
    const groupText = group.text || group.texts.join(' ');
    const cacheKey = getSubtitleTranslationCacheKey(groupText, {
      videoId: settings.videoId,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: targetLang,
      modelKey,
      modelId: model.modelId,
    });
    const value = await getCachedSubtitleTranslation(cacheKey);
    let translations = [];
    if (Array.isArray(value)) {
      translations = normalizeTranslationArray(value, group.cueIndices.length);
    } else if (typeof value === 'string' && value && group.cueIndices.length === 1) {
      translations = [value];
    }
    group.cueIndices.forEach(function (cueIndex, idx) {
      if (translations[idx]) {
        nextCues[cueIndex] = { ...nextCues[cueIndex], translated: translations[idx] };
      }
    });
  }

  return nextCues;
}

function hashSubtitleText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function storageLocalGet(key) {
  return new Promise(function (resolve) {
    try {
      if (!chrome.storage || !chrome.storage.local) {
        resolve('');
        return;
      }
      chrome.storage.local.get(key, function (items) {
        if (chrome.runtime && chrome.runtime.lastError) {
          debugLog('YT-Subs', 'subtitle cache read failed: ' + chrome.runtime.lastError.message);
          resolve('');
          return;
        }
        resolve(items && items[key] ? items[key] : '');
      });
    } catch (_err) {
      resolve('');
    }
  });
}

function parseTranslationArray(text, expectedLength) {
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_err) {
    const match = String(text || '').match(/\[[\s\S]*\]/);
    if (match) {
      parsed = JSON.parse(match[0]);
    }
  }
  return normalizeTranslationArray(parsed, expectedLength);
}

function storageLocalSet(key, value) {
  return new Promise(function (resolve, reject) {
    try {
      if (!chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }
      chrome.storage.local.set({ [key]: value }, function () {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(function () {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('Translation request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTranslationArray(value, expectedLength) {
  if (!Array.isArray(value)) {
    throw new Error('Translation response is not an array');
  }
  const normalized = value.map(function (item) {
    return String(item || '').trim();
  });
  while (normalized.length < expectedLength) {
    normalized.push('');
  }
  return normalized.slice(0, expectedLength);
}

function getSubtitleMessage(key, fallback) {
  try {
    return chrome.i18n.getMessage(key) || fallback;
  } catch (_err) {
    return fallback;
  }
}

/**
 * 全文本字幕重写：将原始 ASR 碎片一次性发送给 AI
 * AI 负责：清洗 → 断句 → 分配时间 → 翻译
 * 适合长上下文模型（如 Agnes-2.0-Flash 1M Token）
 *
 * 网络中断时等待 window.online 事件恢复后自动重试；
 * 在线但 API 报错（400/401/500）不重试，立即返回 null；
 * 在线但 fetch 异常（DNS/CORS 等）也返回 null，不重试。
 *
 * 成功返回 [{start, end, original, translated}, ...]
 * 失败返回 null（由调用方降级到增量翻译）
 */
async function rewriteSubtitleTranscript(cues, settings) {
  if (!cues || cues.length === 0) {
    debugLog('YT-Subs', 'rewriteSubtitleTranscript: no cues, skipping');
    return null;
  }

  const modelKey = settings.defaultModel || 'agnes-ai';
  const models = settings.models || {};
  const model = models[modelKey];
  debugLog('YT-Subs', 'rewriteSubtitleTranscript: modelKey=' + modelKey + ' model=' + (model ? 'found' : 'not found') + ' apiKey=' + (model && model.apiKey ? 'set' : 'empty'));
  if (!model || !model.apiKey) {
    debugLog('YT-Subs', 'rewriteSubtitleTranscript: model not configured or apiKey missing, falling back to incremental');
    return null;
  }

  const prompt = TranslatePrompt.buildRewritePrompt({
    cues: cues,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage || 'zh-CN',
    videoTitle: settings.videoTitle || null,
  });

  const apiUrl = model.apiUrl.replace(/\/+$/, '') + '/chat/completions';

  while (true) {
    var startedAt = Date.now();
    debugLog('YT-Subs', 'rewriteSubtitleTranscript: sending ' + cues.length + ' cues to ' + model.modelId);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + model.apiKey,
        },
        body: JSON.stringify({
          model: model.modelId,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          max_tokens: 65536,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errTxt = await response.text().catch(function () { return ''; });
        debugLog('YT-Subs', 'rewriteSubtitleTranscript API error ' + response.status + ': ' + errTxt.slice(0, 200));
        return null; // API 错误不重试
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      debugLog('YT-Subs', 'rewriteSubtitleTranscript done: ' + (Date.now() - startedAt) + 'ms responseLen=' + content.length);
      return content ? parseRewriteResponse(content, cues) : null;
    } catch (err) {
      // 网络断开导致 fetch 失败 → 等待恢复，不主动重试
      if (!navigator.onLine) {
        debugLog('YT-Subs', 'rewriteSubtitleTranscript: network lost, waiting for online event...');
        await waitForOnline();
        debugLog('YT-Subs', 'rewriteSubtitleTranscript: network restored, resuming');
        // 网络已恢复 → 重新 fetch
      } else {
        // 在线但 fetch 异常（DNS/CORS/TLS 等不可恢复错误）
        debugLog('YT-Subs', 'rewriteSubtitleTranscript: fetch error while online: ' + err.message);
        return null;
      }
    }
  }
}

/**
 * 无限等待网络恢复（不超时）
 * 只有 window.online 事件触发才返回
 */
function waitForOnline() {
  return new Promise(function (resolve) {
    if (navigator.onLine) {
      resolve();
      return;
    }
    window.addEventListener('online', function onOnline() {
      resolve();
    }, { once: true });
  });
}

/**
 * 解析 AI 返回的全文本重写结果
 * 尝试多种解析策略，确保健壮性
 * @param {string} content - AI 返回的文本
 * @param {Array} originalCues - 原始 cues（用于校验时间范围）
 * @returns {Array|null} [{start, end, original, translated}, ...] 或 null
 */
function parseRewriteResponse(content, originalCues) {
  if (!content) return null;

  // 提取 JSON 字符串：优先尝试完整 parse，支持 markdown 代码块
  var jsonStr = content.trim();

  // 尝试提取 ```json ... ``` 代码块
  var codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // 尝试找到第一个 [ 到最后一个 ]
  var arrayStart = jsonStr.indexOf('[');
  var arrayEnd = jsonStr.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    jsonStr = jsonStr.slice(arrayStart, arrayEnd + 1);
  }

  var parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    // 尝试逐行修复：某些 AI 会在 JSON 后加多余内容
    try {
      parsed = JSON.parse(jsonStr.replace(/[\s\S]*?(\[[\s\S]*)/, '$1'));
    } catch (e2) {
      debugLog('YT-Subs', 'parseRewriteResponse: JSON parse failed: ' + e2.message);
      return null;
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  // 校验和标准化每一项
  var minTime = 0;
  var maxTime = 0;
  if (originalCues && originalCues.length > 0) {
    minTime = originalCues[0].start;
    maxTime = originalCues[originalCues.length - 1].end;
  }

  var results = [];
  for (var i = 0; i < parsed.length; i++) {
    var item = parsed[i];
    if (!item || typeof item !== 'object') continue;

    var start = Number(item.start);
    var end = Number(item.end);
    var original = String(item.original || item.text || '').trim();
    var translated = String(item.translated || '').trim();

    // 校验时间
    if (isNaN(start) || isNaN(end)) continue;
    if (end <= start) continue;
    if (end < minTime || start > maxTime) continue; // 超出原始范围

    // 校验文本
    if (!original && !translated) continue;

    results.push({
      start: Math.max(start, minTime),
      end: Math.min(end, maxTime),
      original: original,
      translated: translated,
    });
  }

  // 按 start 排序
  results.sort(function (a, b) { return a.start - b.start; });

  // 如果有效结果太少（不足 30%），视为失败
  var validThreshold = Math.max(1, Math.floor(parsed.length * 0.3));
  if (results.length < validThreshold) {
    debugLog('YT-Subs', 'parseRewriteResponse: too few valid entries ' + results.length + '/' + parsed.length);
    return null;
  }

  debugLog('YT-Subs', 'parseRewriteResponse: valid ' + results.length + '/' + parsed.length + ' entries');
  return results;
}
