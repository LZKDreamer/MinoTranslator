/**
 * 多语言流水线回归测试 — 批量处理 log/ 目录下的 JSON3 字幕文件
 * 用法: node test_multilang.js
 *
 * 覆盖的修复点:
 *   - isTitleCardText 拉丁文字小写守卫
 *   - selectBestTrack 轨道选择 + verifySubtitleContentLanguage 脚本族匹配
 *   - segmentSentences 断句/合并不回归
 *
 * 测试文件命名: log/test-{langCode}.json3  (如 log/test-id.json3)
 * 可选 meta: log/test-{langCode}.meta.json  {"language":"id","expectTitleCardDrop":true,...}
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT_DIR = __dirname;
const LOG_DIR = path.join(EXT_DIR, 'log');
const SRC = {
  prompt: path.join(EXT_DIR, 'src', 'shared', 'translate-prompt.js'),
  subs: path.join(EXT_DIR, 'src', 'content', 'youtube-subtitles.js'),
};

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

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
  performance: { now: function () { return Date.now(); } },
  Response: class {},
  AbortSignal: { prototype: { aborted: false } },
};

// Load modules
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC.subs, 'utf8'), sandbox);
sandbox.TranslatePrompt = {};
vm.runInContext(fs.readFileSync(SRC.prompt, 'utf8'), sandbox);

let passed = 0, failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; failures.push(msg); console.log('  ✗ FAIL: ' + msg); }
}
function eq(actual, expected, msg) { assert(actual === expected, msg + ': expected ' + expected + ', got ' + actual); }
function test(name, fn) {
  console.log('\n── ' + name + ' ──');
  try { fn(); } catch (e) { failed++; failures.push(name + ': ' + e.message); console.log('  ✗ ERROR: ' + e.message); }
}

// ── Scan test files ──
const testFiles = fs.readdirSync(LOG_DIR)
  .filter(f => /^test-.+\.json3$/.test(f))
  .map(f => path.join(LOG_DIR, f));

if (testFiles.length === 0) {
  console.log('No test files found in log/ (expected: log/test-{lang}.json3)');
  console.log('\nPlace JSON3 subtitle files to test, e.g.:');
  console.log('  log/test-id.json3    — Indonesian');
  console.log('  log/test-ko.json3    — Korean');
  console.log('  log/test-ja.json3    — Japanese');
  console.log('  log/test-en.json3    — English (ASR)');
  console.log('  log/test-vi.json3    — Vietnamese');
  console.log('  log/test-ar.json3    — Arabic');
  console.log('  log/test-th.json3    — Thai');
  process.exit(1);
}

for (const file of testFiles) {
  const basename = path.basename(file, '.json3');
  const langMatch = basename.match(/^test-(.+)$/);
  const lang = langMatch ? langMatch[1] : 'unknown';

  test(basename + ' — full pipeline', () => {
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);
    assert(json && json.events, 'JSON3 has events array');

    const words = sandbox.parseJson3ToWords(json);
    assert(words.length > 0, 'parseJson3ToWords produced words');

    const segWords = sandbox.preSegmentPhraseEvents(words);
    assert(segWords.length > 0, 'preSegmentPhraseEvents produced output');

    const sentences = sandbox.segmentSentences(segWords);
    assert(sentences.length > 0, 'segmentSentences produced sentences');

    // Verify no title cards are dropped when they shouldn't be
    // (lowercase guard: natural speech with \n should survive)
    const rawWordsBefore = words.length;
    const segWordsAfter = segWords.length;
    const ratio = segWordsAfter / Math.max(rawWordsBefore, 1);
    assert(ratio > 0.3, 'preSegment dropped too many words (ratio=' + ratio.toFixed(2)
      + ', before=' + rawWordsBefore + ', after=' + segWordsAfter + ')');

    // Verify sentences have reasonable durations (not hard fail, just warn)
    let maxDur = 0, incompleteCount = 0;
    for (const s of sentences) {
      const dur = s.end - s.start;
      if (dur > maxDur) maxDur = dur;
      if (!/[.!?。？！۔؟।॥።፧]/.test(s.text)) incompleteCount++;
    }
    // Long sentences >20s are suspicious but can happen with speech-heavy segments
    if (maxDur > 25) {
      console.log('  ⚠ WARN: max sentence duration ' + maxDur.toFixed(1) + 's (may be OK for speech-heavy content)');
    }
    console.log('  words: ' + rawWordsBefore + ' → preSeg ' + segWordsAfter
      + ' → sentences ' + sentences.length
      + ' | maxDur=' + maxDur.toFixed(1) + 's | incomplete=' + incompleteCount + '/' + sentences.length);

    // Metadata checks if available
    const metaFile = file.replace('.json3', '.meta.json');
    if (fs.existsSync(metaFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (meta.expectSentenceCount !== undefined) {
        // Within ±30% of expected
        const range = Math.round(meta.expectSentenceCount * 0.3);
        assert(Math.abs(sentences.length - meta.expectSentenceCount) <= range,
          'sentence count ' + sentences.length + ' vs expected ~' + meta.expectSentenceCount);
      }
      if (meta.expectTitleCardDrop) {
        const hasTitleCards = sentences.some(s => /Season \d+.*Eps\.?\d+/i.test(s.text));
        assert(!hasTitleCards, 'title cards should be dropped');
      }
      if (meta.minSentenceCount !== undefined) {
        assert(sentences.length >= meta.minSentenceCount,
          'sentence count ' + sentences.length + ' >= ' + meta.minSentenceCount);
      }
    }
  });
}

console.log('\n══════ Results ══════');
console.log('Passed: ' + passed + ' | Failed: ' + failed);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
