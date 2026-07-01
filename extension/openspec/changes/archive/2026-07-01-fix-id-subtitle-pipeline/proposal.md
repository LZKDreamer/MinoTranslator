## Why

印尼语（id）视频字幕翻译质量极差——源文本被错误地替换为英文、大量有效片段被静默丢弃、时间轴错位。根因有两个：(1) `isTitleCardText` 把含 `\n` 换行的印尼语字幕误判为"标题卡片"并删除；(2) `selectBestTrack` + `fetchSubtitleFile` 的 InnerTube 多客户端回退链可能选中英文自动翻译轨道，导致原文内容不是印尼语。

## What Changes

- 修复 `isTitleCardText` 的条件2（含 `\n` 且不以句末标点结尾）：新增对印尼语/马来语（id/ms）等拉丁书写语言的字幕换行豁免，不再误杀正常字幕
- 强化 `selectBestTrack` 和 `fetchSubtitleFile` 的轨道选择：用户指定语言时跳过 InnerTube 回退链的非匹配客户端数据，优先使用直接 timedtext URL
- 在 `fetchTimedtextJsonFirst` 增加对返回内容语言的快速检测（采样前 10 条 event 文本做 Unicode 字符集检测），若实际内容语言与轨道元数据声明的语言不符，回退到下一个客户端

## Capabilities

### New Capabilities

- `subtitle-track-guard`: 字幕轨道获取时对返回内容进行语言一致性校验，防止元数据声明 id 但实际内容为 en 的错轨
- `titlecard-whitelist-latin`: `isTitleCardText` 新增对拉丁书写语言（id/ms 等）的换行豁免，基于源语言代码判断而非硬编码

### Modified Capabilities

- `subtitle-segmentation`: `isTitleCardText` 的条件2判断逻辑需修改，新增源语言感知的换行豁免

## Impact

- `src/content/youtube-subtitles.js`: `isTitleCardText` 签名新增 `langCode` 参数，`preSegmentPhraseEvents` 透传语言代码
- `src/content/youtube-subtitles.js`: `fetchTimedtextJsonFirst` 新增内容语言一致性检测
- `src/content/youtube-subtitles.js`: `fetchSubtitleFile` 的 InnerTube 回退链增加源语言匹配校验
- `src/content/youtube-subtitles.js`: `parseSubtitleData` 保存原始事件数用于诊断日志
