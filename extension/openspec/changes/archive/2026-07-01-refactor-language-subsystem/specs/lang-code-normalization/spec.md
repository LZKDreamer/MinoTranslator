## ADDED Requirements

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

### Requirement: findRegistryEntry and findRegistryKeyByEntry are removed

`findRegistryEntry()` and `findRegistryKeyByEntry()` SHALL be removed. `resolveToLangCode(code)` SHALL be the only lookup function used by external callers. The registry entry's `key` field SHALL provide O(1) canonical key access.

#### Scenario: getLangName uses resolveToLangCode

- **WHEN** `getLangName("id-ID")` is called
- **THEN** it calls `resolveToLangCode("id-ID")` → `{ key: "id", entry: ... }`
- **AND** returns `entry.name` → `"Indonesian"`

#### Scenario: normalizeLanguageCode replaced by resolveToLangCode

- **WHEN** `findTrackByLang(tracks, "id-ID")` is called (youtube-subtitles.js)
- **THEN** the normalization uses `resolveToLangCode("id-ID").key` → `"id"` for comparison
- **AND** falls back to `String(lang).split(/[-_]/)[0]` when `resolveToLangCode` returns null

### Requirement: Registry entries have a key field

Every entry in `LANGUAGE_REGISTRY` SHALL include a `key` property whose value equals the object's own key in the registry. This eliminates the need for `findRegistryKeyByEntry()`.

#### Scenario: Access canonical key from entry

- **WHEN** `LANGUAGE_REGISTRY["id"]` is accessed
- **THEN** `entry.key` equals `"id"`
