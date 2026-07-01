## Context

The sentence-end safety net in `segmentSentences()` uses `sGap >= 0` as a merge precondition, which blocks overlapping segments (negative gap) from being merged. This causes split sentences where the AI consolidates two halves into one translation slot, leaving the other empty.

## Goals / Non-Goals

**Goals:** Allow safety net to merge overlapping segments (gap ≤ 0) when the preceding segment lacks sentence-ending punctuation.

**Non-Goals:** Change any other merge rule (gap threshold, duration threshold, hard break check).

## Decisions

**Choice:** Remove `sGap >= 0 &&` from the merge condition. The existing `sGap < SAFETYNET_GAP_SEC` (1.0s) and `sGap <= SAFETYNET_HARDBREAK_GAP_SEC` (2.0s) already constrain the merge window — a negative gap is trivially within both bounds.

**No other changes needed:** The merged duration check, text concatenation, and chain-merge loop remain identical.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Overzealous merging of unrelated overlapping segments | Actual overlap is rare in practice and only occurs within the same utterance due to ASR timing jitter. Tested with Korean video — merged correctly. |
