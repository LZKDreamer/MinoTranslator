/* ═══════════════════════════════════════════════
   Options — YouTube 翻译插件设置页
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
      apiUrl: 'https://api.agnes-ai.com/api/v1',
      modelId: 'agnes-20-flash',
      modelOptions: ['agnes-20-flash'],
    },
    openai: {
      name: 'OpenAI',
      apiUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-4o-mini',
      modelOptions: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
    },
    claude: {
      name: 'Claude',
      apiUrl: 'https://api.anthropic.com/v1',
      modelId: 'claude-3-haiku-20240307',
      modelOptions: ['claude-3-haiku-20240307', 'claude-3-sonnet-20240229', 'claude-3-opus-20240229', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
    },
    deepseek: {
      name: 'DeepSeek',
      apiUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat',
      modelOptions: ['deepseek-chat', 'deepseek-reasoner'],
    },
    qwen: {
      name: 'Qwen',
      apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      modelId: 'qwen-turbo',
      modelOptions: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long'],
    },
    minimax: {
      name: 'Minimax',
      apiUrl: 'https://api.minimax.chat/v1',
      modelId: 'abab5.5s-chat',
      modelOptions: ['abab5.5s-chat', 'abab6.5s-chat', 'abab6.5g-chat', 'abab6.5t-chat'],
    },
  };

  /* ── Default State ────────────────────── */
  const DEFAULTS = {
    uiLanguage: 'auto',
    translationEnabled: true,
    subtitleMode: 'bilingual',
    targetLanguage: 'zh-CN',
    fontSize: 'medium',
    subPosition: 'below',
    bgOpacity: 0.6,
    floatingTranslateEnabled: true,
    floatPosition: 'mouse',
    models: {
      'agnes-ai': {
        name: 'Agnes AI',
        apiUrl: 'https://api.agnes-ai.com/api/v1',
        apiKey: '',
        modelId: 'agnes-20-flash',
        enabled: true,
      },
    },
  };

  let state = {};

  /* ── DOM Refs ──────────────────────────── */
  const $modelList = document.getElementById('modelList');
  const $addBtn = document.getElementById('addModelBtn');
  const $bgOpacity = document.getElementById('bgOpacity');
  const $bgOpacityValue = document.getElementById('bgOpacityValue');
  const $floatingEnable = document.getElementById('floatingEnable');
  const $floatPositionBlock = document.getElementById('floatPositionBlock');
  const $versionDisplay = document.getElementById('versionDisplay');

  /* ── Storage ───────────────────────────── */
  async function loadState() {
    try {
      // Need to get models separately since it's nested
      const result = await chrome.storage.sync.get([
        'uiLanguage', 'translationEnabled', 'subtitleMode',
        'targetLanguage', 'fontSize', 'subPosition', 'bgOpacity',
        'floatingTranslateEnabled', 'floatPosition', 'models',
      ]);
      state = {
        ...DEFAULTS,
        ...result,
        models: { ...DEFAULTS.models, ...(result.models || {}) },
      };
    } catch {
      state = { ...DEFAULTS, models: { ...DEFAULTS.models } };
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
    // UI Language
    const langRadios = document.querySelectorAll('input[name="uiLang"]');
    langRadios.forEach(r => {
      r.checked = r.value === state.uiLanguage;
    });

    // Subtitle settings
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

    // Floating translate
    $floatingEnable.checked = state.floatingTranslateEnabled;

    const floatPosRadios = document.querySelectorAll('input[name="floatPosition"]');
    floatPosRadios.forEach(r => {
      r.checked = r.value === state.floatPosition;
    });

    renderModels();
  }

  /* ── Models CRUD ───────────────────────── */
  let addFormOpen = false;

  function getModelOptions(key, currentId) {
    // Check if this key matches a known preset
    const preset = MODEL_PRESETS[key];
    const options = preset?.modelOptions || [currentId || ''];
    return options.map(id =>
      `<option value="${id}" ${id === currentId ? 'selected' : ''}>${id}</option>`
    ).join('');
  }

  function getModelOptionsHtml(presetKey) {
    const preset = MODEL_PRESETS[presetKey];
    if (!preset?.modelOptions) return '<option value="">输入模型 ID</option>';
    return preset.modelOptions.map(id =>
      `<option value="${id}">${id}</option>`
    ).join('');
  }

  function renderModels() {
    const keys = Object.keys(state.models);
    if (keys.length === 0) {
      $modelList.innerHTML = `<div class="empty-state" data-i18n="options.noModels">暂无模型配置</div>`;
      applyI18nFromState();
      return;
    }

    $modelList.innerHTML = keys.map(key => {
      const m = state.models[key];
      const isDefault = key === 'agnes-ai';
      return `
        <div class="model-card" data-key="${key}">
          <div class="model-card-header">
            <span class="model-card-name">
              ${m.name}
              ${isDefault ? '<span class="model-default-badge" data-i18n="options.default">默认</span>' : ''}
            </span>
            <div class="toggle-wrapper">
              <input type="checkbox" class="toggle-input model-enable-toggle" data-key="${key}" ${m.enabled ? 'checked' : ''} />
              <div class="toggle-track"><div class="toggle-thumb"></div></div>
            </div>
          </div>
          <div class="model-card-fields">
            <div class="model-field">
              <span class="model-field-label" data-i18n="options.apiUrl">API 地址</span>
              <input type="text" class="model-input-url" data-key="${key}" value="${m.apiUrl}" placeholder="https://api.example.com/v1" />
            </div>
            <div class="model-field">
              <span class="model-field-label" data-i18n="options.apiKey">API Key</span>
              <input type="password" class="model-input-key" data-key="${key}" value="${m.apiKey || ''}" placeholder="sk-..." />
            </div>
            <div class="model-field">
              <span class="model-field-label" data-i18n="options.modelId">模型 ID</span>
              <select class="model-input-id" data-key="${key}">
                ${getModelOptions(key, m.modelId)}
              </select>
            </div>
          </div>
          <div class="model-card-actions">
            <button class="btn btn-sm btn-primary test-btn" data-key="${key}" data-i18n="options.testBtn">测试连接</button>
            ${!isDefault ? `<button class="btn btn-sm btn-danger delete-btn" data-key="${key}" data-i18n="options.deleteBtn">删除</button>` : ''}
          </div>
        </div>
      `;
    });

    applyI18nFromState();

    // Bind model events
    document.querySelectorAll('.model-enable-toggle').forEach(el => {
      el.addEventListener('change', onModelToggle);
    });
    document.querySelectorAll('.model-input-url').forEach(el => {
      el.addEventListener('change', onModelFieldChange);
    });
    document.querySelectorAll('.model-input-key').forEach(el => {
      el.addEventListener('change', onModelFieldChange);
    });
    document.querySelectorAll('.model-input-id').forEach(el => {
      el.addEventListener('change', onModelFieldChange);
    });
    document.querySelectorAll('.test-btn').forEach(el => {
      el.addEventListener('click', onTestConnection);
    });
    document.querySelectorAll('.delete-btn').forEach(el => {
      el.addEventListener('click', onDeleteModel);
    });
  }

  function onModelToggle(e) {
    const key = e.target.dataset.key;
    state.models[key].enabled = e.target.checked;
    saveState({ models: state.models });
  }

  function onModelFieldChange(e) {
    const key = e.target.dataset.key;
    const cls = e.target.className;
    const val = e.target.value;
    if (cls.includes('model-input-url')) state.models[key].apiUrl = val;
    else if (cls.includes('model-input-key')) state.models[key].apiKey = val;
    else if (cls.includes('model-input-id')) state.models[key].modelId = val;
    saveState({ models: state.models });
  }

  async function onTestConnection(e) {
    const key = e.target.dataset.key;
    const btn = e.target;
    const m = state.models[key];

    btn.disabled = true;
    btn.textContent = 'Testing...';

    try {
      const resp = await fetch(`${m.apiUrl.replace(/\/+$/, '')}/chat/completions`, {
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
        const err = await resp.text().catch(() => 'Unknown error');
        showToast(`❌ ${resp.status}: ${err.slice(0, 60)}`);
      }
    } catch (err) {
      showToast(`❌ Network error: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Connection';
      applyI18nFromState();
    }
  }

  function onDeleteModel(e) {
    const key = e.target.dataset.key;
    delete state.models[key];
    renderModels();
    saveState({ models: state.models });
  }

  /* ── Add Model ─────────────────────────── */
  let addFormHtml = null;

  function renderAddForm() {
    if (!addFormOpen) return;

    const presets = Object.entries(MODEL_PRESETS).map(([key, p]) =>
      `<button class="preset-btn" data-preset="${key}">${p.name}</button>`
    ).join('');

    const html = `
      <div id="addForm" class="model-add-form open">
        <div class="preset-selector">${presets}</div>
        <div class="model-card-fields">
          <div class="model-field">
            <span class="model-field-label">Preset (fill from above)</span>
            <input type="text" id="addModelName" placeholder="Custom name" />
          </div>
          <div class="model-field">
            <span class="model-field-label">API URL</span>
            <input type="text" id="addModelUrl" placeholder="https://api.example.com/v1" />
          </div>
          <div class="model-field">
            <span class="model-field-label">API Key</span>
            <input type="password" id="addModelKey" placeholder="sk-..." />
          </div>
          <div class="model-field">
            <span class="model-field-label">Model ID</span>
            <select id="addModelId">
              <option value="">选择模型 ID</option>
            </select>
          </div>
        </div>
        <button id="confirmAddModel" class="btn btn-primary btn-full">Add Model</button>
      </div>
    `;

    // Insert after model list
    $modelList.insertAdjacentHTML('afterend', html);

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.preset;
        const preset = MODEL_PRESETS[key];
        document.getElementById('addModelName').value = preset.name;
        document.getElementById('addModelUrl').value = preset.apiUrl;
        const $idSelect = document.getElementById('addModelId');
        $idSelect.innerHTML = '<option value="">选择模型 ID</option>' + getModelOptionsHtml(key);
        $idSelect.value = preset.modelId || '';
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('confirmAddModel').addEventListener('click', confirmAddModel);
  }

  function confirmAddModel() {
    const name = document.getElementById('addModelName').value.trim();
    const url = document.getElementById('addModelUrl').value.trim();
    const key = document.getElementById('addModelKey').value.trim();
    const modelId = document.getElementById('addModelId').value;

    if (!name || !url || !modelId) {
      showToast('❌ Please fill in name, API URL, and Model ID');
      return;
    }

    // Generate a unique key
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const uniqueKey = slug || `model-${Date.now()}`;

    state.models[uniqueKey] = {
      name,
      apiUrl: url,
      apiKey: key,
      modelId,
      enabled: true,
    };

    saveState({ models: state.models });
    addFormOpen = false;
    document.getElementById('addForm')?.remove();
    renderModels();
  }

  $addBtn.addEventListener('click', () => {
    if (addFormOpen) {
      document.getElementById('addForm')?.remove();
      addFormOpen = false;
      return;
    }
    addFormOpen = true;
    renderAddForm();
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
    el.addEventListener('change', () => {
      if (el.checked) saveState({ uiLanguage: el.value });
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
