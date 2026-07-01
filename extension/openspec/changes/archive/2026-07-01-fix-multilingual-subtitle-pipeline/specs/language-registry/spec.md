# language-registry (Delta)

## MODIFIED Requirements

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

**Registry level changes:**

| Entry | Field | Old Value | New Value | Reason |
|-------|-------|-----------|-----------|--------|
| `es` | `level` | `"medium"` | `"high"` | Spanish is a pro-drop language; subject pronouns are routinely omitted, requiring more context for accurate translation |
| `it` | `level` | `"medium"` | `"high"` | Italian is a pro-drop language; same reasoning as Spanish |
| `it` | `target` | `false` | `true` | Italian was omitted from the target dropdown; it SHALL appear alongside other European languages |
| `pt` | `level` | `"medium"` | `"medium"` | No change (partial pro-drop; correct at medium) |
| `fr` | `level` | `"low"` | `"medium"` | French is not pro-drop but has complex liaison and elision rules that benefit from context |

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
