/* ═══════════════════════════════════════════════
   youtube-subtitles.js — 字幕获取、解析、清洗、翻译
   新方案：本地断句 + 批量 AI 翻译，时间戳全来自 JSON3 原始数据
   ═══════════════════════════════════════════════ */

const TRANSLATION_REQUEST_TIMEOUT_MS = 60000;
const TRANSLATION_CACHE_MAX_SIZE = 600;
const TRANSLATION_MAX_RETRIES = 2;
const TRANSLATION_RETRY_BASE_DELAY_MS = 1200;
const subtitleTranslationCache = new Map();

// translate-prompt.js 已由 manifest 加载，提供 window.TranslatePrompt

/**
 * 从 YouTube 页面提取字幕数据（3 级降级）
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

  if (captionsData) {
    const trackUrl = captionsData.baseUrl;
    debugLog('YT-Subs', 'track URL: ' + trackUrl + ' lang: ' + language);
    rawData = await fetchSubtitleFile(trackUrl);
  }

  // 方法3: 拦截 YouTube 播放器自己的字幕请求（绕过 PoToken）
  if (!rawData || rawData.length === 0) {
    debugLog('YT-Subs', 'trying fetch via interceptor (bypass PoToken)...');
    try {
      const intercepted = await waitForInterceptedTimedtext(60000, videoId);
      debugLog('YT-Subs', 'interceptor got data: textLen=' + intercepted.text.length + ' url=' + intercepted.url);
      rawData = intercepted.text;
      const langMatch = intercepted.url.match(/[?&]lang=([^&]+)/);
      if (langMatch) language = decodeURIComponent(langMatch[1]);
    } catch (interceptorErr) {
      debugLog('YT-Subs', 'interceptor failed: ' + interceptorErr.message);
    }
  }

  if (!rawData || rawData.length === 0) {
    console.error('[YT-Subs] FAILED: no subtitle data from any method');
    throw new Error('No subtitles available for this video');
  }

  // 解析 + 本地断句
  var parsed = parseSubtitleData(rawData);
  parsed.language = language;

  // 清洗每句文本
  for (var i = 0; i < parsed.sentences.length; i++) {
    parsed.sentences[i].text = cleanCueText(parsed.sentences[i].text, { forTranslation: false });
  }

  // 过滤空句
  parsed.sentences = parsed.sentences.filter(function (s) { return s.text && s.text.length > 0; });

  debugLog('YT-Subs', 'fetchSubtitles done: ' + parsed.sentences.length + ' sentences, lang=' + language);
  return parsed;
}

// 快速检测缓存，避免 popup 轮询时重复下载 2MB 页面
const quickDetectCache = new Map();

/**
 * 快速检测字幕是否可用（仅检查元数据，不下载字幕文件）
 * 结果按 videoId 缓存
 */
async function quickDetectSubtitles(videoId) {
  var cached = quickDetectCache.get(videoId);
  if (cached) return cached;

  debugLog('YT-Subs', 'quickDetectSubtitles start: ' + videoId);

  let captionsData = extractFromPlayerResponse();
  debugLog('YT-Subs', 'quickDetect extractFromPlayerResponse: ' + (captionsData ? 'found' : 'not found'));

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
    var result = { available: false };
    quickDetectCache.set(videoId, result);
    return result;
  }

  var result = {
    available: true,
    language: captionsData.language || 'unknown',
    baseUrl: captionsData.baseUrl,
  };
  quickDetectCache.set(videoId, result);
  if (quickDetectCache.size > 20) {
    var firstKey = quickDetectCache.keys().next().value;
    quickDetectCache.delete(firstKey);
  }
  return result;
}

async function getSubtitleTrackInfo(videoId) {
  let captionsData = extractFromPlayerResponse();
  if (!captionsData) captionsData = await fetchFromPage(videoId);
  if (!captionsData) return null;
  return { language: captionsData.language || 'unknown', baseUrl: captionsData.baseUrl || '' };
}

/**
 * 从页面嵌入的 ytInitialPlayerResponse 中提取字幕数据
 */
function extractFromPlayerResponse() {
  try {
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
            return { baseUrl: track.baseUrl, language: track.languageCode || track.name?.simpleText || 'unknown' };
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
    const url = 'https://www.youtube.com/watch?v=' + videoId;
    debugLog('YT-Subs', 'fetchFromPage: fetching ' + url);
    const resp = await fetch(url);
    debugLog('YT-Subs', 'fetchFromPage: response status ' + resp.status);
    const html = await resp.text();
    debugLog('YT-Subs', 'fetchFromPage: HTML length ' + html.length);
    const match = html.match(/"captionTracks":(\[.*?\])/);
    debugLog('YT-Subs', 'fetchFromPage regex match: ' + (match ? 'found, match[1] len:' + match[1].length : 'not found'));
    if (match) {
      const tracks = JSON.parse(match[1]);
      debugLog('YT-Subs', 'fetchFromPage: parsed ' + tracks.length + ' tracks');
      if (tracks.length > 0) {
        debugLog('YT-Subs', 'fetchFromPage: first track: ' + (tracks[0].languageCode || '?') + ' baseUrl: ' + !!tracks[0].baseUrl);
        return { baseUrl: tracks[0].baseUrl, language: tracks[0].languageCode || 'unknown' };
      }
    }
  } catch (e) {
    console.warn('[YT-Subs] fetchFromPage error:', e);
  }
  return null;
}

/**
 * 获取字幕文件内容（多客户端降级）
 */
async function fetchSubtitleFile(trackUrl) {
  debugLog('YT-Subs', 'fetchSubtitleFile for track: ' + trackUrl.slice(0, 80) + '...');

  const videoId = extractVideoId(trackUrl);
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
    const jsonResp = await fetch(jsonUrl, { headers: { 'Accept': 'application/json,*/*' } });
    if (jsonResp.ok) {
      const jsonText = await jsonResp.text();
      debugLog('YT-Subs', 'fetchTimedtext [' + label + '] json3 response: textLen=' + jsonText.length + ' preview=' + jsonText.slice(0, 120).replace(/\n/g, '\\n'));
      if (jsonText && jsonText.trim().startsWith('{')) return jsonText;
    }
  } catch (e) {
    debugLog('YT-Subs', 'fetchTimedtext [' + label + '] json3 failed: ' + e.message);
  }

  const resp = await fetch(url, { headers: { 'Accept': 'application/xml,text/xml,application/json,*/*' } });
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

async function fetchPlayerResponse(videoId, clientName) {
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

  if (clientName === 'WEB_EMBEDDED_PLAYER') {
    context.thirdParty = { embedUrl: 'https://www.youtube.com' };
  }
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

  const body = { videoId: videoId, context: context };

  const resp = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSy...qcW8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

// ═══════════════════════════════════════════════
// 解析 & 本地断句
// ═══════════════════════════════════════════════

const SENTENCE_END_RE = /[.?!。？！]$/;

/**
 * 解析字幕数据：JSON3 → 词级解析 → 本地断句；XML → 短语级解析
 * @returns {{ sentences: Array<{start, end, text}>, language: string }}
 */
function parseSubtitleData(rawData) {
  if (!rawData || rawData.length === 0) return { sentences: [], language: 'unknown' };

  if (rawData.trim().startsWith('{')) {
    try {
      var json = JSON.parse(rawData);
      if (json && json.events && Array.isArray(json.events)) {
        var words = parseJson3ToWords(json);
        var sentences = segmentSentences(words);
        debugLog('YT-Subs', 'parseJson3ToWords: ' + words.length + ' words → ' + sentences.length + ' sentences');
        return { sentences: sentences, words: words, language: 'unknown' };
      }
    } catch (e) { /* fall through to XML */ }
  }

  return parseSubtitleDataXml(rawData);
}

function parseSubtitleDataXml(rawData) {
  var cues = parseXmlSubtitle(rawData);
  var sentences = cues.map(function (cue) {
    return { start: cue.start, end: cue.end, text: cue.text };
  });
  return { sentences: sentences, language: 'unknown' };
}

/**
 * 从 JSON3 事件中提取词序列，保留每个词的精确时间戳
 * 支持：短语级（无 tOffsetMs）、词级（有 tOffsetMs）、显示窗口模型（有 aAppend）
 */
function parseJson3ToWords(json) {
  var words = [];
  var events = json.events || [];

  for (var ei = 0; ei < events.length; ei++) {
    var ev = events[ei];
    if (!ev.segs || ev.segs.length === 0) continue;

    var tStart = ev.tStartMs || 0;
    var tEnd = tStart + (ev.dDurationMs || 0);
    var isAppend = (ev.aAppend || 0) === 1;
    var segs = ev.segs;

    if (isAppend && segs.length === 1 && !(segs[0].utf8 || '').trim()) {
      words.push({ text: '', start: tStart, end: tEnd, lineBreak: true, nonSpeech: false, speakerChange: false });
      continue;
    }

    for (var si = 0; si < segs.length; si++) {
      var seg = segs[si];
      var text = seg.utf8 || '';
      var offset = seg.tOffsetMs || 0;
      var absStart = tStart + offset;
      var absEnd;
      if (si + 1 < segs.length) {
        absEnd = tStart + (segs[si + 1].tOffsetMs || 0);
      } else {
        absEnd = tEnd;
      }

      var isNonSpeech = !('acAsrConf' in seg);
      var isSpeakerChange = seg.isSpeakerChange === 1;

      words.push({
        text: text,
        start: absStart,
        end: absEnd,
        lineBreak: false,
        nonSpeech: isNonSpeech,
        speakerChange: isSpeakerChange,
      });
    }
  }

  return words;
}

/**
 * 本地断句：按标点切分 + 碎片合并
 */
function segmentSentences(words) {
  var cleanWords = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (w.lineBreak || w.nonSpeech) continue;
    var t = (w.text || '').replace(/^>>\s*/, '').trim();
    if (!t) continue;
    cleanWords.push({ text: t, start: w.start, end: w.end });
  }

  if (cleanWords.length === 0) return [];

  var segments = [];
  var current = [];
  for (var j = 0; j < cleanWords.length; j++) {
    current.push(cleanWords[j]);
    if (SENTENCE_END_RE.test(cleanWords[j].text)) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);

  var merged = [];
  for (var k = 0; k < segments.length; k++) {
    var seg = segments[k];
    var lastText = seg[seg.length - 1].text;
    var endsWithSentEnd = SENTENCE_END_RE.test(lastText);
    if (!endsWithSentEnd && seg.length <= FRAGMENT_MERGE_MAX_WORDS && k + 1 < segments.length) {
      segments[k + 1] = seg.concat(segments[k + 1]);
    } else {
      merged.push(seg);
    }
  }

  var result = [];
  for (var m = 0; m < merged.length; m++) {
    if (merged[m].length <= TINY_SENTENCE_MAX_WORDS && m + 1 < merged.length) {
      merged[m + 1] = merged[m].concat(merged[m + 1]);
    } else {
      result.push(merged[m]);
    }
  }

  var sentences = [];
  for (var n = 0; n < result.length; n++) {
    var sent = result[n];
    if (sent.length === 0) continue;
    var textParts = [];
    for (var p = 0; p < sent.length; p++) textParts.push(sent[p].text);
    var fullText = textParts.join(' ').replace(/\s+/g, ' ').trim();
    if (!fullText) continue;
    sentences.push({
      start: sent[0].start / 1000.0,
      end: sent[sent.length - 1].end / 1000.0,
      text: fullText,
    });
  }

  return sentences;
}

/**
 * 解析 XML 格式字幕（保留原逻辑）
 */
function parseXmlSubtitle(xmlText) {
  const cues = [];
  let doc;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(xmlText, 'text/xml');
    var parseErr = doc.querySelector('parsererror');
    if (parseErr) debugLog('YT-Subs', 'parseXmlSubtitle: DOMParser error: ' + parseErr.textContent.slice(0, 200));
  } catch (e) {
    debugLog('YT-Subs', 'parseXmlSubtitle: DOMParser threw: ' + e.message);
    return cues;
  }

  var timedEls = doc.querySelectorAll('p[t], wp[t]');
  if (timedEls.length > 0) {
    timedEls.forEach(function (el) {
      var t = parseFloat(el.getAttribute('t'));
      var d = parseFloat(el.getAttribute('d'));
      if (isNaN(t)) return;
      var textEl = el.querySelector('text');
      var text = textEl ? textEl.textContent : el.textContent;
      if (!text) return;
      text = text.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      if (text) cues.push({ start: t / 1000, end: (t + (d || 0)) / 1000, text: text });
    });
    return cues;
  }

  const textEls = doc.querySelectorAll('text');
  textEls.forEach(function (el) {
    var start = parseFloat(el.getAttribute('start'));
    var dur = parseFloat(el.getAttribute('dur') || '2');
    var text = el.textContent.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (text) cues.push({ start: start, end: start + dur, text: text });
  });

  return cues;
}

/**
 * 清洗字幕文本（委托给 TranslatePrompt）
 */
function cleanCueText(text, options) {
  return TranslatePrompt.cleanCueText(text, options || {});
}

// ═══════════════════════════════════════════════
// 批量翻译（新方案：本地已断句，AI 只翻译）
// ═══════════════════════════════════════════════

// 断句合并阈值
const FRAGMENT_MERGE_MAX_WORDS = 3;     // 逗号结尾片段≤此值合并到下一句
const TINY_SENTENCE_MAX_WORDS = 2;      // 最终≤此值的句子合并
const MAX_TRANSLATION_TOKENS = 65536;    // AI 最大输出 token 数
const TRANSLATION_TEMPERATURE = 0.3;     // 翻译 temperature

const BATCH_SIZE = 40;
const BATCH_CONTEXT_SIZE = 5;  // 每批传给下一批的上下文句子数

/**
 * 批量翻译已断句的字幕
 * 短视频（≤40句）：单批翻译；长视频：分批串行，每批带上一批最后 5 句译文作上下文
 */
async function batchTranslateSentences(sentences, settings, onProgress, signal) {
  var modelKey = settings.defaultModel || 'agnes-ai';
  var models = settings.models || {};
  var model = models[modelKey];

  if (!model || !model.apiKey) {
    throw new Error(getSubtitleMessage('noApiKey', '请先在设置中配置 API Key'));
  }

  var targetLang = settings.targetLanguage || 'zh-CN';

  // 缓存检查
  var allCached = true;
  var cachedResults = [];
  for (var i = 0; i < sentences.length; i++) {
    var cacheKey = getSubtitleTranslationCacheKey(sentences[i].text, {
      videoId: settings.videoId, sourceLanguage: settings.sourceLanguage,
      targetLanguage: targetLang, modelKey: modelKey, modelId: model.modelId,
    });
    var cached = await getCachedSubtitleTranslation(cacheKey);
    if (cached && typeof cached === 'string') { cachedResults[i] = cached; }
    else { cachedResults[i] = null; allCached = false; }
  }
  if (allCached) {
    debugLog('YT-Subs', 'batchTranslateSentences: all ' + sentences.length + ' sentences cached');
    return cachedResults;
  }

  // 单批（短视频）
  if (sentences.length <= BATCH_SIZE) {
    debugLog('YT-Subs', 'batchTranslateSentences: single batch, ' + sentences.length + ' sentences');
    var results = await translateOneBatch(sentences, settings, model, targetLang, null, signal);
    if (onProgress) onProgress({ completedSentences: sentences.length, totalSentences: sentences.length, currentBatch: 1, totalBatches: 1 });
    return results;
  }

  // 分批串行（长视频）
  var batches = [];
  for (var bi = 0; bi < sentences.length; bi += BATCH_SIZE) {
    batches.push({ start: bi, sentences: sentences.slice(bi, bi + BATCH_SIZE) });
  }
  debugLog('YT-Subs', 'batchTranslateSentences: ' + sentences.length + ' sentences → ' + batches.length + ' batches');

  var allResults = new Array(sentences.length);
  var prevContexts = null;

  for (var b = 0; b < batches.length; b++) {
    if (signal && signal.aborted) throw new Error('Translation cancelled');

    var batch = batches[b];
    var batchResults = await translateOneBatch(batch.sentences, settings, model, targetLang, prevContexts, signal);

    for (var ri = 0; ri < batchResults.length; ri++) allResults[batch.start + ri] = batchResults[ri];

    for (var ci = 0; ci < batch.sentences.length; ci++) {
      var ck = getSubtitleTranslationCacheKey(batch.sentences[ci].text, {
        videoId: settings.videoId, sourceLanguage: settings.sourceLanguage,
        targetLanguage: targetLang, modelKey: modelKey, modelId: model.modelId,
      });
      await rememberSubtitleTranslation(ck, batchResults[ci] || '');
    }

    if (b < batches.length - 1) {
      var ctxStart = Math.max(0, batch.sentences.length - BATCH_CONTEXT_SIZE);
      prevContexts = [];
      for (var ctx = ctxStart; ctx < batch.sentences.length; ctx++) {
        prevContexts.push({ index: batch.start + ctx, original: batch.sentences[ctx].text, translated: batchResults[ctx] || '' });
      }
    }

    if (onProgress) {
      onProgress({ completedSentences: batch.start + batchResults.length, totalSentences: sentences.length, currentBatch: b + 1, totalBatches: batches.length });
    }

    if (b < batches.length - 1) await delay(500);
  }

  return allResults;
}

/**
 * 翻译单批句子
 */
async function translateOneBatch(sentences, settings, model, targetLang, prevContexts, signal) {
  var apiUrl = model.apiUrl.replace(/\/+$/, '') + '/chat/completions';

  var prompt = TranslatePrompt.buildBatchTranslatePrompt({
    sentences: sentences.map(function (s) { return s.text; }),
    targetLanguage: targetLang,
    sourceLanguage: settings.sourceLanguage,
    videoTitle: settings.videoTitle || null,
    prevContexts: prevContexts,
  });

  var startedAt = Date.now();
  var lastError;

  for (var attempt = 0; attempt <= TRANSLATION_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        debugLog('YT-Subs', 'translateOneBatch retry ' + attempt + '/' + TRANSLATION_MAX_RETRIES);
        await delay(TRANSLATION_RETRY_BASE_DELAY_MS * attempt);
      }

      var response = await fetchWithTimeout(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + model.apiKey },
        body: JSON.stringify({
          model: model.modelId,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          max_tokens: model.maxTokens || MAX_TRANSLATION_TOKENS,
          temperature: model.temperature != null ? model.temperature : TRANSLATION_TEMPERATURE,
        }),
        signal: signal,
      }, TRANSLATION_REQUEST_TIMEOUT_MS);

      if (!response.ok) {
        var errTxt = await response.text().catch(function () { return ''; });
        throw new Error('API error ' + response.status + ': ' + errTxt.slice(0, 200));
      }

      var data = await response.json();
      var content = (data.choices?.[0]?.message?.content || '').trim();
      var results = parseTranslationArray(content, sentences.length);

      debugLog('YT-Subs', 'translateOneBatch: ' + (Date.now() - startedAt) + 'ms, ' + sentences.length + ' sentences, retries=' + attempt);
      return results;
    } catch (err) {
      lastError = err;
      if (signal && signal.aborted) throw err;
    }
  }

  throw lastError || new Error('Translation failed after ' + TRANSLATION_MAX_RETRIES + ' retries');
}

// ═══════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function getSubtitleTranslationCacheKey(text, options) {
  const opts = options || {};
  const normalized = cleanCueText(text, { forTranslation: true }).toLowerCase();
  return ['ytSubCache', opts.videoId || '', opts.sourceLanguage || '', opts.targetLanguage || '', opts.modelKey || '', opts.modelId || '', hashSubtitleText(normalized)].join(':');
}

async function getCachedSubtitleTranslation(cacheKey) {
  if (subtitleTranslationCache.has(cacheKey)) return subtitleTranslationCache.get(cacheKey);
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
      if (!chrome.storage || !chrome.storage.local) { resolve(''); return; }
      chrome.storage.local.get(key, function (items) {
        if (chrome.runtime && chrome.runtime.lastError) { resolve(''); return; }
        resolve(items && items[key] ? items[key] : '');
      });
    } catch (_err) { resolve(''); }
  });
}

function parseTranslationArray(text, expectedLength) {
  let parsed = null;
  var rawText = String(text || '').trim();
  try { parsed = JSON.parse(rawText); } catch (_err) {
    // 非贪婪提取第一个 JSON 数组（防止 AI 在数组后加注释）
    const match = rawText.match(/\[[\s\S]*?\]/);
    if (match) try { parsed = JSON.parse(match[0]); } catch (_e2) {}
  }
  // 容错：单句时 AI 可能返回纯文本（无引号、无括号）
  if (expectedLength === 1) {
    if (typeof parsed === 'string') { parsed = [parsed]; }
    else if (!Array.isArray(parsed) && rawText) { parsed = [rawText]; }
  }
  return normalizeTranslationArray(parsed, expectedLength);
}

function storageLocalSet(key, value) {
  return new Promise(function (resolve, reject) {
    try {
      if (!chrome.storage || !chrome.storage.local) { resolve(); return; }
      chrome.storage.local.set({ [key]: value }, function () {
        if (chrome.runtime && chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    } catch (err) { reject(err); }
  });
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('Translation request timed out');
    throw err;
  } finally { clearTimeout(timer); }
}

function normalizeTranslationArray(value, expectedLength) {
  if (!Array.isArray(value)) throw new Error('Translation response is not an array');
  const normalized = value.map(function (item) { return String(item || '').trim(); });
  while (normalized.length < expectedLength) normalized.push('');
  return normalized.slice(0, expectedLength);
}

function getSubtitleMessage(key, fallback) {
  try { return chrome.i18n.getMessage(key) || fallback; } catch (_err) { return fallback; }
}
