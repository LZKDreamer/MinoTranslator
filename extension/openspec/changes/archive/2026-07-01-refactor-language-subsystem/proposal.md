## Why

上次变更引入了 `LANGUAGE_REGISTRY` 数据驱动架构，但遗留了多个质量问题：源语言显示从历史已完成任务中取数据而非当前视频、三个独立的 normalize 函数做同一件事、popup 与 options 重复代码、反向查找用 O(n) 扫描——这些问题积累后用户看到错误来源、维护成本上升，需要系统性清理。

## What Changes

- **源语言显示修复**: 没有视频时显示 i18n "自动检测" 而非 `'—'`；有视频时仅从 AVAILABLE/PREPARING/TRANSLATING 状态的任务中提取源语言，忽略 COMPLETED 历史任务
- **归一化函数统一**: 删除 `youtube-subtitles.js` 的 `normalizeLanguageCode()` 和 `youtube.js` 的 `normalizeLanguage()`；整合为 `constants.js` 的 `resolveToLangCode(code)` ——一次查表返回 canonical key + registry entry
- **Registry 条目加 `key` 字段**: 删除 O(n) 的 `findRegistryKeyByEntry()`，直接取 `entry.key`
- **消除 popup/options 重复**: 提取 `buildTargetLangSelect($select, tFn)` 和 `resolveTargetValue(storedValue)` 到 `constants.js`，两处 UI 各缩减 ~20 行
- **清理 dead code**: 移除 `youtube.js` 的 `sourceLangFallback` 分支和不再触发的 `normalizeLanguage` 比较
- **`cleanCueText` 改用 registry**: `translate-prompt.js:210` 的 `split(/[-_]/)[0]` 替换为 `resolveToLangCode` 获取 canonical code

## Capabilities

### New Capabilities
- `lang-code-normalization`: 统一的语言代码归一化函数 `resolveToLangCode(code)`，返回 `{ key, entry }` 或 `null`

### Modified Capabilities
- `language-registry`: 每个条目新增 `key` 字段；`findRegistryKeyByEntry()` 移除；`findRegistryEntry()` 改为返回 `{ key, entry }`
- `target-language-auto`: `renderLanguageSelects` 和 `setResolvedLanguageValues` 逻辑提取为共享函数；源语言显示规则改为仅从活跃任务提取

## Impact

| 文件 | 影响 |
|------|------|
| `shared/constants.js` | 新增 `resolveToLangCode()`、`buildTargetLangSelect()`、`resolveTargetValue()`；registry 条目加 `key`；删除 `findRegistryKeyByEntry()` |
| `shared/translate-prompt.js` | `getLangName`/`getLanguageLevel` 改用 `resolveToLangCode()`；`cleanCueText` 改用 registry |
| `content/youtube.js` | 删除 `normalizeLanguage()`、`isSameLanguage()` 改用 registry 比较；删 dead code |
| `content/youtube-subtitles.js` | `normalizeLanguageCode()` 替换为 `resolveToLangCode()` |
| `popup/popup.js` | 调用共享的 `buildTargetLangSelect()`/`resolveTargetValue()`；源语言显示修复 |
| `popup/popup.html` | 无需改动 |
| `options/options.js` | 调用共享函数，移除重复实现 |
