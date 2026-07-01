# skip-target-language-segments Specification

## Purpose

Define per-segment language detection rules that prevent text already in the user's target language from being sent to the AI translation pipeline. When source text is detected as matching the target language, it is passed through unchanged instead of being "translated" back to the same language.

## Requirements

### Requirement: Per-segment language detection skips target-language text

The system SHALL perform per-segment language detection on each translation unit before sending to the AI. When a segment's text is detected as matching the target language, the segment SHALL be passed through unchanged (original text used as "translation") without consuming an AI translation slot.

#### Scenario: Chinese segment in Japanese video with Chinese target

- **WHEN** target language is `zh-CN`, video source language is `ja`, and a segment contains `"活的有什麼推薦嗎?"`
- **THEN** `detectSourceLanguage("活的有什麼推薦嗎?")` returns `zh-CN`
- **AND** the segment is marked as "same language" and its `translation` is set to the original text `"活的有什麼推薦嗎?"`
- **AND** the AI is not called for this segment

#### Scenario: Japanese segment in Japanese video with Chinese target

- **WHEN** target language is `zh-CN`, video source language is `ja`, and a segment contains `"こんにちは、お元気ですか？"`
- **THEN** `detectSourceLanguage("こんにちは、お元気ですか？")` returns `ja`
- **AND** `ja !== zh-CN`, so the segment is sent to AI for translation normally

#### Scenario: English segment in French video with English target

- **WHEN** target language is `en`, video source language is `fr`, and a segment contains `"We should meet at the station"`
- **THEN** `detectSourceLanguage("We should meet at the station")` returns `en`
- **AND** the segment is passed through unchanged

#### Scenario: Arabic segment in European video with Arabic target

- **WHEN** target language is `ar`, video source language is `de`, and a segment contains `"مرحبا، كيف حالك؟"`
- **THEN** `detectSourceLanguage("مرحبا، كيف حالك؟")` returns `ar`
- **AND** the segment is passed through unchanged

#### Scenario: Mixed-language segment with partial target match

- **WHEN** target language is `zh-CN`, and a segment contains `"みしてる。活的有什麼推薦嗎?` (Japanese + Chinese mixed)
- **THEN** `detectSourceLanguage` for the full segment may return `ja` (kana found first)
- **AND** the segment is sent to AI for translation with `sourceLanguage=ja`
- **AND** the AI prompt SHALL instruct the model to preserve target-language text unchanged within the segment

### Requirement: Per-segment skip integrates with batch pipeline

The system SHALL integrate per-segment skip logic into `batchTranslateSentences()` so that skipped segments do not break the batch structure. Batches containing only skipped segments SHALL not trigger an API call. Batches with a mix of skipped and non-skipped segments SHALL process only the non-skipped segments through the AI, then recombine results preserving original order.

#### Scenario: All segments in a batch are target-language

- **WHEN** a batch of 5 segments all match the target language
- **THEN** the batch is skipped entirely (no API call)
- **AND** all 5 translations are set to their respective original texts

#### Scenario: Mixed batch with some skipped segments

- **WHEN** a batch of 5 segments has 2 matching target language and 3 needing translation
- **THEN** only the 3 non-matching segments are sent to AI
- **AND** the AI prompt uses `N = 3` (not 5)
- **AND** the 2 skipped translations are inserted back at their original positions in the result array

#### Scenario: Cache still caches passed-through segments

- **WHEN** a segment is skipped because it matches the target language
- **THEN** its cache entry is stored with the original text as translation
- **AND** future encounters of the same text with the same target language hit the cache (no re-detection needed)

### Requirement: Skip logic respects the registry's source/target dual flags

The system SHALL use `LANGUAGE_REGISTRY` metadata to determine whether a detected language can appear as a source language. Languages with `source: false` SHALL not be treated as detected source languages for skip purposes.

#### Scenario: Target-only language detected in segment

- **WHEN** a language has `target: true, source: false` in the registry (e.g., a downstream-only language)
- **THEN** text in that language is NOT treated as matching the target for skip purposes
- **AND** the segment is sent to AI for translation normally (the AI can handle it)
