## Context

`getVideoTasks` 返回的 items 中，活跃任务（非 COMPLETED）未排序，按 Map 插入顺序（即首次检测到的先后）排列。用户最后打开的页面应该在列表最前。

## Goals / Non-Goals

**Goals:**
- 最后交互的视频排在列表最前
- 切换到某个视频 tab 后，popup 轮询能识别并更新排序

**Non-Goals:**
- 已完成任务排序不变（已按 `updatedAt` 降序）

## Decisions

### 决策：AVAILABLE 命中时刷新 `updatedAt`

在 `getVideoTasks` 遍历当前打开 tab 时，若发现已有的 AVAILABLE 任务匹配，更新 `updatedAt = Date.now()`。这样当前打开的视频每次 popup 轮询都被标记为"最近交互"。

两处 AVAILABLE 匹配均需更新：
- 精确 key 匹配: `existing.status === STATUS.AVAILABLE`
- 跨 targetLanguage 匹配: `availableTask`

### 决策：活跃任务按 `updatedAt` 降序

```js
const active = tasks
  .filter(t => t.status !== STATUS.COMPLETED)
  .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
```

## Risks / Trade-offs

- **[风险] 多个 tab 同时打开时，popup 每次轮询会刷新所有 AVAILABLE 任务的 updatedAt** → 同一轮次内多个视频 `updatedAt` 几乎相同，排序退化为不稳定排序。实际影响小：用户关注的是刚操作的视频，不会频繁同时切换多个 tab。
