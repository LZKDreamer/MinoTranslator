importScripts('/src/shared/crypto-utils.js', '/src/background/storage.js', '/src/background/translator.js', '/src/shared/translate-prompt.js');

const MAX_VIDEO_TASKS = 3;
const debugLogBuffer = [];
const MAX_LOG = 500;
const videoTasks = new Map();

// 字幕翻译缓存（10 天自动清理）
const CACHE_PREFIX = 'ytSubCache';
const CACHE_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;

// 任务持久化——SW 重启后恢复已完成翻译
const STORAGE_TASKS_KEY = 'ytVideoTasks';

async function persistTasks() {
  try {
    const tasks = {};
    for (const [videoId, task] of videoTasks) {
      if (task.status !== 'canceled' && task.status !== 'available') {
        tasks[videoId] = task;
      }
    }
    await chrome.storage.local.set({ [STORAGE_TASKS_KEY]: tasks });
  } catch (_err) { /* ignore */ }
}

async function loadPersistedTasks() {
  try {
    const data = await chrome.storage.local.get(STORAGE_TASKS_KEY);
    const tasks = data[STORAGE_TASKS_KEY];
    if (tasks) {
      for (const [videoId, task] of Object.entries(tasks)) {
        if (task.status !== 'canceled') {
          videoTasks.set(videoId, task);
        }
      }
    }
  } catch (_err) { /* ignore */ }
}

// SW 启动时立即恢复已持久化的任务
loadPersistedTasks();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = messageHandlers[request.type];
  if (!handler) return false;
  handler(request, sender).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true;
});

const messageHandlers = {
  async GET_VIDEO_TASKS(request) {
    return getVideoTasks(request.targetLanguage || 'zh-CN', request.showAllCompleted);
  },

  async START_VIDEO_TASK(request) {
    const videoId = request.videoId || '';
    if (!videoId) return { error: 'Missing videoId' };

    const existing = videoTasks.get(videoId);
    if (!existing && getActiveTaskCount() >= MAX_VIDEO_TASKS) {
      return { error: '最多同时处理 3 个视频任务' };
    }

    if (existing && existing.status === 'completed') {
      await openOrFocusVideo(existing.url);
      await applyTaskToOpenTabs(existing);
      return { ok: true };
    }

    const tabId = Number(request.tabId || existing?.tabId || 0);
    if (!tabId) return { error: '需要先打开该 YouTube 视频以获取字幕' };

    const prepared = await sendTabMessage(tabId, {
      type: 'PREPARE_VIDEO_TRANSLATION',
      targetLanguage: request.targetLanguage || existing?.targetLanguage || 'zh-CN',
    }, 30000);
    if (prepared.error) return prepared;
    if (!prepared.cues || prepared.cues.length === 0) {
      return { error: '该视频没有可用字幕' };
    }

    const settings = await StorageManager.getAll();
    const modelKey = settings.defaultModel || 'agnes-ai';
    const model = settings.models?.[modelKey];
    if (!model || !model.apiKey) {
      return { error: '请先在设置中配置 API Key' };
    }

    const targetLanguage = request.targetLanguage || settings.targetLanguage || 'zh-CN';
    const apiUrl = model.apiUrl.replace(/\/+$/, '') + '/chat/completions';

    // 先创建任务（status=translating），让 popup 立即看到进展
    const task = {
      videoId, tabId,
      title: prepared.title || existing?.title || videoId,
      url: prepared.url || existing?.url || getYouTubeUrl(videoId),
      thumbnailUrl: prepared.thumbnailUrl || getYouTubeThumbnail(videoId),
      sourceLanguage: prepared.sourceLanguage || 'unknown',
      targetLanguage,
      status: 'translating',
      progress: 0,
      completedGroups: 0,
      totalGroups: 0,
      cues: prepared.cues,
      translations: {},
      modelKey, modelId: model.modelId, apiUrl, apiKey: model.apiKey,
      estimatedSeconds: Math.ceil(prepared.cues.length * 0.6) + 5,
      updatedAt: Date.now(),
    };
    videoTasks.set(videoId, task);
    persistTasks();

    messageHandlers.attemptRewrite(task, prepared, model, targetLanguage, apiUrl).catch(function () {});

    return { ok: true };
  },

  async attemptRewrite(task, prepared, model, targetLanguage, apiUrl) {
    const videoId = task.videoId;
    try {
      const rewritePrompt = TranslatePrompt.buildRewritePrompt({
        cues: prepared.cues,
        sourceLanguage: prepared.sourceLanguage,
        targetLanguage: targetLanguage,
        videoTitle: prepared.title || '',
      });

      debugLog('[SW] rewritePhase: sending ' + prepared.cues.length + ' cues to ' + model.modelId);
      const rewriteResp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + model.apiKey },
        body: JSON.stringify({
          model: model.modelId,
          messages: [
            { role: 'system', content: rewritePrompt.system },
            { role: 'user', content: rewritePrompt.user },
          ],
          max_tokens: 65536,
          temperature: 0.3,
        }),
      });

      if (rewriteResp.ok) {
        const rewriteData = await rewriteResp.json();
        const rewriteContent = rewriteData.choices?.[0]?.message?.content || '';
        if (rewriteContent) {
          const parsedRewrite = parseRewriteResponse(rewriteContent, prepared.cues);
          if (parsedRewrite && parsedRewrite.length > 0) {
            debugLog('[SW] rewritePhase: success, got ' + parsedRewrite.length + ' cues');
            const cues = parsedRewrite.map(function (item) {
              return { start: item.start, end: item.end, text: item.original, translated: item.translated };
            });
            task.status = 'completed';
            task.progress = 100;
            task.completedGroups = cues.length;
            task.totalGroups = cues.length;
            task.cues = cues;
            task.updatedAt = Date.now();
            videoTasks.set(videoId, task);
            persistTasks();
            await applyTaskToOpenTabs(task);
            await notifyComplete(task);
            return;
          }
        }
      }
      debugLog('[SW] rewritePhase: failed (status=' + rewriteResp.status + ')');
    } catch (err) {
      debugLog('[SW] rewritePhase: error (' + err.message + ')');
    }

    task.status = 'failed';
    task.updatedAt = Date.now();
    videoTasks.set(videoId, task);
    persistTasks();
  },

  async CANCEL_VIDEO_TASK(request) {
    const videoId = request.videoId || '';
    if (!videoId) return { error: 'Missing videoId' };
    videoTasks.delete(videoId);
    persistTasks();
    return { ok: true };
  },

  async OPEN_VIDEO_TASK(request) {
    const videoId = request.videoId || '';
    const task = videoTasks.get(videoId);
    const url = task?.url || getYouTubeUrl(videoId);
    const tab = await openOrFocusVideo(url);
    if (task && task.status === 'completed') {
      // 等待标签页加载完成后再发送字幕（setTimeout 不可靠）
      await waitForTabReady(tab.id, 15000);
      await new Promise(r => setTimeout(r, 600));
      await applyTaskToTab(tab.id, task);
    }
    return { ok: true };
  },

  async VIDEO_TASK_PROGRESS(request) {
    const videoId = request.videoId || request.payload?.videoId;
    if (!videoId) return { ok: false };
    const previous = videoTasks.get(videoId) || { videoId };
    const next = {
      ...previous,
      ...request.payload,
      videoId,
      updatedAt: Date.now(),
    };
    videoTasks.set(videoId, next);
    persistTasks();
    if (next.status === 'completed') {
      await applyTaskToOpenTabs(next);
      await notifyComplete(next);
    }
    return { ok: true };
  },

  async VIDEO_TASK_GROUP_TRANSLATED(request) {
    const task = videoTasks.get(request.videoId);
    if (!task) return { ok: false };
    const payload = request.payload || {};
    (payload.cueIndices || []).forEach((cueIndex, idx) => {
      task.translations[cueIndex] = (payload.translations || [])[idx] || '';
      if (task.cues?.[cueIndex]) {
        task.cues[cueIndex] = { ...task.cues[cueIndex], translated: task.translations[cueIndex] };
      }
    });
    task.updatedAt = Date.now();
    videoTasks.set(task.videoId, task);
    persistTasks();
    await applyTaskToOpenTabs(task);
    return { ok: true };
  },

  async CACHE_GET(request) {
    const raw = await storageLocalGet(request.key);
    // 新格式：{ d: data, t: timestamp }
    if (raw && typeof raw === 'object' && 'd' in raw) {
      return { value: raw.d };
    }
    // 旧格式兼容（纯数组/字符串）
    return { value: raw };
  },

  async CACHE_SET(request) {
    await storageLocalSet(request.key, { d: request.value, t: Date.now() });
    return { ok: true };
  },

  async TRANSLATE_TEXT(request) {
    const { text, modelKey } = request;
    // 简单的语言匹配检测：如果文本已包含目标语言的典型字符，跳过翻译
    try {
      const targetLang = await StorageManager.get('targetLanguage');
      if (targetLang && text && text.length > 0 && text.length <= 2000) {
        var skip = false;
        if (targetLang.indexOf('zh') === 0 && /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)) {
          skip = true;
        } else if (targetLang.indexOf('en') === 0 && /^[a-zA-Z0-9\s.,!?;:'"()\-–—/@#$%&*+=<>]+$/.test(text)) {
          skip = true;
        }
        if (skip) {
          return { result: text, skipped: true };
        }
      }
    } catch (_err) {
      // 检测失败时继续翻译
    }
    const result = await Translator.translate(text, modelKey);
    return { result };
  },

  async TRANSLATE_BATCH(request) {
    const { texts, modelKey } = request;
    const results = await Translator.translateBatch(texts, modelKey);
    return { results };
  },

  async GET_SETTINGS(request) {
    if (request.keys && Array.isArray(request.keys)) {
      const result = {};
      for (const key of request.keys) result[key] = await StorageManager.get(key);
      return result;
    }
    return StorageManager.getAll();
  },

  async UPDATE_SETTING(request) {
    await StorageManager.set(request.data);
    return { success: true };
  },

  async PROXY_FETCH(request) {
    const resp = await fetch(request.url, { headers: request.headers || {} });
    return { text: await resp.text(), status: resp.status };
  },

  async DEBUG_LOG(request) {
    const entry = request.payload;
    entry.timestamp = entry.timestamp || Date.now();
    debugLogBuffer.push(entry);
    if (debugLogBuffer.length > MAX_LOG) debugLogBuffer.splice(0, debugLogBuffer.length - MAX_LOG);
    console.log(`[SW-DEBUG] ${entry.tag}: ${entry.message}`);
    fetch('http://localhost:19876/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => {});
    return { ok: true };
  },

  async GET_DEBUG_LOGS() {
    return { logs: [...debugLogBuffer] };
  },

  async CLEAR_DEBUG_LOGS() {
    debugLogBuffer.length = 0;
    return { ok: true };
  },
};

async function getVideoTasks(targetLanguage, showAllCompleted) {
  const tabs = await chrome.tabs.query({ url: ['https://*.youtube.com/*'] });
  for (const tab of tabs.filter(isYouTubeVideoTab)) {
    const videoId = extractVideoIdFromUrl(tab.url || '');
    const existing = videoTasks.get(videoId);
    if (existing && (existing.status === 'translating' || existing.status === 'preparing')) {
      existing.tabId = tab.id;
      existing.url = tab.url || existing.url;
      videoTasks.set(videoId, existing);
      persistTasks();
      continue;
    }

    if (existing && existing.targetLanguage === targetLanguage && existing.status === 'completed') {
      existing.tabId = tab.id;
      videoTasks.set(videoId, existing);
      persistTasks();
      // 自动应用已完成翻译的字幕到当前标签页
      applyTaskToTab(tab.id, existing).catch(() => {});
      continue;
    }

    const detected = await sendTabMessage(tab.id, {
      type: 'DETECT_VIDEO_TRANSLATABLE',
      targetLanguage,
    }, 8000);
    if (!detected || detected.error || detected.needsTranslation === false) continue;

    const item = {
      videoId,
      tabId: tab.id,
      title: detected.title || cleanYouTubeTitle(tab.title || ''),
      url: tab.url || getYouTubeUrl(videoId),
      thumbnailUrl: detected.thumbnailUrl || getYouTubeThumbnail(videoId),
      sourceLanguage: detected.sourceLanguage || 'unknown',
      targetLanguage,
      status: detected.status || 'available',
      progress: detected.progress || 0,
      completedGroups: detected.completedGroups || 0,
      totalGroups: detected.totalGroups || 0,
      cues: detected.cues || existing?.cues || [],
      translations: existing?.translations || {},
      updatedAt: Date.now(),
    };
    videoTasks.set(videoId, item);
    persistTasks();
    // 如果检测到已完成翻译，自动应用字幕到当前标签页
    if (detected.status === 'completed') {
      applyTaskToTab(tab.id, item).catch(() => {});
    }
  }

  return {
    items: (function () {
      const tasks = Array.from(videoTasks.values())
        .filter(task => task.targetLanguage === targetLanguage)
        .filter(task => task.status !== 'canceled');
      const active = tasks.filter(t => t.status !== 'completed');
      const done = tasks.filter(t => t.status === 'completed')
        .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      const MAX_COMPLETED_SHOWN = 10;
      const hasMoreCompleted = !showAllCompleted && done.length > MAX_COMPLETED_SHOWN;
      // 活跃任务最多占 MAX_VIDEO_TASKS 个，已完成任务默认显示最近 10 个
      const completedToShow = showAllCompleted ? done : done.slice(0, MAX_COMPLETED_SHOWN);
      return [...active.slice(0, MAX_VIDEO_TASKS), ...completedToShow];
    })(),
    hasMoreCompleted: (function () {
      const done = Array.from(videoTasks.values())
        .filter(task => task.targetLanguage === targetLanguage && task.status === 'completed');
      return done.length > 10;
    })(),
  };
}

async function applyTaskToOpenTabs(task) {
  const tabs = await chrome.tabs.query({ url: ['https://*.youtube.com/*'] });
  await Promise.all(tabs.filter(tab => extractVideoIdFromUrl(tab.url || '') === task.videoId)
    .map(tab => applyTaskToTab(tab.id, task)));
}

async function applyTaskToTab(tabId, task) {
  return sendTabMessage(tabId, {
    type: 'APPLY_VIDEO_TRANSLATIONS',
    payload: {
      videoId: task.videoId,
      cues: task.cues || [],
      targetLanguage: task.targetLanguage,
    },
  }, 5000).catch(() => ({}));
}

async function openOrFocusVideo(url) {
  const videoId = extractVideoIdFromUrl(url);
  const tabs = await chrome.tabs.query({ url: ['https://*.youtube.com/*'] });
  const existing = tabs.find(tab => extractVideoIdFromUrl(tab.url || '') === videoId);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    return existing;
  }
  return chrome.tabs.create({ url });
}

function waitForTabReady(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve(true);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function notifyComplete(task) {
  await chrome.notifications.create('yt-translate-complete-' + task.videoId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: '字幕翻译完成',
    message: task.title || 'YouTube 视频已翻译完成',
    priority: 1,
  }).catch(() => {});
}

function sendTabMessage(tabId, message, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ error: 'Tab did not respond' });
      }
    }, timeoutMs || 2500);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || {});
    });
  });
}

function isYouTubeVideoTab(tab) {
  return !!extractVideoIdFromUrl(tab.url || '');
}

function extractVideoIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/').filter(Boolean)[1] || '';
    return parsed.searchParams.get('v') || '';
  } catch (_err) {
    return '';
  }
}

function cleanYouTubeTitle(title) {
  return String(title || '').replace(/\s*-\s*YouTube\s*$/i, '').trim();
}

function getYouTubeThumbnail(videoId) {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/default.jpg` : '';
}

function getYouTubeUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function getActiveTaskCount() {
  let count = 0;
  for (const task of videoTasks.values()) {
    if (task.status === 'preparing' || task.status === 'translating') count += 1;
  }
  return count;
}

function storageLocalGet(key) {
  return new Promise(resolve => {
    chrome.storage.local.get(key, items => resolve(items ? items[key] : undefined));
  });
}

function storageLocalSet(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('YouTube translator installed');
  // 注册 10 天自动清理缓存
  chrome.alarms.create('cache-cleanup', { periodInMinutes: 10 * 24 * 60 }).catch(() => {});
  performCacheCleanup();
});

async function performCacheCleanup() {
  try {
    const all = await chrome.storage.local.get(null);
    const toDelete = [];
    const now = Date.now();
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(CACHE_PREFIX)) continue;
      // 只有新格式（带时间戳）才能判断过期
      if (value && typeof value === 'object' && value.t) {
        if (now - value.t > CACHE_RETENTION_MS) {
          toDelete.push(key);
        }
      }
    }
    if (toDelete.length > 0) {
      await chrome.storage.local.remove(toDelete);
      console.log('[Cache] cleaned ' + toDelete.length + ' expired entries');
    }
  } catch (err) {
    console.warn('[Cache] cleanup error:', err);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cache-cleanup') {
    performCacheCleanup();
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  const prefix = 'yt-translate-complete-';
  if (!notificationId.startsWith(prefix)) return;
  const videoId = notificationId.slice(prefix.length);
  const task = videoTasks.get(videoId);
  openOrFocusVideo(task?.url || getYouTubeUrl(videoId)).catch(() => {});
  chrome.notifications.clear(notificationId).catch(() => {});
});

/**
 * 解析 AI 返回的全文本重写结果
 * 与 content script 中的 parseRewriteResponse 逻辑一致
 */
function parseRewriteResponse(content, originalCues) {
  if (!content) return null;
  var jsonStr = content.trim();
  var codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
  var arrayStart = jsonStr.indexOf('[');
  var arrayEnd = jsonStr.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) jsonStr = jsonStr.slice(arrayStart, arrayEnd + 1);
  var parsed;
  try { parsed = JSON.parse(jsonStr); } catch (e) {
    try { parsed = JSON.parse(jsonStr.replace(/[\s\S]*?(\[[\s\S]*)/, '$1')); } catch (e2) { return null; }
  }
  if (!Array.isArray(parsed)) return null;
  var result = [];
  for (var i = 0; i < parsed.length; i++) {
    var item = parsed[i];
    if (item && typeof item === 'object' && item.start != null && item.end != null && item.translated) {
      result.push({
        start: Number(item.start),
        end: Number(item.end),
        original: String(item.original || item.text || ''),
        translated: String(item.translated || ''),
      });
    }
  }
  return result.length > 0 ? result : null;
}

function debugLog(msg) {
  console.log('[SW] ' + msg);
  fetch('http://localhost:19876/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp: Date.now(), tag: 'SW-Rewrite', message: msg }),
  }).catch(function () {});
}
