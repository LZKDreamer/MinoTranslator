## Why

用户打开 YouTube 视频后打开 Popup 经常看不到视频，需要等好几秒甚至重新打开才出现；点击翻译按钮后状态闪烁"翻译中 → 准备字幕 → 翻译中"，方向错乱。根因是 Popup、Service Worker、Content Script 三个角色各自往同一个任务状态机写值且时序不同步，加上 Popup 纯 pull 模式导致检测期出现空档。

## What Changes

- 修复翻译任务状态的写入所有权：Service Worker 设置初始 PREPARING，Content Script 不再重复报告 PREPARING，避免状态倒退
- Content Script 检测到视频后主动推送给 Service Worker，消除 Popup 打开时的空档期
- Popup 在首次扫描未完成时显示"正在检测"而非"没有视频"
- Content Script 的 `startTranslation` 利用 Service Worker 已准备好的字幕数据，跳过重复的 `fetchSubtitles` 调用

## Capabilities

### New Capabilities
- `status-state-machine`: 定义翻译任务的状态机及写入所有权——谁在何时可以写哪个状态，禁止状态倒退
- `content-script-video-detection`: Content Script 主动检测视频并上报给 Service Worker，Popup 可以即时获取已检测到的视频

### Modified Capabilities
<!-- 本次不修改已有 spec -->

## Impact

- `src/background/service-worker.js`: START_VIDEO_TASK handler 初始状态改为 PREPARING；将 prepared.cues 传递给 content script；新增 VIDEO_DETECTED 消息处理
- `src/content/youtube.js`: startTranslation 利用已准备的 cues，跳过重复 prepare；不报告 PREPARING；checkForVideo 触发后主动上报 VIDEO_DETECTED
- `src/popup/popup.js`: 首次扫描期间显示"正在检测"loading 状态；增加首次快速轮询
- `src/shared/constants.js`: 可能新增 MESSAGE_TYPE.VIDEO_DETECTED
