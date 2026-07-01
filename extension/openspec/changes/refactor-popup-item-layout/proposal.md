## Why

视频列表 item 的 `.video-status` 行同时承载「语言对」（如 `한국어 → 简体中文`）和「翻译状态」（如 `翻译中...`），在 208px 可用宽度下文字拥挤甚至截断，视觉混乱。应拆分为独立的两行，每种信息有自己的语义空间。

## What Changes

- 模板 `.video-meta` 新增 `.video-lang` 行，专用于展示语言对
- `.video-status` 改为只展示状态文字（`翻译中...`/`可翻译`/`准备字幕`），完成/取消时隐藏该行
- `getStatusLabel()` 改为返回 `{ lang: string, status: string | null }`，调用方分别设置两个 DOM 元素
- CSS 微调 `.video-item` 的最小高度和行间距

## Capabilities

### Modified Capabilities
- `target-language-auto`: 视频状态标签拆分为语言对行和状态行，不再合并展示

## Impact

| 文件 | 影响 |
|------|------|
| `popup.html` | 模板 `<article>` 新增 `<div class="video-lang">` |
| `popup.css` | 新增 `.video-lang` 样式；调整 `.video-item` 最小高度 |
| `popup.js` | `getStatusLabel()` 返回 `{ lang, status }`；`renderItems()` 拆分设置两个元素 |
