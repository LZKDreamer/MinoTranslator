/* ═══════════════════════════════════════════════
   Options — Mino Translator 设置页
   ═══════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── I18n ────────────────────────────── */
  const SUPPORTED = ['zh-CN', 'en'];
  const FALLBACK = 'en';

  function detectUILang() {
    const raw = chrome.i18n.getUILanguage();
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
      if (val) el.textContent = val;
    });
  }

  /* ── Presets ──────────────────────────── */
  const MODEL_PRESETS = {
    'agnes-ai': {
      name: 'Agnes AI',
      apiUrl: 'https://apihub.agnes-ai.com/v1',
      modelId: 'agnes-2.0-flash',
      modelOptions: ['agnes-2.0-flash', 'agnes-1.5-flash'],
    },
    deepseek: {
      name: 'DeepSeek',
      apiUrl: 'https://api.deepseek.com',
      modelId: 'deepseek-v4-flash',
      modelOptions: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    },
  };

  /* ── Default State ────────────────────── */
  const CONFIG_VERSION = 2; // bump when model presets change to trigger migration
  const DEFAULTS = {
    uiLanguage: 'auto',
    translationEnabled: true,
    subtitleMode: 'bilingual',
    targetLanguage: 'zh-CN',
    fontSize: 'medium',
    subPosition: 'above',
    bgOpacity: 0.6,
    originalTextColor: 50,
    translatedTextColor: 50,
    subBgColor: 0,
    floatingTranslateEnabled: true,
    floatPosition: 'mouse',
    defaultModel: 'agnes-ai',
    models: {
      'agnes-ai': {
        name: 'Agnes AI',
        apiUrl: 'https://apihub.agnes-ai.com/v1',
        apiKey: '',
        modelId: 'agnes-2.0-flash',
        enabled: true,
      },
      deepseek: {
        name: 'DeepSeek',
        apiUrl: 'https://api.deepseek.com',
        apiKey: '',
        modelId: 'deepseek-v4-flash',
        enabled: true,
      },
    },
  };

  let state = {};

  /* ── DOM Refs ──────────────────────────── */
  const $modelSelector = document.getElementById('modelSelector');
  const $modelName = document.getElementById('modelName');
  const $modelApiUrl = document.getElementById('modelApiUrl');
  const $modelApiKey = document.getElementById('modelApiKey');
  const $modelModelId = document.getElementById('modelModelId');
  const $testModelBtn = document.getElementById('testModelBtn');
  const $deleteModelBtn = document.getElementById('deleteModelBtn');
  const $addModelBtn = document.getElementById('addModelBtn');
  const $targetLanguage = document.getElementById('targetLanguage');
  const $bgOpacity = document.getElementById('bgOpacity');
  const $bgOpacityValue = document.getElementById('bgOpacityValue');
  const $originalTextColor = document.getElementById('originalTextColor');
  const $translatedTextColor = document.getElementById('translatedTextColor');
  const $subBgColor = document.getElementById('subBgColor');
  const $floatingEnable = document.getElementById('floatingEnable');
  const $floatPositionBlock = document.getElementById('floatPositionBlock');
  const $versionDisplay = document.getElementById('versionDisplay');

  /* ── Storage ───────────────────────────── */
  /**
   * Migrate stored model configs to match current DEFAULTS for known presets.
   * Preserves user-entered API keys while updating fields that changed across versions.
   * Removes presets that are no longer supported.
   */
  function migrateModelConfigs(storedModels) {
    if (!storedModels || Object.keys(storedModels).length === 0) return storedModels;

    const migrated = { ...storedModels };
    let changed = false;

    // Known old/broken values → correct values map per preset key
    const MIGRATIONS = {
      'agnes-ai': {
        // Old URL → new URL
        apiUrl: { from: ['https://api.agnes-ai.com/api/v1'], to: DEFAULTS.models['agnes-ai'].apiUrl },
        // Old model IDs → new model ID
        modelId: { from: ['agnes-20-flash'], to: DEFAULTS.models['agnes-ai'].modelId },
      },
    };

    // Presets removed in this version — delete them from stored configs
    const REMOVED_PRESET_KEYS = ['openai', 'claude', 'qwen', 'minimax'];

    for (const key of REMOVED_PRESET_KEYS) {
      if (migrated[key]) {
        delete migrated[key];
        changed = true;
      }
    }

    for (const [presetKey, fieldMigrations] of Object.entries(MIGRATIONS)) {
      const model = migrated[presetKey];
      if (!model) continue;

      for (const [field, migration] of Object.entries(fieldMigrations)) {
        if (migration.from.includes(model[field])) {
          model[field] = migration.to;
          changed = true;
        }
      }
    }

    return changed ? migrated : storedModels;
  }

  async function loadState() {
    try {
      const result = await chrome.storage.sync.get([
        'uiLanguage', 'translationEnabled', 'subtitleMode',
        'targetLanguage', 'fontSize', 'subPosition', 'bgOpacity',
        'originalTextColor', 'translatedTextColor', 'subBgColor',
        'floatingTranslateEnabled', 'floatPosition', 'defaultModel', 'models',
        '_modelConfigVersion',
      ]);

      // 解密 apiKey 字段（兼容旧格式）
      if (result.models) {
        result.models = await ApiKeyCrypto.decryptModels(result.models);
      }

      // Migrate outdated model configs
      const storedVersion = result._modelConfigVersion || 0;
      let models = result.models;
      if (storedVersion < CONFIG_VERSION) {
        models = migrateModelConfigs(result.models);
        // Persist migrated configs + new version（加密后存）
        await chrome.storage.sync.set({
          models: await ApiKeyCrypto.encryptModels(models),
          _modelConfigVersion: CONFIG_VERSION,
        });
      }

      state = {
        ...DEFAULTS,
        ...result,
        models: { ...DEFAULTS.models, ...(models || {}) },
      };
    } catch {
      state = { ...DEFAULTS, models: { ...DEFAULTS.models } };
    }
    applyState();
  }

  async function saveState(partial) {
    Object.assign(state, partial);
    try {
      // 如果包含 models，加密 apiKey 后再存储
      let dataToStore = partial;
      if (partial.models && typeof partial.models === 'object') {
        dataToStore = { ...partial, models: await ApiKeyCrypto.encryptModels(partial.models) };
      }
      await chrome.storage.sync.set(dataToStore);
    } catch (e) {
      console.warn('Failed to save state:', e);
    }
  }

  function applyState() {
    $targetLanguage.value = state.targetLanguage;

    // UI Language
    const langRadios = document.querySelectorAll('input[name="uiLang"]');
    langRadios.forEach(r => {
      r.checked = r.value === state.uiLanguage;
    });

    // Subtitle settings
    const subtitleModeRadios = document.querySelectorAll('input[name="subtitleMode"]');
    subtitleModeRadios.forEach(r => {
      r.checked = r.value === state.subtitleMode;
    });

    const fontSizeRadios = document.querySelectorAll('input[name="fontSize"]');
    fontSizeRadios.forEach(r => {
      r.checked = r.value === state.fontSize;
    });

    const posRadios = document.querySelectorAll('input[name="subPosition"]');
    posRadios.forEach(r => {
      r.checked = r.value === state.subPosition;
    });

    $bgOpacity.value = state.bgOpacity;
    $bgOpacityValue.textContent = state.bgOpacity;

    // Color settings
    applyColorSlider($originalTextColor, state.originalTextColor);
    applyColorSlider($translatedTextColor, state.translatedTextColor);
    applyColorSlider($subBgColor, state.subBgColor);

    // Floating translate
    $floatingEnable.checked = state.floatingTranslateEnabled;

    const floatPosRadios = document.querySelectorAll('input[name="floatPosition"]');
    floatPosRadios.forEach(r => {
      r.checked = r.value === state.floatPosition;
    });

    renderModelSelector();
  }

  /**
   * 将滑块位置 (0-360) 映射为颜色
   * 0→黑, 50→白, 50-360→彩虹全色
   */
  function posToColor(pos) {
    if (pos <= 50) {
      const l = Math.round((pos / 50) * 100);
      return `hsl(0, 0%, ${l}%)`;
    }
    const hue = Math.round(((pos - 50) / 310) * 360);
    return `hsl(${hue}, 100%, 50%)`;
  }

  /**
   * 设置颜色滑块的值和 thumb 颜色
   */
  function applyColorSlider($slider, pos) {
    $slider.value = pos;
    $slider.style.setProperty('--thumb-color', posToColor(pos));
  }

  /* ── Model Selector ─────────────────────── */
  let _currentModelKey = null;

  function renderModelSelector() {
    const keys = Object.keys(state.models);
    const current = state.defaultModel || keys[0];

    // Build dropdown
    $modelSelector.innerHTML = keys.map(key => {
      const m = state.models[key];
      const isPreset = !!MODEL_PRESETS[key];
      const label = isPreset ? m.name : `${m.name} (自定义)`;
      return `<option value="${key}" ${key === current ? 'selected' : ''}>${label}</option>`;
    }).join('');

    loadModelFields(current);
  }

  function getCurrentModelKey() {
    return $modelSelector.value || state.defaultModel;
  }

  function loadModelFields(key) {
    if (!key || !state.models[key]) return;
    _currentModelKey = key;
    const m = state.models[key];
    $modelName.value = m.name || '';
    $modelApiUrl.value = m.apiUrl || '';
    $modelApiKey.value = m.apiKey || '';
    $modelModelId.value = m.modelId || '';

    // Name field: editable for custom, read-only for built-in presets
    const isPreset = !!MODEL_PRESETS[key];
    $modelName.disabled = isPreset;

    // Delete button only for custom models
    $deleteModelBtn.style.display = isPreset ? 'none' : '';

    // Update test button state
    updateTestBtnState();

    // Update default model
    if (state.defaultModel !== key) {
      state.defaultModel = key;
      saveState({ defaultModel: key });
    }
  }

  function saveCurrentModelFields() {
    const key = getCurrentModelKey();
    if (!key || !state.models[key]) return;
    const m = state.models[key];
    m.name = $modelName.value;
    m.apiUrl = $modelApiUrl.value;
    m.apiKey = $modelApiKey.value;
    m.modelId = $modelModelId.value;
    saveState({ models: state.models });
  }

  function updateTestBtnState() {
    const allFilled = $modelName.value.trim()
      && $modelApiUrl.value.trim()
      && $modelApiKey.value.trim()
      && $modelModelId.value.trim();
    $testModelBtn.disabled = !allFilled;
  }

  // ── Events ─────────────────────────────
  
  // Dropdown change: switch model
  $modelSelector.addEventListener('change', () => {
    const key = $modelSelector.value;
    if (key) loadModelFields(key);
  });

  // Field changes: save automatically (on blur for text)
  const onFieldChange = () => {
    saveCurrentModelFields();
    updateTestBtnState();
    // Refresh dropdown label for name changes
    const key = getCurrentModelKey();
    const option = $modelSelector.querySelector(`option[value="${key}"]`);
    if (option) {
      const isPreset = !!MODEL_PRESETS[key];
      option.textContent = isPreset ? $modelName.value : `${$modelName.value} (自定义)`;
    }
  };

  $modelName.addEventListener('change', onFieldChange);
  $modelApiUrl.addEventListener('change', onFieldChange);
  $modelApiKey.addEventListener('change', onFieldChange);
  $modelModelId.addEventListener('change', onFieldChange);

  // Real-time button state as user types (without saving on every keystroke)
  $modelName.addEventListener('input', updateTestBtnState);
  $modelApiUrl.addEventListener('input', updateTestBtnState);
  $modelApiKey.addEventListener('input', updateTestBtnState);
  $modelModelId.addEventListener('input', updateTestBtnState);

  // API Key show/hide toggle
  document.getElementById('revealApiKey').addEventListener('click', () => {
    const isPassword = $modelApiKey.type === 'password';
    $modelApiKey.type = isPassword ? 'text' : 'password';
    document.querySelectorAll('.reveal-icon .eye-open, .reveal-icon .eye-closed').forEach(el => {
      el.style.display = el.style.display === 'none' ? '' : 'none';
    });
  });

  // Test connection
  $testModelBtn.addEventListener('click', async () => {
    const key = getCurrentModelKey();
    const m = state.models[key];
    if (!m) return;

    // Double-check all fields are filled
    if (!m.name?.trim() || !m.apiUrl?.trim() || !m.apiKey?.trim() || !m.modelId?.trim()) {
      showToast('❌ 请先填写完整的模型配置');
      return;
    }

    // Save fields first so latest values are used
    saveCurrentModelFields();

    const btn = $testModelBtn;
    btn.disabled = true;
    btn.textContent = 'Testing...';

    try {
      const apiUrl = m.apiUrl.replace(/\/+$/, '');
      const resp = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${m.apiKey}`,
        },
        body: JSON.stringify({
          model: m.modelId,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
        }),
      });

      if (resp.ok) {
        showToast('✅ Connection successful');
      } else {
        const errText = await resp.text().catch(() => 'Unknown error');
        let errMsg = errText;
        try {
          const parsed = JSON.parse(errText);
          errMsg = parsed.error?.message || parsed.message || errText;
        } catch { /* not JSON, use raw */ }
        showToast(`❌ ${resp.status}: ${errMsg}`);
      }
    } catch (err) {
      showToast(`❌ Network error: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Connection';
      applyI18nFromState();
    }
  });

  // Delete custom model
  $deleteModelBtn.addEventListener('click', () => {
    const key = getCurrentModelKey();
    if (!key || !state.models[key]) return;
    if (MODEL_PRESETS[key]) return; // cannot delete built-in models

    delete state.models[key];

    // If we deleted the default, pick first available
    if (state.defaultModel === key) {
      const remaining = Object.keys(state.models);
      state.defaultModel = remaining.length > 0 ? remaining[0] : '';
    }

    saveState({ models: state.models, defaultModel: state.defaultModel });
    renderModelSelector();
  });

  // Add custom model
  $addModelBtn.addEventListener('click', () => {
    // Find a unique name/key
    const existing = new Set(Object.keys(state.models));
    let n = 1;
    let name, key;
    do {
      name = `自定义模型 ${n}`;
      key = `custom-${n}`;
      n++;
    } while (existing.has(key));

    state.models[key] = {
      name,
      apiUrl: 'https://',
      apiKey: '',
      modelId: '',
      enabled: true,
    };
    state.defaultModel = key;
    saveState({ models: state.models, defaultModel: key });
    renderModelSelector();
    $modelName.focus();
    $modelName.select();
  });

  /* ── Toast ─────────────────────────────── */
  function showToast(msg) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toast._hide);
    toast._hide = setTimeout(() => toast.classList.remove('visible'), 3000);
  }

  /* ── Other Event Bindings ──────────────── */
  // UI Language
  document.querySelectorAll('input[name="uiLang"]').forEach(el => {
    el.addEventListener('change', async () => {
      if (el.checked) {
        await saveState({ uiLanguage: el.value });
        // 重新加载消息并应用 i18n
        const lang = el.value === 'auto' ? detectUILang() : el.value;
        _messages = await loadMessages(lang);
        applyI18n(_messages);
      }
    });
  });

  $targetLanguage.addEventListener('change', () => {
    saveState({ targetLanguage: $targetLanguage.value });
  });

  document.querySelectorAll('input[name="subtitleMode"]').forEach(el => {
    el.addEventListener('change', () => {
      if (el.checked) saveState({ subtitleMode: el.value });
    });
  });

  // Font Size
  document.querySelectorAll('input[name="fontSize"]').forEach(el => {
    el.addEventListener('change', () => {
      if (el.checked) saveState({ fontSize: el.value });
    });
  });

  // Subtitle Position
  document.querySelectorAll('input[name="subPosition"]').forEach(el => {
    el.addEventListener('change', () => {
      if (el.checked) saveState({ subPosition: el.value });
    });
  });

  // Background Opacity
  $bgOpacity.addEventListener('input', () => {
    const val = parseFloat($bgOpacity.value);
    $bgOpacityValue.textContent = val;
    saveState({ bgOpacity: val });
  });

  // Original Text Color
  $originalTextColor.addEventListener('input', () => {
    const pos = parseInt($originalTextColor.value);
    $originalTextColor.style.setProperty('--thumb-color', posToColor(pos));
    saveState({ originalTextColor: pos });
  });

  // Translated Text Color
  $translatedTextColor.addEventListener('input', () => {
    const pos = parseInt($translatedTextColor.value);
    $translatedTextColor.style.setProperty('--thumb-color', posToColor(pos));
    saveState({ translatedTextColor: pos });
  });

  // Subtitle Background Color
  $subBgColor.addEventListener('input', () => {
    const pos = parseInt($subBgColor.value);
    $subBgColor.style.setProperty('--thumb-color', posToColor(pos));
    saveState({ subBgColor: pos });
  });

  // Floating Translate
  $floatingEnable.addEventListener('change', () => {
    saveState({ floatingTranslateEnabled: $floatingEnable.checked });
  });

  document.querySelectorAll('input[name="floatPosition"]').forEach(el => {
    el.addEventListener('change', () => {
      if (el.checked) saveState({ floatPosition: el.value });
    });
  });

  /* ── Version ───────────────────────────── */
  function setVersion() {
    const m = chrome.runtime.getManifest();
    $versionDisplay.textContent = m.version || '1.0.0';
  }

  /* ── I18n helper for dynamic content ───── */
  let _messages = {};

  function applyI18nFromState() {
    if (!_messages || Object.keys(_messages).length === 0) return;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      const parts = key.split('.');
      let val = _messages;
      for (const p of parts) {
        val = val?.[p];
        if (!val) break;
      }
      if (val) el.textContent = val;
    });
  }

  /* ── Init ──────────────────────────────── */
  async function init() {
    const lang = detectUILang();
    _messages = await loadMessages(lang);
    applyI18n(_messages);
    setVersion();
    await loadState();
  }

  init();
})();
