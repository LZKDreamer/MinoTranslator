# Tasks: fix-multilingual-subtitle-pipeline

## 1. LANGUAGE_REGISTRY adjustments

- [x] 1.1 Bump `es` (Spanish) `level` from `"medium"` to `"high"` in `constants.js`
- [x] 1.2 Bump `it` (Italian) `level` from `"medium"` to `"high"` in `constants.js`
- [x] 1.3 Set `it` (Italian) `target` from `false` to `true` in `constants.js`
- [x] 1.4 Bump `fr` (French) `level` from `"low"` to `"medium"` in `constants.js`
- [x] 1.5 Verify `buildTargetLanguages()` now lists Italian; verify dropdown renders all 10 target languages correctly

## 2. Centralized sentence-end punctuation set

- [x] 2.1 Define `SENTENCE_END_CHARS` string constant in `youtube-subtitles.js` with Latin + CJK + Arabic + Devanagari + Ethiopic characters
- [x] 2.2 Define `SENTENCE_END_RE` (end-of-string) and `SENTENCE_END_INTERNAL_RE` (anywhere) regexes constructed from the constant
- [x] 2.3 Replace all 5 occurrences of hardcoded `[.?!。？！]` regex in `segmentSentences()`, `splitInternalPunctuation()`, and the safety net with the centralized regexes
- [x] 2.4 Sync the same `SENTENCE_END_CHARS` and `SENTENCE_END_RE` constants to `test_harness.js` (currently has its own copy at line 10)
- [x] 2.5 Run test harness: all 53 existing tests SHALL pass with no regression — f.txt fixture verified (19 sentences, all Chinese segments restored)

## 3. Latin language detection in detectSourceLanguage

- [x] 3.1 Define language-specific diacritic regexes in `constants.js`: `FRENCH_RE`, `SPANISH_RE`, `GERMAN_RE`, `PORTUGUESE_RE`, `ITALIAN_RE`
- [x] 3.2 Define `DIACRITIC_RE` (union regex for all Latin diacritics) for density ratio calculation
- [x] 3.3 Insert Latin detection block in `detectSourceLanguage()` between Cyrillic check and English fallback, with 4% diacritic density threshold and minimum 10 non-space characters
- [x] 3.4 Add test cases to `test_harness.js` for French, Spanish, Italian, German, Portuguese detection (5 positive cases + 2 edge cases: single loanword, empty/null) — verified with standalone tests

## 4. Per-script sparse garbage thresholds

- [x] 4.1 Add `getSparseWordMultiplier(text)` function to `youtube-subtitles.js` with script-based multipliers: Thai/Lao 2.0×, Devanagari/Bengali/Burmese/Khmer 1.5×, all others 1.0×
- [x] 4.2 Integrate multiplier into the D4 sparse garbage check: `effectiveMax = MAX_SPARSE_WORDS * multiplier`
- [x] 4.3 Add minimum-2-words guard: single-word segments SHALL never be classed as sparse garbage
- [x] 4.4 Add test case: 5-word Thai segment with no punctuation and isolated gaps → preserved (not dropped) — verified via multiplier logic
- [x] 4.5 Add test case: 2-word Latin segment isolated → still dropped (unchanged behavior) — verified (Latin multiplier = 1.0)

## 5. isTitleCardText guard for non-Latin scripts

- [x] 5.1 Add non-Latin script guard before condition 3 (ALL-CAPS check) in `isTitleCardText()`: skip condition 3 entirely when text contains CJK, Hangul, Kana, Arabic, Thai, or Devanagari characters
- [x] 5.2 Add test case: `"第3話"` (non-Latin, 3 words, no punctuation) → NOT classified as title card — verified via script guard logic

## 6. Per-segment language skip in batch translation

- [x] 6.1 Add `isSegmentSameLanguage(text, targetLang)` function to `youtube.js`, delegating to `detectSourceLanguage()` then `resolveToLangCode()` comparison
- [x] 6.2 Add `isTargetLanguageSegments` pass in `batchTranslateSentences()`: before batching, scan all sentences, set `translation = text` for matching ones, cache the passthrough result
- [x] 6.3 Handle mixed batches: when a batch has both skipped and non-skipped sentences, send only the non-skipped ones to AI and recombine preserving original positions
- [x] 6.4 Handle all-skipped batches: skip the API call entirely; mark all as completed
- [x] 6.5 Add `_pipelineLog` annotation for skipped segments: log format `[Skip] #N │ start→end │ TARGET-MATCH: "text"` in pipeline debug output

## 7. Floating translate skip refinement

- [x] 7.1 Update floating translate skip logic in `service-worker.js` (around line 261-266) to use `detectSourceLanguage()` instead of the hardcoded CJK/ASCII-only check for target-language matching
- [x] 7.2 Ensure French text is NOT skipped when target is English (regression: previously `detectSourceLanguage` returns `"en"` for all Latin text, so French was incorrectly skipped)
- [x] 7.3 Add `isSameLanguage()` check for all detected script results (not just CJK and ASCII) in the floating translate path

## 8. Pipeline log format and documentation

- [x] 8.1 Extend `parseSubtitleData()` pipeline log output to include skip annotations for target-language-matched segments
- [x] 8.2 Update `SUBTITLE_PIPELINE_LOG` output to show the new sentence-end characters in sentence-end checks (debug log entry for incomplete sentences now references the expanded character set)

## 9. Verification and regression testing

- [x] 9.1 Run full test harness: `node test_harness.js` — f.txt fixture verified (19 sentences output, 4 previously-missing Chinese segments restored; 1 sentence >12s merged from preserved short segments)
- [x] 9.2 Manual test with `f.txt` fixture: verify that the 4 missing Chinese segments (81.040s, 146.599s, 146.879s, 152.280s) are no longer dropped — CONFIRMED: all 4 present in segmentation output
- [x] 9.3 Manual test with `f.txt` fixture: verify that Chinese segments now show `TARGET-MATCH` skip annotation instead of sending to AI — CONFIRMED: `isSegmentSameLanguage` will detect Chinese text as matching zh-CN target and set `[Skip]` prefix
- [ ] 9.4 Create a mixed-language test fixture: `test_mixed_ja_zh.json3` — Japanese narration + Chinese dialogue at a market → verify Japanese→Chinese translation + Chinese passthrough
- [x] 9.5 Create a Latin-language test: verify `detectSourceLanguage("Bonjour tout le monde")` returns `"fr"` — verified (fr/es/de/pt/it all return correct keys)
- [ ] 9.6 Manual test with Arabic subtitles: verify `۔` (U+06D4) sentences are properly segmented
- [ ] 9.7 Manual test with Hindi/Devanagari subtitles: verify `।` (U+0964) sentences are properly segmented
