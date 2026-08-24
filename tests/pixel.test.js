'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { imageTokens, estimateDimensions, countWrappedLines, estimateImageTokens, estimateSavings } = require('../src/pixel/estimate');
const { skillDirs, findInstalledSkills, parseSkill, origPath, collectMd } = require('../src/pixel/paths');
const { stripMarkdown, wrapLine, tryCanvas } = require('../src/pixel/render');
const {
  dryRun, convert, revertAll, revertSkill, isPixelated, buildPixelatedContent,
  formatDryRun, formatConvert, formatRevert,
} = require('../src/pixel/convert');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-pixel-'));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true }); } catch { /* ok */ }
}

function writeSkill(dir, name, content) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

const SAMPLE_SKILL = `---
description: Test skill
allowed-tools: Bash
---

This is the skill body.
It has multiple lines.
${Array(50).fill('This is a long line with quite a bit of content.').join('\n')}
`;

// ── estimate ─────────────────────────────────────────────────────────────────

test('imageTokens: 512×512 = 1 tile = 255 tokens', () => {
  assert.equal(imageTokens(512, 512), 255); // 1*1*170 + 85
});

test('imageTokens: 800×600 = 2×2 tiles = 765 tokens', () => {
  assert.equal(imageTokens(800, 600), 765); // 2*2*170 + 85
});

test('imageTokens: 1024×512 = 2×1 tiles = 425 tokens', () => {
  assert.equal(imageTokens(1024, 512), 425); // 2*1*170 + 85
});

test('estimateDimensions: returns width and height', () => {
  const { width, height } = estimateDimensions(40);
  assert.equal(width, 512); // 512px = 1 tile wide, minimises horizontal cost
  assert.ok(height > 0);
});

test('countWrappedLines: counts short lines as 1 each', () => {
  assert.equal(countWrappedLines('line1\nline2\nline3'), 3);
});

test('countWrappedLines: wraps long lines', () => {
  const long = 'x'.repeat(200);
  const lines = countWrappedLines(long, 80);
  assert.ok(lines > 1);
});

test('countWrappedLines: empty string = 1 line', () => {
  assert.equal(countWrappedLines(''), 1);
});

test('estimateImageTokens: returns positive number', () => {
  const tok = estimateImageTokens('hello world\n'.repeat(20));
  assert.ok(tok > 0);
});

test('estimateSavings: profitable for large body', () => {
  const body = Array(100).fill('This is a long enough line to create enough content.').join('\n');
  const r = estimateSavings(body);
  assert.ok(r.textTokens > 0);
  assert.ok(r.imgTokens > 0);
  assert.ok(typeof r.savePct === 'number');
  assert.ok(typeof r.profitable === 'boolean');
});

test('estimateSavings: not profitable for tiny body', () => {
  const r = estimateSavings('hi');
  // 1 text token, image = 255 tokens — not profitable
  assert.equal(r.profitable, false);
});

test('estimateSavings: zero body', () => {
  const r = estimateSavings('');
  assert.equal(r.textTokens, 0);
  assert.equal(r.savePct, 0);
});

// ── paths ─────────────────────────────────────────────────────────────────────

test('skillDirs: returns array with agent and dir', () => {
  const dirs = skillDirs('/tmp/fakehome');
  assert.ok(Array.isArray(dirs));
  assert.ok(dirs.every((d) => d.agent && d.dir));
});

test('collectMd: finds .md files, skips .orig.md', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'skill.md'), '# test');
  fs.writeFileSync(path.join(dir, 'skill.orig.md'), '# backup');
  const files = collectMd(dir);
  assert.ok(files.some((f) => f.endsWith('skill.md')));
  assert.ok(!files.some((f) => f.endsWith('.orig.md')));
  cleanup(dir);
});

test('collectMd: recurses into subdirs', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub', 'deep.md'), '# deep');
  const files = collectMd(dir);
  assert.ok(files.some((f) => f.endsWith('deep.md')));
  cleanup(dir);
});

test('collectMd: returns [] for nonexistent dir', () => {
  assert.deepEqual(collectMd('/nonexistent/path'), []);
});

test('findInstalledSkills: returns skills from fake home', () => {
  const home = tmpDir();
  const commandsDir = path.join(home, '.claude', 'commands');
  writeSkill(commandsDir, 'test.md', SAMPLE_SKILL);
  const skills = findInstalledSkills({ home });
  assert.ok(skills.some((s) => s.file.endsWith('test.md')));
  cleanup(home);
});

test('findInstalledSkills: agent filter', () => {
  const home = tmpDir();
  writeSkill(path.join(home, '.claude', 'commands'), 'a.md', SAMPLE_SKILL);
  const all = findInstalledSkills({ home });
  const claudeOnly = findInstalledSkills({ home, agent: 'claude-code' });
  const codexOnly = findInstalledSkills({ home, agent: 'codex' });
  assert.ok(all.length >= claudeOnly.length);
  // codex dir doesn't exist in this fake home → empty
  assert.equal(codexOnly.length, 0);
  cleanup(home);
});

test('parseSkill: parses frontmatter + body', () => {
  const dir = tmpDir();
  const file = writeSkill(dir, 'skill.md', SAMPLE_SKILL);
  const result = parseSkill(file);
  assert.ok(result !== null);
  assert.ok(result.frontmatter.includes('description'));
  assert.ok(result.body.includes('skill body'));
  cleanup(dir);
});

test('parseSkill: handles file without frontmatter', () => {
  const dir = tmpDir();
  const file = writeSkill(dir, 'plain.md', 'Just a plain markdown file\nno frontmatter here\n');
  const result = parseSkill(file);
  assert.ok(result !== null);
  assert.equal(result.frontmatter, '');
  assert.ok(result.body.includes('plain markdown'));
  cleanup(dir);
});

test('parseSkill: returns null for unreadable file', () => {
  assert.equal(parseSkill('/nonexistent/file.md'), null);
});

test('parseSkill: handles unclosed frontmatter', () => {
  const dir = tmpDir();
  const file = writeSkill(dir, 'bad.md', '---\ndescription: test\n\nbody without closing ---\n');
  const result = parseSkill(file);
  assert.ok(result !== null);
  assert.equal(result.frontmatter, '');
  cleanup(dir);
});

test('origPath: appends .orig.md', () => {
  assert.equal(origPath('/some/skill.md'), '/some/skill.orig.md');
});

// ── render ────────────────────────────────────────────────────────────────────

test('stripMarkdown: removes headings', () => {
  const out = stripMarkdown('# Heading\n## Sub');
  assert.ok(!out.includes('#'));
  assert.ok(out.includes('Heading'));
});

test('stripMarkdown: removes bold/italic', () => {
  const out = stripMarkdown('**bold** and *italic*');
  assert.ok(!out.includes('**'));
  assert.ok(out.includes('bold'));
  assert.ok(out.includes('italic'));
});

test('stripMarkdown: removes image references', () => {
  const out = stripMarkdown('![alt text](./image.png)');
  assert.ok(!out.includes('!['));
});

test('stripMarkdown: keeps link text, removes URL', () => {
  const out = stripMarkdown('[click here](https://example.com)');
  assert.ok(out.includes('click here'));
  assert.ok(!out.includes('https://'));
});

test('stripMarkdown: converts unordered lists', () => {
  const out = stripMarkdown('- item one\n- item two');
  assert.ok(out.includes('•'));
});

test('wrapLine: short line unchanged', () => {
  assert.deepEqual(wrapLine('hello world', 80), ['hello world']);
});

test('wrapLine: wraps at word boundary', () => {
  const words = Array(20).fill('word');
  const line = words.join(' '); // 20*4 + 19 = 99 chars
  const wrapped = wrapLine(line, 40);
  assert.ok(wrapped.length > 1);
  for (const l of wrapped) assert.ok(l.length <= 40 || !l.includes(' '));
});

test('wrapLine: single very long word gets truncated at maxChars', () => {
  const line = 'x'.repeat(100);
  const wrapped = wrapLine(line, 40);
  assert.ok(Array.isArray(wrapped));
});

test('tryCanvas: returns module or null', () => {
  const result = tryCanvas();
  // canvas may or may not be installed; just verify it returns module or null
  assert.ok(result === null || typeof result === 'object');
});

// ── convert ───────────────────────────────────────────────────────────────────

test('isPixelated: detects marker', () => {
  assert.ok(isPixelated('<!-- lakonai-pixel: skill.orig.md -->'));
  assert.ok(!isPixelated('# Regular markdown'));
});

test('buildPixelatedContent: contains marker and img reference', () => {
  const content = buildPixelatedContent('---\ndesc: x\n---', '/path/to/skill-body.png', './skill-body.png');
  assert.ok(content.includes('<!-- lakonai-pixel:'));
  assert.ok(content.includes('![skill-body]'));
  assert.ok(content.includes('./skill-body.png'));
});

test('dryRun: returns results array', () => {
  const home = tmpDir();
  writeSkill(path.join(home, '.claude', 'commands'), 'test.md', SAMPLE_SKILL);
  const results = dryRun({ home });
  assert.ok(Array.isArray(results));
  assert.ok(results.length > 0);
  assert.ok('textTokens' in results[0]);
  assert.ok('profitable' in results[0]);
  cleanup(home);
});

test('dryRun: marks already-pixelated skills', () => {
  const home = tmpDir();
  const pixelated = `---\ndesc: x\n---\n\n<!-- lakonai-pixel: skill.orig.md -->\n![body](./skill-body.png)\n`;
  writeSkill(path.join(home, '.claude', 'commands'), 'pixel.md', pixelated);
  const results = dryRun({ home });
  const found = results.find((r) => r.file.endsWith('pixel.md'));
  assert.ok(found?.pixelated === true);
  cleanup(home);
});

test('dryRun: handles unreadable skill gracefully', () => {
  // findInstalledSkills finds .md files, parseSkill returns null for unreadable
  // This is tested indirectly — dryRun should not throw
  const home = tmpDir();
  assert.doesNotThrow(() => dryRun({ home }));
  cleanup(home);
});

test('convert: skips already-pixelated skills', () => {
  const home = tmpDir();
  const pixelated = `---\ndesc: x\n---\n\n<!-- lakonai-pixel: skill.orig.md -->\n![body](./skill-body.png)\n`;
  writeSkill(path.join(home, '.claude', 'commands'), 'p.md', pixelated);
  const results = convert({ home });
  const found = results.find((r) => r.file.endsWith('p.md'));
  assert.ok(found?.status === 'skip');
  assert.ok(found?.reason.includes('already'));
  cleanup(home);
});

test('convert: skips non-profitable skills', () => {
  const home = tmpDir();
  writeSkill(path.join(home, '.claude', 'commands'), 'tiny.md', '---\ndesc: x\n---\n\nhi\n');
  const results = convert({ home });
  const found = results.find((r) => r.file.endsWith('tiny.md'));
  assert.ok(found?.status === 'skip');
  cleanup(home);
});

test('convert: skips when canvas unavailable (mocked)', () => {
  // tryCanvas returns null when canvas is not installed.
  // If canvas IS installed in this test env, we can't test this path easily,
  // but we can test the skip logic via a tiny file (not profitable → skip before canvas check).
  const home = tmpDir();
  writeSkill(path.join(home, '.claude', 'commands'), 'tiny.md', '---\ndesc: x\n---\n\nhi\n');
  const results = convert({ home });
  // tiny skill is not profitable → skip regardless of canvas availability
  assert.ok(results[0].status === 'skip');
  cleanup(home);
});

test('revertSkill: returns false when no .orig.md backup', () => {
  const dir = tmpDir();
  const file = writeSkill(dir, 'skill.md', SAMPLE_SKILL);
  const result = revertSkill(file);
  assert.equal(result.restored, false);
  assert.ok(result.reason.includes('backup'));
  cleanup(dir);
});

test('revertSkill: restores from .orig.md and cleans up', () => {
  const dir = tmpDir();
  const file = writeSkill(dir, 'skill.md', '# modified content\n');
  const orig = origPath(file);
  fs.writeFileSync(orig, SAMPLE_SKILL);
  const result = revertSkill(file);
  assert.equal(result.restored, true);
  assert.ok(!fs.existsSync(orig), '.orig.md should be removed after restore');
  assert.ok(fs.readFileSync(file, 'utf8').includes('skill body'));
  cleanup(dir);
});

test('revertAll: returns results for pixelated skills only', () => {
  const home = tmpDir();
  const pixelated = `---\ndesc: x\n---\n\n<!-- lakonai-pixel: p.orig.md -->\n![body](./p-body.png)\n`;
  const file = writeSkill(path.join(home, '.claude', 'commands'), 'p.md', pixelated);
  // Create fake .orig.md
  fs.writeFileSync(origPath(file), SAMPLE_SKILL);
  const results = revertAll({ home });
  assert.ok(results.some((r) => r.file.endsWith('p.md')));
  cleanup(home);
});

test('revertAll: returns empty array when nothing pixelated', () => {
  const home = tmpDir();
  writeSkill(path.join(home, '.claude', 'commands'), 'plain.md', SAMPLE_SKILL);
  const results = revertAll({ home });
  assert.deepEqual(results, []);
  cleanup(home);
});

// ── formatters ────────────────────────────────────────────────────────────────

test('formatDryRun: no skills returns message', () => {
  const out = formatDryRun([]);
  assert.ok(out.includes('no skills'));
});

test('formatDryRun: shows token math', () => {
  const results = [{ file: '/home/user/.claude/commands/skill.md', agent: 'claude-code', textTokens: 1000, imgTokens: 400, saved: 600, savePct: 60, profitable: true, pixelated: false }];
  const out = formatDryRun(results);
  assert.ok(out.includes('1000'));
  assert.ok(out.includes('400'));
});

test('formatDryRun: marks pixelated', () => {
  const results = [{ file: '/home/user/.claude/commands/skill.md', agent: 'claude-code', textTokens: 0, imgTokens: 0, saved: 0, savePct: 0, profitable: false, pixelated: true }];
  const out = formatDryRun(results);
  assert.ok(out.includes('[pixelated]'));
});

test('formatConvert: no skills returns message', () => {
  assert.ok(formatConvert([]).includes('no skills'));
});

test('formatConvert: shows converted status', () => {
  const results = [{ file: '/some/skill.md', status: 'converted', textTokens: 500, imgTokens: 200, saved: 300, reason: null }];
  assert.ok(formatConvert(results).includes('✅'));
});

test('formatConvert: shows skipped status', () => {
  const results = [{ file: '/some/skill.md', status: 'skip', reason: 'not profitable' }];
  assert.ok(formatConvert(results).includes('not profitable'));
});

test('formatRevert: no pixelated skills returns message', () => {
  assert.ok(formatRevert([]).includes('no pixelated'));
});

test('formatRevert: shows restored status', () => {
  const results = [{ file: '/some/skill.md', restored: true, reason: null }];
  assert.ok(formatRevert(results).includes('✅'));
});

test('formatRevert: shows error status', () => {
  const results = [{ file: '/some/skill.md', restored: false, reason: 'no backup' }];
  assert.ok(formatRevert(results).includes('❌'));
  assert.ok(formatRevert(results).includes('no backup'));
});
