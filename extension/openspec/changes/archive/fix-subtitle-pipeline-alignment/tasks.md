## 1. 短语级 event 预切分（D1, D2, D4）

- [x] 1.1 在 `youtube-subtitles.js` 新增 `preSegmentPhraseEvents(words)` 函数，遍历 word 数组，对每个 word 文本执行：(a) 按 `\n- `（及 `\n *-`）切分并标记 `speakerChange`；(b) 按内部句末标点（`.?!。？！` 不在末尾时）切分。子片段时间戳按文本长度比例分配 event 剩余 duration。
- [x] 1.2 在 `parseSubtitleData` 的 `parseJson3ToWords` 之后、`segmentSentences` 之前调用 `preSegmentPhraseEvents`。
- [x] 1.3 实现 `titleCard` 检测：含 `\n` 且不以句末标点结尾 / 匹配 `Season \d+ - Eps\.\d+` 等剧集模式 / 全大写 ≤6 词无小写。标记后从 word 流剔除。
- [x] 1.4 保证词级 json3（word 已是单词、无内部标点、无 `\n- `）经过 `preSegmentPhraseEvents` 后数组不变。
- [x] 1.5 用 `extension/log/f.txt` 构造测试输入，验证：event 49 `"Yeah.\n- I say okay.  - Maybe it's okay."` 被切成 3 片且标记 speakerChange；event `"Topa, China\nSeason 8 - Eps.114"` 被剔除；event 90 `"It's here. I think"` 被切成 2 片。

## 2. 断句合并阈值与双向合并（D3）

- [x] 2.1 把 `FRAGMENT_MERGE_MAX_WORDS` 从 3 改为 4，`TINY_SENTENCE_MAX_WORDS` 从 2 改为 3。
- [x] 2.2 在 `segmentSentences` 合并阶段增加向后合并路径：当前段以句末标点结尾（完整句）且下一段 ≤3 词孤儿且间隔 <1s 时，把孤儿合并到下一段。
- [x] 2.3 验证日志样本中 `#0 "Oh, maybe..." + #1 "Oh," + #2 "I'm just going..."` 不再产出独立 `"Oh,"` cue；`#78 "So, in the last" + #79 "episode..."` 合并为单一 cue。

## 3. 清洗路径统一（D6）

- [x] 3.1 把 `fetchSubtitles` 第 73 行的 `cleanCueText(text, {forTranslation:false})` 改为 `cleanCueText(text, {forTranslation:true})`，确认 `parsed.sentences[i].text` 同时用于显示和 cache key 计算。
- [x] 3.2 验证 `"Oh, eeeee."` 清洗后显示为 `"Oh."`，cache key 基于清洗后文本。

## 4. 稀疏垃圾检测修复重叠判断

- [x] 4.1 在 `segmentSentences` 稀疏垃圾检测中，把 `gapBefore`/`gapAfter` 的负值按 0 处理（用 `Math.max(0, gap)`）。
- [x] 4.2 验证 `"Jama sh"`（与相邻句重叠）能被判定为稀疏垃圾并丢弃。

## 5. 渲染器：广告强制隐藏 + seek 监听（D5）

- [x] 5.1 在 `subtitle-renderer.js` `renderLoop` 的 `isAdShowing()` 分支，直接 `container.classList.remove('visible'); container.innerHTML='';`，不调用 `renderCue(-1)`、不走 gap-hold。
- [x] 5.2 在 `renderCue(-1)` 的 gap-hold 入口加判定：`if (this.isAdShowing() || this._lastValidIndex < 0) skip hold`。
- [x] 5.3 在 `start()` 中给 `video` 添加 `seeking` 和 `seeked` 事件监听，回调里 `this._lastValidIndex = -1`；在 `destroy()`/`clear()` 中移除监听。
- [ ] 5.4 手动验证：播放中插入广告字幕立即消失；seek 到无字幕区字幕立即消失；自然播放 <2s 短间隙仍 hold 不闪烁；seek 到有字幕区立即切换到对应 cue。

## 6. 解析器加固（D7）

- [x] 6.1 在 `tryRepairTruncatedJson` 增加 `{` 开头分支：从末尾向前找最后一个完整 `"key":"value"` 对（value 闭合 `"`），补 `}` 重解析。
- [x] 6.2 修复后校验 keys 是连续整数 0..N-1，否则返回 null。
- [x] 6.3 在 `parseTranslationArray` 增加 wrapper 解包：解析结果非数组非对象但有 `translations`/`data`/`result` 字段且值是数组/对象时，解包该字段。
- [x] 6.4 构造单元测试：截断对象 `{"0":"a","1":"b","2":"c` → 修复为长度 2；wrapper `{"translations":["a","b"]}` → 解包为 `["a","b"]`；keys 不连续 `{"0":"a","2":"c` → 返回 null。

## 7. 回归验证

- [x] 7.1 用 `f.txt` 作为输入跑完整流水线，对比 `subtitle-pipeline-log.txt`：412 句不再出现 0.8s 孤儿闪烁；多说话人 event 拆开；标题卡剔除；`"Jama sh"` 丢弃。
- [ ] 7.2 在真实 YouTube 视频上验证：广告插入字幕消失；seek 拖动字幕不残留；长视频翻译批次无 retry/split 异常。
- [x] 7.3 运行 `openspec validate fix-subtitle-pipeline-alignment` 通过。
