#!/usr/bin/env node
'use strict';

// Aggregate an OUTPUT-benchmark snapshot OFFLINE (no LLM, CI-safe). The honest
// metric is lakonai vs the generic "concise" arm — that isolates what the rule
// adds beyond plain "answer concisely".

const fs = require('fs');
const path = require('path');
const { SNAPSHOT_PATH } = require('./bench-output');

function median(nums) {
  const a = nums.filter((n) => typeof n === 'number').slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

function measure(snapshot) {
  const byArm = {};
  for (const r of snapshot.results || []) {
    (byArm[r.arm] = byArm[r.arm] || []).push(r.outputTokens);
  }
  const med = (arm) => median(byArm[arm] || []);
  const baseline = med('baseline');
  const concise = med('concise');
  const lakonai = med('lakonai');
  const pct = (from, to) => (from ? Math.round((1 - to / from) * 100) : 0);
  return {
    model: snapshot.model || 'unknown',
    n: (byArm.lakonai || []).length,
    baseline,
    concise,
    lakonai,
    vsBaseline: pct(baseline, lakonai),
    vsConcise: pct(concise, lakonai), // the honest delta
  };
}

function format(m) {
  return [
    `OUTPUT benchmark (model: ${m.model}, ${m.n} prompts)`,
    `  baseline median:  ${m.baseline} tok`,
    `  concise median:   ${m.concise} tok`,
    `  lakonai median:   ${m.lakonai} tok`,
    `  vs baseline:      -${m.vsBaseline}%`,
    `  vs concise (honest delta): -${m.vsConcise}%`,
  ].join('\n');
}

/* istanbul ignore next -- CLI presentation */
function main() {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  console.log(format(measure(snap)));
}

/* istanbul ignore next */
if (require.main === module) main();

module.exports = { measure, median, format };
