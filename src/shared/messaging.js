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
