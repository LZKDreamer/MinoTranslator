## Context

当前字幕流水线分两段：(1) `youtube-subtitles.js` 负责获取 json3 → `parseJson3ToWords` → `segmentSentences`（清洗/断句/合并）→ `batchTranslateSentences`（AI 翻译）→ `parseTranslationArray`（解析返回）；(2) `subtitle-renderer.js` 负责按 `video.currentTime` 二分查找 cue 并渲染。

日志分析（`extension/log/`）确认实际数据为**短语级 json3**：每个 event 只有 1 个 seg、无 `tOffsetMs`、无 `aAppend`、`isSpeakerChange` 永远为空（0/449）。真实的句子边界和说话人边界全部编码在文本里——句末标点在短语中间，说话人用 `\n- ` 标记（37 个 event），标题卡用 `\n` 分隔（46 个 event）。现有代码按词级格式设计，在短语级数据上 7 个特性静默失效。

渲染器 gap-hold 逻辑为防闪烁而设，但与广告分支、seek 跳变、`currentCueIndex` 一次性触发假设冲突，存在死锁路径。

约束：
- 保持「本地断句 + AI 只翻译」的现有分工，不引入 AI 端断句。
- 不破坏词级 json3 兼容性（未来可能遇到词级数据）。
- cache key 因清洗路径统一会变化，旧缓存部分失效可接受。
- 必须用 `f.txt` + `subtitle-pipeline-log.txt` 做回归验证。

## Goals / Non-Goals

**Goals**
- 短语级 event 在进入 `segmentSentences` 前被切成真实句子单元（按内部标点 + `\n- `）。
- 多说话人 event 拆成多条 cue，不再合并。
- 消除 0.8s 孤儿闪烁和句中切断（4 词阈值问题）。
- 标题卡/非对白 event 不进入翻译和渲染。
- 广告插入、seek 跳变时字幕立即隐藏，gap-hold 不再卡死。
- 显示原文与翻译用统一的清洗路径。
- 加固解析器对对象格式截断和嵌套 wrapper 的处理。

**Non-Goals**
- 不重写流水线架构，不换协议。
- 不改 popup 源语言自动检测逻辑（它读字幕轨道 `languageCode` 而非音频语言，是已知问题但不在本次范围）。
- 不改 AI prompt 模板结构（保持对象格式输出契约）。
- 不做字幕样式/排版调整。

## Decisions

### D1：在 `parseJson3ToWords` 之后、`segmentSentences` 之前插入「短语预切分」阶段
**选择**：新增 `preSegmentPhraseEvents` 步骤，遍历 word 数组，对每个 text 含内部句末标点或 `\n- ` 的 word，按规则切成多个 word，时间戳按比例或就近分配。

**理由**：`segmentSentences` 现有逻辑（标点切句、间隔切句、合并）都假设 1 word ≈ 1 词。短语级数据 1 word = 整句，导致 `SENTENCE_END_RE` 锚 `$` 永远只看末尾、`FRAGMENT_MERGE_MAX_WORDS` 按词数判定但 word 是整句。在源头切开，下游所有阈值和正则恢复正确语义。

**备选**：
- (A) 在 `segmentSentences` 内部加「句内标点切分」特判。拒绝：会让本就复杂的断句函数更复杂，且 `\n- ` 说话人切分仍需单独处理。
- (B) 改 `SENTENCE_END_RE` 不锚 `$`，用 `split` 拆。拒绝：解决不了 `\n- ` 说话人合并，也解决不了 4 词阈值（word 仍是整句，词数统计无意义）。

### D2：`\n- ` 作为说话人切换的权威信号（替代 `isSpeakerChange`）
**选择**：预切分时遇到 `\n- `（或 `\n *-`）强制切句，且给切出的片段标记 `speakerChange`，让 `segmentSentences` 的硬切句路径触发。

**理由**：`isSpeakerChange` 字段在你的数据里永远为空，但 `\n- ` 是 YouTube 短语级 json3 编码多说话人的事实标准（37 个 event）。继续等 `isSpeakerChange` 等于放弃这个信号。

**备选**：只在清洗阶段把 `\n- ` 替换成空格。拒绝：会让多说话人合并成一句，正是当前 bug。

### D3：碎片合并阈值放宽 + 增加向后合并
**选择**：`FRAGMENT_MERGE_MAX_WORDS` 3→4，`TINY_SENTENCE_MAX_WORDS` 2→3；在 `segmentSentences` 合并阶段增加「若当前段是完整句且下一段是 ≤3 词孤儿且间隔 <1s，则把孤儿向后合并到下一段」的反向路径。

**理由**：预切分后句子单元更细，4 词引导句（"So, in the last"）应能跟后面的 "episode, I already said..." 合并；纯向前合并会让 "Oh," 这种孤儿卡在完整句后面。

**备选**：把合并完全交给预切分阶段，不在 `segmentSentences` 合并。拒绝：预切分只能看文本，看不到时间间隔，合并需要时间维度参与。

### D4：标题卡检测——模式 + 结构双判
**选择**：在预切分阶段，event 满足以下任一即标记为 `titleCard`，从 word 流中剔除：
- 文本含 `\n` 且无句末标点结尾。
- 匹配 `Season \d+ - Eps\.\d+`、`Episode \d+` 等剧集标记模式。
- 全大写短文本（≤6 词）且无小写字母。

**理由**：标题卡不是对白，翻译它只会产生噪声。46 个含 `\n` 的 event 里多数是标题卡或多说话人，预切分后多说话人走 D2，剩下的标题卡走本规则剔除。

**备选**：保留标题卡但用不同样式渲染。拒绝：超出本次目标，且当前渲染器无标题卡样式。

### D5：渲染器——seek 监听清空 `_lastValidIndex` + 广告分支强制隐藏
**选择**：
- `start()` 时给 `video` 加 `seeking` 监听，回调里 `this._lastValidIndex = -1`，让 gap-hold 立即失效。
- `renderLoop` 广告分支直接 `container.classList.remove('visible'); container.innerHTML='';`，不调 `renderCue(-1)`、不走 gap-hold。
- `renderCue(-1)` 的 gap-hold 入口加 `if (this._isSeeking || this.isAdShowing()) skip hold`。

**理由**：思路 C（seek 清空）+ 思路 A（广告强制）最小改动解决两个症状。思路 B（独立 holding 状态每帧评估）更彻底但改动大，本次先用 C+A，若仍有残留再升级到 B。

**备选**：完全重写 gap-hold 为独立状态机。拒绝：当前 gap-hold 在自然播放场景工作良好，重写风险高。

### D6：显示与翻译统一用 `forTranslation:true` 清洗
**选择**：`fetchSubtitles:73` 把 `forTranslation:false` 改为 `true`，原文显示也走深度清洗。

**理由**：当前原文显示带 `um/uh/eeee`，译文已清洗，两者分叉。统一后 cache key 一致、显示一致。唯一副作用是原文显示不再带场景标记 `[음악]`，可接受（场景标记对观众意义有限）。

**备选**：保持分叉，只统一 cache key。拒绝：分叉本身就是 bug 来源。

### D7：解析器加固——对象截断修复 + wrapper 解包
**选择**：
- `tryRepairTruncatedJson` 增加 `{` 开头分支：找最后一个完整 `"key":"value"` 对，补 `}` 重解析。
- `parseTranslationArray` 在解析成功后增加：若结果是非数组非对象但有 `translations`/`data`/`result` 字段且其值是数组/对象，则解包。

**理由**：prompt 要求对象格式输出，对象截断是当前未覆盖的失败模式；wrapper 是部分模型的实际行为。本次日志无失败但属潜伏风险。

## Risks / Trade-offs

- **[预切分时间戳分配不准]** 短语级 event 切开后，子片段的精确时间戳不可得（只有 event 的 `tStartMs`/`dDurationMs`）。**缓解**：按文本长度比例分配 duration，或给切出的句末片段分配 event 的剩余时长；下游已有 `OVERLAP_BUFFER_SEC=0.3` 截断和 `MIN_DISPLAY_SEC=0.8` 拉伸兜底。
- **[标题卡误判]** 全大写短文本可能是强调的对白而非标题卡。**缓解**：标题卡规则保守（必须含 `\n` 或匹配剧集模式），全大写仅作辅助信号；误判的代价是少翻译一句，可接受。
- **[`\n- ` 模式不通用]** 其他视频可能不用 `\n- ` 标记说话人。**缓解**：D2 只在「文本确实含 `\n- `」时触发，不含则走原逻辑，向后兼容。
- **[cache 失效]** D6 改清洗路径后 cache key 变化，旧缓存命中率为 0。**缓解**：可接受，新视频重新翻译；不主动清理旧缓存（自然过期）。
- **[seek 监听漏边界]** `seeking` 事件在某些浏览器/场景可能不触发。**缓解**：同时监听 `seeked` 兜底；`renderLoop` 每帧重算 cue index 本就是兜底。
- **[对象截断修复误修复]** `tryRepairTruncatedJson` 对 `{` 的修复可能补出语法正确但语义错误的 JSON。**缓解**：修复后校验 keys 是连续数字 0..N-1，否则丢弃走重试/拆分。

## Migration Plan

1. **阶段 1（断句/清洗）**：实现预切分 + D2/D3/D4/D6，用 `f.txt` + `subtitle-pipeline-log.txt` 回归，验证：412 句不再出现 0.8s 孤儿、"Jama sh" 被丢弃、多说话人 event 拆开、标题卡剔除。
2. **阶段 2（渲染）**：实现 D5，手动验证：播放中插入广告字幕立即消失、seek 到无字幕区字幕立即消失、自然播放短间隙仍 hold 不闪烁。
3. **阶段 3（解析器加固）**：实现 D7，构造截断对象和 wrapper 响应的单元测试用例。
4. **回滚**：三阶段相互独立，任一阶段出问题可单独回滚；预切分是新增步骤，删除即回滚到原逻辑。

## Open Questions

- 预切分后子片段时间戳分配策略（按文本长度比例 vs 就近附着到下一句）需实测对比，哪个对齐体感更好？
- 标题卡剔除后，是否需要在渲染层显示一个占位（如 "—"）表示非对白段，还是完全留空？倾向完全留空。
- D5 的 `seeking` 监听是否需要防抖（连续拖动时频繁清空 `_lastValidIndex` 是否有性能问题）？预期无影响（仅赋值），但需确认。
