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

  // [Pipeline] 日志：断句清洗后的完整输出（写到全局缓冲区）
  var pipelineLines = [];
  pipelineLines.push('══════ [Pipeline] Cleaned & Segmented Sentences (' + parsed.sentences.length + ' total) ══════');
  for (var pi = 0; pi < parsed.sentences.length; pi++) {
    var ps = parsed.sentences[pi];
    pipelineLines.push('[Pipeline] #' + pi + ' │ ' + ps.start.toFixed(3) + ' → ' + ps.end.toFixed(3) + ' (' + (ps.end - ps.start).toFixed(1) + 's) │ ' + ps.text);
  }
  pipelineLines.push('══════ [Pipeline] END ══════');
  parsed._pipelineLog = pipelineLines.join('\n');
  if (window.SUBTITLE_PIPELINE_LOG === true) console.log(parsed._pipelineLog);

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

      // 非语音标记：方括号包裹的音效（如 [Music], [음악], [Applause]）
      // 也匹配带 >> 前缀的（如 >> [음악], >> [music]）
      // 注意：不能仅凭 acAsrConf 缺失判断，Gemini 字幕所有 seg 都无此字段
      var isNonSpeech = /^(>>\s*)?\[.*\]$/.test(text.trim());
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
 * 本地断句：按标点切分 + 说话人切换切分 + 时间间隔切分 + 碎片合并
 */
function segmentSentences(words) {
  var cleanWords = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    // P2: 先检查 speakerChange（即使 nonSpeech 也要切句）
    if (w.lineBreak) continue;
    if (w.nonSpeech) {
      // 如果 nonSpeech 标记了说话人切换，在 cleanWords 中插入一个空标记来强制切句
      if (w.speakerChange && cleanWords.length > 0) {
        cleanWords.push({ text: '', start: w.start, end: w.end, speakerChange: true, _ghost: true });
      }
      continue;
    }
    var t = (w.text || '').replace(/^>>\s*/, '').trim();
    if (!t) continue;
    cleanWords.push({ text: t, start: w.start, end: w.end, speakerChange: w.speakerChange });
  }

  // 清理空 ghost 标记：如果 ghost 后面紧跟着 speakerChange，合并为一个
  var realWords = [];
  for (var ri = 0; ri < cleanWords.length; ri++) {
    var rw = cleanWords[ri];
    if (rw._ghost) {
      if (realWords.length > 0 && ri + 1 < cleanWords.length) {
        // ghost 标记已完成了切句使命，跳过即可
      }
      continue;
    }
    realWords.push(rw);
  }
  cleanWords = realWords;

  if (cleanWords.length === 0) return [];

  var SENTENCE_GAP_MS = 2000; // 2秒以上间隔强制切句

  var segments = [];
  var current = [];
  var prevEndMs = 0;
  var hardBreakNext = false; // 上一个push是否因硬切句（说话人切换/时间间隔）

  for (var j = 0; j < cleanWords.length; j++) {
    var cw = cleanWords[j];

    // ghost 词：仅用于触发切句，自身不加入 current
    if (cw.text === '' && cw.speakerChange) {
      if (current.length > 0) {
        current._hardBreakAfter = true;
        segments.push(current);
        current = [];
        hardBreakNext = true;
      }
      continue;
    }

    // 说话人切换：强制切句
    if (cw.speakerChange && current.length > 0) {
      current._hardBreakAfter = true;
      segments.push(current);
      current = [];
      hardBreakNext = true;
    }
    // 时间间隔过大：强制切句（跳过首词）
    else if (current.length > 0 && (cw.start - prevEndMs) > SENTENCE_GAP_MS) {
      current._hardBreakAfter = true;
      segments.push(current);
      current = [];
      hardBreakNext = true;
    }

    current.push(cw);
    prevEndMs = cw.end;

    // 句末标点切句
    if (SENTENCE_END_RE.test(cw.text)) {
      if (hardBreakNext) current._hardBreakAfter = true;
      segments.push(current);
      current = [];
      hardBreakNext = false;
    }
  }
  if (current.length > 0) {
    if (hardBreakNext) current._hardBreakAfter = true;
    segments.push(current);
  }

  var merged = [];
  for (var k = 0; k < segments.length; k++) {
    var seg = segments[k];
    var lastText = seg[seg.length - 1].text;
    var endsWithSentEnd = SENTENCE_END_RE.test(lastText);
    if (!endsWithSentEnd && seg.length <= FRAGMENT_MERGE_MAX_WORDS && k + 1 < segments.length && !seg._hardBreakAfter) {
      segments[k + 1] = seg.concat(segments[k + 1]);
    } else {
      merged.push(seg);
    }
  }

  var result = [];
  for (var m = 0; m < merged.length; m++) {
    // 过短句合并——但完整句（有标点结尾）或硬切句不合并
    var isComplete = merged[m].length > 0 && SENTENCE_END_RE.test(merged[m][merged[m].length - 1].text);
    if (merged[m].length <= TINY_SENTENCE_MAX_WORDS && !isComplete && m + 1 < merged.length && !merged[m]._hardBreakAfter) {
      merged[m + 1] = merged[m].concat(merged[m + 1]);
    } else {
      result.push(merged[m]);
    }
  }

  var sentences = [];
  var MAX_SENTENCE_DURATION_SEC = 12.0; // P1: 8→12s，减少碎片
  var MIN_WORDS_TO_SPLIT = 6;            // P1: <6词的句子不切分

  // P0: 先标记孤立碎片（前后间隔都>5s 且 <4词 且无句末标点 = ASR幻觉垃圾）
  var SPARSE_GAP_MS = 5000;
  var MAX_SPARSE_WORDS = 3;
  for (var n = 0; n < result.length; n++) {
    var sent = result[n];
    if (sent.length === 0 || sent.length > MAX_SPARSE_WORDS) continue;
    var hasSentenceEnd = false;
    for (var pe = 0; pe < sent.length; pe++) {
      if (SENTENCE_END_RE.test(sent[pe].text)) { hasSentenceEnd = true; break; }
    }
    if (hasSentenceEnd) continue; // 有标点的完整句保留
    var gapBefore = Infinity, gapAfter = Infinity;
    if (n > 0) {
      var prevSent = result[n - 1];
      gapBefore = sent[0].start - prevSent[prevSent.length - 1].end;
    }
    if (n + 1 < result.length) {
      var nextSent = result[n + 1];
      gapAfter = nextSent[0].start - sent[sent.length - 1].end;
    }
    if (gapBefore > SPARSE_GAP_MS && gapAfter > SPARSE_GAP_MS) {
      sent._sparseGarbage = true;
    }
  }

  for (var n = 0; n < result.length; n++) {
    var sent = result[n];
    if (sent._sparseGarbage) continue; // P0: 丢弃ASR幻觉碎片
    if (sent.length === 0) continue;
    var textParts = [];
    for (var p = 0; p < sent.length; p++) textParts.push(sent[p].text);
    var fullText = textParts.join(' ').replace(/\s+/g, ' ').trim();
    if (!fullText) continue;

    var startSec = sent[0].start / 1000.0;
    var endSec = sent[sent.length - 1].end / 1000.0;
    var duration = endSec - startSec;

    if (duration > MAX_SENTENCE_DURATION_SEC && sent.length >= MIN_WORDS_TO_SPLIT) {
      // 找句子内最大的词间间隔，在该处切分
      var bestSplit = -1;
      var bestGap = 0;
      for (var q = 0; q < sent.length - 1; q++) {
        var gapMs = sent[q + 1].start - sent[q].end;
        if (gapMs > bestGap) { bestGap = gapMs; bestSplit = q; }
      }
      // 如果有>=80ms的间隔，在最大间隔处切分
      // 如果没有显著间隔（连续说话），按词数对半切分
      if (bestGap >= 80) {
        // split at bestGap position
      } else {
        bestSplit = Math.floor(sent.length / 2) - 1;
      }
      if (bestSplit > 0 && bestSplit < sent.length - 1) {
        var leftSent = sent.slice(0, bestSplit + 1);
        var rightSent = sent.slice(bestSplit + 1);
        var leftTextParts = []; for (var lp = 0; lp < leftSent.length; lp++) leftTextParts.push(leftSent[lp].text);
        var leftFull = leftTextParts.join(' ').replace(/\s+/g, ' ').trim();
        if (leftFull) {
          sentences.push({
            start: leftSent[0].start / 1000.0,
            end: leftSent[leftSent.length - 1].end / 1000.0,
            text: leftFull,
          });
        }
        result.splice(n + 1, 0, rightSent);
        continue;
      }
    }

    sentences.push({
      start: startSec,
      end: endSec,
      text: fullText,
    });
  }

  // 后处理：重叠句子截断 — 当前句的 end 不能超过下一句的 start + 300ms 缓冲
  // 解决「字幕还显示上句，音频已经在说下句」的滞后问题，同时保留 300ms 自然过渡
  var OVERLAP_BUFFER_SEC = 0.3;
  for (var ot = 0; ot < sentences.length - 1; ot++) {
    if (sentences[ot + 1].start + OVERLAP_BUFFER_SEC < sentences[ot].end) {
      sentences[ot].end = sentences[ot + 1].start + OVERLAP_BUFFER_SEC;
    }
  }

  // 后处理：跨语言 ASR 幻觉检测 — 非源语言的语音被 ASR 音译成重复短句
  // 规则：同一文本在 30s 窗口内出现 ≥4 次且句子 ≤4 词 → 整组丢弃
  var REPETITION_WINDOW_SEC = 30;
  var REPETITION_MIN_COUNT = 4;
  var REPETITION_MAX_WORDS = 4;
  for (var ri = 0; ri < sentences.length; ri++) {
    if (sentences[ri]._repetitionGarbage) continue;
    var rText = sentences[ri].text;
    var rWords = rText.split(/\s+/).length;
    if (rWords > REPETITION_MAX_WORDS) continue;
    var group = [ri];
    for (var rj = ri + 1; rj < sentences.length; rj++) {
      if (sentences[rj]._repetitionGarbage) continue;
      if (sentences[rj].start - sentences[ri].start > REPETITION_WINDOW_SEC) break;
      if (sentences[rj].text === rText) group.push(rj);
    }
    if (group.length >= REPETITION_MIN_COUNT) {
      for (var gk = 0; gk < group.length; gk++) {
        sentences[group[gk]]._repetitionGarbage = true;
      }
      ri += group.length - 1;
    }
  }
  sentences = sentences.filter(function (s) { return !s._repetitionGarbage; });

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
// 优先级并发翻译（播放位优先 + 2路并发 + 拖动重排）
// ═══════════════════════════════════════════════

// 断句合并阈值
const FRAGMENT_MERGE_MAX_WORDS = 3;
const TINY_SENTENCE_MAX_WORDS = 2;
const MAX_TRANSLATION_TOKENS = 65536;
const TRANSLATION_TEMPERATURE = 0.3;

const BATCH_SIZE = 40;
const BATCH_CONTEXT_SIZE = 5;
const MAX_CONCURRENT = 2;

/**
 * 批量翻译：播放位优先、2路并发、批次独立失败
 * @param {Array} sentences - 已断句数组 [{start, end, text}]
 * @param {Object} settings - 翻译配置
 * @param {Function} getCurrentTime - 返回当前播放秒数（用于优先级）
 * @param {Function} onProgress - 每批完成回调 (resultsByIndex, batchMeta)
 * @param {AbortSignal} signal
 * @returns {Promise<string[]>} 译文数组
 */
async function batchTranslateSentences(sentences, settings, getCurrentTime, onProgress, signal) {
  var modelKey = settings.defaultModel || 'agnes-ai';
  var models = settings.models || {};
  var model = models[modelKey];

  if (!model || !model.apiKey) {
    throw new Error(getSubtitleMessage('noApiKey', '请先在设置中配置 API Key'));
  }

  // 短视频：单批直接翻
  if (sentences.length <= BATCH_SIZE) {
    var results = await translateOneBatch(sentences, settings, model, null, signal);
    if (onProgress) onProgress(results, { batchIndex: 0, totalBatches: 1 });
    return results;
  }

  // 构建批次 — 自适应尺寸：长句子用更小批次避免 AI 输出超 max_tokens
  var allBatches = [];
  var batchSize = BATCH_SIZE;
  // 计算平均句长，如果 >120 字符/句，按比例缩小批次
  var totalChars = 0;
  for (var ci2 = 0; ci2 < sentences.length; ci2++) totalChars += sentences[ci2].text.length;
  var avgChars = sentences.length > 0 ? totalChars / sentences.length : 0;
  if (avgChars > 150) batchSize = 15;
  else if (avgChars > 120) batchSize = 25;
  else if (avgChars > 90) batchSize = 30;
  debugLog('YT-Subs', 'batchTranslateSentences: avgChars=' + avgChars.toFixed(0) + ' → batchSize=' + batchSize);

  for (var bi = 0; bi < sentences.length; bi += batchSize) {
    allBatches.push({
      id: allBatches.length,
      startIndex: bi,
      sentences: sentences.slice(bi, bi + batchSize),
      status: 'pending',       // pending | inFlight | completed | failed | split
      translations: null,
      retries: 0,
    });
  }

  var apiUrl = model.apiUrl.replace(/\/+$/, '') + '/chat/completions';
  var targetLang = settings.targetLanguage || 'zh-CN';
  var allResults = new Array(sentences.length);
  var completedBatches = new Map();  // batchId → { texts, translations }

  // 按距离当前播放位的远近排序
  function sortByPriority(batches) {
    var ct = getCurrentTime ? getCurrentTime() : 0;
    batches.sort(function (a, b) {
      var dA = distanceToPlayback(a, ct);
      var dB = distanceToPlayback(b, ct);
      return dA - dB;
    });
  }

  function distanceToPlayback(batch, currentTime) {
    var first = batch.sentences[0];
    var last = batch.sentences[batch.sentences.length - 1];
    var batchMid = (first.start + last.end) / 2;
    return Math.abs(batchMid - currentTime);
  }

  sortByPriority(allBatches);

  // 查缓存，跳过已译句子
  for (var ci = 0; ci < allBatches.length; ci++) {
    var batch = allBatches[ci];
    var allCached = true;
    var cached = [];
    for (var si = 0; si < batch.sentences.length; si++) {
      var cacheKey = getSubtitleTranslationCacheKey(batch.sentences[si].text, {
        videoId: settings.videoId, sourceLanguage: settings.sourceLanguage,
        targetLanguage: targetLang, modelKey: modelKey, modelId: model.modelId,
      });
      var cachedVal = await getCachedSubtitleTranslation(cacheKey);
      if (cachedVal && typeof cachedVal === 'string') {
        cached[si] = cachedVal;
      } else {
        cached[si] = null;
        allCached = false;
      }
    }
    if (allCached) {
      batch.translations = cached;
      batch.status = 'completed';
      completedBatches.set(batch.id, { texts: batch.sentences.map(function (s) { return s.text; }), translations: cached });
      for (var ri = 0; ri < cached.length; ri++) {
        allResults[batch.startIndex + ri] = cached[ri];
      }
    }
  }

  debugLog('YT-Subs', 'batchTranslateSentences: ' + sentences.length + ' sentences → ' + allBatches.length + ' batches, ' + MAX_CONCURRENT + ' concurrent');

  // 2路并发 worker
  var inFlight = 0;
  var waiters = [];

  function releaseWorker() {
    inFlight--;
    var next = waiters.shift();
    if (next) next();
  }

  async function acquireWorker() {
    while (inFlight >= MAX_CONCURRENT) {
      await new Promise(function (r) { waiters.push(r); });
    }
    inFlight++;
  }

  async function runWorker(workerId) {
    while (true) {
      if (signal && signal.aborted) break;

      // 选优先级最高的待处理批次
      var pendingBatches = allBatches.filter(function (b) { return b.status === 'pending'; });
      sortByPriority(pendingBatches);
      if (pendingBatches.length === 0) break;

      var batch = pendingBatches[0];
      batch.status = 'inFlight';

      // 找已完成批次中时间最近的作上下文
      var prevContexts = findNearestContext(batch, completedBatches, allBatches);

      try {
        await acquireWorker();
        var startedAt = Date.now();
        var batchTranslations = await translateOneBatch(batch.sentences, settings, model, prevContexts, signal);
        debugLog('YT-Subs', 'translateOneBatch: ' + (Date.now() - startedAt) + 'ms, ' + batch.sentences.length + ' sentences, worker=' + workerId);

        batch.translations = batchTranslations;
        batch.status = 'completed';
        completedBatches.set(batch.id, {
          texts: batch.sentences.map(function (s) { return s.text; }),
          translations: batchTranslations,
        });

        // 写入结果数组 + 缓存
        for (var wi = 0; wi < batchTranslations.length; wi++) {
          allResults[batch.startIndex + wi] = batchTranslations[wi];
          var ck = getSubtitleTranslationCacheKey(batch.sentences[wi].text, {
            videoId: settings.videoId, sourceLanguage: settings.sourceLanguage,
            targetLanguage: targetLang, modelKey: modelKey, modelId: model.modelId,
          });
          await rememberSubtitleTranslation(ck, batchTranslations[wi] || '');
        }
      } catch (err) {
        if (signal && signal.aborted) { releaseWorker(); break; }

        // 错误类型区分
        var isFatal = isNonRetryableError(err);
        batch.retries++;

        if (isFatal) {
          batch.status = 'failed';
          debugLog('YT-Subs', 'translateOneBatch FAILED (fatal): batch=' + batch.id + ' ' + err.message);
        } else if (batch.retries > TRANSLATION_MAX_RETRIES) {
          // 重试耗尽 → 尝试拆分为更小批次
          if (batch.sentences.length > 10) {
            var subSize = Math.ceil(batch.sentences.length / 2);
            var sub1 = batch.sentences.slice(0, subSize);
            var sub2 = batch.sentences.slice(subSize);
            allBatches.push({
              id: allBatches.length, startIndex: batch.startIndex,
              sentences: sub1, status: 'pending', translations: null, retries: 0,
            });
            allBatches.push({
              id: allBatches.length, startIndex: batch.startIndex + subSize,
              sentences: sub2, status: 'pending', translations: null, retries: 0,
            });
            batch.status = 'split';
            debugLog('YT-Subs', 'translateOneBatch SPLIT: batch=' + batch.id + ' → sub-batches ' + (allBatches.length-2) + '+' + (allBatches.length-1) + ' sizes=' + sub1.length + '+' + sub2.length);
          } else {
            // 已经很小了，放弃
            batch.status = 'failed';
            debugLog('YT-Subs', 'translateOneBatch FAILED: batch=' + batch.id + ' retries=' + batch.retries + ' ' + err.message);
          }
        } else {
          batch.status = 'pending'; // 回队重试
          debugLog('YT-Subs', 'translateOneBatch retryable: batch=' + batch.id + ' retries=' + batch.retries + ' ' + err.message);
        }
      } finally {
        releaseWorker();
      }

      // 每批完成回调
      if (onProgress && !(signal && signal.aborted)) {
        onProgress(allResults.slice(), {
          completedCount: allBatches.filter(function (b) { return b.status === 'completed'; }).length,
          failedCount: allBatches.filter(function (b) { return b.status === 'failed'; }).length,
          totalBatches: allBatches.length,
        });
      }

      if (batch.status === 'failed') {
        // 不阻断继续处理其他批次
      }
    }
  }

  // 启动并发 workers
  var workers = [];
  for (var w = 0; w < MAX_CONCURRENT; w++) {
    workers.push(runWorker(w));
  }
  await Promise.all(workers);

  return allResults;
}

/**
 * 找已完成批次中时间距离最近的，提取最后 N 句译文作上下文
 */
function findNearestContext(batch, completedBatches, allBatches) {
  if (completedBatches.size === 0) return null;

  var batchMid = (batch.sentences[0].start + batch.sentences[batch.sentences.length - 1].end) / 2;
  var nearest = null;
  var minDist = Infinity;

  completedBatches.forEach(function (ctx, batchId) {
    // 从 allBatches 找到这个批次的句子时间
    var refBatch = allBatches[batchId];
    if (!refBatch) return;
    var refMid = (refBatch.sentences[0].start + refBatch.sentences[refBatch.sentences.length - 1].end) / 2;
    var dist = Math.abs(refMid - batchMid);
    if (dist < minDist) { minDist = dist; nearest = ctx; }
  });

  if (!nearest || !nearest.texts) return null;

  var ctxLen = Math.min(BATCH_CONTEXT_SIZE, nearest.texts.length);
  var ctxStart = nearest.texts.length - ctxLen;
  var result = [];
  for (var i = ctxStart; i < nearest.texts.length; i++) {
    result.push({ index: -1, original: nearest.texts[i], translated: nearest.translations[i] || '' });
  }
  return result;
}

/**
 * 不可重试的错误
 */
function isNonRetryableError(err) {
  var msg = (err.message || '').toLowerCase();
  // 401/403 认证授权错误
  if (msg.indexOf('api error 401') !== -1 || msg.indexOf('api error 403') !== -1) return true;
  // 模型未找到
  if (msg.indexOf('api error 404') !== -1) return true;
  // JSON 解析失败 — 改用修复逻辑后改为可重试（可能是 max_tokens 截断，拆小批后能成功）
  // 旧逻辑: if (msg.indexOf('not an array') !== -1 || msg.indexOf('translation response') !== -1) return true;
  return false;
}

/**
 * 翻译单批句子
 */
async function translateOneBatch(sentences, settings, model, prevContexts, signal) {
  var targetLang = settings.targetLanguage || 'zh-CN';
  var apiUrl = model.apiUrl.replace(/\/+$/, '') + '/chat/completions';

  var prompt = TranslatePrompt.buildBatchTranslatePrompt({
    sentences: sentences.map(function (s) { return s.text; }),
    targetLanguage: targetLang,
    sourceLanguage: settings.sourceLanguage,
    videoTitle: settings.videoTitle || null,
    prevContexts: prevContexts,
  });

  var lastError;

  for (var attempt = 0; attempt <= TRANSLATION_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        var delayMs = TRANSLATION_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        debugLog('YT-Subs', 'translateOneBatch retry ' + attempt + '/' + TRANSLATION_MAX_RETRIES + ' delay=' + delayMs + 'ms');
        await delay(delayMs);
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

      if (response.status === 401 || response.status === 403 || response.status === 404) {
        var errTxt = await response.text().catch(function () { return ''; });
        throw new Error('API error ' + response.status + ': ' + errTxt.slice(0, 200));
      }

      if (response.status === 429) {
        var retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
        debugLog('YT-Subs', 'translateOneBatch 429, waiting ' + retryAfter + 's');
        await delay(retryAfter * 1000);
        throw new Error('API rate limited (429)');
      }

      if (!response.ok) {
        var errTxt2 = await response.text().catch(function () { return ''; });
        throw new Error('API error ' + response.status + ': ' + errTxt2.slice(0, 200));
      }

      var data = await response.json();
      var content = (data.choices?.[0]?.message?.content || '').trim();
      return parseTranslationArray(content, sentences.length);
    } catch (err) {
      lastError = err;
      if (signal && signal.aborted) throw err;
      // 不可重试错误立即抛
      if (isNonRetryableError(err)) throw err;
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
  // 容错：AI 输出被 max_tokens 截断，JSON 数组不完整
  // 尝试修复常见截断模式：[..., "partial → 补全为 [..., "partial"]
  if (!parsed || !Array.isArray(parsed)) {
    var repaired = tryRepairTruncatedJson(rawText);
    if (repaired) parsed = repaired;
  }
  return normalizeTranslationArray(parsed, expectedLength);
}

/**
 * 尝试修复被截断的 JSON 数组（AI 输出超出 max_tokens 时常见）
 * 模式1: ["a","b","c  → 补全后重解析
 * 模式2: ["a","b","c"]  额外文本  → 提取完整数组
 */
function tryRepairTruncatedJson(rawText) {
  if (!rawText || rawText.length < 3) return null;
  // 确保以 [ 开头
  if (rawText[0] !== '[') return null;
  // 找最后一个完整的字符串元素（以 ", 或 "] 结尾）
  // 策略：从末尾向前找最后一个 "], "], 或 "]
  var lastComplete = -1;
  // 找最后一个 " 后跟 ], 或 ] 的位置
  for (var i = rawText.length - 1; i >= 1; i--) {
    if (rawText[i] === '"') {
      // 检查这个 " 后面是 ], 还是 ]
      var after = rawText.slice(i + 1).trim();
      if (after === ']' || after === '],') {
        lastComplete = i;
        break;
      }
    }
  }
  if (lastComplete === -1) return null;
  // 尝试补全：从开头到最后一个完整元素，加上 ]
  var repaired = rawText.slice(0, lastComplete + 1) + ']';
  try { var arr = JSON.parse(repaired); if (Array.isArray(arr)) return arr; } catch (_e) {}
  // 再尝试：如果上述失败，可能是中间有截断的字符串未闭合
  // 找最后一个完整的 "string", 对
  var lastComma = rawText.lastIndexOf('",');
  if (lastComma > 0) {
    repaired = rawText.slice(0, lastComma + 2) + ']';
    try { var arr2 = JSON.parse(repaired); if (Array.isArray(arr2)) return arr2; } catch (_e) {}
  }
  return null;
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
