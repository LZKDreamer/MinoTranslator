/**
 * f(3).txt (源 json3) ↔ subtitle-pipeline-log (4).txt 交叉校验
 * - 用真实 parseSubtitleData 跑 f(3).txt，得到 final sentences
 * - 与 (4).txt 的 [Pipeline] 段逐句对比（idx/start/end/text）
 * - 与 (4).txt 的 [Translate] 段对齐检查
 * - 反查源 json3 words：每条 final sentence 的词是否都来自源（无幻觉）
 * - 时间戳完整性：单调非递减、邻句 end<=next.start+buffer、无反向
 * - 残留 5 个 incomplete：定位源词序列，看是否真的无标点结尾（ASR 漏 vs 切错）
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
const FIXTURE = path.join(EXT_DIR, 'log', 'f (3).txt');
const LOGFILE = path.join(EXT_DIR, 'log', 'subtitle-pipeline-log (4).txt');

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
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  Array: Array, Object: Object, String: String, Number: Number,
  RegExp: RegExp, Error: Error, parseInt: parseInt, isNaN: isNaN,
  Infinity: Infinity, NaN: NaN, Symbol: Symbol, Map: Map,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC.prompt, 'utf8'), sandbox, { filename: 'translate-prompt.js' });
vm.runInContext(fs.readFileSync(SRC.subs, 'utf8'), sandbox, { filename: 'youtube-subtitles.js' });

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

// ── parse source ──
const raw = fs.readFileSync(FIXTURE, 'utf8');
const json = JSON.parse(raw);
const events = json.events || [];
const allWords = sandbox.parseJson3ToWords(json);
const preSeg = sandbox.preSegmentPhraseEvents(allWords);
const sentences = sandbox.segmentSentences(preSeg);

console.log('── source ──');
console.log('  events: ' + events.length);
console.log('  raw words: ' + allWords.length);
console.log('  pre-segmented: ' + preSeg.length);
console.log('  final sentences: ' + sentences.length);

// ── parse log ──
const logLines = fs.readFileSync(LOGFILE, 'utf8').split(/\r?\n/);
const pipeLog = [], transLog = [];
for (const l of logLines) {
  let m = l.match(/^\[Pipeline\] #(\d+) │ ([\d.]+) → ([\d.]+) \(([\d.]+)s\) │ (.*)$/);
  if (m) pipeLog.push({ idx: +m[1], start: +m[2], end: +m[3], dur: +m[4], text: m[5] });
  m = l.match(/^\[Translate\] #(\d+) │ ([\d.]+)→([\d.]+) │ ORIG: (.*) │ TRANS: (.*)$/);
  if (m) transLog.push({ idx: +m[1], start: +m[2], end: +m[3], orig: m[4], trans: m[5] });
}
console.log('  log pipeline: ' + pipeLog.length + '  translate: ' + transLog.length);

// ── 1) code output vs log consistency ──
console.log('\n── code output vs log pipeline ──');
check(sentences.length === pipeLog.length,
  'code sentences = log pipeline count (' + sentences.length + ' vs ' + pipeLog.length + ')');
let mismatch = 0;
for (let i = 0; i < Math.min(sentences.length, pipeLog.length); i++) {
  const s = sentences[i], p = pipeLog[i];
  if (Math.abs(s.start - p.start) > 0.001 || Math.abs(s.end - p.end) > 0.001 || s.text !== p.text) {
    mismatch++;
    if (mismatch <= 5) console.error('    diff #' + i + ': code(' + s.start + ',' + s.end + ',"' + s.text.slice(0,40) + '") vs log(' + p.start + ',' + p.end + ',"' + p.text.slice(0,40) + '")');
  }
}
check(mismatch === 0, 'all ' + sentences.length + ' sentences code/log identical (idx/start/end/text)');

// ── 2) translate alignment ──
console.log('\n── translate alignment ──');
check(pipeLog.length === transLog.length,
  'pipeline = translate count (' + pipeLog.length + ')');
let tMismatch = 0;
for (let i = 0; i < Math.min(pipeLog.length, transLog.length); i++) {
  const p = pipeLog[i], t = transLog[i];
  if (p.idx !== t.idx || Math.abs(p.start - t.start) > 0.001 || Math.abs(p.end - t.end) > 0.001 || p.text !== t.orig) {
    tMismatch++;
  }
}
check(tMismatch === 0, 'all ' + transLog.length + ' translations 1:1 aligned');

// ── 3) timestamp integrity ──
console.log('\n── timestamp integrity ──');
let nonMonoStart = 0, overlapNoBuf = 0, prevEnd = -Infinity;
for (let i = 0; i < sentences.length; i++) {
  const s = sentences[i];
  if (s.start < prevEnd - 0.3) { overlapNoBuf++; } // OVERLAP_BUFFER_SEC=0.3
  if (i > 0 && s.start < sentences[i-1].start) nonMonoStart++;
  if (s.end < s.start) console.error('    NEG dur #' + i);
  prevEnd = s.end;
}
check(nonMonoStart === 0, 'all sentence starts monotonic non-decreasing');
check(overlapNoBuf === 0, 'no overlapping sentences beyond OVERLAP_BUFFER 0.3s');

// ── 4) word-level provenance: every sentence word appears in source ──
console.log('\n── word provenance (no hallucination) ──');
// build set of source word texts from POST-preSegment (which is what segmentSentences actually consumes)
// preSegment splits glued seg utf8 at internal punctuation, so use those for matching.
const srcTexts = {};
for (const w of preSeg) {
  if (w.lineBreak || w.nonSpeech) continue;
  const t = (w.text || '').replace(/^>>\s*/, '').trim();
  if (!t) continue;
  srcTexts[t] = (srcTexts[t] || 0) + 1;
}
// 每个句子里的每个 word 应能在 srcTexts 找到
let phantomWords = 0;
const phantomSamples = [];
for (const s of sentences) {
  const toks = s.text.split(/\s+/).filter(x => x.length > 0);
  for (const tok of toks) {
    if (!srcTexts[tok]) {
      phantomWords++;
      if (phantomSamples.length < 5) phantomSamples.push(tok);
    }
  }
}
check(phantomWords === 0, 'no phantom (synthesised) words in output' + (phantomSamples.length ? ' [e.g. ' + JSON.stringify(phantomSamples) + ']' : ''));

// ── 5) text preservation: source word count vs final consumed count ──
console.log('\n── text preservation ──');
let srcWordCnt = 0;
for (const w of allWords) {
  if (w.lineBreak || w.nonSpeech) continue;
  const t = (w.text || '').replace(/^>>\s*/, '').trim();
  if (t) srcWordCnt++;
}
// count words in final sentences
let finalWordCnt = 0;
for (const s of sentences) finalWordCnt += s.text.split(/\s+/).filter(x => x.length).length;
console.log('  source real-word count: ' + srcWordCnt);
console.log('  final sentences word count: ' + finalWordCnt);
// final may omit words dropped by sparse-garbage / repetition-garbage, but should never exceed source
check(finalWordCnt <= srcWordCnt, 'final words (' + finalWordCnt + ') <= source real words (' + srcWordCnt + ') (no invention)');
const dropRate = (srcWordCnt - finalWordCnt) / srcWordCnt;
console.log('  drop rate: ' + (dropRate * 100).toFixed(2) + '% (sparse/repetition garbage)');
check(dropRate < 0.05, 'drop rate < 5% (sparse-garbage + repetition-garbage not over-aggressive)');

// ── 6) 5 个残留 incomplete 的源词反查 ──
console.log('\n── residual incomplete: source audit ──');
const SENTENCE_END_RE = /[.?!。？！]$/;
const incomplete = sentences.filter(s => !SENTENCE_END_RE.test(s.text));
for (const s of incomplete) {
  // find source words whose start matches s.start (sec->ms)
  const startMs = Math.round(s.start * 1000);
  // find index in allWords around that start
  let firstIdx = -1;
  for (let i = 0; i < allWords.length; i++) {
    if (Math.abs(allWords[i].start - startMs) < 5 && !(allWords[i].lineBreak || allWords[i].nonSpeech)) { firstIdx = i; break; }
  }
  // walk source words from firstIdx collecting tokens at the sentence end + next
  const nextIdx = sentences.indexOf(s) + 1;
  const nextS = sentences[nextIdx];
  // Look in raw words from s.start to nextS.end+some
  const endMs = nextS ? Math.round(nextS.end * 1000) : Math.round(s.end * 1000) + 2000;
  const slice = [];
  for (let i = firstIdx; i < allWords.length && allWords[i].start <= endMs + 50; i++) {
    if (allWords[i].lineBreak || allWords[i].nonSpeech) continue;
    const t = (allWords[i].text || '').replace(/^>>\s*/, '').trim();
    if (t) slice.push(allWords[i].start + ':' + t);
  }
  console.log('  residual start=' + s.start + ' dur=' + (s.end - s.start).toFixed(2) + 's');
  console.log('    text: ' + s.text.slice(0, 70));
  if (nextS) {
    const gap = nextS.start - s.end;
    const mergedDur = nextS.end - s.start;
    console.log('    next gap=' + gap.toFixed(2) + 's mergedDur=' + mergedDur.toFixed(2) + 's');
  }
  // scan the source word slice for any sentence-ending punctuation in this region
  const punctWords = slice.filter(x => /[.?!。？！]$/.test(x.split(':').slice(1).join(':'))).slice(0, 3);
  console.log('    punct words in source slice (first 3): ' + (punctWords.length ? punctWords.join(' | ') : '(none — ASR truly omitted)'));
}

console.log('\n══════════════════════════');
console.log('Passed: ' + passed + ' | Failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);