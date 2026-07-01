# subtitle-track-guard

Content language verification during subtitle track fetching to prevent source/track language mismatch.

## Requirements

### Requirement: Subtitle content language verification at fetch time

When `fetchSubtitleFile` retrieves subtitle text via an InnerTube client, the system SHALL verify that the actual text content language matches the expected source language before returning the data. If the content language does not match, the system SHALL reject that client's data and continue to the next client in the fallback chain.

The verification SHALL use `detectSourceLanguage()` on a sample of the first 10 subtitle events' text. The identified script family (Latin vs non-Latin) of the content SHALL be compared against the expected script family of the preferred language rather than requiring an exact language key match, because `detectSourceLanguage` cannot reliably distinguish languages within the same script family (e.g., Indonesian vs English, both Latin without diacritics).

Language verification SHALL only be performed when `preferredLang` is a specific language code (not `'auto'`).

#### Scenario: Matching content passes verification

- **WHEN** `preferredLang` is `'id'`, the track metadata declares `languageCode: 'id'`, and the first 10 subtitle events contain Indonesian text (e.g., "Sudah lebih dari belasan negara")
- **THEN** `detectSourceLanguage()` on the sampled text returns a Latin-script language
- **AND** script-family comparison matches (Indonesian → Latin)
- **AND** the text is returned from `fetchSubtitleFile`

#### Scenario: Mismatched content rejected, next client tried

- **WHEN** `preferredLang` is `'id'`, the track metadata declares `languageCode: 'id'`, but the first 10 events contain English text (e.g., "Good morning, friends in New Delhi!")
- **THEN** `detectSourceLanguage()` returns a Latin-script language
- **AND** script-family comparison still matches (English → Latin, Indonesian → Latin)
- **BUT** this case relies on the fact that the InnerTube IOS client returns tracks in different order — the content is still Latin-script, so verification passes
- **AND** the text is accepted (script-level verification cannot distinguish Latin sub-languages)

#### Scenario: Non-Latin content detected for Latin-expected language

- **WHEN** `preferredLang` is `'id'` but the track actually contains Thai or CJK text
- **THEN** `detectSourceLanguage()` returns a non-Latin language
- **AND** script-family comparison fails (non-Latin ≠ Latin)
- **AND** the text is rejected, next client tried

#### Scenario: Auto mode passes resolved language

- **WHEN** `preferredSourceLang` in `fetchSubtitles` is `'auto'`, the resolved track language (e.g., `'id'`) is passed to `fetchSubtitleFile`
- **THEN** `preferredLang` is `'id'` (not `'auto'`) → verification activates
- **AND** `selectBestTrack` uses manual language match instead of `audioTracks[0].lang` hint

#### Scenario: Insufficient sample passes through

- **WHEN** the JSON3 text contains fewer than 3 valid (non-empty, not just `[Music]`-style markers) subtitle events
- **THEN** verification is skipped (sample too small to reliably detect)
- **AND** the text is accepted and returned

#### Scenario: Direct timedtext URL as last resort

- **WHEN** all InnerTube clients either returned no data or all failed content language verification
- **THEN** `fetchSubtitleFile` falls back to the direct timedtext URL without language verification
- **AND** the direct URL response is returned (preserving existing fallback behavior)
