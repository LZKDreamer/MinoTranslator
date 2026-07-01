## Why

`selectBestTrack` 的音频匹配代码试图读取 `audioTracks[0].audioLanguageCode` 和 `audioTracks[0].languageCode`，但 YouTube 的真实数据结构中这两个字段都不存在。音频匹配从未生效，导致源语言始终退化为字幕列表的第一条（`tracks[0]`），而非视频的实际发音语言。

通过用户真实 YouTube 数据验证，`audioTracks` 的语言信息存在以下字段中：

| 场景 | 可用字段 |
|------|---------|
| 单音轨视频 | `captionTrackIndices` + `defaultCaptionTrackIndex` |
| 多音轨配音视频 | `audioTrackId`（如 `"ko.10"`） + `captionTrackIndices` |

## What Changes

- `selectBestTrack` 从 `audioTracks[0]` 提取音频语言时，按优先级尝试三个数据源：
  1. `defaultCaptionTrackIndex` → 反查 `captionTracks[索引].languageCode`
  2. `captionTrackIndices[0]` → 反查 `captionTracks[索引].languageCode`
  3. `audioTrackId` → `split('.')[0]` 提取语言前缀
- 移除无效的 `audioLanguageCode` / `languageCode` 读取

## Capabilities

### New Capabilities
- `audio-track-language-extraction`: `selectBestTrack` 音频语言提取逻辑，定义从 YouTube `audioTracks` 对象获取语言的优先级链

### Modified Capabilities
<!-- 无 -->

## Impact

- `src/content/youtube-subtitles.js`: `selectBestTrack` 函数的音频语言提取部分（约 5 行改动）
