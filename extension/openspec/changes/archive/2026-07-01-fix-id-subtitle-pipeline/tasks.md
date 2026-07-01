## 1. Fix isTitleCardText Latin-script multi-line false-positive

- [x] 1.1 In `isTitleCardText` (youtube-subtitles.js:695), add lowercase guard to condition 2: if text contains `[a-z]` lowercase letters, return `false` (not a title card). Rationale: natural speech has lowercase, title cards are all-caps or episode patterns.
- [x] 1.2 Verify: existing `test_pipeline.js` titleCard tests pass (all existing assertions remain correct)
- [x] 1.3 Add new test case in `test_pipeline.js`: Indonesian multi-line subtitle `"Sudah lebih dari belasan negara ku\nlewati dalam perjalanan ini."` → `isTitleCardText` returns `false`, `preSegmentPhraseEvents` does NOT drop it
- [x] 1.4 Add new test case: multi-line natural English subtitle `"But this is India.\nThere is no wrong way."` → `isTitleCardText` returns `false`
- [x] 1.5 Add new test case: truly-garbled all-caps text `"TOPA CHINA\nBEAUTIFUL PLACE"` → `isTitleCardText` still returns `true` (all caps, no lowercase → still a title card) — ensure lowercase guard doesn't create false negatives

## 2. Add subtitle content language verification during fetch

- [x] 2.1 Create `verifySubtitleContentLanguage(text, expectedLang)` helper in `youtube-subtitles.js`
- [x] 2.2 Integrate into `fetchSubtitleFile`: after text fetch, verify content language; mismatch → skip client
- [x] 2.2a **Critical additional fix**: In `fetchSubtitles`, pass resolved track language (not `'auto'`) to `fetchSubtitleFile` so content verification actually activates. When `preferredSourceLang` is `'auto'`, use the detected `language` from track metadata instead.
- [x] 2.3 Add debug log for verification results
- [x] 2.4 Verify direct timedtext URL fallback intact

## 3. Verification (manual)

- [x] 3.1 Run full `test_pipeline.js` regression suite — all existing tests must pass
- [ ] 3.2 Manual test: open Indonesian YouTube video, verify source text shown in pipeline log is actual Indonesian (not English)
- [ ] 3.3 Manual test: open Korean YouTube video with ASR subtitles, verify subtitle segmentation and translation still work correctly (no regression)
- [ ] 3.4 Manual test: open English YouTube video with English target, verify same-language skip still works
- [ ] 3.5 Manual test: open video with actual multi-line title cards (e.g., anime episode title screen), verify title cards are still properly dropped
