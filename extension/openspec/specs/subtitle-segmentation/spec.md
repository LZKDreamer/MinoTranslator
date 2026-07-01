# subtitle-segmentation Specification

## Purpose

定义 `segmentSentences` 流水线中将 ASR 词级 transcript 切分、合并、截断、丢弃为最终送 AI 翻译的句子（翻译单元）的规则，并保证每个翻译单元以句末标点结尾、长度与时长可控、输入输出数组长度一致以避免翻译错位。

_TBD: 补充更完整的流水线概述（断句、合并、长句切分、截断、丢弃各阶段的顺序与边界）。_

## Requirements

### Requirement: 翻译单元完整性安全网

系统 SHALL 在 `segmentSentences` 的所有现有断句、合并、切分、截断、丢弃后处理完成之后、返回最终 sentences 数组之前，执行一次"无标点前向合并"安全网扫描，确保送 AI 翻译的每条句子以句末标点（`.?!。？！۔؟।॥።፧`）结尾（极端连续无标点 case 除外）。

安全网扫描规则：
- 遍历最终 sentences 数组，对每个不以 `SENTENCE_END_RE` 结尾的句子 `S[i]`：
  - 若 `S[i+1]` 存在，且 `gap = S[i+1].start - S[i].end < 1.0s`，且合并后 duration `= S[i+1].end - S[i].start < 15.0s`，且 `gap <= 2.0s`（即非大间隔硬切）：
    - 把 `S[i]` 前向合并到 `S[i+1]`：`S[i+1].text = S[i].text + ' ' + S[i+1].text`，`S[i+1].start = S[i].start`，移除 `S[i]`。
    - 合并后重新检查新的 `S[i]` 位置（合并结果可能仍无标点，需继续往前看）。
  - 否则保留 `S[i]` 不变（gap>1s 或合并超 15s 或大间隔硬切，不强制合并）。

系统 SHALL 在安全网扫描结束后，扫描最终数组，对仍不以 `SENTENCE_END_RE` 结尾的句子输出 WARN 级 `debugLog`（`'segmentSentences: incomplete sentence remains at #N: "..."'`），但不中断处理。

安全网 MUST NOT 改变以 `SENTENCE_END_RE` 结尾的完整句。
安全网 MUST NOT 合并跨大间隔（gap > 2s）的句子（保留语义停顿边界）。
安全网 MUST NOT 合并后 duration ≥ 15s 的句子对（避免产出超长翻译单元）。

`SENTENCE_END_RE` SHALL 被定义为包含以下字符的集中式正则：拉丁 `.?!`、中日韩 `。？！`、阿拉伯语 `۔` (U+06D4) `؟` (U+061F)、天城文 `।` (U+0964) `॥` (U+0965)、埃塞俄比亚文 `።` (U+1362) `፧` (U+1367)。

#### Scenario: 半句话被安全网合并

- **WHEN** 上游产出句子 `S[i]` = `"그러니까 관리 측면에서 토닝이라든지 보톡스라든지 몸에 해를 끼치는게 아니기 때문에 정기적으로 다니면은 다른 분들보다"`（无句末标点，329.720→337.881，8.2s）紧接 `S[i+1]` = `"확실히 덜 늙으실 수 있습니다. 다음 질문입니다."`（338.400→343.240，gap≈0.5s）
- **THEN** 安全网检测到 `S[i]` 不以 `SENTENCE_END_RE` 结尾、gap≈0.5s < 1s、合并 duration≈13.5s < 15s、gap < 2s
- **AND** 把 `S[i]` 前向合并到 `S[i+1]`，产出单一句子 `"그러니까...다른 분들보다 확실히 덜 늙으실 수 있습니다. 다음 질문입니다."`
- **AND** 该句以 `.` 结尾，作为完整翻译单元送 AI
- **AND** AI 翻译输出 1 条译文，输入数组长度 = 输出数组长度，不错位。

#### Scenario: gap 超过 1s 不合并

- **WHEN** `S[i]` 不以 `SENTENCE_END_RE` 结尾，`S[i+1]` 存在，但 gap = 1.5s（语义停顿）
- **THEN** 安全网不合并，`S[i]` 保留为独立句子
- **AND** `S[i]` 触发 WARN 日志
- **AND** 不产出超长合并句。

#### Scenario: 合并后超 15s 不合并

- **WHEN** `S[i]` 无标点结尾（10s），`S[i+1]` 有标点结尾（8s），gap=0.3s，合并后 18.3s ≥ 15s
- **THEN** 安全网不合并，`S[i]` 保留为独立句子
- **AND** `S[i]` 触发 WARN 日志
- **AND** 接受半句话送 AI（半句话翻译比错位好）。

#### Scenario: 大间隔硬切不合并

- **WHEN** `S[i]` 无标点结尾，`S[i+1]` 存在，gap = 3s（> 2s 大间隔，语义已断）
- **THEN** 安全网不合并，`S[i]` 保留为独立句子
- **AND** `S[i]` 触发 WARN 日志。

#### Scenario: 连续多个半句话链式合并

- **WHEN** `S[i]` 无标点（3s），`S[i+1]` 无标点（4s），`S[i+2]` 有标点（5s），三者 gap 均 < 1s，链式合并后 12s < 15s
- **THEN** 安全网先把 `S[i]` 合并到 `S[i+1]`，新 `S[i+1]` 仍无标点，再把新 `S[i+1]` 合并到 `S[i+2]`
- **AND** 最终产出一个以标点结尾的 12s 句子
- **AND** 不产出半句话。

#### Scenario: 完整句不被安全网触碰

- **WHEN** `S[i]` 以 `SENTENCE_END_RE` 结尾
- **THEN** 安全网跳过 `S[i]`，不改变其内容和时间戳
- **AND** 即使 `S[i+1]` 存在且 gap<1s，也不合并（完整句已是合法翻译单元）。

#### Scenario: 阿拉伯语完整句不被安全网触碰

- **WHEN** `S[i]` 以 `۔` (U+06D4) 或 `؟` (U+061F) 结尾
- **THEN** 安全网跳过 `S[i]`，不改变其内容
- **AND** 视其为完整句。

#### Scenario: 天城文完整句不被安全网触碰

- **WHEN** `S[i]` 以 `।` (U+0964) 或 `॥` (U+0965) 结尾
- **THEN** 安全网跳过 `S[i]`，不改变其内容
- **AND** 视其为完整句。

#### Scenario: 词级 json3 数据安全网不误触发

- **WHEN** 输入是词级 json3，每词独立 event，词间 gap 通常 > 1s 或每词已有标点
- **THEN** 安全网扫描时大多数句子以 `SENTENCE_END_RE` 结尾或 gap > 1s，触发率极低
- **AND** 即使偶发触发，合并结果仍是合法句子
- **AND** 53 个现有测试无回归。

#### Scenario: 时间重叠的两段被安全网合并

- **WHEN** `S[40]` = `"...제가 싫은 소리 해야"`（无句末标点，171.175→176.441，5.3s）紧接 `S[41]` = `"...힘들긴 하죠."`（有句末标点，176.400→185.440，gap = 176.400 - 176.441 = -0.041s）
- **THEN** 安全网检测到 gap = -0.041s ≤ 0，`S[40]` 无标点结尾
- **AND** 把 `S[40]` 前向合并到 `S[41]`
- **AND** 最终产出一句以 `.` 结尾的完整句
- **AND** AI 收到 1 句而非 2 句，翻译不合并输出，不错位也不留空。

### Requirement: 长句切分标点优先

系统 SHALL 在 `segmentSentences` 的长句切分步骤中，当句子 `duration > MAX_SENTENCE_DURATION_SEC`（当前 12s）且 `length >= MIN_WORDS_TO_SPLIT`（当前 6）时，按以下优先级选择切分点：
1. 优先选择 `sent[q].text` 以 `SENTENCE_END_RE` 结尾的 q（q < len-1），在 q 之后切分。若有多个标点切分点，选**最接近句子中点**的那个（平衡左右半长度）。
2. 若整段无句末标点切分点，退化到现有"最大词间间隔"切分逻辑。

系统 MUST 保持切分后左右半的时间戳计算不变（左半用首词 start 到 q 词 end，右半用 q+1 词 start 到末词 end）。

#### Scenario: 长句在标点处切分

- **WHEN** 句子 `"...다른 분들보다 확실히 덜 늙으실 수 있습니다. 다음 질문입니다."`（14.8s，含 `있습니다.` 在中后部）触发长句切分
- **THEN** 切分点优先选在 `있습니다.` 之后
- **AND** 左半以 `.` 结尾（完整句），右半以 `.` 结尾（完整句）
- **AND** 不在最大间隔处切，不产出半句话
- **AND** 安全网不触发。

#### Scenario: 长句在阿拉伯语标点处切分

- **WHEN** 句子 15s，含 `۔` (U+06D4) 在词 7 处（共 12 词，中点在词 6）
- **THEN** 切分点选在词 7 之后
- **AND** 左半以 `۔` 结尾

#### Scenario: 长句无标点退化到最大间隔

- **WHEN** 句子 15s，6 词，整段无 `SENTENCE_END_RE` 匹配（罕见，ASR 漏标点）
- **THEN** 找不到标点切分点，退化到现有"最大词间间隔"切分
- **AND** 切出的左右半可能无标点
- **AND** 安全网兜底尝试合并（若 gap<1s 且合并<15s 则接回，否则 WARN 接受半句话）。

#### Scenario: 多个标点选接近中点

- **WHEN** 句子 13s，10 词，`sent[2]` 和 `sent[6]` 都以 `.` 结尾，中点在词 5 附近
- **THEN** 选 `sent[6]`（更接近中点）之后切
- **AND** 左半 7 词、右半 3 词，长度相对平衡。

### Requirement: 稀疏垃圾检测支持无标点语言的阈值扩展

当段落文本字符属于无标准句末标点的文字系统（如泰文、缅甸文、高棉文），系统 SHALL 使用该文字系统的单词数乘数来调整 MAX_SPARSE_WORDS 阈值，而非使用全局统一的 3 词限制。乘数表 SHALL 按文字系统定义：

| 文字系统 | 乘数 | 原因 |
|---------|:---:|------|
| 拉丁/中日韩/阿拉伯/西里尔 | 1.0× | 默认行为 |
| 泰文/寮文 | 2.0× | 无标准句末标点，且词分界不明确 |
| 天城文/孟加拉文/缅甸文/高棉文 | 1.5× | 弱标点支持的 ASR 输出 |

段落 MUST 至少含 2 个 "词"（按空格或 Unicode 词界分割）才会触发稀疏垃圾检查；单一词段落永远不丢弃。

#### Scenario: 泰文 5 词段落不被丢弃

- **WHEN** 泰文段落含 5 词（按空格分割）、无句末标点、且前后间隔均 > 5000ms
- **THEN** `MAX_SPARSE_WORDS * 2.0 = 6`，5 ≤ 6，因此段落不会被标记为稀疏垃圾
- **AND** 段落保留并继续到翻译环节

#### Scenario: 孤立拉丁文本 2 词无标点仍然丢弃

- **WHEN** 拉丁文本 2 词、无句末标点、前后间隔均 > 5000ms
- **THEN** `MAX_SPARSE_WORDS * 1.0 = 3`，2 ≤ 3，且段落被标记为稀疏垃圾
- **AND** 该段落被丢弃（现有行为不变）

#### Scenario: 单字段落永不丢弃

- **WHEN** 段落仅含 1 个"词"（按空格或 Unicode 词界分割）、无句末标点
- **THEN** 段落长度 = 1 < 2（不满足最小段落长度要求）
- **AND** 段落被跳过，即便间隔条件满足也不丢弃

### Requirement: Title card detection exempts Latin-script multi-line natural speech

When `isTitleCardText` evaluates condition 2 (text contains `\n`, does not end with sentence-ending punctuation, and has no speaker change markers), the system SHALL additionally verify that the text does NOT contain any lowercase Latin letters (`[a-z]`). Text containing lowercase letters SHALL NOT be classified as a title card under this condition.

This exemption applies because natural-language subtitles from Latin-script languages (Indonesian, English, French, Spanish, etc.) commonly use `\n` for multi-line display layout. Such text is almost never a title card, which typically uses all-caps formatting.

The system SHALL continue to detect real title cards via condition 3 (all-caps, ≤6 words, no sentence-ending punctuation) which remains unchanged.

This exemption SHALL NOT affect non-Latin writing systems (CJK, Hangul, Arabic, Thai, Devanagari, etc.) since those scripts have no lowercase/uppercase distinction and `[a-z]` will not match.

Additionally, text that contains non-Latin script characters (CJK, Hangul, Thai, Arabic, Cyrillic, etc.) SHALL be exempted from condition 2's sentence-ending-punctuation requirement when `\n` is present, because these scripts either lack standard sentence-ending punctuation or their sentence-ending markers are inconsistently produced by ASR.

Speaker marker prefixes containing `>>` SHALL also exempt text from condition 2 classification, as these markers indicate multi-speaker dialogue transcription.

#### Scenario: Indonesian multi-line subtitle is NOT classified as title card

- **WHEN** text is `"Sudah lebih dari belasan negara ku\nlewati dalam perjalanan ini. Ribuan"`
- **THEN** condition 2 initially matches (contains `\n`, no sentence-ending punctuation at end, no speaker markers)
- **BUT** text contains lowercase letters (`"udah"`, `"ebih"`, `"ari"`, etc.) → `/[a-z]/.test(trimmed)` returns `true`
- **AND** `isTitleCardText` returns `false` (not a title card)
- **AND** the word is preserved in `preSegmentPhraseEvents` output

#### Scenario: Continuation fragment with line break is NOT classified as title card

- **WHEN** text is `"kilometer jalan telah tertinggal di\nbelakang. Tapi ada sesuatu yang beda"` (next subtitle event continuing from previous)
- **THEN** condition 2 initially matches (has `\n`, ends with "beda" no punctuation)
- **BUT** text contains lowercase letters → exemption applies
- **AND** `isTitleCardText` returns `false`
- **AND** the word is preserved

#### Scenario: All-caps title card IS still classified as title card

- **WHEN** text is `"SEASON 1\nEPISODE 5"`
- **THEN** condition 2 matches (has `\n`, no sentence-ending punctuation, no speaker markers)
- **AND** text has NO lowercase letters → condition 2 MAY return `true`
- **OR** condition 3 catches it (all-caps, ≤6 words, no sentence-ending punctuation) → `isTitleCardText` returns `true`
- **AND** the title card is dropped from the word stream

#### Scenario: English multi-line casual subtitle is NOT classified as title card

- **WHEN** text is `"But this is India.\nThere is no wrong way"`
- **THEN** condition 2 initially matches (has `\n`, arguably no sentence-ending punctuation at end... but wait, ends with "way" not punctuation)
- **BUT** text contains lowercase letters → exemption applies
- **AND** `isTitleCardText` returns `false`

#### Scenario: Single-line text without line breaks is unaffected

- **WHEN** text is `"Selamat pagi dari New Delhi, Guys."` (no `\n`, ends with `.`)
- **THEN** condition 2 does not match (no `\n`) → falls through
- **AND** existing behavior preserved — the function proceeds to check other conditions
- **AND** `isTitleCardText` returns `false` (not a title card)

#### Scenario: Korean text with line break is NOT affected by lowercase guard

- **WHEN** text is `"부산행\n기차 안에서"`
- **THEN** condition 2 matches (has `\n`, no sentence-ending punctuation, no speaker markers)
- **AND** `/[a-z]/.test(trimmed)` returns `false` (Hangul has no lowercase)
- **AND** condition 2 still returns `true`
- **AND** condition 3 is skipped (non-Latin script) → could still return `true`
- **BUT** word count may exceed 6 for longer text → `false`
- **AND** overall behavior for Korean content remains unchanged from before

#### Scenario: Bilingual text with mixed Latin and non-Latin is exempted

- **WHEN** text is `"Halo, Guys.\nNamaste."` (contains `\n`, ends with `.` though)
- **THEN** ends with `.` → condition 2 does not trigger (sentence-ending punctuation present)
- **AND** `isTitleCardText` returns `false`
