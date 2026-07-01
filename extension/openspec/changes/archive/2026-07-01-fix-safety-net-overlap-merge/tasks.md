## 1. Safety net overlap merge

- [x] 1.1 In `segmentSentences()` safety net loop in `youtube-subtitles.js`, add overlap detection: when `gap <= 0`, merge `S[i]` into `S[i+1]` regardless of `_hardBreakAfter`, provided `S[i]` lacks sentence-ending punctuation and combined duration < 15s
- [x] 1.2 Sync the same overlap merge logic to `test_harness.js` safety net loop
- [x] 1.3 Add test case in `test_harness.js` for overlapping Korean segments from the real-world case

## 2. Verification

- [ ] 2.1 Run test harness — verify existing tests pass
- [ ] 2.2 Re-test Korean video — verify #40 and #41 merge into one sentence, no more (empty) slot
