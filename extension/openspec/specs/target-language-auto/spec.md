# target-language-auto

Auto-detection and display of source/target languages with transparent UI.

## Requirements

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

### Requirement: Source language display shows "auto-detect" when no video

The source language display SHALL show the localized "auto-detect" label when no active video is detected. It SHALL only show a detected language name when a task with status `AVAILABLE`, `PREPARING`, or `TRANSLATING` exists. COMPLETED and FAILED tasks SHALL NOT affect the source language display.

#### Scenario: No active video — shows auto-detect

- **WHEN** no video tasks exist OR all tasks have status `COMPLETED`
- **THEN** the source language display shows the i18n label for `"sourceLang.auto"` (e.g. "自动检测")
- **AND** does NOT show a language name from historical tasks

#### Scenario: Active video detected — shows language

- **WHEN** a task has `status: "available"` and `sourceLanguage: "id"`
- **THEN** the source language display shows `"Indonesian"` (via `getDisplayLangName`)

#### Scenario: Multiple tasks, only COMPLETED ones — shows auto-detect

- **WHEN** the task list contains only `COMPLETED` tasks with `sourceLanguage: "ko"`
- **THEN** the source language display shows "自动检测", not "Korean"

### Requirement: Shared target language rendering functions

The functions `resolveTargetValue(storedValue)` and `buildTargetLangSelect($select, tFn)` SHALL be defined in `constants.js` and used by both `popup.js` and `options.js` for target language dropdown rendering. Neither popup nor options SHALL implement their own duplicate versions.

#### Scenario: Popup renders target dropdown via shared function

- **WHEN** popup calls `renderLanguageSelects()`
- **THEN** it delegates to `buildTargetLangSelect($targetLang, t)` from constants.js

#### Scenario: Options renders target dropdown via shared function

- **WHEN** options calls `renderLanguageSelects()`
- **THEN** it delegates to `buildTargetLangSelect($targetLanguage, t)` from constants.js

#### Scenario: resolveTargetValue resolves auto

- **WHEN** `resolveTargetValue("auto")` is called
- **THEN** it returns `resolveLanguage()` (the resolved browser/YouTube language)

#### Scenario: resolveTargetValue returns fixed value

- **WHEN** `resolveTargetValue("ja")` is called
- **THEN** it returns `"ja"`

### Requirement: isSameLanguage uses registry comparison

The `isSameLanguage(source, target)` function in `youtube.js` SHALL use `resolveToLangCode()` to compare canonical keys, eliminating the hardcoded `normalizeLanguage()` function. When a code cannot be resolved via registry, the primary language part (split by `-`) SHALL be used as fallback.

#### Scenario: Same language via aliases

- **WHEN** `isSameLanguage("zh", "zh-CN")` is called
- **THEN** `resolveToLangCode("zh")` finds `"zh"` in `"zh-CN".aliases` → key = `"zh-CN"`
- **AND** both resolve to `"zh-CN"` → returns `true`

#### Scenario: Different languages

- **WHEN** `isSameLanguage("id", "zh-CN")` is called
- **THEN** source key = `"id"`, target key = `"zh-CN"` → returns `false`

#### Scenario: Unknown code falls back to primary part

- **WHEN** `isSameLanguage("xx-YY", "xx")` is called and `"xx"` is not in the registry
- **THEN** both resolve to `"xx"` via split → returns `true`
