## ADDED Requirements

### Requirement: 短语级 event 预切分

系统 SHALL 在 `parseJson3ToWords` 之后、`segmentSentences` 之前对 word 数组执行预切分：当 word 文本含内部句末标点（`.?!。？！`，且不在字符串末尾）时，按该标点切成多个 word，使下游每个 word 代表一个真实句子单元而非整段短语。系统 MUST 保持词级 json3（word 已带 `tOffsetMs`）的原有行为不变。

#### Scenario: 短语内含句末标点被切分

 WHEN 输入 word 文本为 `"It's here. I think"`（来自单个短语级 event，tStart=453599, dDurationMs=2040）
 THEN 输出两个 word：`"It's here."`（start=453599）和 `"I think"`（start 推进到 `"It's here."` 占用时长之后）
 AND 两者作为独立单元进入 `segmentSentences`，不再因 `SENTENCE_END_RE` 锚 `$` 而漏切。

#### Scenario: 词级 json3 不受影响

 WHEN 输入来自词级 json3（segs 各自带 `tOffsetMs`，每 seg 一个词）
 THEN 预切分不改变 word 数组（每 word 已是单词，无内部标点需切）
 AND `segmentSentences` 行为与改动前完全一致。

### Requirement: 说话人切换标记解析

系统 SHALL 把 event 文本中的 `\n- `（及 `\n *-` 变体）识别为说话人切换信号：预切分时在该处强制切句，并给切出的片段标记 `speakerChange`，触发 `segmentSentences` 的硬切句路径，使不同说话人的内容进入不同 cue。当 event 不含 `\n- ` 时，系统 MUST 回退到现有 `seg.isSpeakerChange === 1` 判定（对词级数据保持兼容）。

#### Scenario: 多说话人 event 拆分

 WHEN 输入 event 文本为 `"Yeah.\n- I say okay.  - Maybe it's okay."`（tStart=220132）
 THEN 预切分产出三个片段：`"Yeah."`、`"I say okay."`、`"Maybe it's okay."`
 AND 每个片段标记 `speakerChange`（第一个除外）
 AND `segmentSentences` 把它们分入三个不同的 segment，触发 `_hardBreakAfter`
 AND 最终产出三条独立 cue，各自有独立的 start/end 和翻译。

#### Scenario: 无 \n- 的词级数据回退到 isSpeakerChange

 WHEN 输入来自词级 json3，seg 带 `isSpeakerChange=1`，文本不含 `\n- `
 THEN 预切分不触发切句，`segmentSentences` 按现有 `cw.speakerChange` 逻辑处理
 AND 行为与改动前一致。

### Requirement: 碎片合并阈值放宽与双向合并

系统 SHALL 将 `FRAGMENT_MERGE_MAX_WORDS` 从 3 提升至 4，`TINY_SENTENCE_MAX_WORDS` 从 2 揢升至 3。系统 SHALL 在 `segmentSentences` 合并阶段增加向后合并路径：当前段以句末标点结尾（完整句）且下一段是 ≤3 词孤儿且两者间隔 <1s 时，把孤儿合并到下一段，避免完整句后的 1-2 词孤儿成为独立闪烁 cue。

#### Scenario: 4 词引导句向前合并

 WHEN 预切分后存在片段 `"So, in the last"`（4 词，0.8s）紧接 `"episode, I already said..."`（间隔 <0.5s）
 THEN `FRAGMENT_MERGE_MAX_WORDS=4` 允许向前合并
 AND 产出单一 cue `"So, in the last episode, I already said..."`，不再出现 0.8s 闪烁后接 6.5s 大块。

#### Scenario: 完整句后孤儿向后合并

 WHEN 存在 `#0 "Oh, maybe I should break a little bit here."`（完整句，`.` 结尾）紧接 `#1 "Oh,"`（1 词孤儿，间隔 0s）紧接 `#2 "I'm just going to go for it."`（间隔 14s）
 THEN `#1 "Oh,"` 因向后合并规则（下段 ≤3 词孤儿 + 间隔 <1s）被合并到 `#2`
 AND 不再产出独立的 `"Oh,"` cue。

### Requirement: 标题卡与非对白 event 剔除

系统 SHALL 在预切分阶段把满足以下任一条件的 event 标记为 `titleCard` 并从 word 流中剔除：
- 文本含 `\n` 且不以句末标点结尾。
- 文本匹配剧集标记模式（`Season \d+ - Eps\.\d+`、`Episode \d+` 等）。
- 文本全大写、≤6 词、无小写字母。

被剔除的 event SHALL 不进入 `segmentSentences`、不进入 AI 翻译批次、不进入渲染 cues。

#### Scenario: 剧集标题卡剔除

 WHEN 输入 event 文本为 `"Topa, China\nSeason 8 - Eps.114"`（tStart=21878）
 THEN 该 event 被标记为 `titleCard` 并剔除
 AND `parsed.sentences` 不含该文本
 AND AI 翻译批次不含该文本
 AND 渲染 cues 不含该时间段。

#### Scenario: 多说话人 event 不被误判为标题卡

 WHEN 输入 event 文本为 `"Yeah.\n- I say okay.  - Maybe it's okay."`（含 `\n` 但末尾是 `.`）
 THEN 不满足「含 `\n` 且不以句末标点结尾」条件，不标记为 `titleCard`
 AND 走说话人切分路径正常处理。

### Requirement: 显示原文与翻译统一清洗

系统 SHALL 在 `fetchSubtitles` 中对显示原文和翻译输入使用同一套深度清洗规则（`cleanCueText` 的 `forTranslation:true` 分支），包括去除填充词（`um/uh/er/eeee` 等）、重复词、时间标记。系统 MUST NOT 在显示路径使用 `forTranslation:false` 浅清洗。

#### Scenario: 原文不再带填充词

 WHEN 输入 event 文本为 `"Oh, eeeee."`
 THEN `fetchSubtitles` 清洗后 `parsed.sentences[i].text` 为 `"Oh."`（`eeee` 被去除）
 AND 该清洗后的文本同时用于渲染原文显示和 AI 翻译输入
 AND 两者一致。

#### Scenario: cache key 与显示文本同步

 WHEN 同一文本在显示路径和翻译 cache key 计算路径都经过 `forTranslation:true` 清洗
 THEN cache key 基于的归一化文本与显示文本一致
 AND 不再出现「显示带填充词、cache key 不带」的分叉。

### Requirement: 稀疏垃圾检测修复重叠判断

系统 SHALL 在 `segmentSentences` 的稀疏垃圾检测中，把 `gapBefore` 和 `gapAfter` 的负值（当前句与相邻句重叠）按 0 处理，使重叠相邻的孤立短句仍能被判定为稀疏垃圾并丢弃。

#### Scenario: 重叠的 ASR 幻觉垃圾被丢弃

 WHEN 存在句子 `"Jama sh"`（2 词，171.9→174.6）且相邻句子与它重叠（`gapBefore` 或 `gapAfter` 为负）
 THEN 负值按 0 处理，不满足 `>SPARSE_GAP_MS(5000)` 即视为非稀疏
 AND 该句满足「≤3 词 + 前后间隔均 ≤5000ms（含 0）+ 无句末标点」时被标记 `_sparseGarbage` 并丢弃
 AND 不再出现在最终 `sentences` 中。

### Requirement: 解析器支持截断的对象格式响应

系统 SHALL 在 `tryRepairTruncatedJson` 中增加对 `{` 开头的截断 JSON 的修复：从末尾向前找最后一个完整的 `"key":"value"` 对（value 以闭合 `"` 结尾），在该处补 `}` 重新解析。修复结果 MUST 校验 keys 是连续整数 0..N-1（N 为期望长度），否则丢弃走重试/拆分路径。

#### Scenario: 对象格式响应被 max_tokens 截断后修复

 WHEN AI 返回 `{"0":"第一句","1":"第二句","2":"第三句`（被截断，无闭合 `}`）
 THEN `tryRepairTruncatedJson` 找到最后一个完整对 `"1":"第二句"`，补 `}` 得到 `{"0":"第一句","1":"第二句"}`
 AND 校验 keys `[0,1]` 连续，返回长度为 2 的数组（剩余位置由 `normalizeTranslationArray` 补空字符串）
 AND 不抛「not valid JSON」错误。

#### Scenario: 修复后 keys 不连续则丢弃

 WHEN AI 返回 `{"0":"a","2":"c`（截断且 keys 不连续）
 THEN 修复后 keys `[0,2]` 不连续，`tryRepairTruncatedJson` 返回 null
 AND 走重试/拆分路径。

### Requirement: 解析器解包嵌套 wrapper 响应

系统 SHALL 在 `parseTranslationArray` 中，当解析得到非数组非对象但有 `translations`/`data`/`result` 字段且该字段值是数组或索引对象时，解包该字段作为真实结果继续处理。

#### Scenario: 模型返回 wrapper 对象

 WHEN AI 返回 `{"translations":["第一句","第二句"]}`（外层 wrapper）
 THEN `parseTranslationArray` 识别 `translations` 字段是数组，解包得到 `["第一句","第二句"]`
 AND 走 `normalizeTranslationArray` 对齐到期望长度。

### Requirement: 词级 json3 向后兼容

系统 MUST 保持对词级 json3（segs 带 `tOffsetMs`、可能带 `isSpeakerChange`、可能带 `aAppend`）的完全兼容：预切分只对「word 文本含内部句末标点或 `\n- `」的情况触发，对已是单词的 word 不做任何改变。`segmentSentences` 的时间间隔切句、说话人切句、碎片合并等既有逻辑 MUST 在词级数据上保持原有行为。

#### Scenario: 词级数据全流程不变

 WHEN 输入是词级 json3（每 seg 一个词，带 `tOffsetMs`）
 THEN `parseJson3ToWords` 产出的 word 数组与改动前一致
 AND 预切分不改变该数组（单词无内部标点）
 AND `segmentSentences` 产出的 sentences 与改动前一致
 AND 无回归。
