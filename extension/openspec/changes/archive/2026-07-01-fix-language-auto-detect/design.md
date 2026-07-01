## Context

当前语言系统有三个分散的硬编码数据源，互不同步且都有缺口：

```
getLangName()  ── if-ladder ──  18种语言名 (缺 id, ms, hi, ru...)
getLanguageLevel() ── array ──  40+种语言等级 (比 getLangName 多 20+种)
SOURCE_LANGUAGES ──── array ──  11项 (含 auto)
TARGET_LANGUAGES ──── array ──  10项 (缺 auto)
LANGUAGE_CODE_MAP ─── object ── 11种浏览器语言映射
```

翻译印尼语视频时，`audioTracks` 正确检测出 `id`，但 `getLangName('id')` 返回原始代码 `"id"` 而非 `"Indonesian"`。AI 提示词变成了 "Translate from id to Simplified Chinese"，AI 不理解 `id` 指印尼语，输出与原文相同。

## Goals / Non-Goals

**Goals:**
- 所有语言数据集中到一个 registry，函数通过查表获取，零 if-ladder
- 源语言始终自动检测，UI 显示为只读的语言名称
- 目标语言支持 `auto`，选中时透明展示解析结果
- 视频列表状态行展示人类可读的语言名（含 i18n 兜底）
- `resolveLanguage()` 优先匹配 YouTube 页面 UI 语言、其次是浏览器语言

**Non-Goals:**
- 不增加/删除已支持的语言类别（AI 模型的能力范围不受此影响）
- 不改变翻译的 API 调用逻辑
- 不重构 i18n 体系（已有的 `sourceLang.*` 标签保持兼容）

## Decisions

### Decision 1: LANGUAGE_REGISTRY 数据结构

每个条目以语言代码为 key，包含所有维度：

```javascript
var LANGUAGE_REGISTRY = {
  'auto': {
    name: 'Auto-detect',      // 英文名（必填，兜底显示）
    level: null,              // high|medium|low|null
    source: true, target: true, isAuto: true,
    i18nKey: 'sourceLang.auto',
    aliases: []               // 语言代码别名（用于 normalize 匹配）
  },
  'id': {
    name: 'Indonesian',
    level: 'medium',
    source: true, target: false,
    aliases: ['id', 'id-ID', 'in']
  },
  'en': {
    name: 'English',
    level: 'low',
    source: true, target: true,
    i18nKey: 'sourceLang.en',
    aliases: ['en', 'en-US', 'en-GB', 'english']
  },
};
```

**替代方案的排除:**
- 保持 if-ladder 但扩充满 40+ 种: 代码冗长，下次加新语言还是要动代码
- Map 结构: Chrome extension MV3 不支持 ES6 Map 在 service worker 中? 实际支持，但 object 更简单兼容。选 object。

**选择理由:** 单一数据源，新增语言只需加一行 entry，所有函数自动生效。

### Decision 2: 源语言改为只读显示

用户原话: "源语言不要下拉框了，识别到视频就更新为对应的语言名称"

```
Popup:  源语言: 印尼语              ← <span> 只读，随检测结果更新
Options: 源语言: 自动识别（根据视频音轨自动检测）← 只读说明文字
```

**影响:** `state.sourceLanguage` 存储值不再在 UI 使用。视频页始终走 auto 路径 (`selectBestTrack` 的 `audioTracks` 匹配)。手选的 `sourceLanguage` 存储值可被忽略或清理。

**选择理由:** YouTube 的 `audioTracks` 已能准确识别音轨语言，手动选源语言的价值很低。免去用户选择负担。

### Decision 3: 目标语言 auto 展示策略

```
下拉闭合态: [English ▼]              ← 直接显示解析值
下拉展开态:
  ┌─────────────────────┐
  │ 自动跟随 · English   │          ← auto 项显示当前解析值
  │ ─────────────────   │
  │ 简体中文            │
  │ English             │
  │ 日本語              │
  │ ...                 │
  └─────────────────────┘
```

- 存储值: `'auto'`（解析值实时计算）
- 显示值: 解析结果（如 `'English'`、`'简体中文'`）
- `getEffectiveTargetLanguage()`: 当值为 `'auto'` 时调用 `resolveLanguage()`（优先级见 Decision 4）

**选择理由:** 方案 B（下方 hint）无额外物理空间，且"解析值直接显示在闭合态"更自然—用户永远是看到有效语言名。

### Decision 4: resolveLanguage 的优先级

```
1. 浏览器 Navigator.language (e.g. 'id-ID', 'zh-CN')
2. YouTube 页面 <html lang> (e.g. 'id-ID' 如果用户用印尼语 YouTube)
3. fallback 'en'
```

每种候选通过 registry 的 `aliases` 匹配到 canonical code。只返回 `target: true` 的条目（确保在目标下拉框中）。

**选择理由:** YouTube 用户经常在 `youtube.com/?hl=id` 下使用，浏览器语言可能是 `zh-CN`。检测 `<html lang>` 更能反映用户 YouTube 使用语言环境。

### Decision 5: 视频状态行语言展示

```javascript
function getDisplayLangName(code) {
    var entry = LANGUAGE_REGISTRY[code];
    if (!entry) return code || '?';
    if (entry.i18nKey) return t(entry.i18nKey);   // i18n 标签
    return entry.name;                             // 英文名兜底
}

// 使用:
getStatusLabel(item) {
    var src = getDisplayLangName(item.sourceLanguage); // '한국어' / 'Indonesian'
    var tgt = getDisplayLangName(item.targetLanguage);  // '简体中文' / 'English'
    if (item.status === STATUS.AVAILABLE) return src + ' → ' + tgt + ' · 可翻译';
    if (item.status === STATUS.COMPLETED) return src + ' → ' + tgt;
}
```

### Decision 6: 代码生成列表

`SOURCE_LANGUAGES` 和 `TARGET_LANGUAGES` 从 registry 动态生成，不再手动维护静态数组。

但源语言不再需要下拉列表，因此只需生成 `TARGET_LANGUAGES`：

```javascript
function buildTargetLanguages() {
    var list = [{
        value: 'auto',
        i18nKey: LANGUAGE_REGISTRY['auto'].i18nKey,
        name: LANGUAGE_REGISTRY['auto'].name
    }];
    for (var code in LANGUAGE_REGISTRY) {
        var entry = LANGUAGE_REGISTRY[code];
        if (!entry.isAuto && entry.target) {
            list.push({ value: code, i18nKey: entry.i18nKey, name: entry.name });
        }
    }
    return list;
}
```

## Risks / Trade-offs

- **[源语言不再可选]** → 极少数视频 `audioTracks` 为空导致检测失败 → 降级到 ASR 或 tracks[0] 的逻辑不变（在 `selectBestTrack` 中已有三级 fallback）
- **[Registry 条目数]** → 目前 registry 约 40+ 条目，作为顶层 `var` 在所有上下文中加载 → 体积可忽略（<10KB）
- **[用户已有 sourceLanguage 存储值]** → 忽略，从 registry 取 display name 始终正确
