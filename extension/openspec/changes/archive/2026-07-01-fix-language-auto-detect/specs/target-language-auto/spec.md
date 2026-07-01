## ADDED Requirements

### Requirement: Target language dropdown includes auto option

The target language dropdown (in both popup and options page) SHALL include `auto` as the first option with the label key `"sourceLang.auto"`. When `auto` is the effective value, the dropdown's collapsed display SHALL show the resolved language name (e.g. `"English"`, `"简体中文"`), not the literal string "自动检测".

#### Scenario: Default auto state displays resolved language

- **WHEN** no user-set target language exists and `resolveLanguage()` returns `"zh-CN"`
- **THEN** the target language dropdown shows `"简体中文"` in its collapsed state
- **AND** `state.targetLanguage` stores `"auto"`
- **AND** the dropdown option list includes `"自动跟随 · 简体中文"` as the first (auto) option

#### Scenario: User selects a specific language

- **WHEN** user picks `"日本語"` from the target dropdown
- **THEN** the dropdown collapsed state shows `"日本語"`
- **AND** `state.targetLanguage` stores `"ja"`
- **AND** translation uses `"ja"` as the target

#### Scenario: User switches back to auto from a specific language

- **WHEN** user had selected `"ja"` and now picks the auto option
- **THEN** the dropdown collapsed state shows the resolved language (e.g. `"简体中文"`)
- **AND** `state.targetLanguage` stores `"auto"`
- **AND** translation uses the dynamically resolved language

#### Scenario: Settings change persists across sessions

- **WHEN** user sets target language to `"auto"` and closes the extension
- **THEN** `chrome.storage.sync` contains `targetLanguage: "auto"`
- **AND** on next popup open, the dropdown shows the resolved value for the current environment

### Requirement: Source language is read-only auto-detect

The source language SHALL always be auto-detected from the video's subtitle track. No dropdown to select a source language SHALL exist in the popup or options page.

#### Scenario: Popup shows detected source language

- **WHEN** user opens popup on an Indonesian YouTube video whose audio track is `id`
- **THEN** the source language area displays `印尼语` (or `Indonesian` if no i18n label exists)
- **AND** it is a read-only label, not a `<select>` element

#### Scenario: Options page shows auto-detect description

- **WHEN** user opens the options page
- **THEN** the source language section displays a static description: `自动识别（根据视频音轨自动检测）` (or equivalent English)
- **AND** no interactive control exists for source language selection

#### Scenario: Previously stored sourceLanguage is ignored

- **WHEN** a user previously had `sourceLanguage: "ko"` stored in `chrome.storage.sync`
- **THEN** after this change, source language detection always uses auto mode
- **AND** `settings.sourceLanguage` in `loadSettings()` is forced to `"auto"`

### Requirement: Video status label shows human-readable language names

The status label on each video task item (popup list) SHALL use `getDisplayLangName()` to render source and target languages. This applies to ALL statuses: `AVAILABLE`, `PREPARING`, `TRANSLATING`, `COMPLETED`, and `FAILED`.

#### Scenario: Available task shows auto-detected languages

- **WHEN** a video task has `status: "available"`, `sourceLanguage: "id"`, `targetLanguage: "auto"` (resolved to `"en"`)
- **THEN** the status label shows `Indonesian → English · 可翻译`

#### Scenario: Completed task shows localized language names

- **WHEN** a completed task has `sourceLanguage: "ko"`, `targetLanguage: "zh-CN"`
- **THEN** the status label shows `한국어 → 简体中文`

#### Scenario: Translating task shows language pair

- **WHEN** a task has `status: "translating"`, `sourceLanguage: "ja"`, `targetLanguage: "en"`
- **THEN** the status label shows `日本語 → English · 翻译中...`
