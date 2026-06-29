importScripts('/src/shared/constants.js', '/src/shared/crypto-utils.js', '/src/background/storage.js', '/src/background/translator.js', '/src/shared/translate-prompt.js');

const MAX_VIDEO_TASKS = 3;
const debugLogBuffer = [];
const MAX_LOG = 500;
const videoTasks = new Map();

// 字幕翻译缓存（10 天自动清理）
const CACHE_PREFIX = 'ytSubCache';
const CACHE_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;

// 任务持久化——SW 重启后恢复已完成翻译
const STORAGE_TASKS_KEY = 'ytVideoTasks';

function makeTaskKey(videoId, targetLanguage) {
  return videoId + ':' + (targetLanguage || 'unknown');
}

function parseTaskKey(key) {
  var idx = key.indexOf(':');
  if (idx === -1) return { videoId: key, targetLanguage: 'unknown' };
  return { videoId: key.slice(0, idx), targetLanguage: key.slice(idx + 1) };
}

function findTaskByVideoId(videoId, targetLanguage) {
  if (targetLanguage) {
    var key = makeTaskKey(videoId, targetLanguage);
    return videoTasks.get(key);
  }
  // 遍历找第一个匹配的
  for (var entry of videoTasks) {
    var parsed = parseTaskKey(entry[0]);
    if (parsed.videoId === videoId) return entry[1];
  }
  return undefined;
}

function deleteTasksByVideoId(videoId) {
  var deleted = false;
  for (var key of videoTasks.keys()) {
    var parsed = parseTaskKey(key);
    if (parsed.videoId === videoId) {
      videoTasks.delete(key);
      deleted = true;
    }
  }
  return deleted;
}

async function persistTasks() {
  try {
    const tasks = {};
    for (const [key, task] of videoTasks) {
      if (task.status !== STATUS.CANCELED && task.status !== STATUS.AVAILABLE) {
        tasks[key] = task;
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
      for (const [key, task] of Object.entries(tasks)) {
        if (task.status !== STATUS.CANCELED) {
          videoTasks.set(key, task);
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
    return getVideoTasks(request.targetLanguage || resolveLanguage(), request.showAllCompleted);
  },

  async START_VIDEO_TASK(request) {
    const videoId = request.videoId || '';
    if (!videoId) return { error: 'Missing videoId' };

    const targetLanguage = request.targetLanguage || resolveLanguage();
    const taskKey = makeTaskKey(videoId, targetLanguage);
    const existing = videoTasks.get(taskKey);

    if (!existing && getActiveTaskCount() >= MAX_VIDEO_TASKS) {
      return { error: chrome.i18n.getMessage('maxVideoTasks') || '最多同时处理 3 个视频任务' };
    }

    if (existing && existing.status === STATUS.COMPLETED) {
      await openOrFocusVideo(existing.url);
      await applyTaskToOpenTabs(existing);
      return { ok: true };
    }

    const tabId = Number(request.tabId || existing?.tabId || 0);
    if (!tabId) return { error: chrome.i18n.getMessage('needOpenVideo') || '需要先打开该 YouTube 视频以获取字幕' };

    const prepared = await sendTabMessage(tabId, {
      type: 'PREPARE_VIDEO_TRANSLATION',
      targetLanguage: targetLanguage,
    }, 30000);
    if (prepared.error) return prepared;
    if (!prepared.cues || prepared.cues.length === 0) {
      return { error: chrome.i18n.getMessage('noSubtitles') || '该视频没有可用字幕' };
    }

    const settings = await StorageManager.getAll();
    const modelKey = settings.defaultModel || 'agnes-ai';
    const model = settings.models?.[modelKey];
    if (!model || !model.apiKey) {
      return { error: chrome.i18n.getMessage('noApiKey') || '请先在设置中配置 API Key' };
    }

    const apiUrl = model.apiUrl.replace(/\/+$/, '') + '/chat/completions';

    // 先创建任务（status=translating），让 popup 立即看到进展
    const task = {
      videoId, tabId,
      title: prepared.title || existing?.title || videoId,
      url: prepared.url || existing?.url || getYouTubeUrl(videoId),
      thumbnailUrl: prepared.thumbnailUrl || getYouTubeThumbnail(videoId),
      sourceLanguage: prepared.sourceLanguage || 'unknown',
      targetLanguage,
      status: STATUS.TRANSLATING,
      progress: 0,
      completedGroups: 0,
      totalGroups: 0,
      cues: prepared.cues,
      translations: {},
      modelKey, modelId: model.modelId, apiUrl, apiKey: model.apiKey,
      updatedAt: Date.now(),
    };
    videoTasks.set(taskKey, task);
    persistTasks();

    // 触发 content script 开始批量翻译（异步，不阻塞返回）
    sendTabMessage(tabId, {
      type: 'START_SUBTITLE_TRANSLATION',
      targetLanguage: targetLanguage,
    }, 5000).catch(function () {});

    return { ok: true };
  },

  async CANCEL_VIDEO_TASK(request) {
    const videoId = request.videoId || '';
    const targetLanguage = request.targetLanguage || '';
    if (!videoId) return { error: 'Missing videoId' };
    if (targetLanguage) {
      videoTasks.delete(makeTaskKey(videoId, targetLanguage));
    } else {
      deleteTasksByVideoId(videoId);
    }
    persistTasks();
    return { ok: true };
  },

  async OPEN_VIDEO_TASK(request) {
    const videoId = request.videoId || '';
    const targetLanguage = request.targetLanguage || '';
    var task;
    if (targetLanguage) {
      task = videoTasks.get(makeTaskKey(videoId, targetLanguage));
    } else {
      task = findTaskByVideoId(videoId);
    }
    const url = task?.url || getYouTubeUrl(videoId);
    const tab = await openOrFocusVideo(url);
    if (task && task.status === STATUS.COMPLETED) {
      await waitForTabReady(tab.id, 15000);
      await new Promise(r => setTimeout(r, 600));
      await applyTaskToTab(tab.id, task);
    }
    return { ok: true };
  },

  async VIDEO_TASK_PROGRESS(request) {
    const payload = request.payload || {};
    const videoId = request.videoId || payload.videoId;
    if (!videoId) return { ok: false };
    const targetLanguage = payload.targetLanguage || '';
    const taskKey = targetLanguage ? makeTaskKey(videoId, targetLanguage) : '';
    const previous = (taskKey && videoTasks.get(taskKey)) || findTaskByVideoId(videoId) || { videoId };
    const next = {
      ...previous,
      ...payload,
      videoId,
      updatedAt: Date.now(),
    };
    // 用新 key 存储（可能 targetLanguage 变了）
    const storeKey = makeTaskKey(videoId, next.targetLanguage || targetLanguage || previous.targetLanguage || 'unknown');
    videoTasks.set(storeKey, next);
    persistTasks();
    if (next.status === STATUS.COMPLETED) {
      await applyTaskToOpenTabs(next);
      await notifyComplete(next);
    }
    return { ok: true };
  },

  async VIDEO_TASK_GROUP_TRANSLATED(request) {
    const videoId = request.videoId;
    const targetLanguage = request.targetLanguage || '';
    const taskKey = makeTaskKey(videoId, targetLanguage);
    var task = videoTasks.get(taskKey);
    if (!task) task = findTaskByVideoId(videoId);
    if (!task) return { ok: false };
    const payload = request.payload || {};
    (payload.cueIndices || []).forEach((cueIndex, idx) => {
      task.translations[cueIndex] = (payload.translations || [])[idx] || '';
      if (task.cues?.[cueIndex]) {
        task.cues[cueIndex] = { ...task.cues[cueIndex], translated: task.translations[cueIndex] };
      }
    });
    task.updatedAt = Date.now();
    videoTasks.set(makeTaskKey(task.videoId, task.targetLanguage), task);
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

  async CLEAR_CACHE() {
    try {
      // 清除翻译缓存 ytSubCache:*
      var all = await chrome.storage.local.get(null);
      var toDelete = [];
      for (var key in all) {
        if (all.hasOwnProperty(key) && key.indexOf(CACHE_PREFIX) === 0) {
          toDelete.push(key);
        }
      }
      var cacheCount = toDelete.length;

      // 也清除视频任务持久化数据
      if (all.hasOwnProperty(STORAGE_TASKS_KEY)) {
        toDelete.push(STORAGE_TASKS_KEY);
      }

      if (toDelete.length > 0) {
        await chrome.storage.local.remove(toDelete);
      }

      // 清空内存中的视频任务
      videoTasks.clear();

      // 广播到所有 YouTube tab 清空内存缓存
      var tabs = await chrome.tabs.query({ url: ['https://*.youtube.com/*'] });
      for (var ti = 0; ti < tabs.length; ti++) {
        sendTabMessage(tabs[ti].id, { type: MESSAGE_TYPE.PURGE_MEMORY_CACHE }, 3000).catch(function () {});
      }

      return { ok: true, cacheCount: cacheCount, tasksCleared: true };
    } catch (err) {
      console.warn('[Cache] clear error:', err);
      return { ok: false, error: err.message };
    }
  },
};

async function getVideoTasks(targetLanguage, showAllCompleted) {
  const tabs = await chrome.tabs.query({ url: ['https://*.youtube.com/*'] });
  for (const tab of tabs.filter(isYouTubeVideoTab)) {
    const videoId = extractVideoIdFromUrl(tab.url || '');
    const taskKey = makeTaskKey(videoId, targetLanguage);
    const existing = videoTasks.get(taskKey);

    // 活跃任务（翻译中/准备中/失败）——跨所有语言
    var activeTask = null;
    for (var entry of videoTasks) {
      var parsed = parseTaskKey(entry[0]);
      if (parsed.videoId === videoId && (entry[1].status === STATUS.TRANSLATING || entry[1].status === STATUS.PREPARING || entry[1].status === STATUS.FAILED)) {
        activeTask = entry[1];
        break;
      }
    }
    if (activeTask) {
      activeTask.tabId = tab.id;
      activeTask.url = tab.url || activeTask.url;
      videoTasks.set(makeTaskKey(videoId, activeTask.targetLanguage), activeTask);
      persistTasks();
      continue;
    }

    if (existing && existing.status === STATUS.COMPLETED) {
      existing.tabId = tab.id;
      videoTasks.set(taskKey, existing);
      persistTasks();
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
      status: detected.status || STATUS.AVAILABLE,
      progress: detected.progress || 0,
      completedGroups: detected.completedGroups || 0,
      totalGroups: detected.totalGroups || 0,
      cues: detected.cues || [],
      translations: {},
      updatedAt: Date.now(),
    };
    videoTasks.set(taskKey, item);
    persistTasks();
    if (detected.status === STATUS.COMPLETED) {
      applyTaskToTab(tab.id, item).catch(() => {});
    }
  }

  return {
    items: (function () {
      const tasks = Array.from(videoTasks.values())
        .filter(task => task.targetLanguage === targetLanguage)
        .filter(task => task.status !== STATUS.CANCELED);
      const active = tasks.filter(t => t.status !== STATUS.COMPLETED);
      const done = tasks.filter(t => t.status === STATUS.COMPLETED)
        .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      const MAX_COMPLETED_SHOWN = 10;
      const hasMoreCompleted = !showAllCompleted && done.length > MAX_COMPLETED_SHOWN;
      const completedToShow = showAllCompleted ? done : done.slice(0, MAX_COMPLETED_SHOWN);
      return [...active.slice(0, MAX_VIDEO_TASKS), ...completedToShow];
    })(),
    hasMoreCompleted: (function () {
      const done = Array.from(videoTasks.values())
        .filter(task => task.targetLanguage === targetLanguage && task.status === STATUS.COMPLETED);
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
  await chrome.notifications.create('yt-translate-complete-' + makeTaskKey(task.videoId, task.targetLanguage), {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: chrome.i18n.getMessage('translationComplete') || '字幕翻译完成',
    message: task.title || '',
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
    if (task.status === STATUS.PREPARING || task.status === STATUS.TRANSLATING) count += 1;
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
  chrome.alarms.create('cache-cleanup', { periodInMinutes: 10 * 24 * 60 }).catch(() => {});
  chrome.alarms.create('task-cleanup', { periodInMinutes: 30 }).catch(() => {});
  performCacheCleanup();
});

const TASK_STALE_MS = 30 * 60 * 1000; // 30 分钟无更新视为僵尸任务

async function performTaskCleanup() {
  try {
    const now = Date.now();
    var cleaned = 0;
    for (const [key, task] of videoTasks) {
      if (task.status === STATUS.TRANSLATING || task.status === STATUS.PREPARING) {
        if (now - (task.updatedAt || 0) > TASK_STALE_MS) {
          task.status = STATUS.FAILED;
          task.error = 'Translation timed out (no progress for 30 minutes)';
          videoTasks.set(key, task);
          cleaned++;
        }
      }
    }
    if (cleaned > 0) {
      persistTasks();
      console.log('[Task] cleaned ' + cleaned + ' stale tasks');
    }
  } catch (err) {
    console.warn('[Task] cleanup error:', err);
  }
}

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
  if (alarm.name === 'cache-cleanup') performCacheCleanup();
  if (alarm.name === 'task-cleanup') performTaskCleanup();
});

chrome.notifications.onClicked.addListener((notificationId) => {
  const prefix = 'yt-translate-complete-';
  if (!notificationId.startsWith(prefix)) return;
  const taskKey = notificationId.slice(prefix.length);
  const task = videoTasks.get(taskKey);
  openOrFocusVideo(task?.url || getYouTubeUrl(parseTaskKey(taskKey).videoId)).catch(() => {});
  chrome.notifications.clear(notificationId).catch(() => {});
});
