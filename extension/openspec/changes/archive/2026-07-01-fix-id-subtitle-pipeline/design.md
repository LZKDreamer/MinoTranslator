## Context

字幕流水线从 YouTube JSON3 原始数据到最终 AI 翻译，经过 `parseJson3ToWords → preSegmentPhraseEvents → segmentSentences → cleanCueText → batchTranslate` 五个阶段。印尼语视频的两个关键断点：

1. **`isTitleCardText` 条件2 误杀大量印尼语片段**：条件2 判断"含 `\n` + 不以句末标点结尾 + 无说话人标记 → 标题卡片"。印尼语字幕大量使用 `\n` 做多行排版（如 `"Sudah lebih dari belasan negara ku\nlewati dalam perjalanan ini."` ），且跨事件延续的句子（如 `"Ribuan"` 延续到下一个事件的 `"kilometer"`）不以标点结尾。这些片段全部被 `preSegmentPhraseEvents` 的 `continue` 丢弃，流水线中只剩下零散短语。

2. **`fetchSubtitleFile` 的 InnerTube 多客户端回退链可能返回错轨内容**：函数遍历 IOS/WEB_EMBEDDED_PLAYER/ANDROID/WEB 四个客户端，每个客户端独立调用 InnerTube API 获取字幕轨道列表。不同客户端可能返回不同的轨道集合——某些客户端可能将自动翻译的英文内容标记为印尼语轨道，或直接返回英文 ASR 轨道。当前代码选中"第一个返回数据的客户端"就返回，不做内容校验。

## Goals / Non-Goals

**Goals:**
- 修复 `isTitleCardText` 不再误杀含 `\n` 的正常拉丁书写语言字幕文本
- 增加字幕内容语言一致性校验，防止错轨（元数据声明 id 但实际内容为 en）
- 保持对真实标题卡片的检测能力不退化
- 不影响韩语、日语、中文等非拉丁书写语言的现有断句逻辑

**Non-Goals:**
- 不改变 `segmentSentences` 的断句/合并核心逻辑
- 不修改 AI prompt 格式或翻译模型配置
- 不新增外部依赖

## Decisions

### 决策1: 用小写字母守卫修复 `isTitleCardText` 条件2

```
现有逻辑：含 \n + 无标点结尾 + 无说话人标记 → 标题卡片 → 丢弃
修复后：  含 \n + 无标点结尾 + 无说话人标记 + 无不含小写字母 → 标题卡片 → 丢弃
          （有 [a-z] 小写 即 正常自然语句 → 非标题卡片 → 保留）
```

**理由:**
- 真实标题卡片（如 `SEASON 1\nEPISODE 5`）通常是全大写（条件3 单独处理），不会有小写字母
- 自然语言字幕（如 `Sudah lebih...\nlewati...`）必定含小写字母
- 此守卫对非拉丁文字（韩文/日文/中文等）无影响——这些文字无大小写，继续走条件3
- 改动最小（一行守卫），不影响现有测试用例
- **替代方案被拒绝**: 传源语言代码做白名单——需要在 `preSegmentPhraseEvents` 签名中追加参数并逐层透传，侵入性大，且白名单维护繁琐

### 决策2: `fetchSubtitleFile` 增加内容语言抽样校验

```
fetchSubtitleFile 流程变更:
  for client in [IOS, WEB_EMBEDDED_PLAYER, ANDROID, WEB]:
    tracks = InnerTube(player, client)
    bestTrack = selectBestTrack(tracks, audioTracks, preferredLang)
    text = fetchTimedtextJsonFirst(bestTrack.baseUrl)
    if text:
      if preferredLang is specific (not 'auto'):
        expectedLang = resolveToLangCode(preferredLang).key
        if !verifySubtitleContent(text, expectedLang):
          debugLog → continue（尝试下一个客户端）
      return text  ← 通过校验才返回
```

其中 `verifySubtitleContent(text, expectedLang)`:
1. 解析 JSON3 取前 10 个 event 的 `segs[0].utf8` 文本
2. 拼接后调用 `detectSourceLanguage()`（已存在于 `constants.js`）
3. 检测结果与 `expectedLang` 经 `resolveToLangCode` 归一化后比较
4. 采样不足时（<3 个有效片段）放行，避免误拦

**理由:**
- `detectSourceLanguage` 基于 Unicode 字符集分析，零 API 调用，开销极低
- 在 `fetchSubtitleFile` 层面拦截错轨，而非在下游翻译阶段，控制影响面最小
- 多个客户端依次尝试，一个失败自动换下一个，兼容性良好
- **替代方案被拒绝**: 在 `selectBestTrack` 做更复杂的启发式匹配——YouTube 轨道元数据不一定能反映实际内容语言，仅靠元数据无法判断

## Risks / Trade-offs

- **[风险] 小写字母守卫可能放过极少数小写标题卡片**: 如 `"chapter 1\nthe beginning"` 这种不太典型的标题卡片。→ **缓解**: 这种标题卡片即使未被过滤，进入翻译流水线也只是多一句翻译，不会造成数据破坏；比大量丢弃正常字幕的危害小得多。
- **[风险] 内容语言检测在前10个 event 的采样可能不准确**: 视频开头可能是多语言混合（如介绍、字幕）。→ **缓解**: 设置为空时放行（不过滤），不误拦；若前10个 event 全是英文而中间才是印尼语，则此客户端被跳过，下一个客户端通常会解决问题。
- **[风险] InnerTube 客户端全部返回错误内容**: 极端情况下所有客户端都返回英文内容。→ **缓解**: 直接 timedtext URL 作为最后兜底（不经过 InnerTube），理论上最可靠；且日志会输出诊断信息供排查。

## Open Questions

- 是否需要在 `isTitleCardText` 中为更多非拉丁文字系统（如天城文、泰文）增加类似守卫？目前条件3 的非拉丁文字检查已跳过大小写检测（因为无大小写概念），条件2 新守卫 `[a-z]` 对非拉丁文字无影响。暂时不需要。
- 内容语言检测的采样数量（前10个 event）是否足够？可能需要在实际印尼语视频上验证。
