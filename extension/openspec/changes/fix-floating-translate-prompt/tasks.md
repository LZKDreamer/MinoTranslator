## 1. Source language detection

- [x] 1.1 Add `detectSourceLanguage(text)` to `constants.js` with Unicode range priority: kana→ja, hangul→ko, CJK→zh-CN, arabic→ar, thai→th, cyrillic→ru, latin-dominant→en, else null
- [x] 1.2 Handle edge cases: empty string, whitespace-only, mixed scripts (Hangul + English → ko, not en)

## 2. Enhanced floating translate prompt

- [x] 2.1 Add `sourceLanguage` parameter to `buildFloatingPrompt` signature in `translate-prompt.js`
- [x] 2.2 Add CRITICAL directive block matching `buildBatchTranslatePrompt` structure — variable-based, no hardcoded language names
- [x] 2.3 When `sourceLanguage` is known: include "Translate from {source} to {target}" in the prompt
- [x] 2.4 When `sourceLanguage` is null: omit "from X" phrase, keep CRITICAL directive

## 3. Integration in translator

- [x] 3.1 In `Translator.translate()`, call `detectSourceLanguage(text)` before `buildFloatingPrompt`
- [x] 3.2 Pass detection result to `buildFloatingPrompt` via `sourceLanguage` field

## 4. Verification

- [ ] 4.1 Manually test Korean→Simplified Chinese floating translate on a non-YouTube page
- [ ] 4.2 Manually test Japanese→Simplified Chinese floating translate
- [ ] 4.3 Manually test English→Simplified Chinese floating translate
- [ ] 4.4 Verify target language switcher works correctly (switch to English, translate Korean→English)
- [ ] 4.5 Verify YouTube subtitle translation still works (no regression)
