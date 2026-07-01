## 1. Template + CSS

- [x] 1.1 `popup.html` 模板：在 `.video-title` 后、`.video-status` 前插入 `<div class="video-lang"></div>`
- [x] 1.2 `popup.css` 新增 `.video-lang` 样式：font-size 12px、color ink、white-space nowrap、overflow ellipsis、font-weight 500
- [x] 1.3 `popup.css` 调整 `.video-item` `min-height` 从 58px → 62px
- [x] 1.4 `popup.css` `.video-status` font-size 从 12px → 11px

## 2. JS 逻辑重构

- [x] 2.1 `getStatusLabel()` 改为返回 `{ lang: pair, status: statusText | null }`：COMPLETED 时 status 为 null，CANCELED 时 lang 为空字符串
- [x] 2.2 `renderItems()` 拆分设置：`$lang.textContent = label.lang`；`$status.textContent = label.status`（有则显示无则隐藏）
- [x] 2.3 确认 `renderItems` 中 `$lang` 和 `$status` 的 DOM 查询对应新模板结构

## 3. 验证

- [ ] 3.1 TRANSLATING 卡片显示三行：标题 / 语言对 / 状态
- [ ] 3.2 COMPLETED 卡片显示两行：标题 / 语言对（状态行隐藏）
- [ ] 3.3 AVAILABLE 卡片显示三行：标题 / 语言对 / 可翻译
- [ ] 3.4 340px 宽度下所有语言对不截断
