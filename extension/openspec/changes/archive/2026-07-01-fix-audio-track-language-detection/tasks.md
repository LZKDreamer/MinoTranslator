## 1. 实现音频语言三级提取

- [x] 1.1 替换 `selectBestTrack` 中 audioLang 提取逻辑：移除无效的 `audioLanguageCode`/`languageCode` 读取，改为三级优先级提取 (`youtube-subtitles.js:240-244`)

## 2. 验证三种真实场景

- [x] 2.1 繁体中文视频验证：`defaultCaptionTrackIndex` 反查 → 源语言为 `zh-TW`
- [x] 2.2 韩语视频验证：`captionTrackIndices[0]` 反查 → 源语言为 `ko`
- [x] 2.3 多配音英语视频验证：`audioTrackId` 提取 → 音轨语言正确提取
