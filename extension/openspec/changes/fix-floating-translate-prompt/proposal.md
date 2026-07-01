## Why

划词翻译（floating translate）将韩语等非英语文本翻译成英语而非用户设定的简体中文，即使目标语言已明确设为"简体中文"。根因是 `buildFloatingPrompt` 缺少源语言锚点和强输出约束——对比 YouTube 字幕翻译的 `buildBatchTranslatePrompt` 正常，是因为后者有清晰的 "from X to Y" 方向声明和 CRITICAL 级禁止混用语言的指令。

## What Changes

- 在 `constants.js` 新增 `detectSourceLanguage(text)` 函数，基于 Unicode 字符集范围分析，零 API 调用
- 在 `translate-prompt.js` 修改 `buildFloatingPrompt`，接收 `sourceLanguage` 参数，生成 "Translate from {source} to {target}" 格式的强指令 prompt，对齐 `buildBatchTranslatePrompt` 的输出约束级别
- 在 `translator.js` 修改 `translate()`，调用 `detectSourceLanguage()` 并将结果传入 `buildFloatingPrompt`

## Capabilities

### New Capabilities

- `source-language-detection`: 基于 Unicode 字符集的文本源语言检测，以及增强的划词翻译 prompt（含源语言锚点 + 输出语言约束）

### Modified Capabilities

<!-- No existing spec-level behavior changes -->

## Impact

- `src/shared/constants.js`: 新增 `detectSourceLanguage()` 函数
- `src/shared/translate-prompt.js`: `buildFloatingPrompt()` 签名增加 `sourceLanguage` 参数，prompt 内容增强
- `src/background/translator.js`: `translate()` 调用新增检测逻辑
