# language-registry

Data-driven language metadata registry as single source of truth for all language-related functions.

## Requirements

### Requirement: LANGUAGE_REGISTRY as single source of truth

The system SHALL define a `LANGUAGE_REGISTRY` object as the sole source of all language metadata. Every function that needs language names, levels, or availability MUST query this registry—no hardcoded if-ladders or array literals.

Each entry key is the canonical language code. Each value SHALL contain:

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | The canonical language code (same as the registry key). Used for O(1) reverse lookup. |
| `name` | string | English human-readable name (e.g. `"Indonesian"`). Used as display fallback when no i18n label exists. |
| `level` | `"high"`\|`"medium"`\|`"low"`\|`null` | Context-dependence tier for subtitle translation. `null` for non-language entries like `auto`. |
| `source` | boolean | Whether this language can appear as a detected source language. |
| `target` | boolean | Whether this language can be selected as a translation target. |
| `isAuto` | boolean | `true` only for the `auto` pseudo-language entry. |
| `i18nKey` | string\|null | Key into the i18n `sourceLang.*` namespace, or `null` if no localized label exists. |
| `aliases` | string[] | Array of alternate language codes that normalise to this entry (e.g. `["en", "en-US", "en-GB", "english"]` for `"en"`). |

#### Scenario: getLangName resolves known code

- **WHEN** `getLangName("id")` is called
- **THEN** it returns `"Indonesian"` by reading `LANGUAGE_REGISTRY["id"].name`

#### Scenario: getLangName resolves aliased code

- **WHEN** `getLangName("id-ID")` is called
- **THEN** it matches via `LANGUAGE_REGISTRY["id"].aliases` and returns `"Indonesian"`

#### Scenario: getLangName falls back for unknown code

- **WHEN** `getLangName("xx")` is called and no registry entry or alias matches
- **THEN** it returns the raw code `"xx"`

#### Scenario: getLanguageLevel resolves level

- **WHEN** `getLanguageLevel("id")` is called
- **THEN** it returns `"medium"` from `LANGUAGE_REGISTRY["id"].level`

#### Scenario: getLanguageLevel returns medium for unknown code

- **WHEN** `getLanguageLevel("xx")` is called and no registry entry matches
- **THEN** it returns `"medium"` (safe fallback)

#### Scenario: Entry key field equals registry key

- **WHEN** `LANGUAGE_REGISTRY["id"]` is accessed
- **THEN** `entry.key` equals `"id"`

#### Scenario: resolveToLangCode resolves aliased code

- **WHEN** `resolveToLangCode("id-ID")` is called
- **THEN** it matches via `LANGUAGE_REGISTRY["id"].aliases` and returns `{ key: "id", entry: ... }`

#### Scenario: getLanguageLevel resolves Spanish as high

- **WHEN** `getLanguageLevel("es")` is called
- **THEN** it returns `"high"`

#### Scenario: getLanguageLevel resolves Italian as high

- **WHEN** `getLanguageLevel("it")` is called
- **THEN** it returns `"high"`

#### Scenario: Italian appears in target language dropdown

- **WHEN** `buildTargetLanguages()` is called
- **THEN** the result includes an entry for `"it"` with `value: "it"`

#### Scenario: getLanguageLevel resolves French as medium

- **WHEN** `getLanguageLevel("fr")` is called
- **THEN** it returns `"medium"`

#### Scenario: Existing level assignments unchanged

- **WHEN** `getLanguageLevel("ja")`, `getLanguageLevel("ko")`, `getLanguageLevel("zh-CN")`, `getLanguageLevel("zh-TW")`, `getLanguageLevel("th")`, `getLanguageLevel("vi")`, `getLanguageLevel("fil")` are called
- **THEN** all return `"high"` (unchanged)

### Requirement: Registry-driven target language list

The target language dropdown list SHALL be generated from `LANGUAGE_REGISTRY` entries where `target: true`. The first option SHALL be the `auto` entry. The function `buildTargetLanguages()` MUST produce the array.

#### Scenario: Build target language list

- **WHEN** `buildTargetLanguages()` is called
- **THEN** the first element is `{ value: "auto", i18nKey: "sourceLang.auto", name: "Auto-detect" }`
- **AND** subsequent elements include all non-auto entries with `target: true` (e.g. `"zh-CN"`, `"en"`, `"ja"`, `"ko"`)

#### Scenario: Language without i18n tag is still included

- **WHEN** a registry entry has `target: true` but `i18nKey: null`
- **THEN** the generated item has `i18nKey: null` and `name` set to the entry's English name

### Requirement: resolveLanguage uses registry aliases

`resolveLanguage(raw)` SHALL match the input against registry aliases to find the canonical code. It SHALL only return entries where `target: true`. The priority is: browser `navigator.language`, then YouTube page `<html lang>`, then fallback `"en"`.

#### Scenario: Resolve browser language

- **WHEN** `resolveLanguage()` is called with browser language `"id-ID"`
- **THEN** `"id-ID"` does not match directly, but `"id"` matches `LANGUAGE_REGISTRY["id"].aliases`
- **AND** since `LANGUAGE_REGISTRY["id"].target` is `false`, the lookup continues to the next candidate
- **AND** eventually returns `"en"` (fallback) because no Indonesian target entry matches

#### Scenario: Resolve supported browser language

- **WHEN** `resolveLanguage()` is called with browser language `"zh-CN"`
- **THEN** `"zh-CN"` is a direct registry key with `target: true`
- **AND** returns `"zh-CN"`

#### Scenario: Resolve with explicit raw argument

- **WHEN** `resolveLanguage("ja")` is called
- **THEN** `"ja"` is a direct registry key with `target: true`
- **AND** returns `"ja"`

### Requirement: getDisplayLangName provides human-readable display

The function `getDisplayLangName(code, tFn)` SHALL return a human-readable language name for UI display. If the registry entry has an `i18nKey`, it SHALL call `tFn(i18nKey)` to get the localized name. Otherwise it SHALL return `entry.name`.

#### Scenario: Display with i18n label

- **WHEN** `getDisplayLangName("ko", t)` is called and `t("sourceLang.ko")` returns `"한국어"`
- **THEN** returns `"한국어"`

#### Scenario: Display without i18n label (fallback to name)

- **WHEN** `getDisplayLangName("id", t)` is called and `LANGUAGE_REGISTRY["id"].i18nKey` is `null`
- **THEN** returns `"Indonesian"` (the `name` field)
