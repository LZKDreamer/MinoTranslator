## Why

The sentence-end safety net in `segmentSentences` has a boundary case: when two consecutive segments overlap in time (gap ≤ 0), the safety net's `gap < 1.0s` check still passes, but the merge fails because of the `_hardBreakAfter` flag or because both segments independently pass the "complete sentence" check. The result is a split sentence where the AI receives two segments, merges them into one translation, and leaves one output slot empty (`TRANS: (empty)`). This was observed in a Korean video (#40 and #41) where a single thought was split across two time-overlapping segments and the AI consolidated the translation into slot #40, leaving #41 empty.

## What Changes

- Safety net SHALL treat overlapping (negative gap) segments the same as zero-gap — eligible for forward merge if both segments are from the same utterance and the combined duration < 15s
- Safety net SHALL additionally check for overlap (`S[i+1].start <= S[i].end`) and merge regardless of `_hardBreakAfter` when overlap exists and both lack sentence-ending punctuation

## Capabilities

### Modified Capabilities
- `subtitle-segmentation`: The "翻译单元完整性安全网" requirement SHALL be updated to explicitly handle overlapping segments (negative gap), merging them unconditionally when neither segment has sentence-ending punctuation.

## Impact

- **Affected code**: `youtube-subtitles.js` — `segmentSentences()` safety net loop
- **No behavioral change for non-overlapping segments**: existing merge logic unchanged
- **Risk**: Low — only affects overlapping segments where neither has punctuation, which is a strict subset of the existing merge window
