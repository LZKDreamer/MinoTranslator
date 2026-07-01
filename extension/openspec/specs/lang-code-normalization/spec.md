# lang-code-normalization

Unified language code normalization function replacing ad-hoc normalization across the codebase.

## Requirements

### Requirement: resolveToLangCode returns canonical key and entry

The system SHALL provide `resolveToLangCode(code)` as the single entry point for normalizing any language code to its canonical form. It MUST return an object `{ key, entry }` when a match is found, or `null` when no match exists. This function SHALL replace all ad-hoc normalization scattered across the codebase.

#### Scenario: Direct registry key match

- **WHEN** `resolveToLangCode("id")` is called
- **THEN** it returns `{ key: "id", entry: LANGUAGE_REGISTRY["id"] }`

#### Scenario: Alias match

- **WHEN** `resolveToLangCode("id-ID")` is called
- **THEN** it matches via `LANGUAGE_REGISTRY["id"].aliases`
- **AND** returns `{ key: "id", entry: LANGUAGE_REGISTRY["id"] }`

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

### Requirement: Registry entries have a key field

Every entry in `LANGUAGE_REGISTRY` SHALL include a `key` property whose value equals the object's own key in the registry. This eliminates the need for `findRegistryKeyByEntry()`.

#### Scenario: Access canonical key from entry

- **WHEN** `LANGUAGE_REGISTRY["id"]` is accessed
- **THEN** `entry.key` equals `"id"`
