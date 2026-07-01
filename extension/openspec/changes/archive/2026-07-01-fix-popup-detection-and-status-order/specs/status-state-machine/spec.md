## ADDED Requirements

### Requirement: 翻译任务状态转换顺序

系统 SHALL 保证翻译任务的状态按照以下有限状态机转换，禁止状态倒退（即不允许从 TRANSLATING 回到 PREPARING，或从 COMPLETED 回到任何前置状态）。

```
(不存在) ──(CS)──▶ AVAILABLE ──(SW)──▶ PREPARING ──(CS)──▶ TRANSLATING ──(CS)──▶ COMPLETED
                                          │                      │
                                          └──(CS/SW)──▶ CANCELED│
                                                                 └──(CS)──▶ FAILED
```

每个转换的写入者 SHALL 唯一：
- (不存在) → AVAILABLE: Content Script (via VIDEO_TASK_PROGRESS)
- AVAILABLE → PREPARING: Service Worker (via START_VIDEO_TASK handler)
- PREPARING → TRANSLATING: Content Script
- TRANSLATING → COMPLETED: Content Script (所有 batch 翻译完成)
- 任意状态 → FAILED: Content Script (翻译出错)
- 任意状态 → CANCELED: Content Script (取消翻译) 或 Service Worker (用户取消/任务超时清理)

Service Worker 的 `START_VIDEO_TASK` handler 在完成 `PREPARE_VIDEO_TRANSLATION` 后 MUST 创建状态为 `STATUS.PREPARING` 的任务，而非 `STATUS.TRANSLATING`。

Content Script 的 `startTranslation` 在收到 `START_SUBTITLE_TRANSLATION` 后 SHALL NOT 报告 PREPARING 状态。它 SHALL 在初始化 renderer 后直接报告 TRANSLATING。

#### Scenario: 用户点击翻译 — 状态单向推进

- **WHEN** 用户在有字幕的 YouTube 视频页点击"翻译"按钮
- **THEN** Popup 显示的状态顺序 SHALL 为: "准备字幕" → "翻译中" → (完成时显示"打开"按钮)
- **AND** Popup 永远不会显示 "翻译中" 之后又出现 "准备字幕"

#### Scenario: 翻译中取消 — 直接到取消

- **WHEN** 用户在翻译进行中点击"取消"按钮
- **THEN** 状态 SHALL 从 TRANSLATING 直接变为 CANCELED
- **AND** 不会经过 PREPARING 或 COMPLETED

#### Scenario: 翻译失败 — 直接到失败

- **WHEN** 翻译过程中发生网络错误或 API 返回错误
- **THEN** 状态 SHALL 从 TRANSLATING 直接变为 FAILED
- **AND** Popup 显示"失败"状态和重试按钮

### Requirement: Service Worker 初始状态为 PREPARING

Service Worker 的 `START_VIDEO_TASK` 消息处理器 SHALL 在 `PREPARE_VIDEO_TRANSLATION` 成功返回后，创建任务时设置 `status = STATUS.PREPARING`，随后异步发送 `START_SUBTITLE_TRANSLATION`。

发送给 Content Script 的 `START_SUBTITLE_TRANSLATION` 消息 MUST 包含已准备好的 `cues`、`sourceLanguage` 和 `videoTitle` 字段，避免 Content Script 重复获取字幕。

#### Scenario: START_VIDEO_TASK 创建 PREPARING 任务

- **WHEN** Service Worker 收到 `START_VIDEO_TASK` 且 `PREPARE_VIDEO_TRANSLATION` 成功返回
- **THEN** 创建的 task 对象 SHALL 有 `status === STATUS.PREPARING`
- **AND** `START_SUBTITLE_TRANSLATION` 消息 SHALL 包含 `cues`、`sourceLanguage`、`videoTitle` 字段

#### Scenario: Content Script 收到 cues 后跳过重复获取

- **WHEN** Content Script 收到 `START_SUBTITLE_TRANSLATION` 且 `request.cues` 非空
- **THEN** `startTranslation` SHALL 使用传入的 `cues` 初始化 renderer
- **AND** SHALL NOT 调用 `fetchSubtitles`

### Requirement: Popup 正确显示当前状态

Popup 的 `getStatusLabel` 和渲染逻辑 SHALL 正确映射每个状态到对应的 i18n 文本：

| 状态 | i18n key | 默认文本 |
|------|----------|---------|
| AVAILABLE | `popup.statusAvailable` | "可翻译" |
| PREPARING | `popup.statusPreparing` | "准备字幕" |
| TRANSLATING | `popup.statusTranslating` | "翻译中..." |
| COMPLETED | (无，显示"打开"按钮) | |
| FAILED | `popup.statusFailed` | "失败" |
| CANCELED | `popup.statusCanceled` | "已取消" |

#### Scenario: AVAILABLE 状态显示可翻译

- **WHEN** 任务状态为 `STATUS.AVAILABLE`
- **THEN** 按钮显示"翻译"文案
- **AND** 状态文字显示"可翻译"

#### Scenario: TRANSLATING 状态显示翻译中

- **WHEN** 任务状态为 `STATUS.TRANSLATING`
- **THEN** 按钮显示"取消"文案
- **AND** 状态文字显示"翻译中..."
- **AND** 进度环为 indeterminate 动画

#### Scenario: FAILED 状态显示失败和重试

- **WHEN** 任务状态为 `STATUS.FAILED`
- **THEN** 按钮显示"重试"文案
- **AND** 状态文字显示"失败"
- **AND** 状态文字有 `is-error` 样式
