# subtitle-segmentation (delta)

Changes to title card detection: prevent false-positives on natural-language multi-line subtitles from Latin-script writing systems.

## ADDED Requirements

### Requirement: Title card detection exempts Latin-script multi-line natural speech

When `isTitleCardText` evaluates condition 2 (text contains `\n`, does not end with sentence-ending punctuation, and has no speaker change markers), the system SHALL additionally verify that the text does NOT contain any lowercase Latin letters (`[a-z]`). Text containing lowercase letters SHALL NOT be classified as a title card under this condition.

This exemption applies because natural-language subtitles from Latin-script languages (Indonesian, English, French, Spanish, etc.) commonly use `\n` for multi-line display layout. Such text is almost never a title card, which typically uses all-caps formatting.

The system SHALL continue to detect real title cards via condition 3 (all-caps, ≤6 words, no sentence-ending punctuation) which remains unchanged.

This exemption SHALL NOT affect non-Latin writing systems (CJK, Hangul, Arabic, Thai, Devanagari, etc.) since those scripts have no lowercase/uppercase distinction and `[a-z]` will not match.

#### Scenario: Indonesian multi-line subtitle is NOT classified as title card

- **WHEN** text is `"Sudah lebih dari belasan negara ku\nlewati dalam perjalanan ini. Ribuan"`
- **THEN** condition 2 initially matches (contains `\n`, no sentence-ending punctuation at end, no speaker markers)
- **BUT** text contains lowercase letters (`"udah"`, `"ebih"`, `"ari"`, etc.) → `/[a-z]/.test(trimmed)` returns `true`
- **AND** `isTitleCardText` returns `false` (not a title card)
- **AND** the word is preserved in `preSegmentPhraseEvents` output

#### Scenario: Continuation fragment with line break is NOT classified as title card

- **WHEN** text is `"kilometer jalan telah tertinggal di\nbelakang. Tapi ada sesuatu yang beda"` (next subtitle event continuing from previous)
- **THEN** condition 2 initially matches (has `\n`, ends with "beda" no punctuation)
- **BUT** text contains lowercase letters → exemption applies
- **AND** `isTitleCardText` returns `false`
- **AND** the word is preserved

#### Scenario: All-caps title card IS still classified as title card

- **WHEN** text is `"SEASON 1\nEPISODE 5"`
- **THEN** condition 2 matches (has `\n`, no sentence-ending punctuation, no speaker markers)
- **AND** text has NO lowercase letters → condition 2 MAY return `true`
- **OR** condition 3 catches it (all-caps, ≤6 words, no sentence-ending punctuation) → `isTitleCardText` returns `true`
- **AND** the title card is dropped from the word stream

#### Scenario: English multi-line casual subtitle is NOT classified as title card

- **WHEN** text is `"But this is India.\nThere is no wrong way"`
- **THEN** condition 2 initially matches (has `\n`, arguably no sentence-ending punctuation at end... but wait, ends with "way" not punctuation)
- **BUT** text contains lowercase letters → exemption applies
- **AND** `isTitleCardText` returns `false`

#### Scenario: Single-line text without line breaks is unaffected

- **WHEN** text is `"Selamat pagi dari New Delhi, Guys."` (no `\n`, ends with `.`)
- **THEN** condition 2 does not match (no `\n`) → falls through
- **AND** existing behavior preserved — the function proceeds to check other conditions
- **AND** `isTitleCardText` returns `false` (not a title card)

#### Scenario: Korean text with line break is NOT affected by lowercase guard

- **WHEN** text is `"부산행\n기차 안에서"`
- **THEN** condition 2 matches (has `\n`, no sentence-ending punctuation, no speaker markers)
- **AND** `/[a-z]/.test(trimmed)` returns `false` (Hangul has no lowercase)
- **AND** condition 2 still returns `true`
- **AND** condition 3 is skipped (non-Latin script) → could still return `true`
- **BUT** word count may exceed 6 for longer text → `false`
- **AND** overall behavior for Korean content remains unchanged from before

#### Scenario: Bilingual text with mixed Latin and non-Latin is exempted

- **WHEN** text is `"Halo, Guys.\nNamaste."` (contains `\n`, ends with `.` though)
- **THEN** ends with `.` → condition 2 does not trigger (sentence-ending punctuation present)
- **AND** `isTitleCardText` returns `false`
