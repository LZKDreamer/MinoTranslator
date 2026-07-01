## 1. constants.js — 新增 resolveToLangCode + entry.key + 共享函数

- [x] 1.1 每个 registry entry 新增 `key` 字段，值与对象自身 key 相同
- [x] 1.2 新增 `resolveToLangCode(code)` 函数，返回 `{ key, entry }` 或 `null`
- [x] 1.3 删除 `findRegistryEntry()` 和 `findRegistryKeyByEntry()` 函数
- [x] 1.4 `getLangName` / `getLanguageLevel` / `getDisplayLangName` / `resolveLanguage` 中所有 `findRegistryEntry` 调用改为 `resolveToLangCode`
- [x] 1.5 新增 `resolveTargetValue(storedValue)` — 解析 auto 或返回固定值
- [x] 1.6 新增 `buildTargetLangSelect($select, tFn)` — 共享的目标语言下拉渲染

## 2. youtube-subtitles.js — 替换 normalizeLanguageCode

- [x] 2.1 `findTrackByLang()` 中的 `normalizeLanguageCode(lang)` 替换为 `resolveToLangCode(lang)` → 取 `.key`；`resolveToLangCode` 返回 `null` 时 fallback 到 `primaryLangPart()`
- [x] 2.2 删除独立的 `normalizeLanguageCode()` 函数，替换为轻量 `primaryLangPart()`

## 3. youtube.js — 重写 isSameLanguage + 删 dead code

- [x] 3.1 `normalizeLanguage()` 函数删除
- [x] 3.2 `isSameLanguage()` 重写为使用 `resolveToLangCode()` 比较 canonical key
- [x] 3.3 删除 `startTranslation()` 中 never-true 的 `preferredSourceLang !== 'auto'` 分支和 `sourceLangFallback` 逻辑

## 4. translate-prompt.js — cleanCueText 改用 registry

- [x] 4.1 `cleanCueText()` 中 `code = (o.sourceLanguage || '').split(/[-_]/)[0].toLowerCase()` 改为先查 `resolveToLangCode(o.sourceLanguage)`，取 `.key` 或 fallback 到旧逻辑

## 5. popup.js — 源语言显示修复 + 共享函数

- [x] 5.1 `renderLanguageSelects()` 改为调用 `buildTargetLangSelect($targetLang, t)`
- [x] 5.2 `setResolvedLanguageValues()` 使用 `resolveTargetValue(state.targetLanguage)` 简化
- [x] 5.3 删除 `getEffectiveTargetLanguage()`，调用处改用 `resolveTargetValue(state.targetLanguage)`
- [x] 5.4 `renderItems()` 中 `detectedSource` 循环改为只取 `AVAILABLE / PREPARING / TRANSLATING` 状态的任务；无匹配时回退到 "自动检测" label
- [x] 5.5 `renderEmpty()` 将源语言重置为 i18n `sourceLang.auto` label，而非 `'—'`

## 6. options.js — 共享函数 + 简化

- [x] 6.1 `renderLanguageSelects()` 改为调用 `buildTargetLangSelect($targetLanguage, t)`
- [x] 6.2 `setResolvedLanguageValues()` 使用 `resolveTargetValue()` 简化
- [x] 6.3 删除 `getEffectiveTargetLanguage()`，调用处改用 `resolveTargetValue(state.targetLanguage)`

## 7. 验证

- [ ] 7.1 打开印尼语视频 → 翻译完成 → 关闭视频标签 → 打开 popup 在普通页面 → 源语言显示 "自动检测"
- [ ] 7.2 打开韩语视频 → 源语言显示 "한국어" → 翻译完成 → 状态行显示 "한국어 → 简体中文"
- [ ] 7.3 popup 与 options 页面目标语言下拉行为一致
- [ ] 7.4 多个 YouTube tab 打开不同语言视频 → popup 源语言显示活跃 tab 对应的语言
