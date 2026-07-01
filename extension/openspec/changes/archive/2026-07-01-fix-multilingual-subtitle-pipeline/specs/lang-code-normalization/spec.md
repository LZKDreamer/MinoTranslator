# lang-code-normalization (Delta)

## ADDED Requirements

### Requirement: detectSourceLanguage returns canonical registry keys for Latin languages

The system SHALL extend `detectSourceLanguage()` so that Latin-script European languages (French, Spanish, Italian, German, Portuguese) are detected and returned using their canonical registry keys (`"fr"`, `"es"`, `"it"`, `"de"`, `"pt"`) instead of falling through to `"en"`. Detection SHALL use script-specific diacritic and character patterns. When no non-English Latin language pattern matches and the alpha ratio exceeds 60%, the function SHALL still return `"en"`.

#### Scenario: French text returns fr

- **WHEN** `detectSourceLanguage("C'est très bien")` is called
- **THEN** it returns `"fr"` which is a valid registry key

#### Scenario: Spanish text returns es

- **WHEN** `detectSourceLanguage("¿Cómo estás?")` is called
- **THEN** it returns `"es"` which is a valid registry key

#### Scenario: Italian text returns it

- **WHEN** `detectSourceLanguage("Perché è così")` is called
- **THEN** it returns `"it"` which is a valid registry key

#### Scenario: German text returns de

- **WHEN** `detectSourceLanguage("Grüße aus München")` is called
- **THEN** it returns `"de"` which is a valid registry key

#### Scenario: Portuguese text returns pt

- **WHEN** `detectSourceLanguage("Não é possível")` is called
- **THEN** it returns `"pt"` which is a valid registry key

#### Scenario: Pure English text still returns en

- **WHEN** `detectSourceLanguage("Hello world")` is called
- **THEN** it returns `"en"` (unchanged behavior)

### Requirement: detectSourceLanguage supports per-segment short-text calls

The system SHALL ensure `detectSourceLanguage()` returns correct results for short text segments (as few as 3 words or 10 characters) commonly found in subtitle translation units. Detection heuristics SHALL not degrade on short inputs.

#### Scenario: Three-word Japanese segment detected correctly

- **WHEN** `detectSourceLanguage("いいね。")` is called (3 characters, 1 word)
- **THEN** kana range matches, so it returns `"ja"`

#### Scenario: Three-word English segment detected correctly

- **WHEN** `detectSourceLanguage("I like it.")` is called (9 characters, 3 words, 100% alpha)
- **THEN** alpha ratio > 60%, no diacritics, so it returns `"en"`

#### Scenario: Short Spanish segment detected correctly

- **WHEN** `detectSourceLanguage("¿Qué tal?")` is called
- **THEN** Spanish-specific markers `¿` and `é` are found, so it returns `"es"`

#### Scenario: Very short unclassifiable text returns null

- **WHEN** `detectSourceLanguage("A")` is called (1 character, 100% alpha)
- **THEN** it returns `null` (too short to classify)

## MODIFIED Requirements

### Requirement: resolveToLangCode returns canonical key and entry

The system SHALL provide `resolveToLangCode(code)` as the single entry point for normalizing any language code to its canonical form. It MUST return an object `{ key, entry }` when a match is found, or `null` when no match exists. This function SHALL replace all ad-hoc normalization scattered across the codebase.

The function SHALL correctly resolve French, Spanish, Italian, German, and Portuguese codes and their aliases (e.g. `"fr-FR"`, `"es-419"`, `"it-IT"`, `"de-DE"`, `"pt-BR"`) to their canonical keys. These SHALL NOT resolve to `"en"` — the registry entries for these languages already exist with correct alias arrays.

#### Scenario: Direct registry key match

- **WHEN** `resolveToLangCode("id")` is called
- **THEN** it returns `{ key: "id", entry: LANGUAGE_REGISTRY["id"] }`

#### Scenario: Alias match

- **WHEN** `resolveToLangCode("id-ID")` is called
- **THEN** it matches via `LANGUAGE_REGISTRY["id"].aliases`
- **AND** returns `{ key: "id", entry: LANGUAGE_REGISTRY["id"] }`

#### Scenario: French alias match

- **WHEN** `resolveToLangCode("fr-FR")` is called
- **THEN** it matches via `LANGUAGE_REGISTRY["fr"].aliases`
- **AND** returns `{ key: "fr", entry: LANGUAGE_REGISTRY["fr"] }`
- **AND** the key is NOT `"en"`

#### Scenario: German alias match

- **WHEN** `resolveToLangCode("de-DE")` is called
- **THEN** it returns `{ key: "de", entry: LANGUAGE_REGISTRY["de"] }`

#### Scenario: Case-insensitive match

- **WHEN** `resolveToLangCode("ZH-CN")` is called
- **THEN** it matches via alias `"zh-CN"` (lowercased)
- **AND** returns `{ key: "zh-CN", entry: LANGUAGE_REGISTRY["zh-CN"] }`

#### Scenario: No match

- **WHEN** `resolveToLangCode("xx")` is called and no registry entry or alias matches
- **THEN** it returns `null`

#### Scenario: Null input

- **WHEN** `resolveToLangCode(null)` or `resolveToLangCode("")` is called
- **THEN** it returns `null`
