# latin-language-detection Specification

## Purpose

Define character-level and word-level heuristics to distinguish Latin-script European languages (French, Spanish, Italian, German, Portuguese) from English in `detectSourceLanguage()`. Without these heuristics, all Latin-script text is labeled `"en"`, causing floating translate to skip French/Spanish/Italian/German/Portuguese content and potentially biasing the subtitle translation prompt with an incorrect source language.

## Requirements

### Requirement: detectSourceLanguage distinguishes Latin languages by diacritic patterns

The system SHALL extend `detectSourceLanguage()` with script-specific substring detection for Latin-script European languages, inserted between the Cyrillic check and the English fallback. Detection order: check for CJK/Arabic/Thai/Cyrillic scripts first (unchanged), then check for language-specific Latin character patterns, then fall back to `"en"` if no pattern matches.

#### Scenario: French text detected as French

- **WHEN** `detectSourceLanguage("C'est très bien, merci beaucoup")` is called
- **THEN** French-specific patterns match (`ç`, `é`/`è`/`ê`/`ë`, `à`/`â`, `œ`) with sufficient density
- **AND** it returns `"fr"`

#### Scenario: Spanish text detected as Spanish

- **WHEN** `detectSourceLanguage("¿Cómo estás? ¡Qué bueno!")` is called
- **THEN** Spanish-specific patterns match (`¿`, `¡`, `á`/`é`/`í`/`ó`/`ú`, `ü`, `ñ`) with sufficient density
- **AND** it returns `"es"`

#### Scenario: German text detected as German

- **WHEN** `detectSourceLanguage("Grüße aus München")` is called
- **THEN** German-specific patterns match (`ä`/`ö`/`ü`, `ß`) with sufficient density
- **AND** it returns `"de"`

#### Scenario: Italian text detected as Italian

- **WHEN** `detectSourceLanguage("Perché è così bello")` is called
- **THEN** Italian-specific patterns match (`à`/`è`/`é`/`ì`/`ò`/`ù`) with sufficient density
- **AND** it returns `"it"`

#### Scenario: Portuguese text detected as Portuguese

- **WHEN** `detectSourceLanguage("Não é possível, obrigado")` is called
- **THEN** Portuguese-specific patterns match (`ã`/`õ`, `ç`, `á`/`é`/`í`/`ó`/`ú`, `â`/`ê`/`ô`) with sufficient density
- **AND** it returns `"pt"`

#### Scenario: Pure English text without diacritics falls through to en

- **WHEN** `detectSourceLanguage("The quick brown fox jumps over the lazy dog")` is called
- **THEN** no CJK/Arabic/Thai/Cyrillic characters are found
- **AND** no language-specific Latin patterns match
- **AND** alpha ratio > 60%, so it returns `"en"` (unchanged behavior)

#### Scenario: Mixed European + English text delegates to majority

- **WHEN** `detectSourceLanguage("The café is open until 10pm")` is called
- **THEN** `"é"` is found, French pattern match fires with low density
- **AND** alpha ratio is high but diacritic ratio is low
- **AND** system may return either `"fr"` (word-level `café`) or `"en"` (majority English)
- **AND** either outcome is acceptable (the text is predominantly English with one borrowed word)

### Requirement: Detection thresholds prevent false positives

The system SHALL require a minimum density of language-specific diacritics or markers per unit of text before classifying as a non-English Latin language. This prevents single borrowed words (like `café`, `naïve`, `über`) from incorrectly switching detection.

#### Scenario: Single accented word in English text keeps en detection

- **WHEN** `detectSourceLanguage("Let's meet at the café tomorrow")` is called
- **THEN** only 1 character out of 30+ has a French diacritic
- **AND** the French diacritic density is below the threshold
- **AND** the alpha ratio check falls through to `"en"` (primary language is English)

#### Scenario: Fully accented text with high diacritic density triggers detection

- **WHEN** `detectSourceLanguage("Désolé, je ne peux pas venir")` is called
- **THEN** 4+ characters out of ~25 have French diacritics
- **AND** the diacritic density exceeds the threshold
- **AND** it returns `"fr"`

### Requirement: detectSourceLanguage returns null only when no script can be determined

The system SHALL return `null` from `detectSourceLanguage()` only when no recognizable script is found (text is entirely numeric, symbolic, or empty). Previously, pure Latin text below 60% alpha ratio would return `null` — this behavior is preserved.

#### Scenario: Empty or numeric text returns null

- **WHEN** `detectSourceLanguage("12345")` is called
- **THEN** no script matches, alpha ratio is 0
- **AND** it returns `null`

#### Scenario: Text with 50% alpha ratio and no diacritics returns null

- **WHEN** `detectSourceLanguage("Hello... --- wait!!")` is called with ~50% alpha ratio
- **THEN** alpha ratio is below 60%, no diacritic patterns match
- **AND** it returns `null` (unchanged behavior)
