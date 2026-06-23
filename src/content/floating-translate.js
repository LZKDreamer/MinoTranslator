/* ═══════════════════════════════════════════════
   floating-translate.js — 划词翻译浮动弹窗
   选中文本后弹出翻译气泡
   ═══════════════════════════════════════════════ */

(function () {
  'use strict';

  let popupEl = null;
  let isEnabled = true;
  let floatPosition = 'mouse';

  // 创建浮动弹窗 DOM
  function createPopup() {
    const wrapper = document.createElement('div');
    wrapper.id = 'yt-translate-floating';
    document.body.appendChild(wrapper);
    return wrapper;
  }

  // 显示弹窗
  function showPopup(originalText, translatedText, x, y) {
    if (!popupEl) popupEl = createPopup();

    const mode = floatPosition;

    if (mode === 'fixed') {
      popupEl.className = 'fixed-mode';
    } else {
      popupEl.className = '';
      // 定位在选中位置附近
      let left = x;
      let top = y - 10;

      // 确保不超出视口
      const popupWidth = 360;
      if (left + popupWidth > window.innerWidth) {
        left = window.innerWidth - popupWidth - 16;
      }
      if (left < 8) left = 8;
      if (top < 8) top = 8;

      popupEl.style.left = left + 'px';
      popupEl.style.top = top + 'px';
    }

    const isError = translatedText && translatedText.startsWith('❌');
    const errorClass = isError ? 'error-msg' : '';

    popupEl.style.right = mode === 'fixed' ? '24px' : 'auto';
    popupEl.style.bottom = mode === 'fixed' ? '24px' : 'auto';

    popupEl.innerHTML = `
      <div class="floating-popup">
        <button class="close-btn" id="floatCloseBtn">&times;</button>
        <div class="original-text">${escapeHtml(originalText)}</div>
        <div class="translated-text ${errorClass}">${escapeHtml(translatedText)}</div>
      </div>
    `;

    popupEl.classList.add('visible');

    // 绑定关闭按钮
    const closeBtn = popupEl.querySelector('#floatCloseBtn');
    closeBtn.addEventListener('click', () => {
      popupEl.classList.remove('visible');
    });

    // 点击外部关闭
    setTimeout(() => {
      document.addEventListener('click', closeOnOutsideClick, { once: true });
    }, 0);
  }

  function closeOnOutsideClick(e) {
    if (popupEl && !popupEl.contains(e.target)) {
      popupEl.classList.remove('visible');
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 处理选中翻译
  async function handleSelection() {
    if (!isEnabled) return;

    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (!text || text.length > 2000) return;

    // 获取选中位置（用于定位）
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top;

    // 显示加载状态
    showPopup(text, 'Translating...', x, y);

    try {
      const result = await sendMessage({
        type: 'TRANSLATE_TEXT',
        text,
        modelKey: undefined,
      });
      showPopup(text, result.result || '(no translation)', x, y);
    } catch (err) {
      showPopup(text, `❌ ${err.message}`, x, y);
    }
  }

  // 发送消息到 background（封装 chrome.runtime.sendMessage）
  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }

  // 监听鼠标松开（选中操作完成）
  document.addEventListener('mouseup', (e) => {
    // 如果点击了弹窗内部，不触发
    if (popupEl && popupEl.contains(e.target)) return;

    const selection = window.getSelection();
    const text = selection.toString().trim();
    if (text) {
      // 延迟一点点等 selection 稳定
      setTimeout(handleSelection, 100);
    }
  });

  // 监听设置变更
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.floatingTranslateEnabled !== undefined) {
      isEnabled = changes.floatingTranslateEnabled.newValue;
    }
    if (changes.floatPosition !== undefined) {
      floatPosition = changes.floatPosition.newValue || 'mouse';
    }
  });

  // 初始化：读取设置
  (async function init() {
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'GET_SETTINGS',
        keys: ['floatingTranslateEnabled', 'floatPosition'],
      });
      isEnabled = result.floatingTranslateEnabled !== false;
      floatPosition = result.floatPosition || 'mouse';
    } catch {
      // 默认值
    }
  })();
})();
