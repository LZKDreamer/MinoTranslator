/* ═══════════════════════════════════════════════
   storage.js — 统一存储管理
   所有模块通过此模块读写 chrome.storage.sync
   ═══════════════════════════════════════════════ */

const StorageManager = (() => {
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
        apiUrl: 'https://api.agnes-ai.com/v1',
        apiKey: '',
        modelId: 'agnes-20-flash',
        enabled: true,
      },
    },
  };

  let cache = null;

  async function getAll() {
    if (cache) return cache;
    const result = await chrome.storage.sync.get(Object.keys(DEFAULTS));
    cache = { ...DEFAULTS, ...result };
    // Merge models deeply
    if (result.models) {
      cache.models = { ...DEFAULTS.models, ...result.models };
    }
    return cache;
  }

  async function get(key) {
    const all = await getAll();
    return all[key];
  }

  async function set(partial) {
    if (cache) {
      Object.assign(cache, partial);
    }
    await chrome.storage.sync.set(partial);
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
