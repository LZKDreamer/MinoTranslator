# Mino Translator

YouTube 字幕翻译 & 网页划词翻译 Chrome 扩展。支持英/日/韩等多语言视频字幕实时 AI 翻译。

## 功能

- **YouTube 字幕实时翻译** — 自动获取字幕，AI 逐句翻译，Shadow DOM 覆盖显示
- **网页划词翻译** — 选中文本 → 弹出翻译气泡
- **双语字幕** — 原文 + 译文同时显示，位置/颜色/字号可调
- **自定义 AI 模型** — 支持任何 OpenAI-compatible API

## 安装

1. 下载本项目
2. Chrome 打开 `chrome://extensions/`
3. 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `extension/` 目录

## 使用

1. 打开 YouTube 视频
2. 点击扩展图标 → 点「翻译」
3. 字幕自动叠加在视频上

## 技术架构

```
Service Worker (background) — 消息路由、任务管理、缓存
    ↕ chrome.runtime.sendMessage
Content Scripts
    ├── youtube.js              — 视频检测、翻译调度
    ├── youtube-subtitles.js    — 字幕获取(3级降级)、断句、并发翻译
    ├── subtitle-renderer.js    — Shadow DOM 字幕渲染
    ├── timedtext-interceptor.js — Fetch/XHR Hook 绕过 PoToken
    └── floating-translate.js   — 划词翻译
```

### 字幕获取 (3 级降级)

1. 解析页面 `ytInitialPlayerResponse` JSON
2. 重新请求视频页面 HTML 正则提取
3. 注入 `timedtext-page-hook.js` Hook `fetch` 拦截 YouTube 播放器自身的字幕请求

### 断句 & 翻译

- JSON3 词级解析 + 本地断句（标点切分、间隙检测、碎片合并）
- 播放位优先 + 2 路并发 AI 翻译
- 带索引 JSON 格式对齐，防止 AI 输出错位
- 短句最小展示时长 (0.8s)，防止一闪而过

### 渲染

- Shadow DOM 隔离，`requestAnimationFrame` 逐帧对齐
- 广告检测自动隐藏
- 三模式：原文 / 双语 / 译文

## 项目结构

```
extension/
├── manifest.json              # MV3 扩展声明
├── src/
│   ├── background/
│   │   ├── service-worker.js  # 消息网关、任务管理
│   │   ├── translator.js      # 划词翻译 API
│   │   └── storage.js        # chrome.storage 封装
│   ├── content/
│   │   ├── youtube.js         # 视频检测、翻译调度
│   │   ├── youtube-subtitles.js # 字幕获取、断句、翻译
│   │   ├── subtitle-renderer.js # Shadow DOM 渲染
│   │   ├── timedtext-interceptor.js # 主世界注入
│   │   ├── timedtext-page-hook.js   # Fetch/XHR Hook
│   │   └── floating-translate.js    # 划词翻译
│   ├── shared/
│   │   ├── constants.js       # 状态常量
│   │   ├── messaging.js       # 消息 & 调试工具
│   │   ├── translate-prompt.js # Prompt 构建
│   │   └── crypto-utils.js    # API Key 加密 (AES-256-GCM)
│   ├── popup/                 # 扩展弹出界面
│   ├── options/               # 完整设置页
│   └── offscreen/             # Offscreen document
└── icons/
```

## License

MIT
