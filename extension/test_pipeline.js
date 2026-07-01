/**
 * Pipeline regression tests — loads the REAL youtube-subtitles.js + translate-prompt.js
 * in a vm sandbox (browser APIs stubbed) and asserts behavior on fixtures.
 *
 * Covers tasks: 1.4, 1.5, 2.3, 3.2, 4.2, 6.4, 7.1
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT_DIR = __dirname;
const SRC = {
  prompt: path.join(EXT_DIR, 'src', 'shared', 'translate-prompt.js'),
  subs: path.join(EXT_DIR, 'src', 'content', 'youtube-subtitles.js'),
};
const FIXTURE = path.join(EXT_DIR, 'log', 'f.txt');

// ── Stubs for browser/extension APIs ──
const sandbox = {
  console: console,
  debugLog: function () { /* silent */ },
  window: { SUBTITLE_PIPELINE_LOG: false },
  document: {
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    createElement: function () { return { style: {}, classList: { add: function(){}, remove: function(){}, contains: function(){return false;} }, appendChild: function(){}, setAttribute: function(){}, }; },
  },
  DOMParser: class { parseFromString() { return { querySelector: function(){return null;}, querySelectorAll: function(){return [];} }; } },
  chrome: {
    runtime: { getURL: function (p) { return p; }, lastError: null },
    i18n: { getMessage: function () { return ''; } },
    storage: { local: { get: function (_, cb) { if (cb) cb({}); }, set: function (_, cb) { if (cb) cb(); } } },
  },
  fetch: function () { return Promise.resolve({ ok: false, status: 0, headers: { get: function(){return '';} }, text: function () { return Promise.resolve(''); }, json: function () { return Promise.resolve({}); } }); },
  AbortController: class { abort() {} },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  requestAnimationFrame: function () { return 0; },
  cancelAnimationFrame: function () {},
  Promise: Promise,
  JSON: JSON,
  Math: Math,
  Date: Date,
  Array: Array,
  Object: Object,
  String: String,
  Number: Number,
  RegExp: RegExp,
  Error: Error,
  parseInt: parseInt,
  isNaN: isNaN,
  Infinity: Infinity,
  NaN: NaN,
  Symbol: Symbol,
  Map: Map,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC.prompt, 'utf8'), sandbox, { filename: 'translate-prompt.js' });
vm.runInContext(fs.readFileSync(SRC.subs, 'utf8'), sandbox, { filename: 'youtube-subtitles.js' });

// ── Tiny test framework ──
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, msg + ' (got ' + a + ', expected ' + e + ')');
}
function section(name) { console.log('\n── ' + name + ' ──'); }

// ── Helpers ──
function makeWord(text, start, end, extra) {
  return Object.assign({ text: text, start: start, end: end, lineBreak: false, nonSpeech: false, speakerChange: false }, extra || {});
}
function textsOf(words) { return words.map(function (w) { return w.text; }); }

// ════════════════════════════════════════════
// Task 1.5: preSegmentPhraseEvents on fixture cases
// ════════════════════════════════════════════
section('1.5a: multi-speaker event "Yeah.\\n- I say okay.  - Maybe it\'s okay." → 3 pieces');
{
  const input = [makeWord("Yeah.\n- I say okay.  - Maybe it's okay.", 220132, 222406)];
  const out = sandbox.preSegmentPhraseEvents(input);
  eq(out.length, 3, 'should split into 3 pieces');
  eq(textsOf(out), ['Yeah.', 'I say okay.', "Maybe it's okay."], 'texts');
  assert(out[0].speakerChange === false, 'first piece not speakerChange');
  assert(out[1].speakerChange === true, 'second piece speakerChange (from \\n-)');
  assert(out[2].speakerChange === true, 'third piece speakerChange (from  - )');
  assert(out[0].start === 220132, 'first start = event start');
  assert(out[2].end === 222406, 'last end = event end');
}

section('1.5b: titleCard "Topa, China\\nSeason 8 - Eps.114" → dropped');
{
  const input = [makeWord("Topa, China\nSeason 8 - Eps.114", 21878, 26423)];
  const out = sandbox.preSegmentPhraseEvents(input);
  eq(out.length, 0, 'titleCard should be dropped');
}

section("1.5c: internal punctuation \"It's here. I think\" → 2 pieces");
{
  const input = [makeWord("It's here. I think", 453599, 455639)];
  const out = sandbox.preSegmentPhraseEvents(input);
  eq(out.length, 2, 'should split into 2 pieces');
  eq(textsOf(out), ["It's here.", 'I think'], 'texts');
  assert(out[0].speakerChange === false && out[1].speakerChange === false, 'no speakerChange');
  assert(out[0].start === 453599, 'first start = event start');
  assert(out[1].end === 455639, 'second end = event end');
}

// ════════════════════════════════════════════
// Task 1.4: word-level json3 unchanged
// ════════════════════════════════════════════
section('1.4: word-level json3 (single words, no internal punctuation) unchanged');
{
  const input = [
    makeWord('Hello', 1000, 1500),
    makeWord('world.', 1500, 2000),
    makeWord('How', 2100, 2400, { speakerChange: true }),
    makeWord('are', 2400, 2700),
    makeWord('you?', 2700, 3000),
  ];
  const out = sandbox.preSegmentPhraseEvents(input);
  eq(out.length, input.length, 'word count unchanged');
  for (let i = 0; i < input.length; i++) {
    assert(out[i].text === input[i].text, 'text[' + i + '] unchanged');
    assert(out[i].start === input[i].start && out[i].end === input[i].end, 'timestamps[' + i + '] unchanged');
    assert(out[i].speakerChange === input[i].speakerChange, 'speakerChange[' + i + '] unchanged');
  }
}

section('1.4b: lineBreak / nonSpeech words pass through');
{
  const lb = makeWord('', 1000, 1100, { lineBreak: true });
  const ns = makeWord('[Music]', 2000, 3000, { nonSpeech: true });
  const out = sandbox.preSegmentPhraseEvents([lb, ns]);
  eq(out.length, 2, 'both pass through');
  assert(out[0].lineBreak === true && out[1].nonSpeech === true, 'flags preserved');
}

// ════════════════════════════════════════════
// Extra titleCard / non-titleCard edge cases
// ════════════════════════════════════════════
section('titleCard edge cases');
{
  // multi-speaker with no ending punctuation → NOT titleCard (has speaker marker)
  assert(sandbox.isTitleCardText("Chame means top up.\n- Okay") === false, 'multi-speaker no-ending-punct not titleCard');
  // text with \n and ending punctuation → NOT titleCard
  assert(sandbox.isTitleCardText("And what you see here is Kashi?\nthat is Kashgar.") === false, '\\n with ending punct not titleCard');
  // all-caps with ending punct → NOT titleCard (emphatic dialogue)
  assert(sandbox.isTitleCardText("YEAH. YEAH.") === false, 'all-caps with ending punct not titleCard');
  // episode pattern → titleCard
  assert(sandbox.isTitleCardText("Season 8 - Eps.114") === true, 'episode pattern is titleCard');
  // all-caps no ending punct ≤6 words → titleCard
  assert(sandbox.isTitleCardText("PART ONE") === true, 'all-caps no-punct short is titleCard');
  // Indonesian multi-line subtitle with lowercase → NOT titleCard (natural speech with \n layout)
  var idTest = "Sudah lebih dari belasan negara ku\nlewati dalam perjalanan ini";
  assert(sandbox.isTitleCardText(idTest) === false, 'Indonesian multi-line subtitle not titleCard');
  assert(sandbox.preSegmentPhraseEvents([makeWord(idTest, 359, 4880)]).length === 1, 'Indonesian multi-line not dropped by preSegment');
  // multi-line natural English subtitle → NOT titleCard
  assert(sandbox.isTitleCardText("But this is India\nThere is no wrong way") === false, 'English multi-line subtitle not titleCard');
  // truly-garbled all-caps multi-line with NO lowercase → still titleCard
  assert(sandbox.isTitleCardText("TOPA CHINA\nBEAUTIFUL PLACE") === true, 'all-caps multi-line no-lowercase still titleCard');
  // Thai multi-line with \n → NOT titleCard (non-Latin script guard)
  assert(sandbox.isTitleCardText("ตอนนี้อยู่ที่เวียดนาม\nนะคะแล้วก็เอ่อกำลังเดิน") === false, 'Thai multi-line not titleCard');
  // Thai with >> speaker encoding → NOT titleCard (>> guard)
  assert(sandbox.isTitleCardText("ไม่ได้เรื่อย\n>> คนนี้ชื่อน้องโย") === false, 'Thai >> speaker not titleCard');
  // Korean multi-line with \n → NOT titleCard (non-Latin script guard)
  assert(sandbox.isTitleCardText("부산행\n기차 안에서") === false, 'Korean multi-line not titleCard');
  // Pure Latin all-caps multi-line → still titleCard (no guard triggers)
  assert(sandbox.isTitleCardText("SEASON 2\nEPISODE 5") === true, 'pure Latin all-caps multi-line still titleCard');
}

// ════════════════════════════════════════════
// Task 3.2: cleanCueText("Oh, eeeee.") → "Oh."
// ════════════════════════════════════════════
section('3.2: cleanCueText "Oh, eeeee." → "Oh." (forTranslation:true)');
{
  const out = sandbox.TranslatePrompt.cleanCueText('Oh, eeeee.', { forTranslation: true });
  eq(out, 'Oh.', 'Oh, eeeee. → Oh.');
  // cache key uses forTranslation:true too — same cleaned text
  const cacheCleaned = sandbox.TranslatePrompt.cleanCueText('Oh, eeeee.', { forTranslation: true });
  eq(cacheCleaned, out, 'cache key path matches display path');
}

// ════════════════════════════════════════════
// Task 4.2: "Jama sh" overlapping with neighbors → sparse garbage, discarded
// ════════════════════════════════════════════
section('4.2: "Jama sh" (2-word, overlapping both neighbors) → discarded');
{
  // Simulate the pipeline-log scenario: A(complete) | B("Jama sh" overlaps A, close to C) | C(complete)
  // Gap B→C >2s so segmentSentences splits them (SENTENCE_GAP_MS=2000); both gaps ≤5000 → sandwiched garbage.
  const words = [
    makeWord('full full.', 168800, 169500),
    makeWord('Yeah.', 169500, 172220),
    makeWord('Jama sh', 171920, 174640),   // overlaps Yeah. (171920 < 172220), close to Okay.
    makeWord('Okay.', 178000, 178800),     // gap 3360ms from Jama sh (>2s → separate segment, ≤5s → sandwiched)
  ];
  const sentences = sandbox.segmentSentences(words);
  const found = sentences.some(function (s) { return /Jama sh/.test(s.text); });
  assert(!found, '"Jama sh" should NOT appear in final sentences (was: ' + JSON.stringify(sentences.map(function(s){return s.text;})) + ')');
}

// ════════════════════════════════════════════
// Task 2.3: "Oh," orphan after complete sentence → no independent "Oh," cue
// ════════════════════════════════════════════
section("2.3a: #0 complete + #1 'Oh,' orphan (0s gap) + #2 far → no independent 'Oh,' cue");
{
  // A="Oh, maybe here."(complete) B="Oh, eeeee."(complete, 1 word) C="I'm just going."(far, 14s gap)
  // Backward merge should absorb B into A (gap 0s, B ≤3 words).
  const words = [
    makeWord("Oh, maybe I should break a little bit here.", 240, 2051),
    makeWord("Oh, eeeee.", 2051, 3351),
    makeWord("I'm just going to go for it.", 17359, 18840),
  ];
  const sentences = sandbox.segmentSentences(words);
  // "Oh, eeeee." should not be a standalone cue; backward-merged into the first
  const standalone = sentences.filter(function (s) { return /^Oh, eeeee\.$/.test(s.text.trim()); });
  eq(standalone.length, 0, '"Oh, eeeee." should not be standalone (got: ' + JSON.stringify(sentences.map(function(s){return s.text;})) + ')');
}

// ════════════════════════════════════════════
// Task 2.3b: "So, in the last"(4 words) + "episode..." → merged (FRAGMENT_MERGE_MAX_WORDS=4)
// ════════════════════════════════════════════
section('2.3b: "So, in the last"(4w, no end) + "episode..." → merged into one cue');
{
  const words = [
    makeWord('So, in the last', 358000, 358800),   // 4 words, no sentence-ender
    makeWord('episode, I already said that the whole of China is one time zone, whereas of course given', 358880, 365360),
  ];
  const sentences = sandbox.segmentSentences(words);
  // Forward merge (FRAGMENT_MERGE_MAX_WORDS=4) should combine them
  const soLine = sentences.filter(function (s) { return /^So, in the last/.test(s.text); });
  eq(soLine.length, 1, 'should be a single merged cue containing "So, in the last"');
  assert(soLine[0].text.indexOf('episode') !== -1, 'merged cue should contain "episode"');
}

// ════════════════════════════════════════════
// Task 6.4: parser hardening — truncated object / wrapper / non-consecutive keys
// ════════════════════════════════════════════
section('6.4a: truncated object {"0":"a","1":"b","2":"c → repaired length 2');
{
  const repaired = sandbox.tryRepairTruncatedJson('{"0":"a","1":"b","2":"c');
  eq(repaired, ['a', 'b'], 'truncated object repaired to ["a","b"]');
  // Full parse: aligns to expectedLength=3 with empty for missing index 2
  const parsed = sandbox.parseTranslationArray('{"0":"a","1":"b","2":"c', 3);
  eq(parsed, ['a', 'b', ''], 'parseTranslationArray aligns to length 3');
}

section('6.4b: wrapper {"translations":["a","b"]} → unwrapped');
{
  const parsed = sandbox.parseTranslationArray('{"translations":["第一句","第二句"]}', 2);
  eq(parsed, ['第一句', '第二句'], 'wrapper unwrapped to array');
}

section('6.4c: non-consecutive keys {"0":"a","2":"c" → null (repair discarded)');
{
  // Last value has closing " but keys [0,2] are non-consecutive → repair returns null → throws
  let threw = false;
  try {
    sandbox.parseTranslationArray('{"0":"a","2":"c"', 2);
  } catch (_e) { threw = true; }
  assert(threw, 'non-consecutive keys should cause parse to throw (not valid JSON path)');
  // Direct repair returns null
  const repaired = sandbox.tryRepairTruncatedJson('{"0":"a","2":"c"');
  eq(repaired, null, 'tryRepairTruncatedJson returns null for non-consecutive keys');
}

// ════════════════════════════════════════════
// Task 7.1: Full pipeline regression on f.txt
// ════════════════════════════════════════════
section('7.1: full pipeline on f.txt — no 0.8s orphans, titleCards dropped, multi-speaker split');
{
  const json = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const words = sandbox.parseJson3ToWords(json);
  const segWords = sandbox.preSegmentPhraseEvents(words);
  const sentences = sandbox.segmentSentences(segWords);
  // Clean (D6: forTranslation:true)
  const cleaned = sentences.map(function (s) {
    return { start: s.start, end: s.end, text: sandbox.TranslatePrompt.cleanCueText(s.text, { forTranslation: true }) };
  }).filter(function (s) { return s.text.length > 0; });

  console.log('  f.txt: ' + words.length + ' raw words → ' + segWords.length + ' pre-segmented → ' + sentences.length + ' sentences → ' + cleaned.length + ' cleaned');

  // 1) Title card "Topa, China\nSeason 8 - Eps.114" must NOT appear
  const hasTitleCard = cleaned.some(function (s) { return /Season \d+ - Eps\.\d+/.test(s.text); });
  assert(!hasTitleCard, 'title card "Topa, China Season 8 Eps.114" must be dropped');

  // 2) Multi-speaker event "Yeah.\n- I say okay.  - Maybe it's okay." must be split (not one merged cue)
  const mergedSpeaker = cleaned.filter(function (s) { return /I say okay.*Maybe it's okay/.test(s.text); });
  eq(mergedSpeaker.length, 0, 'multi-speaker event must be split, not merged into one cue');

  // 3) No 0.8s orphan cues of the "Oh," type (non-sentence, should-have-been-merged fragment).
  //    A speaker-change interjection like "Okay" from "Chame means top up.\n- Okay" is legitimate
  //    (hardBreak prevents merge) and stretched to 0.8s by MIN_DISPLAY_SEC — not an orphan flash.
  const orphan08 = cleaned.filter(function (s) {
    const dur = s.end - s.start;
    return Math.abs(dur - 0.8) < 0.01 && !/[.?!。？！]$/.test(s.text.trim());
  });
  console.log('  0.8s non-sentence orphans: ' + orphan08.length + (orphan08.length ? ' → ' + JSON.stringify(orphan08.map(function (s) { return s.text; })) : ''));
  // The "Oh," orphan (task 2.3) must be gone; speaker-change interjections (Okay/Yeah/Right) are allowed
  const ohOrphan = orphan08.filter(function (s) { return /^Oh,?$/.test(s.text.trim()); });
  eq(ohOrphan.length, 0, '"Oh," orphan must not exist (the task 2.3 target)');
  // Total orphans should be minimal (speaker-change interjections only, ≤3)
  assert(orphan08.length <= 3, '0.8s non-sentence orphans should be ≤3 (speaker-change interjections only), got ' + orphan08.length);

  // 4) "Jama sh" must NOT appear (sparse garbage, even if not in f.txt — guard against regression)
  const hasJamaSh = cleaned.some(function (s) { return /Jama sh/.test(s.text); });
  assert(!hasJamaSh, '"Jama sh" must not appear in final output');

  // 5) "So, in the last" + "episode" must be merged (no standalone "So, in the last")
  const standaloneSo = cleaned.filter(function (s) { return /^So, in the last$/.test(s.text.trim()); });
  eq(standaloneSo.length, 0, '"So, in the last" must not be standalone (forward-merged into episode...)');
}

// ════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════
console.log('\n════════════════════════');
console.log('Passed: ' + passed + ' | Failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);
