## Why

字幕流水线在「断句/合并」「渲染对齐」两个环节存在结构性 bug，导致字幕时快时慢、说话人合并、广告/拖动进度条时旧字幕残留。日志分析（412 句、449 个 json3 event）确认：当前数据为短语级 json3（无 `tOffsetMs`、无 `aAppend`、无 `isSpeakerChange`），但 `segmentSentences` 按词级格式设计，多个特性在短语级数据上静默失效；`subtitle-renderer.js` 的 gap-hold 状态机有死锁路径，导致广告和 seek 场景字幕卡死。

## What Changes

### 断句/清洗（`youtube-subtitles.js` `segmentSentences` 及上游）
- **新增短语级 event 预切分**：在进入 `segmentSentences` 之前，按内部句末标点（`.?!。？！`）和 `\n- ` 说话人标记把短语级 event 切成真实句子单元，让 word 数组反映句子边界而非整段短语。
- **解析 `\n- ` 说话人标记**：把 `\n- ` 作为说话人切换信号（替代永远为空的 `seg.isSpeakerChange`），多说话人 event 拆成多条 cue。
- **修复句内标点不切分**：当前 `SENTENCE_END_RE` 锚定 `$`，短语打包时内部标点不触发切分；预切分后此问题随之消失。
- **放宽碎片合并阈值**：`FRAGMENT_MERGE_MAX_WORDS` 3→4（或更高），`TINY_SENTENCE_MAX_WORDS` 2→3，避免 4 词引导句（如 "So, in the last"）被切成 0.8s 闪烁孤儿。
- **支持双向合并**：当前只能向前合并，完整句后的 1-2 词孤儿无法回合并到前句；增加向后合并路径或在预切分阶段消解。
- **标题卡检测**：含 `\n` 且无标点结尾、或匹配 `Season \d+ - Eps\.\d+` 等模式的 event，标记为非对白，不参与翻译/渲染（或单独处理）。
- **统一清洗路径**：`fetchSubtitles:73` 对显示原文也用 `forTranslation:true` 深度清洗，消除「原文带填充词、译文已清洗」的分叉。
- **修复稀疏垃圾检测的重叠判断**：`gapBefore`/`gapAfter` 为负（重叠）时按 0 处理，避免重叠垃圾漏判（如 "Jama sh"）。

### 渲染对齐（`subtitle-renderer.js`）
- **修复 gap-hold 状态机死锁**：广告插入和 seek 跳变时强制隐藏字幕，不走 gap-hold；或让 gap-hold 用独立 holding 状态每帧重新评估，不再依赖「一次性触发 `renderCue(-1)` 即隐藏」的假设。
- **监听 `video.seeking`**：seek 时清空 `_lastValidIndex`，让 gap-hold 失去 hold 依据，自动隐藏旧字幕。
- **广告分支强制隐藏**：`isAdShowing()` 为真时直接隐藏，不进入 gap-hold 判断。

### 解析 AI 返回（`youtube-subtitles.js` `parseTranslationArray`）— 潜伏风险加固
- **扩展 `tryRepairTruncatedJson` 支持对象格式**：prompt 现在要求 `{"0":"..","1":".."}` 对象，但截断修复只处理数组 `[`；补上对象 `{` 的截断修复，避免对象响应被截断时落到「not valid JSON」重试链。
- **识别嵌套 `{"translations":[...]}` 包装**：部分模型会在外层加 wrapper，当前会全部返回空字符串；增加解包路径。

## Capabilities

### New Capabilities
- `subtitle-segmentation`: 字幕断句、合并、清洗的规则与不变量（短语级/词级 json3 通用，覆盖说话人切分、碎片合并、标题卡、垃圾检测）。
- `subtitle-rendering`: 字幕渲染层与视频时间对齐的规则（cue 查找、gap-hold、广告/seek 场景的强制隐藏）。

### Modified Capabilities
<!-- 仓库当前 openspec/specs/ 为空，无既有 capability 需修改 -->

## Impact

- **代码**：
  - `extension/src/content/youtube-subtitles.js`：`parseJson3ToWords`、`segmentSentences`、`fetchSubtitles` 调用点、`tryRepairTruncatedJson`、`parseTranslationArray`。
  - `extension/src/content/subtitle-renderer.js`：`renderLoop`、`renderCue`、`findCueIndex`、新增 seek 监听。
  - `extension/src/shared/translate-prompt.js`：`cleanCueText` 可能需调整 `\n- ` 和标题卡的清洗策略。
- **数据契约**：json3 event 的 `\n- ` 和 `\n` 被赋予语义（之前被压平），属于对既有格式的语义化解读，非破坏性。
- **AI 翻译**：预切分后句子更短更准，单批 token 压力下降；cache key 因清洗路径统一而变化，旧缓存部分失效（可接受，新视频重新翻译）。
- **测试**：需要用 `extension/log/f.txt` + `subtitle-pipeline-log.txt` 作为回归样本，验证断句不再出现 0.8s 孤儿、说话人不再合并、广告/seek 字幕立即隐藏。
- **非目标**：不重写整个流水线架构；不引入 AI 端断句（保持本地断句 + AI 只翻译的现有分工）；不修改 popup 自动检测源语言的逻辑（虽然它读的是字幕轨道语言而非音频语言，但当前不在本次范围）。
