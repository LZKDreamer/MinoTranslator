## Context

当前 Popup、Service Worker、Content Script 三个角色围绕同一个 `videoTasks` Map 协作，但存在两个同步问题：

**问题一：状态写入竞争**
```
SW: 创建 task，status=TRANSLATING    → Popup 看到 "翻译中"
CS: reportTask(PREPARING)            → Popup 看到 "准备字幕" (倒退!)
CS: reportTask(TRANSLATING)          → Popup 看到 "翻译中" (恢复)
```
SW 在 `PREPARE_VIDEO_TRANSLATION` 拿到字幕数据后立即将任务状态设为 TRANSLATING，但随后 Content Script 的 `startTranslation` 又重复报告了 PREPARING。

**问题二：视频检测空档**
```
CS: checkForVideo() → MutationObserver(500ms 去抖) → 检测到 videoId
                                            ↑
Popup: GET_VIDEO_TASKS → DETECT_VIDEO_TRANSLATABLE (8s 超时)
        如果 Popup 在此期间打开，可能拿到空结果
```
Content Script 自己检测到了视频，但不主动上报。SW 只有 Popup 问了才去查。

## Goals / Non-Goals

**Goals:**
- 翻译任务状态转换顺序固定为 AVAILABLE → PREPARING → TRANSLATING → COMPLETED/FAILED，永不倒退
- Content Script 检测到新视频后主动上报，Popup 打开即能看到
- Popup 首次扫描期间不显示误导性的"没有视频"

**Non-Goals:**
- 不改变翻译逻辑本身（prompt、API 调用、缓存、渲染器）
- 不改变视频任务持久化逻辑
- 不引入新的浏览器 API 调用
- 不增加超出 MESSAGE_TYPE 枚举的新常量类型

## Decisions

### 决策 1：状态写入所有权模型

| 状态转换 | 唯一写入者 | 触发条件 |
|----------|-----------|---------|
| (不存在) → AVAILABLE | Content Script (via VIDEO_DETECTED) | 检测到视频有可翻译字幕 |
| AVAILABLE → PREPARING | Service Worker (via START_VIDEO_TASK) | 用户点击翻译按钮，SW 完成 PREPARE |
| PREPARING → TRANSLATING | Content Script (via VIDEO_TASK_PROGRESS) | 收到 START_SUBTITLE_TRANSLATION，初始化 renderer 后 |
| TRANSLATING → COMPLETED | Content Script (via VIDEO_TASK_PROGRESS) | 所有 batch 翻译完成 |
| \* → FAILED | Content Script | 翻译过程出错 |
| \* → CANCELED | Content Script (当前) + Service Worker (CANCEL_VIDEO_TASK) | 用户取消 / SW 重启清理 |

**理由**：单一写入者消除竞争。Content Script 是翻译执行者（知道何时 PREPARING 结束、何时 TRANSLATING 结束），所以 PREPARING → TRANSLATING 和 TRANSLATING → COMPLETED 都由它写。SW 是编排者（知道用户何时点击翻译），所以 AVAILABLE → PREPARING 由它写。

### 决策 2：PREPARE 数据传递优化

SW 在 `START_VIDEO_TASK` 中已经通过 `PREPARE_VIDEO_TRANSLATION` 拿到了字幕数据（cues、sourceLanguage），但当前 `START_SUBTITLE_TRANSLATION` 消息没有把这些数据传给 Content Script，导致 Content Script 又重新 `fetchSubtitles` 一次。

**改动**: `START_SUBTITLE_TRANSLATION` 消息体增加 `cues`、`sourceLanguage`、`videoTitle` 字段。Content Script 的 `startTranslation` 如果收到 `cues`，跳过 `fetchSubtitles`，直接用传入的数据初始化 renderer。

**消息体变更**:
```js
// 旧
{ type: 'START_SUBTITLE_TRANSLATION', targetLanguage }
// 新
{ type: 'START_SUBTITLE_TRANSLATION', targetLanguage, cues, sourceLanguage, videoTitle }
```

### 决策 3：视频主动检测上报

Content Script 在 `checkForVideo()` 检测到新 videoId 后，调用 `quickDetectSubtitles()` 快速确认字幕可用性，然后通过 `VIDEO_TASK_PROGRESS`（复用现有消息）将 AVAILABLE 状态上报给 SW。

选择复用 `VIDEO_TASK_PROGRESS` 而非新增 `VIDEO_DETECTED` 消息的理由：
- 消息语义一致：都是"任务进度/状态更新"
- SW 已有的 `VIDEO_TASK_PROGRESS` handler 已包含完整的创建/更新逻辑
- 减少 constants 枚举膨胀

**触发时机**:
1. `checkForVideo()` 发现新 videoId 时（MutationObserver 或 yt-navigate-finish）
2. `quickDetectSubtitles()` 返回 `available: true` 后

**去重**: `quickDetectSubtitles` 已有 `quickDetectCache`（Map 缓存），不会重复网络请求。重复上报被 SW 的 `videoTasks` Map 天然去重（同一 videoId+targetLanguage 覆盖）。

### 决策 4：Popup 首次扫描 loading 状态

Popup 维护 `hasInitialScanCompleted` 标志。首次 `refreshVideos` 调用记为扫描开始。

**扫描期规则**:
- 前 6 秒（4 次 × 1.5s 轮询）或首次拿到非空结果，标记扫描完成
- 扫描期内 data 为空 → 显示"正在扫描视频···"loading（复用已有 `renderLoading()`）
- 扫描完成后 data 为空 → 显示原有"打开有字幕的 YouTube 视频···"empty 状态

## Risks / Trade-offs

- **[风险] Content Script 快速连续检测到多个视频（多 tab 场景）** → 每个都会独立上报，SW 的 Map 容量受限（MAX_VIDEO_TASKS=3 仅限活跃任务，存储无限制），风险低。
- **[风险] CS restart（页面刷新）后检测不到已存在的任务** → `loadPersistedTasks` 在 SW 启动时恢复，不受影响。但如果页面上没有正在播放的 YouTube tab，popup 仍看不到。这是现有行为，不在此次修改范围。
- **[风险] `startTranslation` 新增 `cues` 参数，旧版 CS 收到新消息会忽略 `cues`** → 无兼容性问题，旧版 CS 会走现有 `fetchSubtitles` 路径。但本次修改确保 SW 和 CS 同步更新。
- **[Trade-off] 复用 `VIDEO_TASK_PROGRESS` 而非新增消息** → SW handler 中的 `applyTaskToOpenTabs` 和 `notifyComplete` 会在 AVAILABLE 上报时被误触发。需在 handler 中增加状态判断，仅在 COMPLETED 时触发 apply+notify。
