## 1. LANGUAGE_REGISTRY (constants.js)

- [x] 1.1 定义 `LANGUAGE_REGISTRY` 对象，覆盖所有 `getLanguageLevel()` 中已有的 40+ 种语言，每项含 `name`、`level`、`source`、`target`、`isAuto`、`i18nKey`、`aliases`
- [x] 1.2 移除 `SOURCE_LANGUAGES` 和 `TARGET_LANGUAGES` 静态数组
- [x] 1.3 移除 `LANGUAGE_CODE_MAP`（功能由 registry aliases 替代）
- [x] 1.4 新增 `buildTargetLanguages()` 函数，从 registry 动态生成目标语言下拉列表
- [x] 1.5 重写 `resolveLanguage(raw)`：通过 registry aliases 查找 canonical code，只返回 `target: true` 的条目。优先 `navigator.language`，其次 YouTube `<html lang>`，fallback `"en"`

## 2. translate-prompt.js 适配 registry

- [x] 2.1 重写 `getLangName(lang)`：查 `LANGUAGE_REGISTRY` → 匹配 aliases → 返回 `entry.name` → fallback 返回原始代码
- [x] 2.2 重写 `getLanguageLevel(lang)`：查 `LANGUAGE_REGISTRY` → 匹配 aliases → 返回 `entry.level` → fallback `"medium"`
- [x] 2.3 确认 `getContextWindowSize()` 通过 `getLanguageLevel()` 间接使用 registry，无需额外改动

## 3. 源语言改为只读显示

- [x] 3.1 `popup.html`: 源语言 `<select id="sourceLanguage">` 替换为 `<span id="sourceLanguageDisplay">`
- [x] 3.2 `popup.js`: 移除源语言下拉渲染和 change 事件绑定；新增 `updateSourceLanguageDisplay(code)` 在视频检测后更新显示
- [x] 3.3 `popup.css`: 新增 `.source-lang-display` 样式，与现有 label 视觉一致
- [x] 3.4 `options.html`: 源语言 `<select>` 替换为只读描述文字
- [x] 3.5 `options.js`: 移除相关渲染逻辑

## 4. 目标语言 auto 展示

- [x] 4.1 `popup.js` `setResolvedLanguageValues()`: 重写为从 registry 生成 dropdown；`auto` 项闭合态显示解析值，展开态显示 `"自动跟随 · <解析语言名>"`
- [x] 4.2 `popup.js` `getEffectiveTargetLanguage()`: 已有逻辑，确认无改动（`auto` 时调用 `resolveLanguage()`）
- [x] 4.3 `options.js` `setResolvedLanguageValues()`: 同步 popup 逻辑
- [x] 4.4 确认 popup 和 options 两个 `targetLanguage` change 事件仍正确保存和刷新

## 5. 视频状态行语言名展示

- [x] 5.1 在 `constants.js` 中新增 `getDisplayLangName(code, tFn)` 函数：优先 i18n 标签，fallback 到 `LANGUAGE_REGISTRY[code].name`
- [x] 5.2 `popup.js` `getStatusLabel()`: 对 `AVAILABLE`、`PREPARING`、`TRANSLATING`、`COMPLETED` 状态统一使用 `getDisplayLangName()` 展示源/目标语言对
- [x] 5.3 移除 `formatLangCode()`（不再需要）

## 6. content script 适配

- [x] 6.1 `youtube.js` `loadSettings()`: `sourceLanguage` 强制为 `"auto"`（忽略存储的旧值）
- [x] 6.2 `youtube.js` 新增 `detectYouTubeUILang()`，读取 `document.documentElement.lang`，通过 `resolveLanguage()` 获取 canonical code，用于 target auto 解析的优先检测
- [x] 6.3 `youtube-subtitles.js`: 确认 `selectBestTrack` 的 auto 逻辑无需改动（本身已正确处理 audioTracks 匹配）

## 7. i18n 更新

- [x] 7.1 `zh-CN.json` `sourceLang`: 确认现有标签覆盖 target 列表中所有有 i18nKey 的语言；新增 `options.sourceAutoDesc`
- [x] 7.2 `en.json`: 同上镜像更新

## 8. 验证

- [ ] 8.1 打开印尼语 YouTube 视频，确认源语言显示 "Indonesian" 或 "印尼语"，目标语言正常解析为 "English" 或 "简体中文"
- [ ] 8.2 点击翻译，确认 AI 提示词中源语言显示为 "Indonesian"（非 "id"），译文正确翻译为中文
- [ ] 8.3 切换目标语言为 `auto` → 日语 → `auto`，确认来回切换正确，`auto` 时显示解析值
- [ ] 8.4 打开 options 页面，确认源语言为只读描述，目标语言 dropdown 行为正确
- [ ] 8.5 分别在中文浏览器和英文浏览器环境下验证 `resolveLanguage()` 的 target 解析结果
