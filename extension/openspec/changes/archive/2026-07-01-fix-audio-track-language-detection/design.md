## Context

`selectBestTrack` 函数在 `preferredLang === 'auto'` 时尝试通过音频轨道匹配找到最佳字幕。当前代码读取 `audioTracks[0].audioLanguageCode` 和 `audioTracks[0].languageCode`，但两者都不存在于 YouTube 的真实响应中。

通过用户实际测试采集的三种场景数据：

| 场景 | audioTracks 结构 | 语言来源 |
|------|-----------------|---------|
| 韩语视频（单音轨） | `[{"captionTrackIndices":[0]}]` | 无任何语言字段 |
| 英语视频（多音轨配音） | `[{...,"audioTrackId":"es-US.10","captionTrackIndices":[0,1]}]` | `audioTrackId` 前缀 |
| 繁体中文视频 | `[{"captionTrackIndices":[0,1],"defaultCaptionTrackIndex":1}]` | 反查 `tracks[1]` |

## Goals / Non-Goals

**Goals:**
- YouTube 单音轨视频（最常见）：通过 `captionTrackIndices` 反查字幕轨道，获取视频原语言
- YouTube 多音轨视频（配音）：通过 `audioTrackId` 前缀获取音轨语言
- 100% 向后兼容：不改函数签名，不改返回值结构

**Non-Goals:**
- 不改变 `findTrackByLang` 的匹配逻辑
- 不改变 ASR/translatable fallback 策略
- 不涉及 Popup 显示层的改动（语言名归一化已在之前完成）

## Decisions

### 决策：三级优先级提取音频语言

```js
var audioLang = null;
if (audioTracks && audioTracks.length > 0) {
  var at = audioTracks[0];
  // 1. defaultCaptionTrackIndex → 反查 captionTracks（最可靠，YouTube 明确推荐的字幕）
  if (at.defaultCaptionTrackIndex != null && tracks[at.defaultCaptionTrackIndex]) {
    audioLang = tracks[at.defaultCaptionTrackIndex].languageCode || null;
  }
  // 2. captionTrackIndices[0] → 反查 captionTracks（该音轨关联的字幕列表首条）
  if (!audioLang && at.captionTrackIndices && at.captionTrackIndices.length > 0 && tracks[at.captionTrackIndices[0]]) {
    audioLang = tracks[at.captionTrackIndices[0]].languageCode || null;
  }
  // 3. audioTrackId → 提取前缀（多音轨配音场景："ko.10" → "ko"）
  if (!audioLang && at.audioTrackId) {
    audioLang = String(at.audioTrackId).split('.')[0] || null;
  }
}
```

**理由**：
- 优先级 1 (`defaultCaptionTrackIndex`)：YouTube 通过此字段明确告知"推荐使用这个字幕"，最能代表视频原语言
- 优先级 2 (`captionTrackIndices[0]`)：回退方案，用音轨关联的第一个字幕轨道，涵盖简单视频
- 优先级 3 (`audioTrackId`)：最后回退，仅用于多音轨配音视频。注意此值可能是配音语言而非原语言（如西班牙语配音的英语视频，`audioTrackId="es-US.10"` 会被检测为西班牙语，但这种情况极少）

## Risks / Trade-offs

- **[风险] 多音轨视频 audioTracks[0] 是配音语言** → 取 `audioTracks[0]` 而非遍历查找。这是权衡：大多数视频 `audioTracks[0]` 是原语言，配音占极少数。如果未来需要优化，可以遍历 `audioTracks` 查找第一个非翻译音轨。
- **[风险] `captionTrackIndices` 索引越界** → 代码中已用 `tracks[at.captionTrackIndices[0]]` 守卫，不会崩溃。
