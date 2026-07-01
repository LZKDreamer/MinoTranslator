# audio-track-language-extraction

## Purpose

TBD

## Requirements

### Requirement: 三级优先级提取音频语言

`selectBestTrack` 在 `preferredLang === 'auto'` 且 `audioTracks` 非空时，SHALL 按以下优先级从 `audioTracks[0]` 提取音频语言代码：

1. `defaultCaptionTrackIndex` — 若存在，反查 `captionTracks[该索引].languageCode` 作为音频语言
2. `captionTrackIndices[0]` — 若以上未获取到，反查 `captionTracks[该索引].languageCode`
3. `audioTrackId` — 若以上均未获取到，取 `audioTrackId.split('.')[0]` 作为音频语言前缀

提取到的语言代码 SHALL 通过 `findTrackByLang(tracks, audioLang)` 在所有字幕轨道中匹配。

若所有三级均无法提取语言，SHALL 进入原有 ASR/translatable/tracks[0] fallback 逻辑。

**禁止**读取 `audioLanguageCode` 或 `languageCode` 字段（YouTube 真实数据中不存在）。

#### Scenario: 单音轨视频通过 defaultCaptionTrackIndex 匹配

- **WHEN** 用户打开繁体中文视频，YouTube 返回 `audioTracks: [{"captionTrackIndices":[0,1],"defaultCaptionTrackIndex":1}]` 且 `captionTracks[1].languageCode === "zh-TW"`
- **THEN** `audioLang` SHALL 为 `"zh-TW"`
- **AND** `findTrackByLang(tracks, "zh-TW")` SHALL 匹配到繁体中文轨道
- **AND** 源语言 SHALL 为 `"zh-TW"`

#### Scenario: 单音轨视频通过 captionTrackIndices[0] 匹配

- **WHEN** 用户打开韩语视频，YouTube 返回 `audioTracks: [{"captionTrackIndices":[0]}]` 且 `captionTracks[0].languageCode === "ko"`
- **AND** `defaultCaptionTrackIndex` 不存在
- **THEN** `audioLang` SHALL 为 `"ko"`
- **AND** `findTrackByLang(tracks, "ko")` SHALL 匹配到韩语轨道

#### Scenario: 多音轨视频通过 audioTrackId 匹配

- **WHEN** 用户打开多配音视频，`audioTracks[0].audioTrackId === "ko.10"` 且 `captionTrackIndices` 和 `defaultCaptionTrackIndex` 均存在但未产生匹配（或不存在）
- **THEN** `audioLang` SHALL 为 `"ko"`（从 `"ko.10"` 提取前缀）

#### Scenario: 所有三级均无法提取时进入原 fallback

- **WHEN** `audioTracks[0]` 为 `{}`（空对象，无任何可用字段）
- **THEN** `audioLang` SHALL 为 `null`
- **AND** 进入 ASR → translatable → tracks[0] fallback 逻辑
