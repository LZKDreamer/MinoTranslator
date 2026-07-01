# expanded-sentence-end-punctuation Specification

## Purpose

Define a centralized, extensible set of sentence-ending punctuation characters that covers Latin, CJK, Arabic, and Devanagari scripts. Replace all hardcoded `[.?!。？！]` occurrences across `segmentSentences`, `preSegmentPhraseEvents`, and `splitInternalPunctuation` with a single source-of-truth constant, ensuring uniform segmentation behavior for all supported languages.

## Requirements

### Requirement: Centralized sentence-end character set

The system SHALL define a single constant `SENTENCE_END_CHARS` in `youtube-subtitles.js` that aggregates all recognized sentence-terminating characters. All segmentation and split-point functions SHALL reference this constant instead of hardcoded character classes.

The set SHALL include:
- Latin: `.` `?` `!`
- CJK: `。` (U+3002) `？` (U+FF1F) `！` (U+FF01)
- Arabic: `۔` (U+06D4: Arabic full stop) `؟` (U+061F: Arabic question mark)
- Devanagari: `।` (U+0964: Devanagari danda) `॥` (U+0965: Devanagari double danda)
- Ethiopian: `።` (U+1362: Ethiopic full stop) `፧` (U+1367: Ethiopic question mark)

#### Scenario: Arabic sentence detection

- **WHEN** a segment ends with `"كيف حالك؟"` (ending in U+061F)
- **THEN** `SENTENCE_END_RE.test` returns `true`
- **AND** the segment is considered a complete sentence for segmentation purposes

#### Scenario: Devanagari sentence detection

- **WHEN** a segment ends with `"मैं ठीक हूं।"` (ending in U+0964)
- **THEN** `SENTENCE_END_RE.test` returns `true`
- **AND** `preSegmentPhraseEvents` splits on the `।` character

#### Scenario: Arabic and Devanagari characters do not break existing Latin/CJK tests

- **WHEN** a segment ending with `.?!。？！` is tested
- **THEN** `SENTENCE_END_RE` returns `true` (unchanged behavior)
- **AND** all 53 existing segmentation tests pass unchanged

### Requirement: All sentence-end regex sites use the centralized constant

The system SHALL replace every occurrence of `[.?!。？！]` with the centralized `SENTENCE_END_RE` or `SENTENCE_END_CHARS` across the following locations:

| Location | Current regex | Replacement |
|----------|-------------|-------------|
| `SENTENCE_END_RE` constant (line 462) | `/[.?!。？！]$/` | Updated to include new chars |
| `splitInternalPunctuation` (line 674) | `/[.?!。？！]/` | `SENTENCE_END_CHARS` |
| `segmentSentences` safety net (line 807-812) | `SENTENCE_END_RE` via `sgHasEnd` | Uses updated constant |
| `segmentSentences` long-sentence split (line ~927) | `.?!。？！` | Uses updated constant |
| Hard-break check (line ~787) | `.?!。？！` | Uses updated constant |

#### Scenario: All sites produce identical behavior for Arabic input

- **WHEN** Arabic text `"مرحبا۔ كيف حالك؟"` passes through `splitInternalPunctuation`
- **THEN** it splits into `["مرحبا۔", "كيف حالك؟"]`
- **AND** both pieces are detected as complete sentences by `SENTENCE_END_RE`
- **AND** the sparse garbage filter does not drop either piece

#### Scenario: All sites produce identical behavior for Devanagari input

- **WHEN** Devanagari text `"नमस्ते। आप कैसे हैं?"` passes through `splitInternalPunctuation`
- **THEN** it splits into `["नमस्ते।", "आप कैसे हैं?"]`
- **AND** both pieces pass sentence-end validation

### Requirement: Sparse garbage filter uses per-script heuristics for non-punctuated text

When a segment has no recognized sentence-ending punctuation, the sparse garbage filter SHALL use language-aware thresholds instead of a single global word-count limit. Segments in scripts where standard punctuation is often absent (Thai, Devanagari with weak ASR, Arabic with informal text) SHALL have a higher word-count tolerance or a script-specific `MAX_SPARSE_WORDS` multiplier.

#### Scenario: Thai segment without sentence punctuation is preserved

- **WHEN** a 4-word Thai segment `"สวัสดีครับ วันนี้ไปไหน"` has no recognizable sentence-ending punctuation
- **THEN** `MAX_SPARSE_WORDS * thaiMultiplier >= 4`, so the segment passes the sparse garbage check
- **AND** the segment is NOT dropped

#### Scenario: Latin segment without punctuation is still dropped if isolated

- **WHEN** a 2-word Latin segment `"yeah so"` has no sentence-ending punctuation and is isolated (gaps > 5000ms)
- **THEN** it is still dropped by sparse garbage (unchanged behavior — ASR hallucination in Latin scripts)

#### Scenario: Arabic segment isolated without punctuation uses per-script threshold

- **WHEN** a 5-word Arabic segment has no recognized punctuation and is isolated
- **THEN** with per-script multiplier, 5 words exceeds the threshold for Arabic
- **AND** the segment is preserved (not dropped)
