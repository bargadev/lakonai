'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const mode = require('../src/mode');
const reinforce = require('../src/hooks/prompt-reinforce');
const compress = require('../src/compress');
const { runBench, CASES } = require('../scripts/bench');

function freshHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-cv-'));
  process.env.LAKON_HOME = home;
  delete process.env.LAKON_MODE;
  return home;
}

// --- mode ----------------------------------------------------------------

test('mode: default is full; setMode persists and getMode reads it', () => {
  freshHome();
  assert.equal(mode.getMode(), 'full');
  assert.equal(mode.setMode('ultra'), 'ultra');
  assert.equal(mode.getMode(), 'ultra');
});

test('mode: setMode rejects unknown modes', () => {
  freshHome();
  assert.equal(mode.setMode('wenyan'), null);
  assert.equal(mode.getMode(), 'full');
});

test('mode: a mode file with garbage falls back to default', () => {
  const home = freshHome();
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'mode'), 'garbage');
  assert.equal(mode.getMode(), 'full');
});

test('mode: LAKON_MODE env overrides the file when valid, ignored when invalid', () => {
  freshHome();
  mode.setMode('lite');
  process.env.LAKON_MODE = 'ultra';
  assert.equal(mode.getMode(), 'ultra');
  process.env.LAKON_MODE = 'bogus';
  assert.equal(mode.getMode(), 'lite'); // falls back to the file
  delete process.env.LAKON_MODE;
});

// --- prompt-reinforce ----------------------------------------------------

test('buildReminder returns a per-mode reminder and falls back to full', () => {
  assert.match(reinforce.buildReminder('lite'), /lite/);
  assert.match(reinforce.buildReminder('ultra'), /ultra/);
  assert.match(reinforce.buildReminder('full'), /full/);
  assert.equal(reinforce.buildReminder('nope'), reinforce.REMINDERS.full);
  for (const r of Object.values(reinforce.REMINDERS)) {
    assert.match(r, /security warnings/i); // safety carve-out always present
  }
});

// --- compress ------------------------------------------------------------

test('maskCode/unmaskCode round-trip preserves code spans', () => {
  const text = 'see `foo()` and\n```\nblock\n```\ndone';
  const { masked, spans } = compress.maskCode(text);
  assert.doesNotMatch(masked, /foo\(\)/);
  assert.equal(compress.unmaskCode(masked, spans), text);
});

test('heuristicCompress collapses blanks/trailing ws, never touches code', () => {
  const text = 'line one   \n\n\n\nkeep `inline code  spaces` here\n```\ncode  with  spaces\n```\n';
  const out = compress.heuristicCompress(text);
  assert.doesNotMatch(out, /\n{3,}/); // blank runs collapsed
  assert.doesNotMatch(out, /one   \n/); // trailing ws trimmed
  assert.match(out, /inline code  spaces/); // inline code spaces preserved
  assert.match(out, /code  with  spaces/); // fenced code preserved
});

test('buildPrompt embeds the content and the preserve rules', () => {
  const p = compress.buildPrompt('# Title\nbody');
  assert.match(p, /# Title\nbody/);
  assert.match(p, /code blocks/);
  assert.match(p, /URLs/);
});

test('stripWrapper unwraps a fenced answer, leaves bare text', () => {
  assert.equal(compress.stripWrapper('```markdown\nhi there\n```'), 'hi there\n');
  assert.equal(compress.stripWrapper('  plain\n'), 'plain\n');
});

test('compressFile: dry-run reports without writing; real run writes + backs up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-cmp-'));
  const f = path.join(dir, 'NOTES.md');
  fs.writeFileSync(f, 'a   \n\n\n\nb\n');

  const dry = compress.compressFile(f, { dryRun: true });
  assert.equal(dry.written, false);
  assert.equal(dry.mode, 'heuristic');
  assert.ok(dry.before >= dry.after);
  assert.ok(!fs.existsSync(`${f}.bak`));

  const real = compress.compressFile(f, {});
  assert.equal(real.written, true);
  assert.equal(fs.readFileSync(`${f}.bak`, 'utf8'), 'a   \n\n\n\nb\n'); // original preserved
  assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /\n{3,}/);
});

test('compressFile: empty file reports 0% saved (no divide-by-zero)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-cmp0-'));
  const f = path.join(dir, 'empty.md');
  fs.writeFileSync(f, '');
  const r = compress.compressFile(f, { dryRun: true });
  assert.equal(r.before, 0);
  assert.equal(r.saved, 0);
});

test('compressFile: works with no opts argument (defaults)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-cmpd-'));
  const f = path.join(dir, 'n.md');
  fs.writeFileSync(f, 'a\n\n\n\nb\n');
  const r = compress.compressFile(f);
  assert.equal(r.mode, 'heuristic');
  assert.equal(r.written, true);
});

// --- bench (regression guard) --------------------------------------------

test('bench: every case still clears its savings threshold', () => {
  const rows = runBench();
  assert.equal(rows.length, CASES.length);
  for (const r of rows) {
    assert.ok(r.saved >= r.minSaved, `${r.name}: saved ${r.saved}% < min ${r.minSaved}%`);
    assert.ok(r.before > r.after);
  }
});
