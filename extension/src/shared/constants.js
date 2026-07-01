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
var TARGET_LANGUAGE_DEFAULT = 'auto';

// ═══════════════════════════════════════════════
// LANGUAGE_REGISTRY — 数据驱动的语言数据唯一源
// 所有 getLangName / getLanguageLevel / resolveLanguage 均从此查表
// ═══════════════════════════════════════════════
var LANGUAGE_REGISTRY = {
  'auto': { key: 'auto', name: 'Auto-detect', level: null, source: true, target: true, isAuto: true, i18nKey: 'sourceLang.auto', aliases: [] },
  'zh-CN': { key: 'zh-CN', name: 'Simplified Chinese', level: 'high', source: true, target: true, i18nKey: 'sourceLang.zhCN', aliases: ['zh', 'zh-CN', 'zh-Hans', 'chinese'] },
  'zh-TW': { key: 'zh-TW', name: 'Traditional Chinese', level: 'high', source: true, target: true, i18nKey: 'sourceLang.zhTW', aliases: ['zh-TW', 'zh-Hant', 'zh-HK'] },
  'en': { key: 'en', name: 'English', level: 'low', source: true, target: true, i18nKey: 'sourceLang.en', aliases: ['en', 'en-US', 'en-GB', 'en-AU', 'en-CA', 'english'] },
  'ja': { key: 'ja', name: 'Japanese', level: 'high', source: true, target: true, i18nKey: 'sourceLang.ja', aliases: ['ja', 'ja-JP', 'japanese'] },
  'ko': { key: 'ko', name: 'Korean', level: 'high', source: true, target: true, i18nKey: 'sourceLang.ko', aliases: ['ko', 'ko-KR', 'korean'] },
  'fr': { key: 'fr', name: 'French', level: 'low', source: true, target: true, i18nKey: 'sourceLang.fr', aliases: ['fr', 'fr-FR', 'french'] },
  'de': { key: 'de', name: 'German', level: 'low', source: true, target: true, i18nKey: 'sourceLang.de', aliases: ['de', 'de-DE', 'german'] },
  'es': { key: 'es', name: 'Spanish', level: 'medium', source: true, target: true, i18nKey: 'sourceLang.es', aliases: ['es', 'es-ES', 'es-MX', 'es-419', 'spanish'] },
  'pt': { key: 'pt', name: 'Portuguese', level: 'medium', source: true, target: true, i18nKey: 'sourceLang.pt', aliases: ['pt', 'pt-PT', 'pt-BR', 'portuguese'] },
  'ar': { key: 'ar', name: 'Arabic', level: 'medium', source: true, target: true, i18nKey: 'sourceLang.ar', aliases: ['ar', 'ar-SA', 'arabic'] },
  'ru': { key: 'ru', name: 'Russian', level: 'medium', source: true, target: false, aliases: ['ru', 'ru-RU', 'russian'] },
  'it': { key: 'it', name: 'Italian', level: 'medium', source: true, target: false, aliases: ['it', 'it-IT', 'italian'] },
  'th': { key: 'th', name: 'Thai', level: 'high', source: true, target: false, aliases: ['th', 'th-TH', 'thai'] },
  'vi': { key: 'vi', name: 'Vietnamese', level: 'high', source: true, target: false, aliases: ['vi', 'vi-VN', 'vietnamese'] },
  'tr': { key: 'tr', name: 'Turkish', level: 'medium', source: true, target: false, aliases: ['tr', 'tr-TR', 'turkish'] },
  'nl': { key: 'nl', name: 'Dutch', level: 'low', source: true, target: false, aliases: ['nl', 'nl-NL', 'dutch'] },
  'pl': { key: 'pl', name: 'Polish', level: 'medium', source: true, target: false, aliases: ['pl', 'pl-PL', 'polish'] },
  'id': { key: 'id', name: 'Indonesian', level: 'medium', source: true, target: false, aliases: ['id', 'id-ID', 'in', 'indonesian'] },
  'ms': { key: 'ms', name: 'Malay', level: 'medium', source: true, target: false, aliases: ['ms', 'ms-MY', 'malay'] },
  'hi': { key: 'hi', name: 'Hindi', level: 'medium', source: true, target: false, aliases: ['hi', 'hi-IN', 'hindi'] },
  'uk': { key: 'uk', name: 'Ukrainian', level: 'medium', source: true, target: false, aliases: ['uk', 'uk-UA', 'ukrainian'] },
  'el': { key: 'el', name: 'Greek', level: 'medium', source: true, target: false, aliases: ['el', 'el-GR', 'greek'] },
  'bn': { key: 'bn', name: 'Bengali', level: 'medium', source: true, target: false, aliases: ['bn', 'bn-BD', 'bn-IN', 'bengali'] },
  'ro': { key: 'ro', name: 'Romanian', level: 'medium', source: true, target: false, aliases: ['ro', 'ro-RO', 'romanian'] },
  'fa': { key: 'fa', name: 'Persian', level: 'medium', source: true, target: false, aliases: ['fa', 'fa-IR', 'persian'] },
  'cs': { key: 'cs', name: 'Czech', level: 'medium', source: true, target: false, aliases: ['cs', 'cs-CZ', 'czech'] },
  'sk': { key: 'sk', name: 'Slovak', level: 'medium', source: true, target: false, aliases: ['sk', 'sk-SK', 'slovak'] },
  'sr': { key: 'sr', name: 'Serbian', level: 'medium', source: true, target: false, aliases: ['sr', 'sr-RS', 'serbian'] },
  'hr': { key: 'hr', name: 'Croatian', level: 'medium', source: true, target: false, aliases: ['hr', 'hr-HR', 'croatian'] },
  'sw': { key: 'sw', name: 'Swahili', level: 'medium', source: true, target: false, aliases: ['sw', 'sw-KE', 'swahili'] },
  'hu': { key: 'hu', name: 'Hungarian', level: 'medium', source: true, target: false, aliases: ['hu', 'hu-HU', 'hungarian'] },
  'fi': { key: 'fi', name: 'Finnish', level: 'medium', source: true, target: false, aliases: ['fi', 'fi-FI', 'finnish'] },
  'sv': { key: 'sv', name: 'Swedish', level: 'low', source: true, target: false, aliases: ['sv', 'sv-SE', 'swedish'] },
  'no': { key: 'no', name: 'Norwegian', level: 'low', source: true, target: false, aliases: ['no', 'nb', 'nn', 'no-NO', 'norwegian'] },
  'da': { key: 'da', name: 'Danish', level: 'low', source: true, target: false, aliases: ['da', 'da-DK', 'danish'] },
  'he': { key: 'he', name: 'Hebrew', level: 'medium', source: true, target: false, aliases: ['he', 'iw', 'he-IL', 'hebrew'] },
  'fil': { key: 'fil', name: 'Filipino', level: 'medium', source: true, target: false, aliases: ['fil', 'tl', 'fil-PH', 'filipino', 'tagalog'] },
};

/**
 * 统一的语言代码归一化入口
 * @param {string} code - 语言代码
 * @returns {{ key: string, entry: object } | null}
 */
function resolveToLangCode(code) {
  if (!code) return null;
  if (LANGUAGE_REGISTRY[code]) return { key: code, entry: LANGUAGE_REGISTRY[code] };
  var normalized = String(code).toLowerCase();
  var keys = Object.keys(LANGUAGE_REGISTRY);
  for (var i = 0; i < keys.length; i++) {
    var entry = LANGUAGE_REGISTRY[keys[i]];
    if (entry.aliases) {
      for (var j = 0; j < entry.aliases.length; j++) {
        if (entry.aliases[j].toLowerCase() === normalized) return { key: keys[i], entry: entry };
      }
    }
  }
  return null;
}

/**
 * 基于 Unicode 字符集范围检测文本源语言
 * 优先级从特殊到通用，解决 CJK 冲突：kana→ja, hangul→ko, CJK→zh-CN
 * @param {string} text - 待检测文本
 * @returns {string|null} 语言代码，无法识别时返回 null
 */
function detectSourceLanguage(text) {
  if (!text || !text.trim()) return null;
  var t = text.trim();
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(t)) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(t)) return 'ko';
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(t)) return 'zh-CN';
  if (/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(t)) return 'ar';
  if (/[\u0E00-\u0E7F]/.test(t)) return 'th';
  if (/[\u0400-\u04FF]/.test(t)) return 'ru';
  var alphaCount = (t.match(/[a-zA-Z]/g) || []).length;
  if (alphaCount / t.length >= 0.6) return 'en';
  return null;
}

/**
 * 从 registry 动态生成目标语言下拉列表
 * @returns {Array<{value: string, i18nKey: string|null, name: string}>}
 */
function buildTargetLanguages() {
  var list = [{ value: 'auto', i18nKey: LANGUAGE_REGISTRY['auto'].i18nKey, name: LANGUAGE_REGISTRY['auto'].name }];
  var keys = Object.keys(LANGUAGE_REGISTRY);
  for (var i = 0; i < keys.length; i++) {
    var entry = LANGUAGE_REGISTRY[keys[i]];
    if (!entry.isAuto && entry.target) {
      list.push({ value: keys[i], i18nKey: entry.i18nKey, name: entry.name });
    }
  }
  return list;
}

/**
 * 将浏览器/YouTube 语言映射为支持的语言代码
 * @param {string} [raw] - 语言代码，不传则自动获取 navigator.language
 * @returns {string} 支持的语言代码
 */
function resolveLanguage(raw) {
  var lang = raw || (typeof navigator !== 'undefined' ? (navigator.language || 'en') : 'en');
  var resolved = resolveToLangCode(lang);
  if (resolved && resolved.entry.target && !resolved.entry.isAuto) return resolved.key;
  var parts = String(lang).split('-');
  var primaryResolved = resolveToLangCode(parts[0]);
  if (primaryResolved && primaryResolved.entry.target && !primaryResolved.entry.isAuto) return primaryResolved.key;
  return 'en';
}

/**
 * 获取用户可读的语言显示名
 * @param {string} code - 语言代码
 * @param {function} [tFn] - i18n 翻译函数 (key) => string，可选
 * @returns {string} 可读语言名
 */
function getDisplayLangName(code, tFn) {
  var entry = LANGUAGE_REGISTRY[code];
  if (!entry) {
    var resolved = resolveToLangCode(code);
    entry = resolved ? resolved.entry : null;
  }
  if (!entry || entry.isAuto) return code || '?';
  if (tFn && entry.i18nKey) {
    var localized = tFn(entry.i18nKey);
    if (localized && localized !== entry.i18nKey) return localized;
  }
  return entry.name;
}

/**
 * 解析目标语言存储值：auto→动态解析，固定值→直接返回
 * @param {string} storedValue - 存储的目标语言值
 * @returns {string} 解析后的语言代码
 */
function resolveTargetValue(storedValue) {
  var val = storedValue || TARGET_LANGUAGE_DEFAULT;
  return val === 'auto' ? resolveLanguage() : val;
}

/**
 * 共享的目标语言下拉渲染函数（供 popup 和 options 共用）
 * @param {HTMLSelectElement} $select - select 元素
 * @param {function} tFn - i18n 翻译函数
 */
function buildTargetLangSelect($select, tFn) {
  $select.innerHTML = '';
  var langs = buildTargetLanguages();
  for (var i = 0; i < langs.length; i++) {
    var opt = document.createElement('option');
    opt.value = langs[i].value;
    var displayName = langs[i].i18nKey ? tFn(langs[i].i18nKey, langs[i].name) : langs[i].name;
    opt.textContent = langs[i].value === 'auto'
      ? tFn('sourceLang.auto', 'Auto-detect') + ' · ' + getDisplayLangName(resolveLanguage(), tFn)
      : displayName;
    $select.appendChild(opt);
  }
}

var TOAST_DURATION_MS = 3000;
