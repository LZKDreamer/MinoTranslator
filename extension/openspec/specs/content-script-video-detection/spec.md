# Content Script Video Detection

## Purpose

TBD

## Requirements

### Requirement: Content Script 主动上报视频检测结果

Content Script 在 YouTube 页面上检测到有效视频（URL 中有 videoId 且字幕可用）后，SHALL 通过 `VIDEO_TASK_PROGRESS` 消息主动向 Service Worker 报告检测结果，包括 videoId、title、sourceLanguage、thumbnailUrl 和 `status: STATUS.AVAILABLE`。

上报 MUST 在以下时机触发：
1. `checkForVideo()` 检测到新 videoId（通过 MutationObserver 或 yt-navigate-finish 事件）
2. `quickDetectSubtitles()` 返回 `available: true`

如果 `quickDetectSubtitles` 返回 `available: false`，SHALL NOT 上报（该视频无可翻译字幕）。

Service Worker 收到 AVAILABLE 上报后 SHALL 将该任务存入 `videoTasks` Map 并持久化，但不触发 `applyTaskToOpenTabs` 或 `notifyComplete`（这些仅在 COMPLETED 时触发）。

#### Scenario: 用户打开 YouTube 视频，Content Script 自动上报

- **WHEN** 用户导航到有字幕的 YouTube 视频页
- **AND** Content Script 的 `checkForVideo()` 检测到 videoId
- **AND** `quickDetectSubtitles()` 返回 `{ available: true, language: "en" }`
- **THEN** Content Script SHALL 发送 `VIDEO_TASK_PROGRESS` 消息
- **AND** 消息 payload 包含 `{ videoId, title, sourceLanguage: "en", status: STATUS.AVAILABLE }`
- **AND** Service Worker 的 `videoTasks` Map 包含该任务

#### Scenario: 视频无字幕不上报

- **WHEN** 用户导航到无字幕的 YouTube 视频页
- **AND** `quickDetectSubtitles()` 返回 `{ available: false }`
- **THEN** Content Script SHALL NOT 发送 AVAILABLE 上报
- **AND** Service Worker 的 `videoTasks` Map 不包含该视频任务

#### Scenario: SPA 导航切换视频后上报新视频

- **WHEN** 用户在 YouTube SPA 内从视频 A 导航到视频 B
- **AND** `yt-navigate-finish` 事件触发 `checkForVideo()` 检测到新 videoId
- **AND** `quickDetectSubtitles()` 返回 `available: true`
- **THEN** Content Script SHALL 上报视频 B 的检测结果
- **AND** Service Worker 中视频 B 的任务状态为 AVAILABLE

#### Scenario: AVAILABLE 状态不触发完成通知

- **WHEN** Service Worker 收到 `VIDEO_TASK_PROGRESS` 且 `status === STATUS.AVAILABLE`
- **THEN** SHALL NOT 调用 `applyTaskToOpenTabs`
- **AND** SHALL NOT 调用 `notifyComplete`

### Requirement: Popup 首次扫描期间显示 loading 而非 empty

Popup 在首次打开时、问卷盘为空的时间窗口内，SHALL 显示"正在扫描视频···"loading 状态（复用已有 `renderLoading()`），而非立即显示"打开有字幕的 YouTube 视频···"empty 状态。

首次扫描 SHALL 定义为：从 Popup 打开起的 6 秒内（约 4 次轮询），或直到首次拿到非空视频列表（以先发生者为准）。首次扫描结束后，若仍无视频则显示 empty 状态。

#### Scenario: Popup 刚打开时正在扫描视频

- **WHEN** Popup 打开，`refreshVideos` 返回空列表
- **AND** 首次扫描尚未完成（距打开不到 6 秒）
- **THEN** Popup SHALL 显示 loading 动画及 "正在扫描视频···" 文案
- **AND** SHALL NOT 显示 "打开有字幕的 YouTube 视频···" empty 状态

#### Scenario: 扫描期内检测到视频

- **WHEN** Popup 打开后第 2 次轮询（3 秒后）拿到非空视频列表
- **THEN** Popup SHALL 立即切换到视频列表渲染
- **AND** 扫描标记为完成

#### Scenario: 扫描超时后仍无视频

- **WHEN** Popup 打开后持续 6 秒内每次轮询都返回空列表
- **THEN** Popup SHALL 停止显示 loading
- **AND** 显示 "打开有字幕的 YouTube 视频···" empty 状态
