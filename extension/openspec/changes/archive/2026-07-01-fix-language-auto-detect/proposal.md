## Why

AI翻译提示词中源语言名称缺失（如印尼语 `id` → `"id"` 而非 `"Indonesian"`），导致AI无法正确理解翻译方向，输出与原文相同。同时目标语言下拉框缺少 `auto` 选项，用户选择了固定语言后无法回到自动检测，UI也无法展示自动检测的实际解析结果。

## What Changes

- **BREAKING**: 源语言改为只读显示，移除下拉选择器，始终自动检测视频字幕语言
- 目标语言下拉框新增 `auto` 选项，选中时展示解析后的具体语言
- 引入数据驱动的 `LANGUAGE_REGISTRY`，替代所有散落的硬编码语言数据（`getLangName` 的 if-ladder、`getLanguageLevel` 的数组列表、`SOURCE_LANGUAGES`/`TARGET_LANGUAGES` 静态数组）
- 视频列表状态行（AVAILABLE、COMPLETED等）展示人类可读的语言名称（如 "한국어 → 简体中文"）
- `resolveLanguage()` 增加 YouTube 页面 UI 语言作为 fallback 检测源

## Capabilities

### New Capabilities
- `language-registry`: 统一的数据驱动语言注册表，包含语言代码、英文名、本地化名、语义等级、source/target可用性。替代所有散落的硬编码语言数据。
- `target-language-auto`: 目标语言支持 `auto` 模式并通过UI透明展示解析结果

### Modified Capabilities
- （无现有 spec 涉及语言选择逻辑，本次不需修改已有 spec）

## Impact

| 文件 | 影响 |
|------|------|
| `shared/constants.js` | 新增 `LANGUAGE_REGISTRY`；移除 `SOURCE_LANGUAGES`、`TARGET_LANGUAGES` 硬编码数组（改为从 registry 动态生成）；`LANGUAGE_CODE_MAP` 合并入 registry |
| `shared/translate-prompt.js` | `getLangName()`、`getLanguageLevel()` 改为查 registry；`getContextWindowSize()` 同步调整 |
| `popup/popup.html` | 源语言 `<select>` 改为只读 `<span>` |
| `popup/popup.css` | 新增源语言只读展示样式 |
| `popup/popup.js` | 移除源语言下拉事件；`setResolvedLanguageValues()` 重写；`getStatusLabel()` 使用 registry 名称 |
| `options/options.html` | 源语言 `<select>` 改为只读描述 |
| `options/options.js` | 同上调整 |
| `content/youtube.js` | `loadSettings()` source 始终 auto；可增加 YouTube UI 语言检测 |
| `content/youtube-subtitles.js` | source 选择逻辑简化为始终 auto |
| `src/i18n/zh-CN.json`、`en.json` | sourceLang 标签可精简（移除非视觉化语言项） |
