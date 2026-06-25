/* ═══════════════════════════════════════════════
   floating-translate.js — 划词翻译浮动弹窗
   选中文本 → 出现翻译图标 → 点击图标 → 弹出翻译气泡
   ═══════════════════════════════════════════════ */

(function () {
  'use strict';

  let popupEl = null;
  let logoEl = null;
  let isEnabled = true;
  let floatPosition = 'mouse';
  let defaultModel = 'agnes-ai';
  let pendingTranslate = null; // { text, x, y }

  /* ═══════════════════════════════════════════════
     翻译图标（选中后出现，点击后触发翻译）
     ═══════════════════════════════════════════════ */

  // 安全的 i18n 封装：chrome.i18n 在 content script 中可能不可用
  function getMsg(key, fallback) {
    try {
      if (chrome && chrome.i18n && chrome.i18n.getMessage) {
        var msg = chrome.i18n.getMessage(key);
        if (msg) return msg;
      }
    } catch (_e) {}
    return fallback;
  }

  function createLogo() {
    const el = document.createElement('div');
    el.id = 'yt-translate-logo';
    // 使用项目本身的 logo SVG（纯色，无 id 引用，避免 YouTube 页面冲突）
    el.innerHTML =
      '<svg viewBox="0 0 128 128" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '  <rect width="128" height="128" rx="24" fill="#2F57F6"/>' +
      '  <path d="M31 18L36.8 35.2L54 41L36.8 46.8L31 64L25.2 46.8L8 41L25.2 35.2L31 18Z" fill="white"/>' +
      '  <text x="44" y="101" fill="white" font-family="Segoe UI, Arial, sans-serif" font-size="74" font-weight="700">A</text>' +
      '</svg>';
    document.body.appendChild(el);

    el.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var pt = pendingTranslate;
      hideLogo();
      if (pt) {
        doTranslate(pt.text, pt.x, pt.y);
      }
    });

    return el;
  }

  function showLogo(text, x, y) {
    if (!logoEl) logoEl = createLogo();
    pendingTranslate = { text: text, x: x, y: y };

    logoEl.style.left = x + 'px';
    logoEl.style.top = y + 'px';
    if (!logoEl.classList.contains('visible')) {
      logoEl.classList.add('visible');
    }
  }

  function hideLogo() {
    if (logoEl) {
      logoEl.classList.remove('visible');
    }
    pendingTranslate = null;
  }

  /* ═══════════════════════════════════════════════
     浮动弹窗（翻译结果）
     ═══════════════════════════════════════════════ */

  function ensurePopupEl() {
    // 如果缓存元素已被 DOM 移除（如 YouTube SPA 刷新），重新创建
    if (!popupEl || !document.body.contains(popupEl)) {
      popupEl = document.createElement('div');
      popupEl.id = 'yt-translate-floating';
      document.body.appendChild(popupEl);
    }
    return popupEl;
  }

  function showPopup(originalText, translatedText, x, y) {
    var el = ensurePopupEl();
    var mode = floatPosition;

    if (mode === 'fixed') {
      el.className = 'fixed-mode';
    } else {
      el.className = '';
      var left = x;
      var top = y - 10;

      var popupWidth = 360;
      if (left + popupWidth > window.innerWidth) {
        left = window.innerWidth - popupWidth - 16;
      }
      if (left < 8) left = 8;
      if (top < 8) top = 8;

      el.style.left = left + 'px';
      el.style.top = top + 'px';
    }

    var isError = translatedText && translatedText.indexOf('❌') === 0;
    var errorClass = isError ? 'error-msg' : '';

    el.style.right = mode === 'fixed' ? '24px' : 'auto';
    el.style.bottom = mode === 'fixed' ? '24px' : 'auto';

    el.innerHTML =
      '<div class="floating-popup">' +
        '<button class="close-btn" id="floatCloseBtn">&times;</button>' +
        '<div class="original-text">' + escapeHtml(originalText) + '</div>' +
        '<div class="translated-text ' + errorClass + '">' + escapeHtml(translatedText) + '</div>' +
      '</div>';

    el.classList.add('visible');

    var closeBtn = el.querySelector('#floatCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        el.classList.remove('visible');
      });
    }

    setTimeout(function () {
      document.addEventListener('click', closeOnOutsideClick, { once: true });
    }, 0);
  }

  function closeOnOutsideClick(e) {
    if (popupEl && !popupEl.contains(e.target)) {
      popupEl.classList.remove('visible');
    }
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /* ═══════════════════════════════════════════════
     实际翻译
     ═══════════════════════════════════════════════ */

  async function doTranslate(text, x, y) {
    try {
      if (!isEnabled) return;

      if (!navigator.onLine) {
        showPopup(text, '❌ ' + getMsg('networkOffline', '网络离线'), x, y);
        return;
      }

      if (!text || text.length > 2000) return;

      showPopup(text, getMsg('translating', '翻译中...'), x, y);

      var result = await sendMessage({
        type: 'TRANSLATE_TEXT',
        text: text,
        modelKey: defaultModel,
      });

      if (result.skipped) {
        showPopup(text, '\u2713 ' + getMsg('alreadyInTargetLang', '原文已是目标语言，无需翻译'), x, y);
      } else {
        showPopup(text, result.result || getMsg('noTranslationResult', '暂无翻译结果'), x, y);
      }
    } catch (err) {
      var msg = err.message || '';
      if (msg.indexOf('Extension context invalidated') !== -1 || msg.indexOf('context invalidated') !== -1) {
        showPopup(text, '⚠ ' + getMsg('translateError', '翻译失败') + '：扩展上下文已失效，请刷新页面后重试', x, y);
      } else {
        showPopup(text, getMsg('translateError', '翻译失败') + ': ' + msg, x, y);
      }
    }
  }

  function sendMessage(msg) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(msg, function (response) {
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

  /* ═══════════════════════════════════════════════
     事件监听
     ═══════════════════════════════════════════════ */

  // 鼠标松开：选中文本 → 出图标；没选中 → 隐图标
  document.addEventListener('mouseup', function (e) {
    // 点击弹窗内部 → 只隐藏图标
    if (popupEl && popupEl.contains(e.target)) {
      hideLogo();
      return;
    }
    // 点击图标本身 → 不处理（由 click 事件处理）
    if (logoEl && logoEl.contains(e.target)) return;

    var sel = window.getSelection();
    var text = sel.toString().trim();

    if (text && text.length <= 2000) {
      var range = sel.getRangeAt(0);
      var rect = range.getBoundingClientRect();
      var x = rect.left + rect.width + 4;
      var y = rect.top - 8;

      hideLogo();
      setTimeout(function () { showLogo(text, x, y); }, 80);
    } else {
      hideLogo();
    }
  });

  // 滚动时隐藏图标（位置不再准确）
  window.addEventListener('scroll', hideLogo, { passive: true });

  // 设置变更
  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.floatingTranslateEnabled !== undefined) {
      isEnabled = changes.floatingTranslateEnabled.newValue;
      if (!isEnabled) hideLogo();
    }
    if (changes.floatPosition !== undefined) {
      floatPosition = changes.floatPosition.newValue || 'mouse';
    }
    if (changes.defaultModel !== undefined) {
      defaultModel = changes.defaultModel.newValue || 'agnes-ai';
    }
  });

  // 初始化
  (async function init() {
    try {
      var result = await chrome.runtime.sendMessage({
        type: 'GET_SETTINGS',
        keys: ['floatingTranslateEnabled', 'floatPosition', 'defaultModel'],
      });
      isEnabled = result.floatingTranslateEnabled !== false;
      floatPosition = result.floatPosition || 'mouse';
      defaultModel = result.defaultModel || 'agnes-ai';
    } catch (_err) {
      // 使用默认值
    }
  })();
})();
