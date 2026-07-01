## Context

当前 `buildFloatingPrompt` 生成的 prompt 仅指明目标语言，不指定源语言方向，且缺少强输出约束。对比 `buildBatchTranslatePrompt` 的 prompt，后者包含 "from {source} to {target}" 方向声明和 CRITICAL 级禁止混用语言的指令。Agnes-2.0-flash 等小模型在没有明确方向锚点和输出约束时，可能输出英文而非用户设定的目标语言（如简体中文）。

YouTube 字幕翻译正常，说明目标语言配置正确，问题限定在划词翻译的 prompt 构建路径。

## Goals / Non-Goals

**Goals:**
- 划词翻译时，AI 输出的语言与用户设定的目标语言一致
- 源语言通过文本 Unicode 字符集零成本检测，不增加 API 调用
- `buildFloatingPrompt` 的输出约束级别对齐 `buildBatchTranslatePrompt`

**Non-Goals:**
- 不改变 YouTube 字幕翻译的 prompt 构建
- 不增加新的 API 依赖或外部服务
- 不修改 `chrome.storage` 的数据结构
- 不引入机器学习/NLP 库进行源语言检测

## Decisions

### Decision 1: Unicode 字符集范围检测

采用 Unicode 码点范围分析，检测优先级从特殊到通用（解决 CJK 冲突）：

| 优先级 | 判定字符 | Unicode 范围 | 结果 |
|--------|----------|-------------|------|
| 1 | 日文假名 | `\u3040-\u309F` (平假)、`\u30A0-\u30FF` (片假) | `ja` |
| 2 | 韩文谚文 | `\uAC00-\uD7AF` | `ko` |
| 3 | 中文汉字 | `\u4E00-\u9FFF\u3400-\u4DBF` | `zh-CN` |
| 4 | 阿拉伯文 | `\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF` | `ar` |
| 5 | 泰文 | `\u0E00-\u0E7F` | `th` |
| 6 | 西里尔字母 | `\u0400-\u04FF` | `ru` |
| 7 | 拉丁字母主导 | `[a-zA-Z]` 占比 ≥ 60% 且无其它匹配 | `en` |
| — | 无法识别 | — | `null` |

**Why this priority?** 日语文本必然包含假名，优先用假名判定避免与中文汉字冲突；现代韩语必然包含谚文；纯汉字无假名无谚文只能是中文。

**Alternatives considered:**
- 调用 AI 模型检测源语言 → 增加延迟和成本，且无法在 prompt 构建前获取源语言
- 使用 `Intl.Segmenter` 或 `chrome.i18n.detectLanguage` → 前者无语言识别能力，后者异步且不可靠
- 忽略源语言检测，只加 CRITICAL 指令 → 不解决"方向锚点"缺失问题

### Decision 2: Prompt 结构增强

修改 `buildFloatingPrompt` 签名从 `{ text, targetLanguage }` 扩展为 `{ text, targetLanguage, sourceLanguage }`。

Prompt 结构从：
```
Translate to Simplified Chinese. Output ONLY the translation.
```

增强为：
```
CRITICAL — READ THIS FIRST:
- Your ONLY task is to translate. Output must be in Simplified Chinese ONLY.
- NEVER output any text in the source language. NEVER mix languages.
- If you output even one non-Simplified Chinese word, the entire response is a FAILURE.

You are a translator.
Translate the following text from Korean to natural, accurate Simplified Chinese.
Preserve the original meaning, tone, and intent.
Use natural Simplified Chinese expressions — avoid stiff, literal, or machine-like phrasing.
Output ONLY the translation. No explanations, no greetings, no notes.
```

当 `sourceLanguage` 为 `null`（检测失败）时，省略 "from X" 部分，保留 CRITICAL 约束。

**Why this format?** 直接对齐 `buildBatchTranslatePrompt` 的已验证有效的 prompt 结构，变量化目标语言名以避免硬编码。

### Decision 3: 检测与 prompt 构建的分工

`detectSourceLanguage()` 放在 `constants.js`，与 `LANGUAGE_REGISTRY` 同文件——它是语言工具函数，与注册表的职责一致。

`Translator.translate()` 在构建 prompt 前调用检测函数，将结果传入 `buildFloatingPrompt`。`TRANSLATE_TEXT` handler 不需要修改——它只负责路由和跳过检查。

## Risks / Trade-offs

- **[Risk] 混合语言文本误判**: 韩语文本中嵌入英文单词时，可能因拉丁字母占比高被误判为 `en` → **Mitigation**: 检测优先级中韩文谚文优先于拉丁字母回退，只要文本含一个谚文字符就判定为 `ko`
- **[Risk] 中文与日文歧义**: 纯汉字文本（无假名）被判定为 `zh-CN`，但可能是日语中的汉字词 → **Mitigation**: 日语现代文本几乎必然包含假名，纯汉字场景概率极低；且可接受——纯汉字翻译到中文通常是正确的
- **[Risk] Prompt 长度增加**: CRITICAL 指令约增加 200 字符 → **Mitigation**: 相比模型上下文窗口（数千 token），增加量可忽略
- **[Trade-off] 检测准确度 vs 简单性**: Unicode 检测 100% 准确率对单语文本，对混合语文本精度约 95%，但足以覆盖绝大多数用户场景。不使用重量级方案是合理取舍
