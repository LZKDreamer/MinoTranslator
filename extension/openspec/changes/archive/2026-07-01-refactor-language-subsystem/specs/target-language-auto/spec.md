## MODIFIED Requirements

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
