#!/usr/bin/env node
'use strict';

// Reproducible compression benchmark. Runs a fixed corpus of real command
// outputs (tests/fixtures/bench/) through the filters and reports raw vs
// filtered token counts. `tests/bench.test.js` asserts each case still clears
// its `minSaved` threshold, so a filter regression fails CI.

const fs = require('fs');
const path = require('path');
const { filterCommand, countTokensApprox } = require('../src/filters');

const FIXTURES = path.join(__dirname, '..', 'tests', 'fixtures', 'bench');

const CASES = [
  { name: 'git log -p', cmd: 'git', args: ['log', '-p'], fixture: 'git-log.txt', minSaved: 60 },
  { name: 'npm test (passing)', cmd: 'npm', args: ['test'], fixture: 'npm-test.txt', minSaved: 80 },
  { name: 'make', cmd: 'make', args: [], fixture: 'make.txt', minSaved: 30 },
  { name: 'grep (60 matches)', cmd: 'grep', args: ['-r', 'value', 'src/'], fixture: 'grep.txt', minSaved: 60 },
];

function runBench() {
  return CASES.map((c) => {
    const raw = fs.readFileSync(path.join(FIXTURES, c.fixture), 'utf8');
    const filtered = filterCommand(c.cmd, c.args, raw);
    const before = countTokensApprox(raw);
    const after = countTokensApprox(filtered);
    const saved = before === 0 ? 0 : Math.round((1 - after / before) * 100);
    return { name: c.name, before, after, saved, minSaved: c.minSaved };
  });
}

/* istanbul ignore next -- CLI presentation only */
function main() {
  const rows = runBench();
  const pad = (s, n) => String(s).padEnd(n);
  const padN = (s, n) => String(s).padStart(n);
  console.log(pad('case', 22), padN('raw', 8), padN('filtered', 10), padN('saved', 7));
  console.log('-'.repeat(48));
  for (const r of rows) {
    console.log(pad(r.name, 22), padN(r.before, 8), padN(r.after, 10), padN(r.saved + '%', 7));
  }
}

/* istanbul ignore next */
if (require.main === module) main();

module.exports = { runBench, CASES };
