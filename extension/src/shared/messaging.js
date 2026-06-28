/* ═══════════════════════════════════════════════
   messaging.js — 统一消息发送工具
   所有 content script 通过此函数与 Service Worker 通信
   ═══════════════════════════════════════════════ */

// ═══════════════════════════════════════════════
// 字幕流水线调试日志开关
// 设为 true 后，翻译完成时自动输出完整流水线日志并下载 .txt 文件：
//   [Pipeline]  断句+清洗后的每句文本 + 时间区间
//   [Translate] 原文 vs AI 译文逐句对照
//   [Render]    实际渲染时的 videoTime vs cueRange 偏差
// 用法：在 Console 中执行 window.SUBTITLE_PIPELINE_LOG = true，然后点翻译
// ═══════════════════════════════════════════════
window.SUBTITLE_PIPELINE_LOG = false;

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
