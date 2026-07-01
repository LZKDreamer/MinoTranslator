## MODIFIED Requirements

### Requirement: Video status label shows language pair and status in separate elements

The video item in the popup SHALL display the language pair and the translation status as separate DOM elements. The language pair SHALL occupy a dedicated `.video-lang` line. The status text SHALL occupy the existing `.video-status` line. When a task has status `COMPLETED`, the `.video-status` element SHALL be hidden.

#### Scenario: Translating task shows three-line layout

- **WHEN** a task has `status: "translating"`, `sourceLanguage: "ko"`, `targetLanguage: "zh-CN"`
- **THEN** `.video-lang` shows `"한국어 → 简体中文"`
- **AND** `.video-status` shows `"翻译中..."` (visible)

#### Scenario: Completed task hides status line

- **WHEN** a task has `status: "completed"`, `sourceLanguage: "ko"`, `targetLanguage: "zh-CN"`
- **THEN** `.video-lang` shows `"한국어 → 简体中文"`
- **AND** `.video-status` is hidden (`hidden` attribute or `display: none`)

#### Scenario: Canceled task shows only status

- **WHEN** a task has `status: "canceled"`
- **THEN** `.video-lang` is empty or hidden
- **AND** `.video-status` shows `"已取消"`

### Requirement: getStatusLabel returns structured data

The function `getStatusLabel(item)` SHALL return an object `{ lang: string, status: string | null }` instead of a single combined string. Callers SHALL use `lang` to populate `.video-lang` and `status` to populate `.video-status`.

#### Scenario: Available task returns lang and status

- **WHEN** `getStatusLabel({ status: "available", sourceLanguage: "id", targetLanguage: "en" })` is called
- **THEN** it returns `{ lang: "Indonesian → English", status: "可翻译" }`
