/* ═══════════════════════════════════════════════
   youtube-subtitles.js — 字幕获取、解析、清洗
   ═══════════════════════════════════════════════ */

/**
 * 从 YouTube 页面提取字幕数据
 */
async function fetchSubtitles(videoId) {
  // 方法1: 从 ytInitialPlayerResponse 提取
  let captionsData = extractFromPlayerResponse();

  // 方法2: 重新请求页面 HTML（fallback）
  if (!captionsData) {
    captionsData = await fetchFromPage(videoId);
  }

  if (!captionsData) {
    throw new Error('No subtitles available for this video');
  }

  // 获取字幕轨道 URL
  const trackUrl = captionsData.baseUrl;
  const rawData = await fetchSubtitleFile(trackUrl);

  // 解析为时间轴 cue 数组
  const cues = parseSubtitleData(rawData);

  // 清洗
  const cleaned = cleanCues(cues);

  return { cues: cleaned, language: captionsData.language };
}

/**
 * 从页面嵌入的 ytInitialPlayerResponse 中提取字幕数据
 */
function extractFromPlayerResponse() {
  try {
    const scriptTag = document.querySelector('script');
    // 查找 window.ytInitialPlayerResponse 的赋值
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      const match = text.match(/ytInitialPlayerResponse\s*=\s*({.*?});\s*\n/);
      if (match) {
        const data = JSON.parse(match[1]);
        const captions = data?.captions?.playerCaptionsTracklistRenderer;
        if (captions?.captionTracks?.length > 0) {
          const track = captions.captionTracks[0];
          return {
            baseUrl: track.baseUrl,
            language: track.languageCode || track.name?.simpleText || 'unknown',
          };
        }
      }
    }
  } catch (e) {
    console.warn('Failed to extract captions from player response:', e);
  }
  return null;
}

/**
 * 通过重新请求视频页面获取字幕数据（fallback）
 */
async function fetchFromPage(videoId) {
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const html = await resp.text();
    const match = html.match(/"captionTracks":(\[.*?\])/);
    if (match) {
      const tracks = JSON.parse(match[1]);
      if (tracks.length > 0) {
        return {
          baseUrl: tracks[0].baseUrl,
          language: tracks[0].languageCode || 'unknown',
        };
      }
    }
  } catch (e) {
    console.warn('Failed to fetch captions from page:', e);
  }
  return null;
}

/**
 * 获取字幕文件内容
 */
async function fetchSubtitleFile(url) {
  // 通过 Service Worker 代理请求（避免 CORS）
  const resp = await sendMessage({
    type: 'PROXY_FETCH',
    url: url,
  });

  if (resp.status !== 200) {
    throw new Error(`Failed to fetch subtitles: ${resp.status}`);
  }

  return resp.text;
}

/**
 * 解析 YouTube 字幕 XML/JSON 为 cue 数组
 * YouTube 字幕格式：<text start="seconds" dur="seconds">text content</text>
 */
function parseSubtitleData(xmlText) {
  const cues = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const textEls = doc.querySelectorAll('text');

  textEls.forEach(el => {
    const start = parseFloat(el.getAttribute('start'));
    const dur = parseFloat(el.getAttribute('dur') || '2');
    const text = el.textContent
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();

    if (text) {
      cues.push({ start, end: start + dur, text });
    }
  });

  return cues;
}

/**
 * 清洗字幕 cue
 */
function cleanCues(cues) {
  // 1. 合并相邻的短片段（时间间隔 < 0.5s 的相邻 cue 合并为一句）
  const merged = [];
  for (const cue of cues) {
    const last = merged[merged.length - 1];
    if (last && (cue.start - last.end < 0.5)) {
      last.text += ' ' + cue.text;
      last.end = cue.end;
    } else {
      merged.push({ ...cue });
    }
  }

  // 2. 清洗每段文本
  return merged.map(cue => {
    let text = cue.text;
    // 去除 HTML 标签
    text = text.replace(/<[^>]+>/g, '');
    // 去除舞台标记 [Music], [Applause], [Laughter] 等
    text = text.replace(/\[.*?\]/g, '');
    // 去除语气填充词（英文）
    text = text.replace(/\b(um|uh|er|ah|hmm|mm-hmm|uh-huh)\b/gi, '');
    // 合并重复词
    text = text.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');
    // 合并连续空格
    text = text.replace(/\s+/g, ' ').trim();
    // 基本标点补全（句末无标点时加句号）
    if (text && !/[.?!。？！，、；：""'')】」』》]$/.test(text)) {
      text += '.';
    }
    return { ...cue, text };
  }).filter(cue => cue.text.length > 0);
}

/**
 * 翻译字幕 cue 数组
 */
async function translateCues(cues, settings) {
  if (!settings.translationEnabled) return cues;

  const modelKey = 'agnes-ai'; // 使用默认模型，后续可从 settings 读取 defaultModel
  const texts = cues.map(c => c.text);

  const translatedTexts = await sendMessage({
    type: 'TRANSLATE_BATCH',
    texts,
    modelKey,
  });

  return cues.map((cue, i) => ({
    ...cue,
    translated: translatedTexts[i] || '',
  }));
}
