'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const mem = require('../src/mem-compress');
const { pickMemoryTarget } = require('../src/install');

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakmem-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

// A stand-in compression engine for the harness tests. The real engine is the
// LLM (src/mem-llm.js); here we just need a deterministic shrink that keeps the
// protected spans so we can exercise backup/validate/guard logic.
const shrink = (s) => s.replace(/\bthe /g, '');

// --- validate -------------------------------------------------------------

test('validate ok when protected spans survive', () => {
  const orig = 'see `x.ts` at https://a.io/z';
  const { ok } = mem.validate(orig, 'see `x.ts` https://a.io/z');
  assert.equal(ok, true);
});

test('validate flags a dropped protected span', () => {
  const orig = 'see `x.ts` here';
  const { ok, missing } = mem.validate(orig, 'see here');
  assert.equal(ok, false);
  assert.deepEqual(missing, ['`x.ts`']);
});

test('validate flags a dropped fenced code block', () => {
  const orig = 'intro\n```js\ncode()\n```\nend';
  const { ok, missing } = mem.validate(orig, 'intro end');
  assert.equal(ok, false);
  assert.match(missing[0], /code\(\)/);
});

// --- backupPath / isBackup ------------------------------------------------

test('backupPath inserts .original before the extension', () => {
  assert.match(mem.backupPath('/a/CLAUDE.md'), /CLAUDE\.original\.md$/);
  assert.match(mem.backupPath('/a/notes.txt'), /notes\.original\.txt$/);
});

test('isBackup detects .original files', () => {
  assert.equal(mem.isBackup('/a/CLAUDE.original.md'), true);
  assert.equal(mem.isBackup('/a/CLAUDE.md'), false);
});

// --- compressFile (backup + write + guards) -------------------------------

test('compressFile writes backup and overwrites original with the engine output', () => {
  const p = tmpFile('CLAUDE.md', 'run the tests\nuse `foo.ts`');
  const res = mem.compressFile(p, { compress: shrink, tokenize: (s) => s.length });
  assert.equal(fs.readFileSync(mem.backupPath(p), 'utf8'), 'run the tests\nuse `foo.ts`');
  assert.match(fs.readFileSync(p, 'utf8'), /run tests/);
  assert.match(fs.readFileSync(p, 'utf8'), /`foo\.ts`/); // protected span kept
  assert.ok(res.afterTokens < res.beforeTokens);
  assert.equal(res.backup, mem.backupPath(p));
});

test('compressFile uses a default tokenizer when none given', () => {
  const p = tmpFile('CLAUDE.md', 'run the tests now');
  const res = mem.compressFile(p, { compress: shrink });
  assert.equal(typeof res.beforeTokens, 'number');
});

test('compressFile requires a compress engine', () => {
  const p = tmpFile('CLAUDE.md', 'x');
  assert.throws(() => mem.compressFile(p), /requires a compress engine/);
});

test('compressFile refuses a backup file', () => {
  const p = tmpFile('CLAUDE.original.md', 'x');
  assert.throws(() => mem.compressFile(p, { compress: shrink }), /refusing to compress a backup/);
});

test('compressFile throws on missing file', () => {
  assert.throws(() => mem.compressFile('/no/such/file.md', { compress: shrink }), /file not found/);
});

test('compressFile aborts (no write) when validation fails', () => {
  const p = tmpFile('CLAUDE.md', 'keep `a.ts`');
  const original = fs.readFileSync(p, 'utf8');
  // Inject a lossy compressor that drops the protected span.
  assert.throws(
    () => mem.compressFile(p, { compress: () => 'lost it' }),
    /validation failed/
  );
  assert.equal(fs.readFileSync(p, 'utf8'), original, 'original must be untouched');
  assert.equal(fs.existsSync(mem.backupPath(p)), false, 'no backup written on abort');
});

test('compressFile recovers via a fix pass when the first output is lossy', () => {
  const p = tmpFile('CLAUDE.md', 'keep `a.ts` here');
  const res = mem.compressFile(p, {
    compress: () => 'keep here', // drops `a.ts`
    fix: () => 'keep `a.ts`', // restores it
    tokenize: (s) => s.length,
  });
  assert.match(fs.readFileSync(p, 'utf8'), /`a\.ts`/);
  assert.ok(fs.existsSync(res.backup));
});

test('compressFile refuses a sensitive filename in remote mode', () => {
  const p = tmpFile('secrets.md', 'token stuff');
  assert.throws(() => mem.compressFile(p, { compress: shrink, remote: true }), /looks sensitive/);
  // local (remote:false) is allowed — bytes never leave the machine
  assert.doesNotThrow(() => mem.compressFile(p, { compress: shrink, remote: false, tokenize: (s) => s.length }));
});

test('compressFile refuses when a backup already exists', () => {
  const p = tmpFile('CLAUDE.md', 'run the tests');
  fs.writeFileSync(mem.backupPath(p), 'old backup');
  assert.throws(() => mem.compressFile(p, { compress: shrink }), /backup already exists/);
});

test('isSensitivePath flags credential-ish names', () => {
  assert.equal(mem.isSensitivePath('/a/.env'), true);
  assert.equal(mem.isSensitivePath('/a/my-api-key.md'), true);
  assert.equal(mem.isSensitivePath('/a/CLAUDE.md'), false);
});

// --- revertFile -----------------------------------------------------------

test('revertFile restores original and removes backup', () => {
  const p = tmpFile('CLAUDE.md', 'run the tests\nuse `foo.ts`');
  const before = fs.readFileSync(p, 'utf8');
  mem.compressFile(p, { compress: shrink, tokenize: (s) => s.length });
  const r = mem.revertFile(p);
  assert.equal(fs.readFileSync(p, 'utf8'), before, 'restored byte-for-byte');
  assert.equal(fs.existsSync(mem.backupPath(p)), false, 'backup removed');
  assert.equal(r.file, p);
});

test('revertFile throws when no backup exists', () => {
  const p = tmpFile('CLAUDE.md', 'x');
  assert.throws(() => mem.revertFile(p), /no backup found/);
});

// --- pickMemoryTarget (install-time detection) ----------------------------

test('pickMemoryTarget prefers project CLAUDE.md over user-level', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lakcwd-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakhome-'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'x');
  fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'x');
  assert.equal(pickMemoryTarget(cwd, home), path.join(cwd, 'CLAUDE.md'));
});

test('pickMemoryTarget falls back to user-level CLAUDE.md', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lakcwd-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakhome-'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'x');
  assert.equal(pickMemoryTarget(cwd, home), path.join(home, '.claude', 'CLAUDE.md'));
});

test('pickMemoryTarget returns null when nothing is present', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lakcwd-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakhome-'));
  assert.equal(pickMemoryTarget(cwd, home), null);
});
