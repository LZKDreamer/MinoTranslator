# target-language-auto (Delta)

## MODIFIED Requirements

### Requirement: isSameLanguage uses registry comparison

The `isSameLanguage(source, target)` function in `youtube.js` SHALL use `resolveToLangCode()` to compare canonical keys, eliminating the hardcoded `normalizeLanguage()` function. When a code cannot be resolved via registry, the primary language part (split by `-`) SHALL be used as fallback.

The system SHALL also provide `isSegmentSameLanguage(text, targetLang)` that detects whether a given text segment's script matches the target language, using `detectSourceLanguage()` followed by `resolveToLangCode()` comparison. This enables per-segment skip logic in `batchTranslateSentences()`.

#### Scenario: Same language via aliases

- **WHEN** `isSameLanguage("zh", "zh-CN")` is called
- **THEN** `resolveToLangCode("zh")` finds `"zh"` in `"zh-CN".aliases` → key = `"zh-CN"`
- **AND** both resolve to `"zh-CN"` → returns `true`

#### Scenario: Different languages

- **WHEN** `isSameLanguage("id", "zh-CN")` is called
- **THEN** source key = `"id"`, target key = `"zh-CN"` → returns `false`

#### Scenario: French is not English

- **WHEN** `isSameLanguage("fr", "en")` or `isSameLanguage("es", "en")` or `isSameLanguage("it", "en")` or `isSameLanguage("de", "en")` or `isSameLanguage("pt", "en")` is called
- **THEN** source and target resolve to different canonical keys → returns `false`

#### Scenario: Unknown code falls back to primary part

- **WHEN** `isSameLanguage("xx-YY", "xx")` is called and `"xx"` is not in the registry
- **THEN** both resolve to `"xx"` via split → returns `true`

#### Scenario: Segment-level detection of Chinese text with Chinese target

- **WHEN** `isSegmentSameLanguage("活的有什麼推薦嗎?", "zh-CN")` is called
- **THEN** `detectSourceLanguage("活的有什麼推薦嗎?")` returns `"zh-CN"`
- **AND** `resolveToLangCode("zh-CN").key === "zh-CN"` → returns `true`

#### Scenario: Segment-level detection of Japanese text with Chinese target

- **WHEN** `isSegmentSameLanguage("こんにちは", "zh-CN")` is called
- **THEN** `detectSourceLanguage("こんにちは")` returns `"ja"`
- **AND** `"ja" !== "zh-CN"` → returns `false`

#### Scenario: Segment-level detection of Spanish text with English target

- **WHEN** `isSegmentSameLanguage("¿Cómo estás?", "en")` is called
- **THEN** `detectSourceLanguage("¿Cómo estás?")` returns `"es"` (not `"en"`)
- **AND** `"es" !== "en"` → returns `false` (correct — the text is Spanish, not English)

#### Scenario: Segment-level detection of English text with English target

- **WHEN** `isSegmentSameLanguage("Hello, how are you?", "en")` is called
- **THEN** `detectSourceLanguage("Hello, how are you?")` returns `"en"`
- **AND** `"en" === "en"` → returns `true` (skip translation)

#### Scenario: Non-classifiable text defaults to false (do not skip)

- **WHEN** `isSegmentSameLanguage("12345", "zh-CN")` is called
- **THEN** `detectSourceLanguage("12345")` returns `null`
- **AND** `null` cannot match any language → returns `false`

## ADDED Requirements

### Requirement: Floating translate skips text already in target language per character script

The floating translate logic in `service-worker.js` SHALL use `detectSourceLanguage()` (which now distinguishes Latin European languages from English) to determine whether to skip a floating translate request. When the detected source script matches the target language, the request SHALL be skipped and the original text returned.

#### Scenario: French text not skipped when target is English

- **WHEN** target language is `"en"` and floating translate receives `"Bonjour, comment allez-vous?"`
- **THEN** `detectSourceLanguage` returns `"fr"` (not `"en"`)
- **AND** the text is sent to AI for French→English translation (not skipped)

#### Scenario: English text skipped when target is English

- **WHEN** target language is `"en"` and floating translate receives `"Hello, how are you?"`
- **THEN** `detectSourceLanguage` returns `"en"` or text passes the all-ASCII check
- **AND** the request is skipped (text is already in English)

#### Scenario: Spanish text skipped when target is Spanish

- **WHEN** target language is `"es"` and floating translate receives `"¿Cómo estás?"`
- **THEN** `detectSourceLanguage` returns `"es"`
- **AND** the request is skipped (text is already in Spanish)
