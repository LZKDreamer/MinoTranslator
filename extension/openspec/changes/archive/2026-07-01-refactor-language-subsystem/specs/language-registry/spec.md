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

#### Scenario: Entry key field equals registry key

- **WHEN** `LANGUAGE_REGISTRY["id"]` is accessed
- **THEN** `entry.key` equals `"id"`

#### Scenario: resolveToLangCode resolves aliased code

- **WHEN** `resolveToLangCode("id-ID")` is called
- **THEN** it matches via `LANGUAGE_REGISTRY["id"].aliases` and returns `{ key: "id", entry: ... }`

## REMOVED Requirements

### Requirement: findRegistryKeyByEntry reverse lookup

**Reason**: Replaced by `entry.key` O(1) field access.
**Migration**: All callers now use `resolveToLangCode(code).key` instead of `findRegistryKeyByEntry(findRegistryEntry(code))`.
