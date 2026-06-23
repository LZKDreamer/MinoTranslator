# YouTube 翻译插件设计文档

> 日期：2025-06-23
> 状态：已审批待实施

## 1. 概述

一款 Chrome 翻译扩展，核心功能为 **YouTube 视频字幕翻译**，辅助功能为 **页面划词翻译**。插件根据浏览器语言自动适配界面语言（中文/English），内置多种翻译模型支持，默认使用 Agnes AI。

### 1.1 目标用户

- 观看外语 YouTube 视频需要字幕翻译的用户
- 日常浏览外文网页需要辅助翻译的用户
- 偏好自备 API Key、使用自己选择的翻译模型的用户

### 1.2 技术选型

| 项目 | 选型 |
|------|------|
| 扩展框架 | Chrome Extension Manifest V3 |
| 前端 | 纯原生 JavaScript + CSS |
| 构建 | 无构建工具 |
| 存储 | chrome.storage.sync / chrome.storage.local |
| 翻译 API | 自定义抽象层，默认 Agnes AI |

---

## 2. 系统架构

### 2.1 模块划分

| 模块 | 职责 | 运行环境 |
|------|------|---------|
| **Service Worker** | 管理消息路由、调用翻译 API、缓存翻译结果 | 后台进程 (service worker) |
| **YouTube Content Script** | 注入 YouTube 页面，获取字幕数据，渲染自定义双语字幕 | YouTube 域名 |
| **划词 Content Script** | 注入所有页面，监听选中事件，显示浮动翻译弹窗 | 所有页面 |
| **Popup** | 快速切换：翻译开关、字幕模式、目标语言、划词开关 | 扩展弹出窗口 |
| **Options** | 模型配置（Agnes/OpenAI/Claude/DeepSeek/Qwen/Minimax 等）、语言、字幕样式 | 浏览器新标签页 |

### 2.2 通信架构

```
                 ┌─────────────┐
                 │   Popup     │
                 └──────┬──────┘
                        │ chrome.runtime.sendMessage
                        ▼
  ┌──────────┐    ┌─────────────┐    ┌─────────────────┐
  │YouTube   │◄──►│  Service    │◄──►│   翻译 API       │
  │Content   │    │  Worker     │    │ (Agnes/OpenAI..) │
  │Script    │◄──►│  (后台)     │    └─────────────────┘
  └──────────┘    └──────┬──────┘
  ┌──────────┐           │
  │划词      │◄──────────┘
  │Content   │
  │Script    │
  └──────────┘
```

### 2.3 消息协议

| 方向 | 消息类型 | 说明 |
|------|---------|------|
| Content → Worker | `TRANSLATE_TEXT` | 请求翻译一段文本 |
| Content → Worker | `GET_SUBTITLES` | 请求获取某个视频的字幕数据 |
| Worker → Content | `TRANSLATION_RESULT` | 返回翻译结果 |
| Popup → Worker | `GET_SETTINGS` | 读取设置 |
| Popup → Worker | `UPDATE_SETTING` | 更新某项设置 |
| Worker → Popup | `SETTINGS_CHANGED` | 通知设置已变更 |

---

## 3. YouTube 字幕翻译（核心功能）

### 3.1 字幕获取方案

采用**网络抓取**方式，而非 DOM 监听：

1. 页面加载后，从 YouTube 页面 HTML 中提取 `captionTracks` 的 JSON 数据（嵌入在 ytInitialPlayerResponse 中）
2. 解析得到字幕轨道列表，包含语言、`baseUrl`（字幕文件地址）、`vssId` 等信息
3. 从 `baseUrl` 获取完整字幕时间轴数据（XML 或 JSON 格式）
4. 对于需要 PoToken 认证的视频，追加认证参数到请求 URL

### 3.2 字幕数据清洗

自动生成字幕（ASR）需进行清洗处理：

- **合并被分割片段**：YouTube 自动字幕常将一句话切成多段 time cue，合并为完整句子再翻译
- **去除语气填充词**：移除 "um", "uh", "er" 等无意义填充词
- **去除舞台标记**：移除 `[Music]`, `[Applause]`, `[Laughter]` 等非文字标记
- **补充标点**：自动字幕缺少标点，用规则补全以保证翻译质量
- **处理重复**：合并连续重复词 "the the the" → "the"

**原则**：清洗仅改善翻译质量，不修正原文语义。原文保持原样显示。

### 3.3 字幕渲染方案

采用**自定义渲染层**，完全绕过 YouTube 原生字幕 DOM：

1. 在视频播放器上方创建一个 `<div>` 容器作为自定义字幕层，使用 Shadow DOM 隔离样式
2. 通过 `requestVideoFrameCallback` 监听视频播放进度，每帧根据 `video.currentTime` 执行二分搜索定位当前字幕
3. 将翻译后的文本渲染到自定义字幕层中

**拖拽进度条同步**：自定义渲染层每帧读取 `video.currentTime`，拖拽进度条会自然触发时间跳变，下一帧即重新计算并显示正确字幕。无需特殊处理。

### 3.4 字幕显示模式

支持三种模式，通过 Popup 一键切换：

| 模式 | 显示内容 |
|------|---------|
| **双语对照** | 原文在上，译文在下（默认） |
| **仅译文** | 只显示翻译后的文本 |
| **仅原文** | 只显示 YouTube 原字幕（相当于关闭翻译） |

### 3.5 字幕样式

- 译文显示在原文下方
- 字体大小可配置（小/中/大）
- 半透明黑色背景保证可读性
- 译文过长时自动换行，若仍超出容器宽度则逐步缩小字号（smart layout）
  - 用 `<canvas>` 测量文本宽度，动态计算最佳字号和换行点
  - 最小字号不低于原始字号的 60%

### 3.6 翻译缓存

- 短时间内相同的原文片段不重复调用翻译 API
- 缓存键：`原文文本 + 目标语言 + 模型ID`
- 缓存有效期：当前视频会话

### 3.7 错误处理

| 场景 | 处理方式 |
|------|---------|
| API Key 未配置 | 显示"请先配置 API Key"，字幕显示原文 |
| API 请求超时/失败 | 显示错误提示，保留原文，自动重试一次 |
| YouTube 无字幕 | 检测到无可用字幕轨道，Popup 显示提示 |
| 视频切换/页面导航 | Content Script 重新检测字幕轨道 |
| 网络离线 | 检测 `navigator.onLine`，显示离线提示 |
| 字幕获取 PoToken 失败 | 降级尝试其他获取方式或提示手动开启 YouTube CC |

### 3.8 视频变化与特殊场景

| 场景 | 处理方式 |
|------|---------|
| **播放列表自动切换** | 监听 YouTube 的 `yt-navigate-finish` 事件或 `popstate`；检测到视频 ID 变化后重新获取新视频的字幕数据 |
| **YouTube Shorts** | Shorts 使用不同的播放器结构。检测到 Shorts 页面（URL 包含 `/shorts/`）时，使用 Shorts 对应的字幕容器选择器；渲染层适配竖屏布局 |
| **嵌入式 YouTube 视频**（`<iframe>` 在其他网站） | 由于跨域限制，无法操作 iframe 内部 DOM。对此场景**不做字幕翻译支持**，仅在 Popup 中提示"嵌入式视频暂不支持" |


---

## 4. 划词翻译（辅助功能）

- **触发方式**：用户在任意页面选中文本后，自动在选中位置附近弹出浮动翻译气泡
- **操作**：浮动气泡显示译文，可点击关闭
- **开关**：Popup 中提供划词翻译总开关
- **翻译目标语言**：与字幕翻译的目标语言一致
- **位置**：跟随鼠标选中位置（默认），可配置为固定在右下角

---

## 5. 用户界面

### 5.1 Popup（快速设置）

点击扩展图标弹出的窗口内容：

- 翻译开关（开启/关闭）
- 字幕模式选择（原文 / 双语 / 译文）
- 目标语言下拉（简体中文 / English 等）
- 划词翻译开关
- "打开完整设置"链接 → Options 页面

### 5.2 Options（设置页）

在浏览器新标签页中打开，分 5 个功能区：

**① 翻译模型配置**
- 默认模型：Agnes AI（预填 API 地址 `https://api.agnes-ai.com/v1`，模型 ID `agnes-20-flash`）
- 添加模型按钮，支持 OpenAI / Claude / DeepSeek / Qwen / Minimax 等
- 每个模型可配置：名称别名、API 地址、API Key、模型 ID、启用/禁用
- 测试连接按钮

**② UI 语言**
- 自动检测（默认）：读取 `chrome.i18n.getUILanguage()` 获取浏览器语言
  - 若为 `zh-CN` / `zh-TW` → 简体中文界面
  - 若为 `en` / `en-US` / `en-GB` → English 界面
  - 其他 → 回退 English
- 手动指定：简体中文 / English（覆盖自动检测）

**③ 字幕设置**
- 字号大小：小 / 中 / 大
- 译文位置：原文下方 / 原文上方 / 替换原文
- 背景透明度：滑块 0.2~0.9

**④ 划词翻译设置**
- 启用/禁用快捷键
- 显示位置：跟随鼠标 / 固定在右下角

**⑤ 关于**
- 版本号

---

## 6. 数据存储

使用 `chrome.storage.sync` 存储用户设置，自动同步到登录的 Google 账户：

```json
{
  "uiLanguage": "auto",
  "uiLanguageOverride": "",
  "translationEnabled": true,
  "targetLanguage": "zh-CN",
  "subtitleMode": "bilingual",
  "subtitleFontSize": "medium",
  "subtitleBgOpacity": 0.6,
  "floatingTranslateEnabled": true,
  "defaultModel": "agnes-ai",
  "models": {
    "agnes-ai": {
      "name": "Agnes AI",
      "apiUrl": "https://api.agnes-ai.com/v1",
      "apiKey": "",
      "modelId": "agnes-20-flash",
      "enabled": true
    }
  }
}
```

API Key 可选择使用 `chrome.storage.local` 存储（不同步到云端），也可由用户自行决定。

---

## 7. 项目文件结构

```
youtube-translate/
├── manifest.json              # Manifest V3
├── src/
│   ├── background/
│   │   ├── service-worker.js  # 后台 Service Worker
│   │   ├── translator.js      # 翻译 API 抽象层
│   │   └── storage.js         # 存储管理
│   ├── content/
│   │   ├── youtube.js         # YouTube 字幕内容脚本
│   │   ├── youtube-subtitles.js  # 字幕获取+清洗
│   │   ├── subtitle-renderer.js  # 自定义字幕渲染层
│   │   ├── floating-translate.js # 划词翻译内容脚本
│   │   └── styles/
│   │       ├── subtitle.css    # 字幕样式
│   │       └── floating.css    # 划词弹窗样式
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── options/
│   │   ├── options.html
│   │   ├── options.js
│   │   └── options.css
│   └── i18n/
│       ├── zh-CN.json          # 简体中文
│       └── en.json             # English
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## 8. 不在此范围的功能

以下功能明确不包含在本次实现中，以避免范围蔓延：

- 视频音频实时翻译（非字幕级别）
- 字幕导出/下载功能
- 生词本/学习模式
- 多用户/多设备同步（Chrome 自带 sync 除外）
- 翻译质量评分/反馈机制
- 离线翻译模型

---

## 9. 技术债务与风险

| 风险 | 缓解措施 |
|------|---------|
| YouTube 页面结构变更导致字幕提取失败 | 使用正则+JSON 双重解析，增加 fallback 方案 |
| YouTube PoToken 认证要求变化 | 预留认证参数扩展点 |
| Agnes AI API 变更 | 通过翻译抽象层隔离，切换模型只需改配置 |
| 字幕渲染与 YouTube 播放器样式冲突 | 使用 Shadow DOM 完全隔离 |
