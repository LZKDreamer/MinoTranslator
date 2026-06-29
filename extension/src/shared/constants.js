/* ═══════════════════════════════════════════════
   constants.js — 共享状态常量
   所有模块引用这些常量，杜绝硬编码字符串
   ═══════════════════════════════════════════════ */

var STATUS = {
  AVAILABLE: 'available',
  PREPARING: 'preparing',
  TRANSLATING: 'translating',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled',
};

var MESSAGE_TYPE = {
  GET_VIDEO_TASKS: 'GET_VIDEO_TASKS',
  START_VIDEO_TASK: 'START_VIDEO_TASK',
  CANCEL_VIDEO_TASK: 'CANCEL_VIDEO_TASK',
  OPEN_VIDEO_TASK: 'OPEN_VIDEO_TASK',
  DETECT_VIDEO_TRANSLATABLE: 'DETECT_VIDEO_TRANSLATABLE',
  PREPARE_VIDEO_TRANSLATION: 'PREPARE_VIDEO_TRANSLATION',
  START_SUBTITLE_TRANSLATION: 'START_SUBTITLE_TRANSLATION',
  APPLY_VIDEO_TRANSLATIONS: 'APPLY_VIDEO_TRANSLATIONS',
  VIDEO_TASK_PROGRESS: 'VIDEO_TASK_PROGRESS',
  VIDEO_TASK_GROUP_TRANSLATED: 'VIDEO_TASK_GROUP_TRANSLATED',
  TRANSLATE_TEXT: 'TRANSLATE_TEXT',
  TRANSLATE_BATCH: 'TRANSLATE_BATCH',
  CACHE_GET: 'CACHE_GET',
  CACHE_SET: 'CACHE_SET',
  GET_SETTINGS: 'GET_SETTINGS',
  UPDATE_SETTING: 'UPDATE_SETTING',
  PROXY_FETCH: 'PROXY_FETCH',
  DEBUG_LOG: 'DEBUG_LOG',
  GET_DEBUG_LOGS: 'GET_DEBUG_LOGS',
  CLEAR_DEBUG_LOGS: 'CLEAR_DEBUG_LOGS',
  CLEAR_CACHE: 'CLEAR_CACHE',
  PURGE_MEMORY_CACHE: 'PURGE_MEMORY_CACHE',
};

var SOURCE_LANGUAGE_DEFAULT = 'auto';

var SOURCE_LANGUAGES = [
  { value: 'auto', labelKey: 'sourceLang.auto' },
  { value: 'zh-CN', labelKey: 'sourceLang.zhCN' },
  { value: 'zh-TW', labelKey: 'sourceLang.zhTW' },
  { value: 'en', labelKey: 'sourceLang.en' },
  { value: 'ja', labelKey: 'sourceLang.ja' },
  { value: 'ko', labelKey: 'sourceLang.ko' },
  { value: 'fr', labelKey: 'sourceLang.fr' },
  { value: 'de', labelKey: 'sourceLang.de' },
  { value: 'es', labelKey: 'sourceLang.es' },
  { value: 'pt', labelKey: 'sourceLang.pt' },
  { value: 'ar', labelKey: 'sourceLang.ar' },
];

var TARGET_LANGUAGE_DEFAULT = 'auto';

var TARGET_LANGUAGES = [
  { value: 'zh-CN', labelKey: 'sourceLang.zhCN' },
  { value: 'zh-TW', labelKey: 'sourceLang.zhTW' },
  { value: 'en', labelKey: 'sourceLang.en' },
  { value: 'ja', labelKey: 'sourceLang.ja' },
  { value: 'ko', labelKey: 'sourceLang.ko' },
  { value: 'fr', labelKey: 'sourceLang.fr' },
  { value: 'de', labelKey: 'sourceLang.de' },
  { value: 'es', labelKey: 'sourceLang.es' },
  { value: 'pt', labelKey: 'sourceLang.pt' },
  { value: 'ar', labelKey: 'sourceLang.ar' },
];

var LANGUAGE_CODE_MAP = {
  'zh': 'zh-CN', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', 'zh-HK': 'zh-TW',
  'en': 'en', 'ja': 'ja', 'ko': 'ko',
  'fr': 'fr', 'de': 'de', 'es': 'es', 'pt': 'pt', 'ar': 'ar',
};

/**
 * 将浏览器语言映射为支持的语言代码
 * @param {string} [raw] - navigator.language 的值，不传则自动获取
 * @returns {string} 支持的语言代码
 */
function resolveLanguage(raw) {
  var lang = raw || (typeof navigator !== 'undefined' ? (navigator.language || 'en') : 'en');
  var parts = String(lang).split('-');
  // 先尝试完整匹配 zh-CN, zh-TW
  if (LANGUAGE_CODE_MAP[lang]) return LANGUAGE_CODE_MAP[lang];
  // 再尝试主语言匹配 zh, en
  if (LANGUAGE_CODE_MAP[parts[0]]) return LANGUAGE_CODE_MAP[parts[0]];
  return 'en';
}

var TOAST_DURATION_MS = 3000;
