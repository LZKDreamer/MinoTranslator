/* ═══════════════════════════════════════════════
   Popup — YouTube 翻译插件
   State management & i18n
   ═══════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── I18n ────────────────────────────── */
  const SUPPORTED = ['zh-CN', 'en'];
  const FALLBACK = 'en';

  function detectUILang() {
    const raw = chrome.i18n.getUILanguage();
    // Accept exact match or prefix match (zh-CN → zh, en-US → en)
    if (SUPPORTED.includes(raw)) return raw;
    const prefix = raw.split('-')[0];
    if (prefix === 'zh') return 'zh-CN';
    if (prefix === 'en') return 'en';
    return FALLBACK;
  }

  async function loadMessages(lang) {
    const url = chrome.runtime.getURL(`src/i18n/${lang}.json`);
    const resp = await fetch(url);
    return resp.json();
  }

  function applyI18n(messages) {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      const parts = key.split('.');
      let val = messages;
      for (const p of parts) {
        val = val?.[p];
        if (!val) break;
      }
      if (val) {
        // For <input> / <select>, set placeholder or value
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT') {
          // handled by options
        } else {
          el.textContent = val;
        }
      }
    });

    // Also update <select> options
    document.querySelectorAll('select [data-i18n]').forEach(opt => {
      const key = opt.dataset.i18n;
      const parts = key.split('.');
      let val = messages;
      for (const p of parts) {
        val = val?.[p];
        if (!val) break;
      }
      if (val) opt.textContent = val;
    });
  }

  /* ── State ────────────────────────────── */
  const DEFAULTS = {
    translationEnabled: true,
    subtitleMode: 'bilingual',
    targetLanguage: 'zh-CN',
    floatingTranslateEnabled: true,
  };

  let state = { ...DEFAULTS };

  // DOM refs
  const $translationToggle = document.getElementById('translationToggle');
  const $floatingToggle = document.getElementById('floatingToggle');
  const $modeRadios = document.querySelectorAll('input[name="subtitleMode"]');
  const $targetLang = document.getElementById('targetLanguage');
  const $settingsLink = document.getElementById('openSettings');

  /* ── Storage ───────────────────────────── */
  async function loadState() {
    try {
      const result = await chrome.storage.sync.get(Object.keys(DEFAULTS));
      state = { ...DEFAULTS, ...result };
    } catch {
      state = { ...DEFAULTS };
    }
    applyState();
  }

  async function saveState(partial) {
    Object.assign(state, partial);
    try {
      await chrome.storage.sync.set(partial);
    } catch (e) {
      console.warn('Failed to save state:', e);
    }
  }

  function applyState() {
    $translationToggle.checked = state.translationEnabled;
    $floatingToggle.checked = state.floatingTranslateEnabled;

    $modeRadios.forEach(radio => {
      radio.checked = radio.value === state.subtitleMode;
    });

    $targetLang.value = state.targetLanguage;
  }

  /* ── Events ────────────────────────────── */
  $translationToggle.addEventListener('change', () => {
    saveState({ translationEnabled: $translationToggle.checked });
  });

  $floatingToggle.addEventListener('change', () => {
    saveState({ floatingTranslateEnabled: $floatingToggle.checked });
  });

  $modeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        saveState({ subtitleMode: radio.value });
      }
    });
  });

  $targetLang.addEventListener('change', () => {
    saveState({ targetLanguage: $targetLang.value });
  });

  $settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      // Fallback for older Chrome
      window.open(chrome.runtime.getURL('src/options/options.html'));
    }
  });

  /* ── Init ──────────────────────────────── */
  async function init() {
    const lang = detectUILang();
    const messages = await loadMessages(lang);
    applyI18n(messages);
    await loadState();
  }

  init();
})();
