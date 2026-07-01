## ADDED Requirements

### Requirement: 活跃任务按最近更新时间降序排列

`getVideoTasks` 返回的 items 中，状态不为 COMPLETED 的活跃任务 SHALL 按 `updatedAt` 降序排列（最近更新的排最前）。已完成任务（COMPLETED）的排序规则不变。

当遍历当前打开的 YouTube tab 并匹配到 AVAILABLE 任务时，MUST 更新该任务的 `updatedAt` 为当前时间戳。

#### Scenario: 依次打开多个视频后列表排序

- **WHEN** 用户依次打开印尼语视频、韩语视频、英语视频
- **AND** popup 轮询后返回视频列表
- **THEN** 英语视频 SHALL 排在最前（最近检测）
- **AND** 韩语视频 SHALL 排在第二
- **AND** 印尼语视频 SHALL 排在最后

#### Scenario: 切换到已存在的视频 tab 后排序更新

- **WHEN** 用户已打开多个视频，切换到较早打开的印尼语视频 tab
- **AND** popup 轮询
- **THEN** 印尼语视频的 `updatedAt` SHALL 被更新为当前时间
- **AND** 印尼语视频 SHALL 排在最前

#### Scenario: 源语言显示随排序更新

- **WHEN** 列表首项为英语视频（`sourceLanguage: "en"`）
- **THEN** Popup 源语言显示 SHALL 为"英语"
