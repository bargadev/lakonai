'use strict';

// `lakonai bench` — runs a fixed corpus of representative command outputs through
// the filters and prints the savings. Self-contained (sample outputs are built
// here, no external commands or shipped fixtures), deterministic, no LLM.
// tests/bench.test.js asserts each case clears its `minSaved` threshold so a
// filter regression fails CI.

const { filterCommand, countTokensApprox } = require('./filters');

function gitLogSample() {
  let s = '';
  for (let i = 0; i < 4; i++) {
    s +=
      `commit ${'a'.repeat(39)}${i}\n` +
      `Author: Dev <dev@example.com>\n` +
      `Date:   Mon May 26 10:0${i}:00 2026 -0300\n\n` +
      `    fix: handle edge case ${i} in parser\n\n` +
      `diff --git a/src/p${i}.js b/src/p${i}.js\n` +
      `index 1111111..2222222 100644\n--- a/src/p${i}.js\n+++ b/src/p${i}.js\n` +
      `@@ -1,5 +1,7 @@\n function parse(x){\n-  return x;\n+  if(!x) return null;\n+  return x.trim();\n }\n`;
  }
  return s;
}

function npmTestSample() {
  let s = '> app@1.0.0 test\n> jest\n\n';
  for (let f = 0; f < 6; f++) {
    s += `PASS src/mod${f}.test.js\n`;
    for (let c = 0; c < 5; c++) s += `  ✓ case ${f}.${c} (${c + 1} ms)\n`;
  }
  return s + '\nTest Suites: 6 passed, 6 total\nTests:       30 passed, 30 total\nTime: 2.1 s\n';
}

function makeSample() {
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += `make[1]: Entering directory '/home/u/proj'\ngcc -O2 -c src/f${i}.c -o build/f${i}.o\n\nmake[1]: Leaving directory '/home/u/proj'\n`;
  }
  return s;
}

function grepSample() {
  let s = '';
  for (let i = 0; i < 60; i++) s += `src/file${i}.js:${i + 10}:  const value = compute(${i});\n`;
  return s;
}

const CASES = [
  { name: 'git log -p', cmd: 'git', args: ['log', '-p'], output: gitLogSample, minSaved: 60 },
  { name: 'npm test (passing)', cmd: 'npm', args: ['test'], output: npmTestSample, minSaved: 80 },
  { name: 'make', cmd: 'make', args: [], output: makeSample, minSaved: 30 },
  { name: 'grep (60 matches)', cmd: 'grep', args: ['-r', 'value', 'src/'], output: grepSample, minSaved: 60 },
];

function runBench() {
  return CASES.map((c) => {
    const raw = c.output();
    const filtered = filterCommand(c.cmd, c.args, raw);
    const before = countTokensApprox(raw);
    const after = countTokensApprox(filtered);
    /* istanbul ignore next -- samples are never empty; defensive divide-by-zero guard */
    const saved = before === 0 ? 0 : Math.round((1 - after / before) * 100);
    return { name: c.name, before, after, saved, minSaved: c.minSaved };
  });
}

function format(rows) {
  const pad = (s, n) => String(s).padEnd(n);
  const padN = (s, n) => String(s).padStart(n);
  const lines = [pad('case', 22) + padN('raw', 8) + padN('filtered', 10) + padN('saved', 7), '-'.repeat(47)];
  for (const r of rows) lines.push(pad(r.name, 22) + padN(r.before, 8) + padN(r.after, 10) + padN(r.saved + '%', 7));
  return lines.join('\n') + '\n';
}

module.exports = { runBench, format, CASES };
