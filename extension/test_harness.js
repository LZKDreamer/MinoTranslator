/**
 * Regression test harness — replays JSON3 fixtures through parseJson3ToWords + segmentSentences
 * Must be kept in sync with youtube-subtitles.js
 */

'use strict';
const fs = require('fs');
const path = require('path');

const SENTENCE_END_RE = /[.?!。？！]$/;
const FRAGMENT_MERGE_MAX_WORDS = 3;
const TINY_SENTENCE_MAX_WORDS = 2;

function parseJson3ToWords(json) {
  var words = [];
  var events = json.events || [];
  for (var ei = 0; ei < events.length; ei++) {
    var ev = events[ei];
    if (!ev.segs || ev.segs.length === 0) continue;
    var tStart = ev.tStartMs || 0;
    var tEnd = tStart + (ev.dDurationMs || 0);
    var isAppend = (ev.aAppend || 0) === 1;
    var segs = ev.segs;
    if (isAppend && segs.length === 1 && !(segs[0].utf8 || '').trim()) {
      words.push({ text: '', start: tStart, end: tEnd, lineBreak: true, nonSpeech: false, speakerChange: false });
      continue;
    }
    for (var si = 0; si < segs.length; si++) {
      var seg = segs[si];
      var text = seg.utf8 || '';
      var offset = seg.tOffsetMs || 0;
      var absStart = tStart + offset;
      var absEnd;
      if (si + 1 < segs.length) { absEnd = tStart + (segs[si + 1].tOffsetMs || 0); }
      else { absEnd = tEnd; }
      var isNonSpeech = /^(>>\s*)?\[.*\]$/.test(text.trim());
      var isSpeakerChange = seg.isSpeakerChange === 1;
      words.push({ text: text, start: absStart, end: absEnd, lineBreak: false, nonSpeech: isNonSpeech, speakerChange: isSpeakerChange });
    }
  }
  return words;
}

function segmentSentences(words) {
  var cleanWords = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (w.lineBreak) continue;
    if (w.nonSpeech) {
      if (w.speakerChange && cleanWords.length > 0) {
        cleanWords.push({ text: '', start: w.start, end: w.end, speakerChange: true, _ghost: true });
      }
      continue;
    }
    var t = (w.text || '').replace(/^>>\s*/, '').trim();
    if (!t) continue;
    cleanWords.push({ text: t, start: w.start, end: w.end, speakerChange: w.speakerChange });
  }
  var realWords = [];
  for (var ri = 0; ri < cleanWords.length; ri++) {
    var rw = cleanWords[ri];
    if (rw._ghost) { continue; }
    realWords.push(rw);
  }
  cleanWords = realWords;
  if (cleanWords.length === 0) return [];

  var SENTENCE_GAP_MS = 2000;
  var segments = [];
  var current = [];
  var prevEndMs = 0;
  var hardBreakNext = false;

  for (var j = 0; j < cleanWords.length; j++) {
    var cw = cleanWords[j];

    // ghost 词：仅用于触发切句，自身不加入 current
    if (cw.text === '' && cw.speakerChange) {
      if (current.length > 0) {
        current._hardBreakAfter = true;
        segments.push(current);
        current = [];
        hardBreakNext = true;
      }
      continue;
    }

    // 说话人切换：强制切句
    if (cw.speakerChange && current.length > 0) {
      current._hardBreakAfter = true;
      segments.push(current);
      current = [];
      hardBreakNext = true;
    }
    else if (current.length > 0 && (cw.start - prevEndMs) > SENTENCE_GAP_MS) {
      current._hardBreakAfter = true;
      segments.push(current);
      current = [];
      hardBreakNext = true;
    }
    current.push(cw);
    prevEndMs = cw.end;
    if (SENTENCE_END_RE.test(cw.text)) {
      if (hardBreakNext) current._hardBreakAfter = true;
      segments.push(current);
      current = [];
      hardBreakNext = false;
    }
  }
  if (current.length > 0) {
    if (hardBreakNext) current._hardBreakAfter = true;
    segments.push(current);
  }

  var merged = [];
  for (var k = 0; k < segments.length; k++) {
    var seg = segments[k];
    var lastText = seg[seg.length - 1].text;
    var endsWithSentEnd = SENTENCE_END_RE.test(lastText);
    if (!endsWithSentEnd && seg.length <= FRAGMENT_MERGE_MAX_WORDS && k + 1 < segments.length && !seg._hardBreakAfter) {
      segments[k + 1] = seg.concat(segments[k + 1]);
    } else { merged.push(seg); }
  }

  var result = [];
  for (var m = 0; m < merged.length; m++) {
    var isComplete = merged[m].length > 0 && SENTENCE_END_RE.test(merged[m][merged[m].length - 1].text);
    if (merged[m].length <= TINY_SENTENCE_MAX_WORDS && !isComplete && m + 1 < merged.length && !merged[m]._hardBreakAfter) {
      merged[m + 1] = merged[m].concat(merged[m + 1]);
    } else { result.push(merged[m]); }
  }

  var sentences = [];
  var MAX_SENTENCE_DURATION_SEC = 12.0;
  var MIN_WORDS_TO_SPLIT = 6;
  var SPARSE_GAP_MS = 5000;
  var MAX_SPARSE_WORDS = 3;

  for (var n = 0; n < result.length; n++) {
    var sent = result[n];
    if (sent.length === 0 || sent.length > MAX_SPARSE_WORDS) continue;
    var hasSentenceEnd = false;
    for (var pe = 0; pe < sent.length; pe++) { if (SENTENCE_END_RE.test(sent[pe].text)) { hasSentenceEnd = true; break; } }
    if (hasSentenceEnd) continue;
    var gapBefore = Infinity, gapAfter = Infinity;
    if (n > 0) { var ps = result[n - 1]; gapBefore = sent[0].start - ps[ps.length - 1].end; }
    if (n + 1 < result.length) { var ns = result[n + 1]; gapAfter = ns[0].start - sent[sent.length - 1].end; }
    if (gapBefore > SPARSE_GAP_MS && gapAfter > SPARSE_GAP_MS) { sent._sparseGarbage = true; }
  }

  for (var n = 0; n < result.length; n++) {
    var sent = result[n];
    if (sent._sparseGarbage) continue;
    if (sent.length === 0) continue;
    var textParts = [];
    for (var p = 0; p < sent.length; p++) textParts.push(sent[p].text);
    var fullText = textParts.join(' ').replace(/\s+/g, ' ').trim();
    if (!fullText) continue;
    var startSec = sent[0].start / 1000.0;
    var endSec = sent[sent.length - 1].end / 1000.0;
    var duration = endSec - startSec;
    if (duration > MAX_SENTENCE_DURATION_SEC && sent.length >= MIN_WORDS_TO_SPLIT) {
      var bestSplit = -1, bestGap = 0;
      for (var q = 0; q < sent.length - 1; q++) {
        var gapMs = sent[q + 1].start - sent[q].end;
        if (gapMs > bestGap) { bestGap = gapMs; bestSplit = q; }
      }
      if (bestGap >= 80) { /* split at bestGap */ }
      else { bestSplit = Math.floor(sent.length / 2) - 1; }
      if (bestSplit > 0 && bestSplit < sent.length - 1) {
        var leftSent = sent.slice(0, bestSplit + 1);
        var rightSent = sent.slice(bestSplit + 1);
        var ltp = []; for (var lp = 0; lp < leftSent.length; lp++) ltp.push(leftSent[lp].text);
        var leftFull = ltp.join(' ').replace(/\s+/g, ' ').trim();
        if (leftFull) {
          sentences.push({ start: leftSent[0].start / 1000.0, end: leftSent[leftSent.length - 1].end / 1000.0, text: leftFull });
        }
        result.splice(n + 1, 0, rightSent);
        continue;
      }
    }
    sentences.push({ start: startSec, end: endSec, text: fullText });
  }
  // 重叠截断
  for (var ot = 0; ot < sentences.length - 1; ot++) {
    if (sentences[ot + 1].start < sentences[ot].end) {
      sentences[ot].end = sentences[ot + 1].start;
    }
  }

  // 重复检测
  var REPETITION_WINDOW_SEC = 30;
  var REPETITION_MIN_COUNT = 4;
  var REPETITION_MAX_WORDS = 4;
  for (var ri = 0; ri < sentences.length; ri++) {
    if (sentences[ri]._repetitionGarbage) continue;
    var rText = sentences[ri].text;
    var rWords = rText.split(/\s+/).length;
    if (rWords > REPETITION_MAX_WORDS) continue;
    var group = [ri];
    for (var rj = ri + 1; rj < sentences.length; rj++) {
      if (sentences[rj]._repetitionGarbage) continue;
      if (sentences[rj].start - sentences[ri].start > REPETITION_WINDOW_SEC) break;
      if (sentences[rj].text === rText) group.push(rj);
    }
    if (group.length >= REPETITION_MIN_COUNT) {
      for (var gk = 0; gk < group.length; gk++) {
        sentences[group[gk]]._repetitionGarbage = true;
      }
      ri += group.length - 1;
    }
  }
  sentences = sentences.filter(function (s) { return !s._repetitionGarbage; });

  return sentences;
}

// ── Runner ──
function cleanText(text) {
  let c = String(text || '').replace(/<[^>]+>/g, '').replace(/^(>>|>|Speaker\s*\d*:)\s*/i, '');
  c = c.replace(/\[.*?\]/g, '').replace(/\b(um|uh|er|ah|hmm|mm-hmm|uh-huh)\b/gi, '');
  return c.replace(/\s+/g, ' ').trim();
}

function runFixture(name, filePath) {
  console.log(`--- ${name} ---`);
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const words = parseJson3ToWords(json);
  const nonSpeechCount = words.filter(w => w.nonSpeech).length;
  const sentences = segmentSentences(words);
  const nonEmpty = sentences.map(s => ({ ...s, text: cleanText(s.text) })).filter(s => s.text);
  console.log(`  Words: ${words.length} (nonSpeech: ${nonSpeechCount}) → Sentences: ${nonEmpty.length}`);
  for (let i = 0; i < Math.min(8, nonEmpty.length); i++) {
    const s = nonEmpty[i];
    console.log(`  [${i}] ${s.start.toFixed(3)}-${s.end.toFixed(3)} (${(s.end-s.start).toFixed(1)}s): "${s.text.slice(0,80)}"`);
  }
  const giants = nonEmpty.filter(s => s.end - s.start > 12);
  const totalDuration = nonEmpty.reduce((acc, s) => acc + (s.end - s.start), 0);
  const asrGarbage = sentences.length - nonEmpty.length - (nonEmpty.filter(s => !s._sparseGarbage).length === 0 ? 0 : 0);
  console.log(`  Giants >12s: ${giants.length} | Total speech: ${totalDuration.toFixed(0)}s`);
  return giants.length === 0;
}

const fixtures = [
  ['English', path.join(__dirname, '..', '..', '.reasonix', 'attachments', 'clipboard-20260629-002005.086518-000001.txt')],
  ['f.txt', path.join(__dirname, 'f.txt')],
];
let ok = true;
for (const [n, f] of fixtures) { if (!runFixture(n, f)) ok = false; }
console.log(ok ? '\nALL PASS' : '\nSOME FAIL');
process.exit(ok ? 0 : 1);
