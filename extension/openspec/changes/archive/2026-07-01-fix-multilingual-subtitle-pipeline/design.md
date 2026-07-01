# Design: fix-multilingual-subtitle-pipeline

## Context

The subtitle translation pipeline in `youtube-subtitles.js` has accumulated language-specific assumptions over time. Sentence-ending punctuation is hardcoded to Latin+CJK scripts only (`.?!。？！`). Language detection (`detectSourceLanguage`) treats all Latin-script text as English. The sparse garbage filter applies a uniform 3-word threshold regardless of the language's punctuation conventions. The `isSameLanguage` check skips translation only at the video level (not per segment), so mixed-language videos pass all content through AI regardless of whether individual sentences are already in the target language.

Four source files are affected:
- `src/content/youtube-subtitles.js` — segmentation, sparse garbage, sentence-end, title card
- `src/shared/constants.js` — LANGUAGE_REGISTRY, detectSourceLanguage, getLanguageLevel
- `src/content/youtube.js` — isSameLanguage
- `src/background/service-worker.js` — floating translate skip

## Goals / Non-Goals

**Goals:**
- Per-segment language skip: text detected as target language passes through unchanged
- Centralized sentence-end punctuation covering Latin, CJK, Arabic, Devanagari, and Ethiopic scripts
- Latin language detection: `detectSourceLanguage` distinguishes `fr/es/it/de/pt` from `en`
- Sparse garbage filter with per-script tolerance multipliers
- LANGUAGE_REGISTRY level adjustments (`es`/`it` → high, `fr` → medium, `it` target → true)
- `isTitleCardText` no longer fires condition 3 for non-Latin text

**Non-Goals:**
- New language registry entries (fr/de/es/pt/it already exist)
- Changes to the AI prompt template (beyond the existing `"NEVER output sourceLang text"` constraint)
- Adding support for Burmese/Khmer language-specific ASR models
- Changing the batch size or concurrency model

## Decisions

### Decision 1: Where to inject per-segment skip

**Choice**: Inject in `batchTranslateSentences()`, **after** cache lookup and **before** `translateOneBatch()`.

```
batchTranslateSentences():
  for each sentence in sentences:
    if isSegmentSameLanguage(sentence.text, targetLanguage):
      sentence.translation = sentence.text  // pass through
    else:
      add to pending batch queue
  // only non-skipped sentences go to AI
```

**Alternatives considered**:
- *In segmentSentences()*: Rejected — detection should use fully cleaned text (after `cleanCueText`), which only happens post-segmentation.
- *In translateOneBatch()*: Rejected — would require modifying the AI prompt per-batch to omit skipped entries, complicating the `parseTranslationArray` index mapping.

**Why this order**: Pre-AI injection allows the existing cache layer to also cache "passthrough" results (original→original), avoiding redundant detection calls on repeat views.

### Decision 2: Centralized SENTENCE_END_CHARS

**Choice**: Define a single string constant `SENTENCE_END_CHARS` and construct regexes locally:

```js
var SENTENCE_END_CHARS = '.?!\u3002\uff1f\uff01\u06d4\u061f\u0964\u0965\u1362\u1367';
var SENTENCE_END_RE = new RegExp('[' + SENTENCE_END_CHARS + ']$');
var SENTENCE_END_INTERNAL_RE = new RegExp('[' + SENTENCE_END_CHARS + ']');
```

**Alternatives considered**:
- *Single pre-compiled RegExp*: Rejected — different use sites need different wrapping (end-of-string vs. anywhere vs. captured).
- *Per-language separate constants*: Rejected — need a single `test()` call that works for any supported language.

The string constant contains the raw Unicode characters (not escape sequences) so it's directly usable in `RegExp` constructors without double-escaping.

### Decision 3: detectSourceLanguage Latin extension

**Choice**: Insert language-specific checks between the Cyrillic check and the English fallback, using **diacritic density ratio**:

```js
// Step 1-6: CJK, Korean, Arabic, Thai, Cyrillic checks (unchanged)

// Step 7: Latin-script language detection by diacritic density
var diacriticCount = (t.match(DIACRITIC_RE) || []).length;
var alphaCount = (t.match(/[a-zA-Z]/g) || []).length;
var totalChars = t.replace(/\s/g, '').length; // exclude spaces
if (totalChars >= 10 && diacriticCount > 0) {
  var ratio = diacriticCount / totalChars;
  if (FRENCH_RE.test(t) && ratio > 0.04) return 'fr';
  if (SPANISH_RE.test(t) && ratio > 0.04) return 'es';
  if (GERMAN_RE.test(t) && ratio > 0.04) return 'de';
  if (PORTUGUESE_RE.test(t) && ratio > 0.04) return 'pt';
  if (ITALIAN_RE.test(t) && ratio > 0.04) return 'it';
}

// Step 8: English fallback (unchanged)
if (alphaCount / t.length >= 0.6) return 'en';
return null;
```

**Per-language character sets**:
| Language | Characters | Key marker |
|----------|-----------|-----------|
| `FRENCH_RE` | `éèêëàâçîïôûùœæ` | `ç` and `œ` are uniquely French among European languages |
| `SPANISH_RE` | `áéíóúüñ¿¡` | `ñ` and inverted `¿¡` are uniquely Spanish |
| `GERMAN_RE` | `äöüß` | `ß` is uniquely German |
| `PORTUGUESE_RE` | `ãõçáéíóúâêôà` | `ã` and `õ` (nasal vowels) are uniquely Portuguese |
| `ITALIAN_RE` | `àèéìòù` | Grave accents only; weakest signal, highest priority for false-positive avoidance |

**Threshold rationale**: 4% diacritic density with minimum 10 non-space characters. At 10 chars, 1 accented char = 10% density, which passes. At 50 chars with 2 accented chars = 4%, which passes. This threshold lets short fully-accented phrases through while blocking single loanwords in long English text (e.g., "café" in a 100-word paragraph is ~1% density).

**Ambiguous cases**: `"qué"` exists in both Spanish and French. Since Spanish has `ñ` and inverted punctuation, and French has `ç` and `œ`, these serve as tiebreakers when both patterns match. If both match with equal score, the first check in order wins (arbitrary but deterministic).

### Decision 4: Per-script sparse garbage thresholds

**Choice**: Apply a `SPARSE_WORD_MULTIPLIER` per script, leaving `MAX_SPARSE_WORDS = 3` unchanged as the base:

```js
function getSparseWordMultiplier(text) {
  if (/[\u0E00-\u0E7F]/.test(text)) return 2.0;   // Thai/Lao
  if (/[\u0900-\u0FFF\u1000-\u17FF]/.test(text)) return 1.5; // Devanagari/Bengali/Burmese/Khmer
  return 1.0; // Latin/CJK/Arabic/Cyrillic/Ethiopic
}
var effectiveMax = MAX_SPARSE_WORDS * getSparseWordMultiplier(segmentText);
```

**Additionally**: Require minimum 2 words before any segment can be garbage. A single "word" segment should never be dropped (it could be a number, a name, or `"100"` as in the test case).

This preserves existing behavior for Latin/CJK/Arabic scripts while giving more tolerance to scripts where ASR systems routinely produce unpunctuated output.

### Decision 5: isTitleCardText fix for non-Latin scripts

**Choice**: Add a guard before condition 3:

```js
// Condition 3: ALL-CAPS check — only applies to Latin text
if (!/[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u0600-\u06FF\u0E00-\u0E7F]/.test(trimmed)) {
  // existing ALL-CAPS logic unchanged
}
```

Non-Latin text has no uppercase/lowercase distinction, so `text === text.toUpperCase()` is vacuously true for all non-Latin text. The guard prevents this from triggering for CJK, Hangul, Kana, Arabic, Thai, and other non-Latin scripts.

Condition 2 (newline + no punctuation + no speaker marker) already handles mixed-line cases and is script-agnostic, so it does not need modification.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| **Diacritic false positive**: A Japanese sentence with one kanji mistaken for a diacritic | CJK check runs before Latin detection; kana/CJK characters short-circuit before reaching the Latin path |
| **Italian weak signal**: Italian uses only grave accents, which are shared with French. False-positive risk for single-word matches. | Higher effective threshold for Italian; French checks `ç` first as tiebreaker. Worst case: Italian text detected as French → AI can still translate fr→target correctly |
| **Over-splitting**: Arabic `۔` (U+06D4) could appear mid-text in non-sentence contexts (e.g., abbreviations in Urdu) | Monitor; this is rare in subtitle text. If it occurs, U+06D4 can be restricted to the end-of-string regex only, not the internal-split regex |
| **Performance**: Diacritic density regex for every call to `detectSourceLanguage` | The function is called per segment (typically 10-40 per video), not per frame. Regex is fast on typical 50-char strings |
| **Backward compatibility**: Expanding punctuation could cause over-splitting, producing more translation units than before | Test corpus validation against 53 existing tests; if any regression, tighten the internal-split regex to only break on `۔` and `।` at end-of-string, not mid-text |
| **Sparse garbage false negatives**: Per-script multipliers could let actual ASR hallucination through for Thai/Arabic | Acceptable tradeoff — dropping valid sentences is worse than occasionally translating one hallucinated fragment. The 5000ms gap check still applies |

## Open Questions

1. **Should `it` (Italian) become `target: true`?** The spec proposes yes — it was previously `target: false`. Italian is widely spoken and has a Latin script that AI models handle well. No reason to exclude it from the target dropdown.

2. **Should Burmese (`my`) and Khmer (`km`) be added to LANGUAGE_REGISTRY?** They are currently absent. The multi-script sparse garbage change protects them if they're ever added, but adding registry entries for them is out of scope for this change.

3. **Ethiopic script coverage**: Should Amharic (`am`) be added to the registry? It has sentence-ending characters (`።` `፧`) that are covered by the expanded punctuation set. Out of scope for this change but the infrastructure supports it.
