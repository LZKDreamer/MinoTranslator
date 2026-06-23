# YouTube 翻译插件 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个完整的 Chrome 翻译扩展，实现 YouTube 字幕翻译 + 划词翻译功能

**Architecture:** Manifest V3 扩展，5 个模块：Service Worker（后台翻译+消息路由）、YouTube Content Script（字幕获取+清洗+自定义渲染层）、划词 Content Script（浮动弹窗）、Popup（快速设置）、Options（完整设置页）。所有模块通过 `chrome.runtime.sendMessage` 通信。

**Tech Stack:** 纯原生 JavaScript + CSS + Chrome Extension Manifest V3 + chrome.storage.sync

## Global Constraints

- 不允许使用任何第三方库或框架（纯原生 JS）
- 所有颜色使用 CSS 自定义属性在 `:root` 中定义（参考 DESIGN.md 的 OKLCH 值）
- UI 文字必须通过 `data-i18n` 属性 + i18n JSON 文件加载，不硬编码
- Popup 宽度固定 320px，不允许滚动
- API Key 存储使用 `chrome.storage.sync`，敏感程度更高的可改为 `chrome.storage.local`
- 翻译 API 统一使用 OpenAI-compatible `/chat/completions` 接口格式
- 提交消息使用 Conventional Commits（feat/fix/docs/refactor）

---

### Task 1: manifest.json

**Files:**
- Create: `manifest.json`

**Interfaces:**
- Consumes: 无
- Produces: 扩展入口配置，定义所有模块的注册路径和权限

- [ ] **Step 1: 创建 manifest.json**

```json
{
  "manifest_version": 3,
  "name": "YouTube 翻译插件",
  "version": "1.0.0",
  "description": "YouTube 字幕翻译 & 页面划词翻译",
  "default_locale": "zh_CN",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "https://www.youtube.com/*",
    "https://*.youtube.com/*",
    "https://api.agnes-ai.com/*"
  ],
  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://www.youtube.com/*"],
      "js": ["src/content/youtube.js"],
      "css": ["src/content/styles/subtitle.css"],
      "run_at": "document_idle"
    },
    {
      "matches": ["<all_urls>"],
      "exclude_matches": ["https://www.youtube.com/*"],
      "js": ["src/content/floating-translate.js"],
      "css": ["src/content/styles/floating.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_title": "翻译插件",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "options_ui": {
    "page": "src/options/options.html",
    "open_in_tab": true
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "web_accessible_resources": [
    {
      "resources": ["src/i18n/*.json"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

- [ ] **Step 2: 验证 JSON 格式**

Run: `python -m json.tool manifest.json > /dev/null && echo "valid"` 或使用任何 JSON 验证器
Expected: `valid`

- [ ] **Step 3: 提交**

```bash
git add manifest.json
git commit -m "feat: add manifest.json for Chrome Extension Manifest V3"
```

---

### Task 2: Background — storage.js（统一存储管理）

**Files:**
- Create: `src/background/storage.js`

**Interfaces:**
- Consumes: 无
- Produces: `StorageManager.get(key)`, `StorageManager.set(partial)`, `StorageManager.listen(callback)` — 所有模块通过此模块读写配置

**存储键名对照表（来自设计文档 + 已有 Popup/Options 代码）：**

| 存储键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `uiLanguage` | string | `"auto"` | 界面语言：auto / zh-CN / en |
| `translationEnabled` | boolean | `true` | 翻译总开关 |
| `subtitleMode` | string | `"bilingual"` | 字幕模式：original / bilingual / translated |
| `targetLanguage` | string | `"zh-CN"` | 目标翻译语言 |
| `fontSize` | string | `"medium"` | 字幕字号：small / medium / large |
| `subPosition` | string | `"below"` | 译文位置：below / above / replace |
| `bgOpacity` | number | `0.6` | 字幕背景透明度 0.2~0.9 |
| `floatingTranslateEnabled` | boolean | `true` | 划词翻译开关 |
| `floatPosition` | string | `"mouse"` | 划词位置：mouse / fixed |
| `models` | object | 见下方 | 翻译模型配置字典 |

**models 默认值：**
```json
{
  "agnes-ai": {
    "name": "Agnes AI",
    "apiUrl": "https://api.agnes-ai.com/v1",
    "apiKey": "",
    "modelId": "agnes-20-flash",
    "enabled": true
  }
}
```

- [ ] **Step 1: 创建 storage.js**

```javascript
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
```

- [ ] **Step 2: 提交**

```bash
git add src/background/storage.js
git commit -m "feat: add unified storage manager"
```

---

### Task 3: Background — translator.js（翻译 API 抽象层）

**Files:**
- Create: `src/background/translator.js`

**Interfaces:**
- Consumes: `StorageManager.get('models')`, `StorageManager.get('targetLanguage')`
- Produces: `Translator.translate(text, modelKey)` → `Promise<string>`

统一使用 OpenAI-compatible `/chat/completions` 接口格式，所有主流模型（Agnes AI, OpenAI, Claude, DeepSeek, Qwen, Minimax）均兼容此格式。

- [ ] **Step 1: 创建 translator.js**

```javascript
/* ═══════════════════════════════════════════════
   translator.js — 翻译 API 抽象层
   统一使用 OpenAI-compatible /chat/completions 格式
   ═══════════════════════════════════════════════ */

const Translator = (() => {
  // 翻译缓存：Map<`text:targetLang:modelKey`, { result, timestamp }>
  const cache = new Map();
  const CACHE_TTL = 1000 * 60 * 60; // 1 hour

  function getCacheKey(text, targetLang, modelKey) {
    return `${text}:${targetLang}:${modelKey}`;
  }

  /**
   * 翻译单段文本
   * @param {string} text - 原文
   * @param {string} modelKey - 模型配置键名（如 'agnes-ai'）
   * @returns {Promise<string>} 译文
   */
  async function translate(text, modelKey) {
    if (!text || !text.trim()) return '';

    const models = await StorageManager.get('models');
    const targetLang = await StorageManager.get('targetLanguage');
    const model = models[modelKey || 'agnes-ai'];

    if (!model || !model.enabled) {
      throw new Error('Model not configured or disabled');
    }
    if (!model.apiKey) {
      throw new Error('API Key not configured');
    }

    // Check cache
    const cacheKey = getCacheKey(text, targetLang, modelKey);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.result;
    }

    // Build system prompt based on target language
    const langName = targetLang === 'zh-CN' ? '简体中文' : 'English';
    const systemPrompt = `You are a translator. Translate the following text to ${langName}. Preserve the original meaning and tone. Output ONLY the translation, no explanations.`;

    const response = await fetch(`${model.apiUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({
        model: model.modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        max_tokens: 2048,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`API error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content?.trim() || '';

    // Cache result
    cache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
  }

  /**
   * 批量翻译（带限速控制）
   * @param {string[]} texts - 原文数组
   * @param {string} modelKey
   * @param {function} onProgress - 每完成一条的回调
   * @returns {Promise<string[]>} 译文数组
   */
  async function translateBatch(texts, modelKey, onProgress) {
    const results = [];
    for (let i = 0; i < texts.length; i++) {
      try {
        const t = await translate(texts[i], modelKey);
        results.push(t);
      } catch (e) {
        results.push('');
      }
      if (onProgress) onProgress(i + 1, texts.length);
      // Rate limiting: 100ms between requests
      if (i < texts.length - 1) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    return results;
  }

  return { translate, translateBatch };
})();
```

- [ ] **Step 2: 提交**

```bash
git add src/background/translator.js
git commit -m "feat: add translation API abstraction layer with caching"
```

---

### Task 4: Background — service-worker.js（消息路由）

**Files:**
- Create: `src/background/service-worker.js`

**Interfaces:**
- Consumes: `StorageManager`, `Translator`
- Produces: 消息处理器，响应所有 content script 和 popup 的消息请求

- [ ] **Step 1: 创建 service-worker.js**

```javascript
/* ═══════════════════════════════════════════════
   service-worker.js — 后台 Service Worker
   消息路由 & 翻译服务调度
   ═══════════════════════════════════════════════ */

importScripts('storage.js', 'translator.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = messageHandlers[request.type];
  if (handler) {
    handler(request, sender).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // Keep channel open for async response
  }
});

const messageHandlers = {
  // 翻译单段文本
  async TRANSLATE_TEXT(request) {
    const { text, modelKey } = request;
    const result = await Translator.translate(text, modelKey);
    return { result };
  },

  // 批量翻译
  async TRANSLATE_BATCH(request) {
    const { texts, modelKey } = request;
    const results = await Translator.translateBatch(texts, modelKey);
    return { results };
  },

  // 读取设置
  async GET_SETTINGS(request) {
    const keys = request.keys;
    if (keys && Array.isArray(keys)) {
      const result = {};
      for (const key of keys) {
        result[key] = await StorageManager.get(key);
      }
      return result;
    }
    return await StorageManager.getAll();
  },

  // 更新设置
  async UPDATE_SETTING(request) {
    await StorageManager.set(request.data);
    return { success: true };
  },

  // 获取字幕数据（代理请求，避免 CORS 问题）
  async PROXY_FETCH(request) {
    const { url, headers } = request;
    const resp = await fetch(url, { headers: headers || {} });
    const text = await resp.text();
    return { text, status: resp.status };
  },
};

// Keep service worker alive during active translation sessions
let keepAliveInterval = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'translate-session') {
    // Start keepalive
    keepAliveInterval = setInterval(() => {
      chrome.storage.local.get('_ping').catch(() => {});
    }, 20000);

    port.onDisconnect.addListener(() => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
    });
  }
});

// Initialize: log installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('YouTube 翻译插件已安装');
});
```

- [ ] **Step 2: 提交**

```bash
git add src/background/service-worker.js
git commit -m "feat: add service worker with message routing"
```

---

### Task 5: YouTube Content — youtube.js（页面注入入口）

**Files:**
- Create: `src/content/youtube.js`
- Create: `src/content/youtube-subtitles.js`

**Interfaces:**
- Consumes: Service Worker 消息（`TRANSLATE_TEXT`, `PROXY_FETCH`, `GET_SETTINGS`）
- Produces: 字幕数据 + 渲染指令发送到 subtitle-renderer.js

- [ ] **Step 1: 创建 youtube.js（YouTube 页面入口脚本）**

```javascript
/* ═══════════════════════════════════════════════
   youtube.js — YouTube 页面注入主入口
   初始化字幕获取和渲染模块
   ═══════════════════════════════════════════════ */

(function () {
  'use strict';

  // 等待页面加载完成后初始化
  function init() {
    // 注入字幕渲染层
    const renderer = new SubtitleRenderer();
    renderer.mount();

    // 监听 YouTube 页面导航（SPA 模式）
    let currentVideoId = null;

    function checkForVideo() {
      const videoEl = document.querySelector('video');
      const newId = new URLSearchParams(window.location.search).get('v');

      if (newId && newId !== currentVideoId) {
        currentVideoId = newId;
        onVideoChange(newId, videoEl);
      }
    }

    async function onVideoChange(videoId, videoEl) {
      if (!videoEl) return;

      // 获取设置
      const settings = await sendMessage({ type: 'GET_SETTINGS' });

      // 获取字幕
      const subtitleData = await fetchSubtitles(videoId);

      // 翻译字幕
      const translatedCues = await translateCues(subtitleData.cues, settings);

      // 启动渲染
      renderer.start(videoEl, {
        cues: translatedCues,
        mode: settings.subtitleMode || 'bilingual',
        fontSize: settings.fontSize || 'medium',
        position: settings.subPosition || 'below',
        bgOpacity: settings.bgOpacity || 0.6,
      });
    }

    // 监听页面变化（SPA 页面切换）
    const observer = new MutationObserver(() => {
      checkForVideo();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 初次检查
    setTimeout(checkForVideo, 2000);
  }

  // 页面就绪后启动
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
```

- [ ] **Step 2: 创建 youtube-subtitles.js（字幕获取和清洗）**

```javascript
/* ═══════════════════════════════════════════════
   youtube-subtitles.js — 字幕获取、解析、清洗
   ═══════════════════════════════════════════════ */

/**
 * 从 YouTube 页面提取字幕数据
 */
async function fetchSubtitles(videoId) {
  // 方法1: 从 ytInitialPlayerResponse 提取
  let captionsData = extractFromPlayerResponse();

  // 方法2: 重新请求页面 HTML（fallback）
  if (!captionsData) {
    captionsData = await fetchFromPage(videoId);
  }

  if (!captionsData) {
    throw new Error('No subtitles available for this video');
  }

  // 获取字幕轨道 URL
  const trackUrl = captionsData.baseUrl;
  const rawData = await fetchSubtitleFile(trackUrl);

  // 解析为时间轴 cue 数组
  const cues = parseSubtitleData(rawData);

  // 清洗
  const cleaned = cleanCues(cues);

  return { cues: cleaned, language: captionsData.language };
}

/**
 * 从页面嵌入的 ytInitialPlayerResponse 中提取字幕数据
 */
function extractFromPlayerResponse() {
  try {
    const scriptTag = document.querySelector('script');
    // 查找 window.ytInitialPlayerResponse 的赋值
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      const match = text.match(/ytInitialPlayerResponse\s*=\s*({.*?});\s*\n/);
      if (match) {
        const data = JSON.parse(match[1]);
        const captions = data?.captions?.playerCaptionsTracklistRenderer;
        if (captions?.captionTracks?.length > 0) {
          const track = captions.captionTracks[0];
          return {
            baseUrl: track.baseUrl,
            language: track.languageCode || track.name?.simpleText || 'unknown',
          };
        }
      }
    }
  } catch (e) {
    console.warn('Failed to extract captions from player response:', e);
  }
  return null;
}

/**
 * 通过重新请求视频页面获取字幕数据（fallback）
 */
async function fetchFromPage(videoId) {
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const html = await resp.text();
    const match = html.match(/"captionTracks":(\[.*?\])/);
    if (match) {
      const tracks = JSON.parse(match[1]);
      if (tracks.length > 0) {
        return {
          baseUrl: tracks[0].baseUrl,
          language: tracks[0].languageCode || 'unknown',
        };
      }
    }
  } catch (e) {
    console.warn('Failed to fetch captions from page:', e);
  }
  return null;
}

/**
 * 获取字幕文件内容
 */
async function fetchSubtitleFile(url) {
  // 通过 Service Worker 代理请求（避免 CORS）
  const resp = await sendMessage({
    type: 'PROXY_FETCH',
    url: url,
  });

  if (resp.status !== 200) {
    throw new Error(`Failed to fetch subtitles: ${resp.status}`);
  }

  return resp.text;
}

/**
 * 解析 YouTube 字幕 XML/JSON 为 cue 数组
 * YouTube 字幕格式：<text start="seconds" dur="seconds">text content</text>
 */
function parseSubtitleData(xmlText) {
  const cues = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const textEls = doc.querySelectorAll('text');

  textEls.forEach(el => {
    const start = parseFloat(el.getAttribute('start'));
    const dur = parseFloat(el.getAttribute('dur') || '2');
    const text = el.textContent
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();

    if (text) {
      cues.push({ start, end: start + dur, text });
    }
  });

  return cues;
}

/**
 * 清洗字幕 cue
 */
function cleanCues(cues) {
  // 1. 合并相邻的短片段（时间间隔 < 0.5s 的相邻 cue 合并为一句）
  const merged = [];
  for (const cue of cues) {
    const last = merged[merged.length - 1];
    if (last && (cue.start - last.end < 0.5)) {
      last.text += ' ' + cue.text;
      last.end = cue.end;
    } else {
      merged.push({ ...cue });
    }
  }

  // 2. 清洗每段文本
  return merged.map(cue => {
    let text = cue.text;
    // 去除 HTML 标签
    text = text.replace(/<[^>]+>/g, '');
    // 去除舞台标记 [Music], [Applause], [Laughter] 等
    text = text.replace(/\[.*?\]/g, '');
    // 去除语气填充词（英文）
    text = text.replace(/\b(um|uh|er|ah|hmm|mm-hmm|uh-huh)\b/gi, '');
    // 合并重复词
    text = text.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');
    // 合并连续空格
    text = text.replace(/\s+/g, ' ').trim();
    // 基本标点补全（句末无标点时加句号）
    if (text && !/[.?!。？！，、；：""'')】」』》]$/.test(text)) {
      text += '.';
    }
    return { ...cue, text };
  }).filter(cue => cue.text.length > 0);
}

/**
 * 翻译字幕 cue 数组
 */
async function translateCues(cues, settings) {
  if (!settings.translationEnabled) return cues;

  const modelKey = 'agnes-ai'; // 使用默认模型，后续可从 settings 读取 defaultModel
  const texts = cues.map(c => c.text);

  const translatedTexts = await sendMessage({
    type: 'TRANSLATE_BATCH',
    texts,
    modelKey,
  });

  return cues.map((cue, i) => ({
    ...cue,
    translated: translatedTexts[i] || '',
  }));
}
```

- [ ] **Step 3: 提交**

```bash
git add src/content/youtube.js src/content/youtube-subtitles.js
git commit -m "feat: add YouTube subtitle fetching, parsing, cleaning and translation"
```

---

### Task 6: YouTube Content — subtitle-renderer.js（自定义字幕渲染层）

**Files:**
- Create: `src/content/subtitle-renderer.js`
- Create: `src/content/styles/subtitle.css`

**Interfaces:**
- Consumes: `video` 元素 + 配置对象
- Produces: 在视频上方叠加的自定义字幕层

- [ ] **Step 1: 创建 subtitle.css**

```css
/* ═══════════════════════════════════════════════
   subtitle.css — YouTube 自定义字幕样式
   Shadow DOM 中隔离
   ═══════════════════════════════════════════════ */

:host {
  all: initial;
  display: block;
  position: absolute;
  bottom: 8%;
  left: 50%;
  transform: translateX(-50%);
  width: 80%;
  max-width: 800px;
  pointer-events: none;
  z-index: 1000;
  text-align: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    Roboto, "Noto Sans", sans-serif;
  transition: opacity 0.2s ease;
}

.cue-container {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.cue-container.visible {
  opacity: 1;
}

.cue-original {
  font-size: clamp(14px, 2.5vmin, 22px);
  font-weight: 500;
  color: #ffffff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  line-height: 1.5;
  margin-bottom: 4px;
}

.cue-translated {
  font-size: clamp(13px, 2.2vmin, 20px);
  font-weight: 400;
  color: #e0e0e0;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  line-height: 1.5;
}

/* Font size variants */
.size-small .cue-original { font-size: clamp(12px, 2vmin, 18px); }
.size-small .cue-translated { font-size: clamp(11px, 1.8vmin, 16px); }
.size-large .cue-original { font-size: clamp(18px, 3.5vmin, 30px); }
.size-large .cue-translated { font-size: clamp(16px, 3vmin, 26px); }
```

- [ ] **Step 2: 创建 subtitle-renderer.js**

```javascript
/* ═══════════════════════════════════════════════
   subtitle-renderer.js — 自定义字幕渲染层
   使用 Shadow DOM 隔离，通过 requestVideoFrameCallback 同步
   ═══════════════════════════════════════════════ */

class SubtitleRenderer {
  constructor() {
    this.host = null;
    this.shadow = null;
    this.video = null;
    this.cues = [];
    this.config = {
      mode: 'bilingual',
      fontSize: 'medium',
      position: 'below',
      bgOpacity: 0.6,
    };
    this.rafId = null;
    this.currentCueIndex = -1;
  }

  /**
   * 创建并挂载字幕 DOM 容器
   */
  mount() {
    const player = document.querySelector('#movie_player') ||
                   document.querySelector('.html5-video-player');

    if (!player) {
      // 重试直到找到播放器
      setTimeout(() => this.mount(), 1000);
      return;
    }

    this.host = document.createElement('div');
    this.host.id = 'yt-translate-subtitles';
    this.host.style.cssText = 'position: absolute; bottom: 8%; left: 0; right: 0; pointer-events: none; z-index: 1000;';

    this.shadow = this.host.attachShadow({ mode: 'open' });

    // 加载样式
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('src/content/styles/subtitle.css');
    this.shadow.appendChild(styleLink);

    // 字幕容器
    const container = document.createElement('div');
    container.className = 'cue-container';
    container.id = 'cueContainer';
    this.shadow.appendChild(container);

    // 插入到视频播放器
    // 尝试找到正确的插入位置——在 ytp-caption-window-container 旁边或在播放器底部
    const captionWindow = player.querySelector('.ytp-caption-window-container');
    if (captionWindow) {
      captionWindow.style.display = 'none'; // 隐藏 YouTube 原生字幕
      captionWindow.parentNode.insertBefore(this.host, captionWindow);
    } else {
      player.appendChild(this.host);
    }
  }

  /**
   * 开始渲染循环
   * @param {HTMLVideoElement} video - 视频元素
   * @param {Object} options - { cues, mode, fontSize, position, bgOpacity }
   */
  start(video, options) {
    this.video = video;
    this.cues = options.cues || [];
    this.config = { ...this.config, ...options };

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }

    this.renderLoop();
  }

  renderLoop() {
    if (!this.video || this.video.readyState < 2) {
      this.rafId = requestAnimationFrame(() => this.renderLoop());
      return;
    }

    const currentTime = this.video.currentTime;
    const cueIndex = this.findCueIndex(currentTime);

    if (cueIndex !== this.currentCueIndex) {
      this.currentCueIndex = cueIndex;
      this.renderCue(cueIndex);
    }

    this.rafId = requestAnimationFrame(() => this.renderLoop());
  }

  /**
   * 二分查找当前时间对应的字幕索引
   */
  findCueIndex(time) {
    if (!this.cues.length) return -1;

    let low = 0;
    let high = this.cues.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const cue = this.cues[mid];

      if (time >= cue.start && time < cue.end) {
        return mid;
      } else if (time < cue.start) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return -1;
  }

  renderCue(index) {
    const container = this.shadow.getElementById('cueContainer');
    if (!container) return;

    container.className = 'cue-container';

    if (index < 0 || index >= this.cues.length) {
      container.classList.remove('visible');
      container.innerHTML = '';
      return;
    }

    const cue = this.cues[index];
    const mode = this.config.mode;

    let html = '';

    if (mode === 'original' || mode === 'bilingual') {
      html += `<div class="cue-original">${this.escapeHtml(cue.text)}</div>`;
    }

    if ((mode === 'translated' || mode === 'bilingual') && cue.translated) {
      html += `<div class="cue-translated">${this.escapeHtml(cue.translated)}</div>`;
    }

    container.innerHTML = html;
    container.className = `cue-container size-${this.config.fontSize}`;

    // 触发 transition
    requestAnimationFrame(() => {
      container.classList.add('visible');
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 更新配置（由 Popup 设置变更时调用）
   */
  updateConfig(partial) {
    Object.assign(this.config, partial);
    // 重新渲染当前 cue
    this.renderCue(this.currentCueIndex);
  }

  /**
   * 停止并清理
   */
  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    if (this.host && this.host.parentNode) {
      this.host.parentNode.removeChild(this.host);
    }
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add src/content/subtitle-renderer.js src/content/styles/subtitle.css
git commit -m "feat: add custom subtitle renderer with Shadow DOM isolation"
```

---

### Task 7: Content — floating-translate.js（划词翻译浮动弹窗）

**Files:**
- Create: `src/content/floating-translate.js`
- Create: `src/content/styles/floating.css`

**Interfaces:**
- Consumes: Service Worker 消息 `TRANSLATE_TEXT`, `GET_SETTINGS`

- [ ] **Step 1: 创建 floating.css**

```css
/* ═══════════════════════════════════════════════
   floating.css — 划词翻译浮动弹窗样式
   ═══════════════════════════════════════════════ */

#yt-translate-floating {
  position: fixed;
  z-index: 2147483647;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}

#yt-translate-floating.visible {
  opacity: 1;
  pointer-events: auto;
}

.floating-popup {
  background: oklch(100% 0 0);
  border: 1px solid oklch(90% 0.01 260);
  border-radius: 8px;
  padding: 10px 14px;
  max-width: 360px;
  min-width: 120px;
  box-shadow: 0 4px 16px oklch(0% 0 0 / 0.12);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    Roboto, "Noto Sans", sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: oklch(20% 0.01 265);
  position: relative;
}

.floating-popup .original-text {
  font-size: 13px;
  color: oklch(55% 0.02 260);
  margin-bottom: 4px;
  word-wrap: break-word;
}

.floating-popup .translated-text {
  font-weight: 500;
  word-wrap: break-word;
}

.floating-popup .close-btn {
  position: absolute;
  top: 4px;
  right: 8px;
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: oklch(55% 0.02 260);
  padding: 2px 4px;
  line-height: 1;
  border-radius: 4px;
}

.floating-popup .close-btn:hover {
  background: oklch(95% 0.008 265);
}

.floating-popup .loading {
  color: oklch(55% 0.02 260);
  font-size: 13px;
}

.floating-popup .error-msg {
  color: oklch(50% 0.2 25);
  font-size: 13px;
}

/* Fixed position variant */
#yt-translate-floating.fixed-mode {
  bottom: 24px;
  right: 24px;
  top: auto;
  left: auto;
}
```

- [ ] **Step 2: 创建 floating-translate.js**

```javascript
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
```

- [ ] **Step 3: 提交**

```bash
git add src/content/floating-translate.js src/content/styles/floating.css
git commit -m "feat: add floating translate popup for text selection"
```

---

### Task 8: 生成扩展图标

**Files:**
- Create: `icons/icon16.png`
- Create: `icons/icon48.png`
- Create: `icons/icon128.png`

- [ ] **Step 1: 创建图标（使用内联 SVG 转为 PNG）**

使用 Chrome 扩展常用的翻译图标样式（对话气泡或字母 T 图标）。用 canvas 生成简单的 3 尺寸 PNG：

创建一个临时 HTML 文件，用 canvas 绘制图标并导出：

```html
<!DOCTYPE html>
<html><body><canvas id="c"></canvas>
<script>
const sizes = [16, 48, 128];
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

sizes.forEach(size => {
  canvas.width = size;
  canvas.height = size;

  // Background
  ctx.fillStyle = '#4A90D9';
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.2);
  ctx.fill();

  // Letter T
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${size * 0.6}px -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('T', size / 2, size / 2 + 1);

  // Download
  const link = document.createElement('a');
  link.download = `icon${size}.png`;
  link.href = canvas.toDataURL();
  link.click();
});
</script></body></html>
```

在浏览器中打开此 HTML 文件，下载 3 个尺寸 PNG 放到 `icons/` 目录。

或者使用 Node.js 生成：

```javascript
const { createCanvas } = require('canvas');
const fs = require('fs');
const sizes = [16, 48, 128];
sizes.forEach(size => {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  // Blue rounded rect
  ctx.fillStyle = '#3B82F6';
  const r = size * 0.15;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, r);
  ctx.fill();
  // White T
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${size * 0.55}px -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('T', size / 2, size / 2 + size * 0.05);
  fs.writeFileSync(`icons/icon${size}.png`, c.toBuffer('image/png'));
});
```

Run: `node generate-icons.js` (requires `npm install canvas`)

或使用在线工具生成简单的蓝色圆角方块 + 白色 T 字母的 PNG 图标，保存到 `icons/` 目录。

- [ ] **Step 2: 提交**

```bash
git add icons/icon16.png icons/icon48.png icons/icon128.png
git commit -m "feat: add extension icons"
```

---

### Task 9: Integration — 统一 sendMessage 工具函数 + Popup 与 Content 通信桥梁

**Files:**
- Create: `src/shared/messaging.js`（被所有 content script 引用）

**Interfaces:**
- Produces: 全局 `sendMessage()` 函数

- [ ] **Step 1: 创建 messaging.js**

```javascript
/* ═══════════════════════════════════════════════
   messaging.js — 统一消息发送工具
   所有 content script 通过此函数与 Service Worker 通信
   ═══════════════════════════════════════════════ */

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
```

- [ ] **Step 2: 在 youtube.js 和 floating-translate.js 中引用**

youtube.js 和 floating-translate.js 中已使用 `sendMessage()` 函数，需确保在脚本执行顺序中先加载 messaging.js。

在 manifest.json 的 content_scripts 配置中，为两个 content script 都添加 `"js": ["src/shared/messaging.js"]` 作为第一个引用的脚本。

- [ ] **Step 3: 更新 manifest.json**

在 `content_scripts` 的两个条目中，`js` 数组的第一个元素都改为 `"src/shared/messaging.js"`：

```json
{
  "content_scripts": [
    {
      "matches": ["https://www.youtube.com/*"],
      "js": ["src/shared/messaging.js", "src/content/youtube.js"],
      "css": ["src/content/styles/subtitle.css"],
      "run_at": "document_idle"
    },
    {
      "matches": ["<all_urls>"],
      "exclude_matches": ["https://www.youtube.com/*"],
      "js": ["src/shared/messaging.js", "src/content/floating-translate.js"],
      "css": ["src/content/styles/floating.css"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 4: 提交**

```bash
git add src/shared/messaging.js manifest.json
git commit -m "feat: add shared messaging utility and update manifest"
```

---

### Task 10: Popup 与服务 Worker 直连（当前 Popup 直接读写 storage）

**Files:**
- Modify: `src/popup/popup.js`
- Modify: `src/options/options.js`

当前 Popup 和 Options 直接读写 `chrome.storage.sync`，而 Service Worker 的 storage.js 提供统一接口。将 Popup 改为通过消息机制与 Service Worker 通信，或保持直接读写（两者效果一致，因为都操作同一个 `chrome.storage.sync`）。**当前实现已正确**——Popup 直接通过 `chrome.storage.sync` 读写，与 Service Worker 独立运行但共享同一存储后端。此任务仅做验证确认，无需改动。

**验证：** Popup 和 Options 的设置变更，Service Worker 能通过 `chrome.storage.onChanged` 监听器感知到（已在 storage.js 中实现）。

- [ ] **Step 1: 验证 Popup 与 Options 的存储键名一致性**

确认 Popup 的 `DEFAULTS` 中使用的键名与 Options 的 `DEFAULTS` 中使用的键名一致：

| Popup 使用 | Options 使用 | 一致? |
|-----------|------------|-------|
| `translationEnabled` | `translationEnabled` | ✅ |
| `subtitleMode` | `subtitleMode` | ✅ |
| `targetLanguage` | `targetLanguage` | ✅ |
| `floatingTranslateEnabled` | `floatingTranslateEnabled` | ✅ |
| — | `uiLanguage` | N/A (Popup 无此设置) |
| — | `fontSize` | N/A |
| — | `subPosition` | N/A |
| — | `bgOpacity` | N/A |
| — | `floatPosition` | N/A |
| — | `models` | N/A |

所有共享键名一致，无需修改。

- [ ] **Step 2: 提交（如无改动则跳过）**

---

### Task 11: 错误处理与边界情况补充

**Files:**
- Modify: `src/content/youtube.js` — 添加无字幕处理
- Modify: `src/content/floating-translate.js` — 添加网络离线检测
- Modify: `src/background/service-worker.js` — 添加重试逻辑

- [ ] **Step 1: 为网络离线场景添加检测（youtube.js）**

在 youtube.js 的 `init()` 函数开头添加：

```javascript
// 检查网络状态
if (!navigator.onLine) {
  showSubtitlesOfflineNotice();
  return;
}

window.addEventListener('online', () => {
  checkForVideo();
});

function showSubtitlesOfflineNotice() {
  // 显示离线提示（使用渲染层短消息）
  console.log('Offline: subtitle translation unavailable');
}
```

- [ ] **Step 2: Service Worker 添加重试逻辑（service-worker.js）**

在 `messageHandlers.TRANSLATE_TEXT` 中添加重试：

```javascript
async TRANSLATE_TEXT(request) {
  const { text, modelKey } = request;
  const MAX_RETRIES = 1;
  let lastError;
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      const result = await Translator.translate(text, modelKey);
      return { result };
    } catch (err) {
      lastError = err;
      if (i < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  return { error: lastError.message };
},
```

- [ ] **Step 3: 提交**

```bash
git add src/content/youtube.js src/background/service-worker.js
git commit -m "fix: add offline detection and API retry logic"
```

---

### Task 12: YouTube Shorts 适配

**Files:**
- Modify: `src/content/youtube.js`

在 `checkForVideo()` 中检测 Shorts 页面：

```javascript
function isShortsPage() {
  return window.location.pathname.startsWith('/shorts/');
}

async function onVideoChange(videoId, videoEl) {
  if (!videoEl) return;

  const settings = await sendMessage({ type: 'GET_SETTINGS' });
  const isShorts = isShortsPage();

  // Shorts 使用不同的字幕渲染位置
  let subtitleData;
  if (isShorts) {
    subtitleData = await fetchSubtitlesShorts(videoId);
  } else {
    subtitleData = await fetchSubtitles(videoId);
  }

  // ... 后续翻译和渲染 ...
}
```

**Shorts 字幕获取：** Shorts 视频的字幕数据同样包含在 `ytInitialPlayerResponse` 中，但 `baseUrl` 可能需要不同的认证参数。复用 `extractFromPlayerResponse()` 逻辑（已在 youtube-subtitles.js 中实现），无需额外改动。渲染时通过 `isShorts` 标记为渲染器提供竖屏布局信息。

- [ ] **Step 1: 提交**

```bash
git add src/content/youtube.js
git commit -m "feat: add YouTube Shorts detection and adaptation"
```

---

### Task 13: 本地化 i18n 补充

**Files:**
- Modify: `src/i18n/zh-CN.json`
- Modify: `src/i18n/en.json`

当前 i18n 文件已覆盖 Popup 和 Options 的所有文本。补充 content script 中的用户可见文本：

- [ ] **Step 1: 在 content script 中使用 i18n**

对于 content script 中的用户可见消息（如"Translating..."），可以直接使用 `chrome.i18n.getMessage()` 方法加载 `_locales/` 目录下的国际化资源，无需通过 JSON 文件。

创建 `_locales/zh_CN/messages.json` 和 `_locales/en/messages.json`（注意 manifest.json 中 `default_locale: "zh_CN"`）：

**`_locales/zh_CN/messages.json`：**
```json
{
  "translating": { "message": "翻译中..." },
  "translateError": { "message": "翻译失败" },
  "noSubtitles": { "message": "此视频没有可用字幕" },
  "offlineNotice": { "message": "网络已断开，翻译不可用" },
  "noApiKey": { "message": "请先在设置中配置 API Key" },
  "embeddedNotSupported": { "message": "嵌入式视频暂不支持字幕翻译" }
}
```

**`_locales/en/messages.json`：**
```json
{
  "translating": { "message": "Translating..." },
  "translateError": { "message": "Translation failed" },
  "noSubtitles": { "message": "No subtitles available for this video" },
  "offlineNotice": { "message": "Offline: translation unavailable" },
  "noApiKey": { "message": "Please configure API Key in settings" },
  "embeddedNotSupported": { "message": "Embedded video subtitle translation is not supported" }
}
```

- [ ] **Step 2: 在 content script 中使用 chrome.i18n.getMessage()**

在 floating-translate.js 中替换硬编码的 "Translating..."：

```javascript
// 之前
showPopup(text, 'Translating...', x, y);

// 之后
showPopup(text, chrome.i18n.getMessage('translating'), x, y);
```

- [ ] **Step 3: 提交**

```bash
git add _locales/ src/content/floating-translate.js manifest.json
git commit -m "feat: add _locales for content script i18n messages"
```

---

### 任务清单汇总

| # | 任务 | 文件数 | 依赖 |
|---|------|--------|------|
| 1 | manifest.json | 1 创建 | 无 |
| 2 | storage.js 统一存储 | 1 创建 | 无 |
| 3 | translator.js 翻译 API 抽象层 | 1 创建 | Task 2 |
| 4 | service-worker.js 消息路由 | 1 创建 | Task 2, 3 |
| 5 | youtube.js + youtube-subtitles.js | 2 创建 | Task 4 |
| 6 | subtitle-renderer.js + subtitle.css | 2 创建 | Task 5 |
| 7 | floating-translate.js + floating.css | 2 创建 | Task 4 |
| 8 | 扩展图标（3 个 PNG） | 3 创建 | 无 |
| 9 | messaging.js 统一消息 + manifest 更新 | 2 修改/创建 | Task 5, 7 |
| 10 | Popup/Options 存储一致性验证 | 0 修改 | Task 2 |
| 11 | 错误处理（离线检测+API重试） | 2 修改 | Task 4, 5 |
| 12 | YouTube Shorts 适配 | 1 修改 | Task 5 |
| 13 | 本地化 i18n 补充（_locales） | 2 创建 | Task 7 |
