## ADDED Requirements

### Requirement: detectSourceLanguage identifies language via Unicode ranges

The system SHALL provide `detectSourceLanguage(text)` in `constants.js` that returns a canonical language code (or `null`) by scanning the input text against a prioritized set of Unicode character ranges. The function MUST NOT make any network or external API calls.

Detection priority (first match wins, checked in order):

| Step | Check | Match |
|------|-------|-------|
| 1 | Contains Hiragana or Katakana | `ja` |
| 2 | Contains Hangul syllables | `ko` |
| 3 | Contains CJK Unified Ideographs | `zh-CN` |
| 4 | Contains Arabic script | `ar` |
| 5 | Contains Thai script | `th` |
| 6 | Contains Cyrillic | `ru` |
| 7 | Latin-dominant (≥60% alphabet chars) | `en` |
| — | No match | `null` |

#### Scenario: Korean text detected

- **WHEN** `detectSourceLanguage("안녕하세요")` is called
- **THEN** it returns `"ko"`

#### Scenario: Korean text with embedded English

- **WHEN** `detectSourceLanguage("이건 AI 번역기입니다")` is called
- **THEN** Hangul is detected before Latin fallback → returns `"ko"`

#### Scenario: Japanese text detected via kana

- **WHEN** `detectSourceLanguage("こんにちは、今日の天気は良いですね")` is called
- **THEN** Hiragana is detected at step 1 → returns `"ja"`

#### Scenario: Chinese text detected

- **WHEN** `detectSourceLanguage("你好世界")` is called
- **THEN** CJK Unified Ideographs detected at step 3 (no kana or hangul) → returns `"zh-CN"`

#### Scenario: English text detected

- **WHEN** `detectSourceLanguage("Hello, this is a translation test.")` is called
- **THEN** no script-specific ranges match; Latin alphabet ratio ≥ 60% → returns `"en"`

#### Scenario: Unrecognizable text

- **WHEN** `detectSourceLanguage("12345 @#$%")` is called
- **THEN** no script ranges match and Latin ratio < 60% → returns `null`

#### Scenario: Empty or whitespace-only input

- **WHEN** `detectSourceLanguage("   ")` or `detectSourceLanguage("")` is called
- **THEN** returns `null`

### Requirement: buildFloatingPrompt accepts sourceLanguage and outputs strengthened prompt

The `buildFloatingPrompt` function SHALL accept an optional `sourceLanguage` parameter and SHALL generate a prompt aligned with the constraint level of `buildBatchTranslatePrompt`. When `sourceLanguage` is provided and resolves to a known language, the prompt SHALL include the "from {source} to {target}" direction. The prompt MUST always include a CRITICAL-level directive requiring output exclusively in the target language.

#### Scenario: Prompt with known source language

- **WHEN** `buildFloatingPrompt({ text: "안녕하세요", targetLanguage: "zh-CN", sourceLanguage: "ko" })` is called
- **THEN** the system prompt SHALL contain "Translate the following text from Korean to natural, accurate Simplified Chinese."
- **AND** the system prompt SHALL contain "CRITICAL — READ THIS FIRST:" block
- **AND** the directive SHALL contain "Output must be in Simplified Chinese ONLY"
- **AND** the directive SHALL contain "NEVER output any Korean text"

#### Scenario: Prompt with unknown source language

- **WHEN** `buildFloatingPrompt({ text: "#$%^", targetLanguage: "zh-CN", sourceLanguage: null })` is called
- **THEN** the system prompt SHALL NOT contain "from X" phrase
- **AND** the system prompt SHALL still contain the CRITICAL directive requiring Simplified Chinese output

#### Scenario: Prompt with English as target

- **WHEN** `buildFloatingPrompt({ text: "안녕하세요", targetLanguage: "en", sourceLanguage: "ko" })` is called
- **THEN** the directive SHALL contain "Output must be in English ONLY"
- **AND** the directive SHALL contain "NEVER output any Korean text"

#### Scenario: Prompt structure mirrors batch translate prompt

- **WHEN** `buildFloatingPrompt` generates a prompt with known sourceLanguage
- **THEN** the CRITICAL block structure SHALL follow the same pattern as `buildBatchTranslatePrompt`:
  - "CRITICAL — READ THIS FIRST:"
  - Output-language-only constraint
  - No-source-language constraint
  - Failure consequence

### Requirement: Translator.translate integrates source language detection

The `Translator.translate()` function in `translator.js` SHALL call `detectSourceLanguage(text)` before building the floating translate prompt and SHALL pass the result to `buildFloatingPrompt`. The detection and prompt building SHALL occur for every translation request, not just cached ones.

#### Scenario: Detection result passed to prompt builder

- **WHEN** `Translator.translate("안녕하세요", modelKey)` is called
- **THEN** `detectSourceLanguage("안녕하세요")` is called and returns `"ko"`
- **AND** `buildFloatingPrompt` is called with `sourceLanguage: "ko"`
- **AND** the resulting prompt includes "from Korean"

#### Scenario: Detection failure does not break translation

- **WHEN** `detectSourceLanguage(text)` returns `null`
- **THEN** `buildFloatingPrompt` is called with `sourceLanguage: null`
- **AND** translation proceeds normally with the CRITICAL directive still in place
