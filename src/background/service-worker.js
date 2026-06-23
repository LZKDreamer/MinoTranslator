/* ═══════════════════════════════════════════════
   service-worker.js — 后台 Service Worker
   消息路由 & 翻译服务调度
   ═══════════════════════════════════════════════ */

importScripts('storage.js', 'translator.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = messageHandlers[request.type];
  if (handler) {
    handler(request, sender).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // Keep channel open for async response
  }
});

const messageHandlers = {
  // 翻译单段文本（带 1 次失败重试）
  async TRANSLATE_TEXT(request) {
    const { text, modelKey } = request;
    const MAX_RETRIES = 1;
    let lastError;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      try {
        const result = await Translator.translate(text, modelKey);
        return { result };
      } catch (err) {
        lastError = err;
        if (i < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
    return { error: lastError.message };
  },

  // 批量翻译
  async TRANSLATE_BATCH(request) {
    const { texts, modelKey } = request;
    const results = await Translator.translateBatch(texts, modelKey);
    return { results };
  },

  // 读取设置
  async GET_SETTINGS(request) {
    const keys = request.keys;
    if (keys && Array.isArray(keys)) {
      const result = {};
      for (const key of keys) {
        result[key] = await StorageManager.get(key);
      }
      return result;
    }
    return await StorageManager.getAll();
  },

  // 更新设置
  async UPDATE_SETTING(request) {
    await StorageManager.set(request.data);
    return { success: true };
  },

  // 获取字幕数据（代理请求，避免 CORS 问题）
  async PROXY_FETCH(request) {
    const { url, headers } = request;
    const resp = await fetch(url, { headers: headers || {} });
    const text = await resp.text();
    return { text, status: resp.status };
  },
};

// Keep service worker alive during active translation sessions
let keepAliveInterval = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'translate-session') {
    // Start keepalive: ping storage every 20s to keep SW alive
    keepAliveInterval = setInterval(() => {
      chrome.storage.local.get('_ping').catch(() => {});
    }, 20000);

    port.onDisconnect.addListener(() => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
    });
  }
});

// Initialize: log installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('YouTube 翻译插件已安装');
});
