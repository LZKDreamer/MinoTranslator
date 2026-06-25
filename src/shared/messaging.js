/* ═══════════════════════════════════════════════
   messaging.js — 统一消息发送工具
   所有 content script 通过此函数与 Service Worker 通信
   ═══════════════════════════════════════════════ */

/**
 * 向 Service Worker 发送消息并等待响应
 * @param {Object} message - { type, ... }
 * @returns {Promise<Object>}
 */
window.sendMessage = function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
};

/**
 * 调试日志：发送到 Service Worker 缓冲，可直接下载
 * 使用 window.DEBUG 变量控制是否启用，默认 true
 */
window.debugLog = function debugLog(tag, ...args) {
  if (window.DEBUG === false) return;
  // 同时输出到 Console 便于实时查看
  console.log(`[${tag}]`, ...args);
  // 异步发送到 SW 缓冲（不等待，不阻塞）
  chrome.runtime.sendMessage({
    type: 'DEBUG_LOG',
    payload: { tag, message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), timestamp: Date.now() },
  }).catch(() => {});
};
