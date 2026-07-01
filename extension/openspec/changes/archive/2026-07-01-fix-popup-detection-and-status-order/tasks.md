## 1. P0: 修复翻译状态顺序

- [x] 1.1 Service Worker: START_VIDEO_TASK 中 task status 改为 STATUS.PREPARING (`service-worker.js:140`)
- [x] 1.2 Service Worker: START_SUBTITLE_TRANSLATION 消息增加 cues、sourceLanguage、videoTitle 字段 (`service-worker.js:153-156`)
- [x] 1.3 Content Script: startTranslation 检测到 request.cues 非空时跳过 fetchSubtitles，直接用传入 cues 初始化 renderer (`youtube.js:191-215`)
- [x] 1.4 Content Script: startTranslation 收到 PREPARING 状态的 cues 后直接报告 TRANSLATING，不报告 PREPARING (`youtube.js:207`)
- [x] 1.5 确认 Popup 的 getStatusLabel 和 getActionForStatus 对 PREPARING 状态的映射正确（无需改动，验证即可）

## 2. P1: Content Script 主动上报视频检测

- [x] 2.1 Content Script: checkForVideo 检测到新 videoId 后，调用 quickDetectSubtitles 快速确认字幕 (`youtube.js:108-126`)
- [x] 2.2 Content Script: quickDetectSubtitles 返回 available=true 时，reportTask 上报 AVAILABLE 状态 (`youtube.js:436-448`)
- [x] 2.3 Service Worker: VIDEO_TASK_PROGRESS handler 增加状态判断——仅在 COMPLETED 时触发 applyTaskToOpenTabs 和 notifyComplete，AVAILABLE 时不触发 (`service-worker.js:193-215`)
- [x] 2.4 GET_VIDEO_TASKS 增加 AVAILABLE 任务匹配，跳过重复 DETECT 调用 (`service-worker.js:390-416`)

## 3. P2: Popup 首次扫描 loading 状态

- [x] 3.1 Popup: 添加 `initialScanStartTime` 状态变量，init 时记录 (`popup.js:54-57`)
- [x] 3.2 Popup: refreshVideos 在首次扫描期内（距 init 不到 6 秒）且 items 为空时，不调用 renderEmpty，继续显示 renderLoading (`popup.js:294-323`)
- [x] 3.3 Popup: 首次拿到非空 items 后标记扫描完成，后续空结果正常显示 empty (`popup.js:318-323`)
- [x] 3.4 Popup: 扫描超时（6 秒）后标记完成，空结果显示 empty
