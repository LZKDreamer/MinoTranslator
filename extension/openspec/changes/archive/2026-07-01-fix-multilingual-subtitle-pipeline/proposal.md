## Why

The subtitle translation pipeline has four defects that degrade translation quality across dozens of supported languages. A Japanese-Chinese mixed vlog exposed the most visible symptom — Chinese market dialogue was incorrectly "translated" from Chinese to Chinese (altering original meaning) — but the root causes are language-agnostic structural flaws. Latin-based languages (fr/es/it/de/pt) are all detected as English, causing floating translate to skip them entirely. Non-Latin scripts (Arabic, Devanagari, Thai, Burmese, Khmer) have their sentence-ending punctuation missing from the split regex, making valid subtitle segments vulnerable to the sparse garbage filter that drops them silently. These cross-cut the pipeline's segmentation, language detection, and translation-skip logic.

## What Changes

- **Skip translation of text already in the target language**: Per-segment language detection before sending to AI; text matching the target language is passed through unchanged instead of being "translated" back to the same language. Fixes Chinese→Chinese rewriting, English→English rewriting, and any mixed-language video where one spoken language matches the user's target.
- **Expand sentence-ending punctuation to non-Latin scripts**: Add Arabic (&#x06D4; &#x061F;), Devanagari (&#x0964; &#x0965;), and inspect/cover Burmese/Khmer/Ethiopic sentence terminators in the phrase-event split, sentence-end check, and long-sentence split logic. This restores proper segmentation for ~10 languages.
- **Make sparse garbage filter punctuation-aware**: When a segment has no recognizable sentence-ending punctuation, the sparse garbage filter (which drops ≤3-word orphan segments) shall use per-language heuristics instead of a single global threshold. Non-punctuated short segments in high-context languages are preserved rather than dropped.
- **Add Latin language detection to distinguish European languages from English**: `detectSourceLanguage()` shall incorporate character frequency, diacritic, and word-level heuristics to detect French, Spanish, Italian, German, and Portuguese as distinct from English. Prevents floating translate from skipping all Latin-text languages when target is set to English.
- **Adjust context level for pro-drop European languages**: Spanish and Italian shall be classified as "high" context (like Japanese/Korean) since they are pro-drop languages where implicit subjects require preceding context for correct translation.

## Capabilities

### New Capabilities
- `skip-target-language-segments`: Per-segment language detection that skips translation when source text is already in the user's target language, applicable to all 40+ supported languages in the registry.
- `expanded-sentence-end-punctuation`: Uniform handling of sentence-ending punctuation across Latin, CJK, Arabic, and Devanagari scripts in all segmentation and split-point prioritization logic.
- `latin-language-detection`: Detect French, Spanish, Italian, German, and Portuguese as distinct languages (not as English) in `detectSourceLanguage()`, with calibrated thresholds to avoid false positives.

### Modified Capabilities
- `language-registry`: Add missing registry entries for Italian and German (if absent); verify all 27 registered languages have correct `level`, `source`, `target`, and `aliases`; escalate Spanish and Italian to `high` context level.
- `lang-code-normalization`: `resolveToLangCode` and `detectSourceLanguage` must correctly resolve Latin language aliases (fr, fr-FR, es-ES, it-IT, de-DE, pt-BR) and accept per-segment short-text detection calls.
- `subtitle-segmentation`: Replace the hardcoded `[.?!。？！]` regex constant with a centralized `SENTENCE_END_CHARS` set that includes Arabic and Devanagari terminators; update sparse garbage logic to consider per-script heuristics; update `isTitleCardText` to exclude short non-Latin text from false-positive title card classification.
- `target-language-auto`: Extend `isSameLanguage()` to support per-segment comparison (compare detected script of a single sentence against the target language); add `fr/es/it/de/pt` regression test cases for Latin language parity.

## Impact

- **Affected code**: `youtube-subtitles.js` (segmentation, sparse garbage, sentence-end, title card); `constants.js` (detectSourceLanguage, LANGUAGE_REGISTRY, getLanguageLevel); `translate-prompt.js` (per-segment skip insertion point); `youtube.js` (isSameLanguage extension); `service-worker.js` (floating translate skip logic)
- **New dependencies**: None (all changes are in-browser JS)
- **Breaking changes**: None — existing sentence-end characters retain identical behavior; new characters and heuristics are additive
- **Risk**: Expanded punctuation may cause over-splitting in edge cases (e.g., Arabic isolated form characters appearing mid-sentence). Mitigate with per-script regex validation and test corpus verification.
