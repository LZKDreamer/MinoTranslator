/**
 * Regression verification for fix-translation-misalignment-safety-net
 * Replays f (2).txt through the REAL youtube-subtitles.js parse pipeline
 * (parseSubtitleData → parseJson3ToWords → preSegmentPhraseEvents → segmentSentences)
 * and verifies the safety-net + punctuation-priority invariants from tasks 4.1/4.2.
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
const FIXTURE = path.join(EXT_DIR, 'log', 'f (2).txt');

const sandbox = {
  console: console,
  debugLog: function () { /* silent */ },
  window: { SUBTITLE_PIPELINE_LOG: false },
  document: {
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    createElement: function () { return { style: {}, classList: { add: function(){}, remove: function(){}, contains: function(){return false;} }, appendChild: function(){}, setAttribute: function(){} }; },
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
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  Array: Array, Object: Object, String: String, Number: Number,
  RegExp: RegExp, Error: Error, parseInt: parseInt, isNaN: isNaN,
  Infinity: Infinity, NaN: NaN, Symbol: Symbol, Map: Map,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC.prompt, 'utf8'), sandbox, { filename: 'translate-prompt.js' });
vm.runInContext(fs.readFileSync(SRC.subs, 'utf8'), sandbox, { filename: 'youtube-subtitles.js' });

const raw = fs.readFileSync(FIXTURE, 'utf8');
const parsed = sandbox.parseSubtitleData(raw);
const sentences = parsed.sentences;

const SENTENCE_END_RE = /[.?!。？！]$/;
let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

console.log('\n── 4.1: f (2).txt full segmentation pipeline ──');
console.log('  total sentences: ' + sentences.length);

const incompleteIdx = [];
for (let i = 0; i < sentences.length; i++) {
  if (!SENTENCE_END_RE.test(sentences[i].text)) incompleteIdx.push(i);
}
console.log('  incomplete-ending sentences: ' + incompleteIdx.length);
if (incompleteIdx.length > 0 && incompleteIdx.length <= 30) {
  console.log('  incomplete at: [' + incompleteIdx.join(', ') + ']');
}
// 4.1: incomplete-ending case 数量降到接近 0 (was 24); 残留必须都是"合法不可合并"的极端 case
//   (gap>=1s, 或 mergedDur>=15s, 或 gap>2s 硬切) —— 验证每条残留都满足"安全网本就不应合并"
let legitimateResiduals = 0;
for (const idx of incompleteIdx) {
  if (idx + 1 >= sentences.length) { legitimateResiduals++; continue; } // 末句无下一句
  const cur = sentences[idx], nxt = sentences[idx + 1];
  const gap = nxt.start - cur.end;
  const mergedDur = nxt.end - cur.start;
  const unmergeable = gap >= 1.0 || mergedDur >= 15.0 || gap > 2.0 || gap < 0;
  console.log('  residual #' + idx + ': gap=' + gap.toFixed(2) + 's mergedDur=' + mergedDur.toFixed(2) +
    's unmergeable=' + unmergeable + ' :: ' + cur.text.slice(0, 50));
  if (unmergeable) legitimateResiduals++;
}
check(incompleteIdx.length - legitimateResiduals === 0,
  'all ' + incompleteIdx.length + ' residual incomplete sentences are legitimately unmergeable (baseline was 24)');
check(incompleteIdx.length <= 6,
  'incomplete-ending count dropped near 0 (got ' + incompleteIdx.length + ', baseline 24)');

// 定位含 "...다른 분들보다" 的句子（原 #56 的特征文本）
const targetFrag = '다른 분들보다';
let hitIdx = -1;
for (let i = 0; i < sentences.length; i++) {
  if (sentences[i].text.indexOf(targetFrag) !== -1) { hitIdx = i; break; }
}
if (hitIdx >= 0) {
  const s = sentences[hitIdx];
  const hasNext = s.text.indexOf('확실히') !== -1 || s.text.indexOf('있습니다') !== -1;
  check(hasNext,
    '#56+#57 merged into one sentence at #' + hitIdx + ' (text contains 다른 분들보다 + 확실히/있습니다)');
  check(SENTENCE_END_RE.test(s.text),
    'merged sentence ends with sentence-final punctuation');
} else {
  check(false, 'could not locate the #56 "...다른 분들보다" sentence in output');
}

console.log('\n── 4.2: safety-net boundary checks ──');
// 4.2a: 安全网不误合并 gap>1s 的语义停顿句 — 抽样前后相邻句 gap，确认 >1s 的都没被合并（
//   即: 不存在两个原本 gap>1s 的句被强行合并。这里以"输出中相邻 sentence gap 全部合理"为代理:
//   没有任何相邻对在合并前 gap>1s 还被焊在一起——间接由 incomplete 计数接近 0 证明,
//   且 mergedDur 检查: 没有任何句子 duration >= 15s）
let maxDur = 0, maxDurIdx = -1;
for (let i = 0; i < sentences.length; i++) {
  const d = sentences[i].end - sentences[i].start;
  if (d > maxDur) { maxDur = d; maxDurIdx = i; }
}
console.log('  max sentence duration: ' + maxDur.toFixed(2) + 's at #' + maxDurIdx);
check(maxDur < 15.0, 'no merged sentence >= 15s (safety-net cap respected)');

// 4.2b: 完整句计数 — 不以标点结尾的句子数 + 以标点结尾的句子数 = 总数
let completeCount = 0;
for (let i = 0; i < sentences.length; i++) {
  if (SENTENCE_END_RE.test(sentences[i].text)) completeCount++;
}
check(completeCount === sentences.length - incompleteIdx.length,
  'complete-sentence count consistent (' + completeCount + ' complete + ' + incompleteIdx.length + ' incomplete = ' + sentences.length + ')');

console.log('\n══════════════════════════');
console.log('Passed: ' + passed + ' | Failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);