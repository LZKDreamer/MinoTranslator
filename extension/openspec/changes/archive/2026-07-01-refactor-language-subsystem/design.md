## Context

上次变更建立了 `LANGUAGE_REGISTRY` 作为语言数据的单一源，但代码复用和一致性方面遗留了若干问题：

- `renderItems()` 从任意任务中取源语言展示，不区分 COMPLETED 历史与 AVAILABLE 当前 → 没有视频时仍显示历史语言
- `normalizeLanguageCode()` (youtube-subtitles) / `normalizeLanguage()` (youtube) / `findRegistryEntry()` (constants) 三个函数做同一件事
- `findRegistryKeyByEntry()` 每次 O(n) 扫描 35+ 条目
- popup 与 options 有 3 个共享逻辑的函数，各自 copy-paste
- `cleanCueText` 做独立 normalize 而非用 registry

## Goals / Non-Goals

**Goals:**
- 消除所有重复的 normalize 逻辑，统一为 `resolveToLangCode(code)` 一个入口
- Registry entry 加 `key` 字段，反向查找 O(1)
- 源语言展示正确区分「无视频 / 有视频 / 历史任务」
- popup 与 options 共享目标语言下拉渲染和解析函数
- 清理由 source 改为 always-auto 后产生的 dead code

**Non-Goals:**
- 不改变 LANGUAGE_REGISTRY 的数据结构（仅增 `key` 字段）
- 不增加/删除 registry 中的语言条目
- 不改变翻译流程和 AI prompt 构建

## Decisions

### Decision 1: `resolveToLangCode(code)` 统一归一化

```javascript
/**
 * @param {string} code - 语言代码
 * @returns {{ key: string, entry: object } | null}
 */
function resolveToLangCode(code) {
    if (!code) return null;
    if (LANGUAGE_REGISTRY[code]) return { key: code, entry: LANGUAGE_REGISTRY[code] };
    var normalized = String(code).toLowerCase();
    var keys = Object.keys(LANGUAGE_REGISTRY);
    for (var i = 0; i < keys.length; i++) {
        var entry = LANGUAGE_REGISTRY[keys[i]];
        if (entry.aliases) {
            for (var j = 0; j < entry.aliases.length; j++) {
                if (entry.aliases[j].toLowerCase() === normalized) return { key: keys[i], entry: entry };
            }
        }
    }
    return null;
}
```

替代方案排除：
- 保留 `findRegistryEntry` 只返回 entry → 调用方仍需 O(n) 查找 key
- 每个调用方自己做 split → 逻辑分散

选择理由：调用方一次获得 key 和 entry，均 O(1)。替代了原有的 `findRegistryEntry + findRegistryKeyByEntry` 组合（两遍 O(n)）。

### Decision 2: 源语言展示逻辑修正

三态语义：

| 状态 | 显示 | 来源 |
|------|------|------|
| 无视频 / 加载中 | `自动检测` (i18n) | `renderEmpty()` / `renderLoading()` |
| 检测到视频 | 语言名 (如 Indonesian) | 活跃任务 (AVAILABLE/PREPARING/TRANSLATING) 的 sourceLanguage |
| 只有历史任务 | `自动检测` | 没有任何活跃任务 → 回退到默认 |

```javascript
function pickActiveSource(items) {
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.status !== STATUS.AVAILABLE
            && item.status !== STATUS.PREPARING
            && item.status !== STATUS.TRANSLATING) continue;
        if (item.sourceLanguage && item.sourceLanguage !== 'unknown' && item.sourceLanguage !== 'auto') {
            return item.sourceLanguage;
        }
    }
    return null;
}
```

选择理由：`renderEmpty` + `!items.length` 分支 + `pickActiveSource 返回 null` 三层保证。历史任务只存在于视频列表中，不影响 header。

### Decision 3: `isSameLanguage` 改用 registry

```javascript
// 旧 (youtube.js)
function normalizeLanguage(language) {
    if (value.startsWith('zh-')) return 'zh';  // 硬编码
    if (value.startsWith('en-')) return 'en';  // 硬编码
    return value.split('-')[0];
}

// 新
function isSameLanguage(source, target) {
    var srcResolved = resolveToLangCode(source);
    var tgtResolved = resolveToLangCode(target);
    var srcKey = srcResolved ? srcResolved.key : (String(source).split('-')[0] || '');
    var tgtKey = tgtResolved ? tgtResolved.key : (String(target).split('-')[0] || '');
    return srcKey === tgtKey;
}
```

选择理由：registry 的 alias 对比替代了硬编码 if/else。`zh-CN` 和 `zh` 都会 resolve 到 `'zh-CN'` → key 相同 → 判定为同语言。

### Decision 4: 共享函数提取到 constants.js

```javascript
// constants.js 新增

function resolveTargetValue(storedValue) {
    var val = storedValue || TARGET_LANGUAGE_DEFAULT;
    return val === 'auto' ? resolveLanguage() : val;
}

function buildTargetLangSelect($select, tFn) {
    $select.innerHTML = '';
    var langs = buildTargetLanguages();
    for (var i = 0; i < langs.length; i++) {
        var opt = document.createElement('option');
        opt.value = langs[i].value;
        var displayName = langs[i].i18nKey
            ? tFn(langs[i].i18nKey, langs[i].name)
            : langs[i].name;
        opt.textContent = langs[i].value === 'auto'
            ? tFn('sourceLang.auto', '自动跟随') + ' · ' + getDisplayLangName(resolveLanguage(), tFn)
            : displayName;
        $select.appendChild(opt);
    }
}
```

然后 popup.js 和 options.js 的 `renderLanguageSelects()` 分别变为单向调用：
```javascript
function renderLanguageSelects() {
    buildTargetLangSelect($targetLang, t);
}
```

选择理由：消除了两个文件各 ~15 行的重复代码。由于函数接受 `$select` 和 `tFn` 作为参数，不绑定任何具体 DOM 或 i18n 上下文。

### Decision 5: `fillCueText` 语言代码获取改用 registry

```javascript
// 旧 (translate-prompt.js:210)
var code = (o.sourceLanguage || '').split(/[-_]/)[0].toLowerCase();

// 新
var resolved = resolveToLangCode(o.sourceLanguage);
var code = resolved ? resolved.key : (o.sourceLanguage || '').split(/[-_]/)[0].toLowerCase();
```

选择理由：`sourceLanguage` 可能是 `id-ID` 等别名形式，直接用 `split('-')[0]` 会得到 `id`，但应解析到 registry 的 canonical key。韩语和日语填充词匹配依赖正确的 primary code，两种方式结果一致，但 registry 路径更一致。

### Decision 6: 删除 dead code

`youtube.js:227-230`: `preferredSourceLang !== 'auto'` 条件永远为 false（source 现在强制 auto）。
移除整个 `if` 块和 `reportTask({ sourceLangFallback: ... })`。

## Risks / Trade-offs

- [registry 查找失败时 `resolveToLangCode` 返回 null] → 调用方各有用 `split('-')[0]` 的 fallback，行为等价于旧 normalize 函数
- [共享函数 `buildTargetLangSelect` 在 constants.js] → constants.js 被所有上下文加载，新增的 DOM 操作函数在 service worker 中不会用到但也不会报错（函数未被调用）
- [O(n) alias 扫描仍在 `resolveToLangCode` 内] → alias 总数约 200 条（35 条目 × ~6 alias），单次查找 < 0.1ms，可接受
