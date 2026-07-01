## Why

Popup 视频列表用 Map 插入顺序排列，最先打开的排在前面。用户依次打开印尼语→韩语→英语三个视频，切换到英语标签页时，列表和源语言显示仍然是印尼语。需改为按最近交互时间排序，最后操作的视频排最前。

## What Changes

- `GET_VIDEO_TASKS` 中 AVAILABLE 任务命中时更新 `updatedAt`，确保当前打开的视频被标记为"最近"
- 活跃任务（非 COMPLETED）按 `updatedAt` 降序排列

## Capabilities

### New Capabilities
- `task-list-sorting`: 视频任务列表排序规则，活跃任务按最近更新时间降序

### Modified Capabilities
<!-- 无 -->

## Impact

- `src/background/service-worker.js`: `getVideoTasks` 中 AVAILABLE 匹配块增加 `updatedAt` 更新；items 构建时活跃任务排序
