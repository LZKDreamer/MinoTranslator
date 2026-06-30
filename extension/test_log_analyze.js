'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'log', 'subtitle-pipeline-log (4).txt');
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

const SENTENCE_END_RE = /[.?!。？！]$/;
let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

// ── Pipeline section (#0..#N) ──
const pipeLines = [];
for (const l of lines) {
  const m = l.match(/^\[Pipeline\] #(\d+) │ ([\d.]+) → ([\d.]+) \(([\d.]+)s\) │ (.*)$/);
  if (m) pipeLines.push({ idx: +m[1], start: +m[2], end: +m[3], dur: +m[4], text: m[5] });
}
// ── Translate section (#0..#N) ──
const trLines = [];
for (const l of lines) {
  const m = l.match(/^\[Translate\] #(\d+) │ ([\d.]+)→([\d.]+) │ ORIG: (.*) │ TRANS: (.*)$/);
  if (m) trLines.push({ idx: +m[1], start: +m[2], end: +m[3], orig: m[4], trans: m[5] });
}

console.log('── log structure ──');
console.log('  pipeline sentences: ' + pipeLines.length);
console.log('  translate entries : ' + trLines.length);

// 1) Pipeline / Translate count match (alignment length)
console.log('\n── alignment ──');
check(pipeLines.length === trLines.length,
  'pipeline count = translate count (' + pipeLines.length + ' vs ' + trLines.length + ')');
// per-index alignment
let misalign = 0;
for (let i = 0; i < Math.min(pipeLines.length, trLines.length); i++) {
  if (pipeLines[i].idx !== trLines[i].idx) { misalign++; }
  else if (pipeLines[i].start !== trLines[i].start || pipeLines[i].end !== trLines[i].end) { misalign++; }
  else if (pipeLines[i].text !== trLines[i].orig) { misalign++; }
}
check(misalign === 0, 'all ' + trLines.length + ' translations aligned 1:1 with pipeline (idx/start/end/orig)');

// 2) Incomplete endings (pipeline)
console.log('\n── incomplete endings (pipeline) ──');
const incomplete = [];
for (const p of pipeLines) {
  if (!SENTENCE_END_RE.test(p.text)) incomplete.push(p);
}
console.log('  incomplete-ending pipeline sentences: ' + incomplete.length);
for (const p of incomplete) {
  console.log('    #' + p.idx + ' (' + p.dur + 's): ' + p.text.slice(0, 50));
  const next = pipeLines[p.idx + 1];
  if (next) {
    const gap = next.start - p.end;
    const mergedDur = next.end - p.start;
    const why = gap >= 1.0 ? 'gap>=1s' : (mergedDur >= 15.0 ? 'merged>=15s' : (gap > 2.0 ? 'gap>2s hardbreak' : '??'));
    console.log('      → next gap=' + gap.toFixed(2) + 's mergedDur=' + mergedDur.toFixed(2) + 's (' + why + ')');
  }
}

// 3) Empty translations
console.log('\n── empty translations ──');
const empties = trLines.filter(t => !t.trans || t.trans.trim() === '');
console.log('  empty TRANS: ' + empties.length);
for (const t of empties) console.log('    #' + t.idx + ' ORIG: ' + t.orig.slice(0, 50));

// 4) Incomplete endings in translate ORIG
console.log('\n── incomplete endings (translate ORIG) ──');
const trIncomplete = trLines.filter(t => !SENTENCE_END_RE.test(t.orig));
console.log('  incomplete-ending ORIG: ' + trIncomplete.length);

// 5) Original #56/#57 (now merged at #54) — verify end punctuation
console.log('\n── target #56+#57 (now merged) ──');
const t54 = pipeLines.find(p => p.idx === 54);
if (t54) {
  const hasFragment = t54.text.includes('다른 분들보다') && t54.text.includes('확실히');
  check(hasFragment, '#54 contains both fragments (다른 분들보다 + 확실히)');
  check(SENTENCE_END_RE.test(t54.text), '#54 ends with sentence-final punctuation');
  const tr54 = trLines.find(t => t.idx === 54);
  if (tr54) check(/^[^.?!。？！]*[.?!。？！]$/.test(tr54.trans), '#54 translation also ends with punctuation');
}

// 6)Suspicious: orig ends incomplete but trans ends complete (=AI merged/rewrote). Should be 0 now.
console.log('\n── AI rewrite/smuggling check ──');
const aiMerged = trLines.filter(t => !SENTENCE_END_RE.test(t.orig) && SENTENCE_END_RE.test(t.trans));
console.log('  ORIG incomplete but TRANS complete (possible AI rewrite): ' + aiMerged.length);
for (const t of aiMerged.slice(0, 10)) console.log('    #' + t.idx + ' ORIG:…' + t.orig.slice(-30) + ' | TRANS: ' + t.trans.slice(0, 40));

console.log('\n══════════════════════════');
console.log('Passed: ' + passed + ' | Failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);