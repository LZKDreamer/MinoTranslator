/* ═══════════════════════════════════════════════
   storage.js — 统一存储管理
   所有模块通过此模块读写 chrome.storage.sync
   ═══════════════════════════════════════════════ */

const StorageManager = (() => {
  const DEFAULTS = {
    uiLanguage: 'auto',
    sourceLanguage: 'auto',
    translationEnabled: true,
    subtitleMode: 'bilingual',
    targetLanguage: 'auto',
    fontSize: 'medium',
    subPosition: 'below',
    bgOpacity: 0.6,
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
    },
  };

  let cache = null;

  async function getAll() {
    if (cache) return cache;
    const result = await chrome.storage.sync.get(Object.keys(DEFAULTS));
    cache = { ...DEFAULTS, ...result };
    // Merge models deeply — preserve default fields in each entry
    if (result.models) {
      const merged = {};
      // Start with all default models, deep merge any stored overrides
      for (const key of Object.keys(DEFAULTS.models)) {
        merged[key] = result.models[key]
          ? { ...DEFAULTS.models[key], ...result.models[key] }
          : { ...DEFAULTS.models[key] };
      }
      // Also include any stored models not in defaults (user-added)
      for (const key of Object.keys(result.models)) {
        if (!merged[key]) {
          merged[key] = { ...result.models[key] };
        }
      }
      // 解密 apiKey 字段后再缓存
      cache.models = await ApiKeyCrypto.decryptModels(merged);
    }
    return cache;
  }

  async function get(key) {
    const all = await getAll();
    return all[key];
  }

  async function set(partial) {
    // 加密 models 中的 apiKey 字段后再存储
    let dataToStore = partial;
    if (partial.models && typeof partial.models === 'object') {
      dataToStore = { ...partial, models: await ApiKeyCrypto.encryptModels(partial.models) };
    }
    if (cache) {
      Object.assign(cache, partial);
    }
    await chrome.storage.sync.set(dataToStore);
    // Notify listeners
    listeners.forEach(fn => fn(partial));
  }

  const listeners = [];
  function listen(fn) {
    listeners.push(fn);
  }

  // Listen for cross-context changes (e.g., Options changes while Popup is open)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      // Invalidate cache so next getAll() fetches fresh
      cache = null;
      listeners.forEach(fn => fn(changes));
    }
  });

  return { getAll, get, set, listen };
})();
