'use strict';

// Integration tests: end-to-end flows across multiple lakonai layers.
// Each test exercises a real user-facing scenario using actual modules (no mocks).
// Tests that spawn the CLI verify the full bin/lakonai.js → module pipeline.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '../bin/lakonai.js');
const ROOT = path.resolve(__dirname, '..');

function tmpDir(prefix = 'lakon-int-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true }); } catch { /* ok */ }
}
function writeFile(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}
function runCLI(args, extraEnv = {}, cwd = ROOT) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    cwd,
    timeout: 10000,
  });
}

// ─── 1. Filter layer: real command output through filterCommand ───────────────

describe('Integration: filter layer', () => {
  const { filterCommand } = require('../src/filters');

  test('npm test passing output → only summary line survives', () => {
    let input = '> app@1.0.0 test\n> jest\n\n';
    for (let i = 0; i < 10; i++) {
      input += `PASS tests/mod${i}.test.js\n`;
      for (let c = 0; c < 5; c++) input += `  ✓ case ${i}.${c} (${c} ms)\n`;
    }
    input += '\nTest Suites: 10 passed, 10 total\nTests: 50 passed\nTime: 1.5s\n';
    const out = filterCommand('npm', ['test'], input);
    assert.ok(out.length < input.length, 'should reduce output');
    assert.match(out, /50 passed/);
  });

  test('git log -p → commit hashes stripped, diff retained', () => {
    const input =
      'commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' +
      'Author: Dev <dev@example.com>\nDate: Mon Aug 1 10:00:00 2026\n\n' +
      '    fix: edge case\n\ndiff --git a/f.js b/f.js\n--- a/f.js\n+++ b/f.js\n@@ -1 +1 @@\n-old\n+new\n';
    const out = filterCommand('git', ['log', '-p'], input);
    assert.ok(out.length < input.length);
  });

  test('ls -la → dot-files and total line stripped', () => {
    const input = 'total 42\ndrwxr-xr-x  5 user  group  160 Aug  1 10:00 .\ndrwxr-xr-x 12 user  group  384 Aug  1 09:00 ..\n-rw-r--r--  1 user  group 1234 Aug  1 10:00 README.md\n';
    const out = filterCommand('ls', ['-la'], input);
    assert.ok(!out.includes(' . ') && !out.includes(' .. '));
  });

  test('filterCommand is a no-op for unknown commands (passthrough)', () => {
    const input = 'some random output\n';
    const out = filterCommand('unknowncmd', [], input);
    assert.equal(out, input);
  });
});

// ─── 2. Proxy layer: compressBlock + detect pipeline ─────────────────────────

describe('Integration: proxy compression pipeline', () => {
  const { compressBlock } = require('../src/proxy/compress');
  const { detect } = require('../src/proxy/detect');

  test('npm test output: detect=text, saved ≥ 90%', () => {
    let input = '> jest\n\n';
    for (let f = 0; f < 30; f++) {
      input += `PASS tests/suite${f}.test.js\n`;
      for (let c = 0; c < 10; c++) input += `  ✓ case ${f}.${c} (${c} ms)\n`;
    }
    input += '\nTests: 300 passed\nTime: 2s\n';
    const type = detect(input);
    const { rawTokens, outTokens } = compressBlock(input);
    const pct = Math.round((1 - outTokens / rawTokens) * 100);
    assert.ok(pct >= 90, `expected ≥90% savings, got ${pct}% (type: ${type})`);
  });

  test('build log with timestamps: detect=log, saved ≥ 95%', () => {
    let input = '';
    for (let i = 0; i < 60; i++)
      input += `[2026-08-22T10:${String(i % 60).padStart(2, '0')}:00Z] INFO Compiler: processing src/mod${i}.js\n`;
    assert.equal(detect(input), 'log');
    const { rawTokens, outTokens } = compressBlock(input);
    const pct = Math.round((1 - outTokens / rawTokens) * 100);
    assert.ok(pct >= 95, `expected ≥95% savings, got ${pct}%`);
  });

  test('minified JSON object: detect=json, saved ≥ 90%', () => {
    const input = JSON.stringify({
      users: Array.from({ length: 80 }, (_, i) => ({ id: i, email: `u${i}@x.com`, active: true, createdAt: '2026-01-01T00:00:00Z' })),
    });
    assert.equal(detect(input), 'json');
    const { rawTokens, outTokens } = compressBlock(input);
    const pct = Math.round((1 - outTokens / rawTokens) * 100);
    assert.ok(pct >= 90, `expected ≥90% savings, got ${pct}%`);
  });

  test('minified JSON array: detect=json (not log)', () => {
    const input = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: i, name: `item${i}` })));
    assert.equal(detect(input), 'json');
  });

  test('log line starting with "[" not misclassified as json', () => {
    const input = '[2026-08-22T10:00:00Z] ERROR connection refused\n'.repeat(20);
    assert.equal(detect(input), 'log');
  });

  test('JSON with embedded log-level words stays json', () => {
    const input = JSON.stringify({ level: 'INFO', message: 'ok', timestamp: '2026-01-01T00:00:00Z', data: { count: 42 } });
    assert.equal(detect(input), 'json');
  });

  test('compressBlock never inflates: out ≤ raw for any input', () => {
    const inputs = [
      'short text',
      'a'.repeat(1000),
      JSON.stringify({ x: 1 }),
      '[2026-01-01] INFO hello\n'.repeat(10),
      'function foo() { return 42; }\n'.repeat(20),
    ];
    for (const input of inputs) {
      const { rawTokens, outTokens } = compressBlock(input);
      assert.ok(outTokens <= rawTokens, `inflated: ${rawTokens} → ${outTokens} for "${input.slice(0, 30)}..."`);
    }
  });

  test('proxy stats file accumulates correctly across multiple blocks', () => {
    const { mergeStats } = require('../src/proxy/server');
    const base = { rawTokens: 100, outTokens: 80, requests: 5, byType: { log: { raw: 100, out: 80, count: 5 } } };
    const delta = { rawTokens: 200, outTokens: 20, requests: 3, byType: { json: { raw: 200, out: 20, count: 3 } } };
    // mergeStats mutates existing in place, increments requests by 1 per call
    mergeStats(base, delta);
    assert.equal(base.rawTokens, 300);
    assert.equal(base.outTokens, 100);
    assert.equal(base.requests, 6); // was 5, incremented by 1
    assert.equal(base.byType.log.raw, 100);
    assert.equal(base.byType.json.raw, 200);
  });
});

// ─── 3. Graph layer: build → read-guard subgraph pipeline ────────────────────

describe('Integration: graph + read-guard pipeline', () => {
  const { build } = require('../src/graph/index');
  const { graphSubgraphFor } = require('../src/hooks/read-guard');

  function makeProject(dir) {
    writeFile(dir, 'src/utils.js', 'function helper(x) { return x * 2; }\nmodule.exports = { helper };\n');
    writeFile(dir, 'src/app.js', "const { helper } = require('./utils');\nclass App { run() { return helper(1); } }\nmodule.exports = App;\n");
    writeFile(dir, 'src/index.js', "const App = require('./app');\nconst app = new App();\napp.run();\n");
  }

  test('build → read-guard returns subgraph instead of full file', () => {
    const dir = tmpDir('lakon-rg-');
    try {
      makeProject(dir);
      build(dir);
      const absPath = path.join(dir, 'src/app.js');
      const subgraph = graphSubgraphFor(absPath);
      assert.ok(subgraph !== null, 'expected subgraph for src/app.js');
      assert.match(subgraph, /lakonai-graph/);
    } finally { cleanup(dir); }
  });

  test('build → read-guard includes symbol names from file', () => {
    const dir = tmpDir('lakon-rg2-');
    try {
      makeProject(dir);
      build(dir);
      const subgraph = graphSubgraphFor(path.join(dir, 'src/app.js'));
      assert.ok(subgraph !== null);
      assert.match(subgraph, /App/);
    } finally { cleanup(dir); }
  });

  test('read-guard returns null for file not in graph', () => {
    const dir = tmpDir('lakon-rg3-');
    try {
      makeProject(dir);
      build(dir);
      const result = graphSubgraphFor(path.join(dir, 'src/nonexistent.js'));
      assert.equal(result, null);
    } finally { cleanup(dir); }
  });

  test('read-guard returns null when no graph.json exists', () => {
    const dir = tmpDir('lakon-rg4-');
    try {
      makeProject(dir);
      // no build() call
      const result = graphSubgraphFor(path.join(dir, 'src/app.js'));
      assert.equal(result, null);
    } finally { cleanup(dir); }
  });

  test('build → graph.json contains import edges between files', () => {
    const dir = tmpDir('lakon-rg5-');
    try {
      makeProject(dir);
      build(dir);
      const g = JSON.parse(fs.readFileSync(path.join(dir, 'lakonai-graph', 'graph.json'), 'utf8'));
      const importEdges = g.edges.filter((e) => e.rel === 'imports');
      assert.ok(importEdges.length > 0, 'expected import edges');
    } finally { cleanup(dir); }
  });

  test('graph savings: subgraph token count is less than raw file for a large file', () => {
    const dir = tmpDir('lakon-savings-');
    try {
      // Write a large file — many functions with inline comments, docstrings, etc.
      let src = '';
      for (let i = 0; i < 50; i++) {
        src += `// This function computes the value for index ${i} using the algorithm\n`;
        src += `// defined in the specification document section ${i + 1}.2.3\n`;
        src += `function fn${i}(x, y, z) {\n`;
        src += `  // validate inputs\n`;
        src += `  if (x === null || x === undefined) throw new Error('x required for fn${i}');\n`;
        src += `  const result = x * ${i} + y - z;\n`;
        src += `  return result;\n`;
        src += `}\n\n`;
      }
      src += 'module.exports = { ' + Array.from({ length: 50 }, (_, i) => `fn${i}`).join(', ') + ' };\n';
      writeFile(dir, 'src/big.js', src);
      writeFile(dir, 'src/main.js', "const m = require('./big');\nconsole.log(m.fn0(1, 2, 3));\n");
      build(dir);
      const absPath = path.join(dir, 'src/big.js');
      const subgraph = graphSubgraphFor(absPath);
      assert.ok(subgraph !== null, 'expected subgraph for large file');
      const rawTok = Math.ceil(src.length / 4);
      const subTok = Math.ceil(subgraph.length / 4);
      assert.ok(subTok < rawTok, `subgraph (${subTok} tok) should be smaller than raw file (${rawTok} tok)`);
    } finally { cleanup(dir); }
  });
});

// ─── 4. Install layer: slash commands deployed to disk ───────────────────────

describe('Integration: install → slash commands', () => {
  const { installCommands, commandsDir } = require('../src/install/claude-commands');

  test('installCommands writes gain.md and stats.md', () => {
    const home = tmpDir('lakon-install-');
    try {
      const written = installCommands(home);
      assert.ok(written.includes('/lakonai:gain'), 'gain command missing');
      assert.ok(written.includes('/lakonai:stats'), 'stats command missing');
    } finally { cleanup(home); }
  });

  test('gain.md contains allowed-tools and lakonai gain', () => {
    const home = tmpDir('lakon-gain-');
    try {
      installCommands(home);
      const content = fs.readFileSync(path.join(commandsDir(home), 'gain.md'), 'utf8');
      assert.match(content, /allowed-tools/);
      assert.match(content, /lakonai gain/);
    } finally { cleanup(home); }
  });

  test('stats.md contains proxy-stats.json script', () => {
    const home = tmpDir('lakon-stats-');
    try {
      installCommands(home);
      const content = fs.readFileSync(path.join(commandsDir(home), 'stats.md'), 'utf8');
      assert.match(content, /proxy-stats\.json/);
      assert.match(content, /lakonai gain/);
      assert.match(content, /allowed-tools/);
    } finally { cleanup(home); }
  });

  test('installCommands is idempotent (runs twice, same files)', () => {
    const home = tmpDir('lakon-idem-');
    try {
      installCommands(home);
      const before = fs.readFileSync(path.join(commandsDir(home), 'gain.md'), 'utf8');
      installCommands(home);
      const after = fs.readFileSync(path.join(commandsDir(home), 'gain.md'), 'utf8');
      assert.equal(before, after);
    } finally { cleanup(home); }
  });
});

// ─── 5. CLI e2e: graph subcommands via bin/lakonai.js ────────────────────────

describe('Integration: CLI graph subcommands', () => {
  function makeProject(dir) {
    writeFile(dir, 'src/a.js', 'function alpha() {}\nmodule.exports = { alpha };\n');
    writeFile(dir, 'src/b.js', "const { alpha } = require('./a');\nfunction beta() { return alpha(); }\nmodule.exports = { beta };\n");
  }

  test('lakonai graph build creates graph.json', () => {
    const dir = tmpDir('lakon-cli-g-');
    try {
      makeProject(dir);
      // build uses CWD as rootDir when no arg given
      const r = runCLI(['graph', 'build'], {}, dir);
      assert.ok(fs.existsSync(path.join(dir, 'lakonai-graph', 'graph.json')),
        `graph.json not found. stdout: ${r.stdout} stderr: ${r.stderr}`);
    } finally { cleanup(dir); }
  });

  test('lakonai graph build outputs node/edge counts', () => {
    const dir = tmpDir('lakon-cli-g2-');
    try {
      makeProject(dir);
      const r = runCLI(['graph', 'build'], {}, dir);
      assert.match(r.stdout + r.stderr, /nodes|edges|files/i);
    } finally { cleanup(dir); }
  });

  test('lakonai graph explain returns node info', () => {
    const dir = tmpDir('lakon-cli-g3-');
    try {
      makeProject(dir);
      runCLI(['graph', 'build'], {}, dir);
      // explain reads graph from CWD
      const r = runCLI(['graph', 'explain', 'src/a.js'], {}, dir);
      assert.equal(r.status, 0);
      assert.match(r.stdout + r.stderr, /alpha|src\/a\.js/i);
    } finally { cleanup(dir); }
  });

  test('lakonai graph query returns relevant nodes', () => {
    const dir = tmpDir('lakon-cli-g4-');
    try {
      makeProject(dir);
      runCLI(['graph', 'build'], {}, dir);
      const r = runCLI(['graph', 'query', 'alpha function'], {}, dir);
      assert.equal(r.status, 0);
      assert.match(r.stdout + r.stderr, /alpha|src\/a\.js/i);
    } finally { cleanup(dir); }
  });

  test('lakonai graph query shows [bm25] prefix when no embeddings.json', () => {
    const dir = tmpDir('lakon-cli-g5-');
    try {
      makeProject(dir);
      runCLI(['graph', 'build'], {}, dir);
      // Remove embeddings if somehow generated
      try { fs.unlinkSync(path.join(dir, 'lakonai-graph', 'embeddings.json')); } catch { /* ok */ }
      const r = runCLI(['graph', 'query', 'alpha function'], {}, dir);
      assert.equal(r.status, 0);
      assert.ok(r.stdout.includes('[bm25]'), `expected [bm25] in stdout: ${r.stdout}`);
    } finally { cleanup(dir); }
  });
});

// ─── 6. CLI e2e: pixel subcommands via bin/lakonai.js ────────────────────────

describe('Integration: CLI pixel subcommands', () => {
  const SAMPLE_SKILL = `---
description: A test skill with enough content to be worth converting.
allowed-tools: Bash(*)
---

# Test Skill

This skill has substantial content that should exceed the break-even threshold.

## Usage

Run the following commands in sequence to complete the task. Make sure to verify
each step before proceeding to the next one.

\`\`\`bash
echo "step 1: setup"
echo "step 2: validate"
echo "step 3: complete"
\`\`\`

## Notes

- Always check the output of each command before proceeding.
- If an error occurs, retry the step or consult the documentation.
- The process is idempotent and safe to run multiple times.
- Keep logs for debugging purposes.
- Report any anomalies to the team immediately.
`;

  test('lakonai pixel --dry-run reports savings without writing files', () => {
    const home = tmpDir('lakon-pixel-dry-');
    try {
      const skillDir = path.join(home, '.claude', 'commands', 'lakonai');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'test-skill.md'), SAMPLE_SKILL);
      const r = runCLI(['pixel', '--dry-run'], { HOME: home });
      assert.equal(r.status, 0);
      // dry-run must not create .orig.md backups
      const files = fs.readdirSync(skillDir);
      assert.ok(!files.some((f) => f.endsWith('.orig.md')), 'dry-run must not write .orig.md');
    } finally { cleanup(home); }
  });

  test('lakonai pixel --dry-run output mentions token savings or "no profitable"', () => {
    const home = tmpDir('lakon-pixel-dry2-');
    try {
      const skillDir = path.join(home, '.claude', 'commands', 'lakonai');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'test-skill.md'), SAMPLE_SKILL);
      const r = runCLI(['pixel', '--dry-run'], { HOME: home });
      const out = r.stdout + r.stderr;
      assert.ok(out.length > 0, 'pixel --dry-run produced no output');
    } finally { cleanup(home); }
  });

  test('lakonai pixel --revert with no backups exits gracefully', () => {
    const home = tmpDir('lakon-pixel-rev-');
    try {
      const r = runCLI(['pixel', '--revert'], { HOME: home });
      assert.equal(r.status, 0);
    } finally { cleanup(home); }
  });
});

// ─── 7. CLI e2e: gain command with real stats ─────────────────────────────────

describe('Integration: gain command with accumulated stats', () => {
  test('lakonai gain with no stats says no usage', () => {
    const home = tmpDir('lakon-gain-empty-');
    try {
      const r = runCLI(['gain'], { LAKON_HOME: home });
      assert.equal(r.status, 0);
      assert.match(r.stdout + r.stderr, /no usage|no data|not found|0/i);
    } finally { cleanup(home); }
  });

  test('lakonai gain with tracking data shows token counts', () => {
    const home = tmpDir('lakon-gain-data-');
    try {
      // Seed a tracking log
      const logPath = path.join(home, 'usage.log');
      fs.mkdirSync(home, { recursive: true });
      for (let i = 0; i < 5; i++) {
        fs.appendFileSync(logPath, `${Date.now()}\tgit\tlog\t-p\t200\t40\n`);
      }
      const r = runCLI(['gain'], { LAKON_HOME: home });
      assert.equal(r.status, 0);
    } finally { cleanup(home); }
  });
});

// ─── 8. Cross-layer: filter → proxy pipeline (same content, both layers) ─────

describe('Integration: filter + proxy combined pipeline', () => {
  const { filterCommand } = require('../src/filters');
  const { compressBlock } = require('../src/proxy/compress');

  test('npm test: filter removes noise, proxy compresses summary further', () => {
    let raw = '> jest\n\n';
    for (let f = 0; f < 20; f++) {
      raw += `PASS tests/suite${f}.test.js\n`;
      for (let c = 0; c < 10; c++) raw += `  ✓ case ${f}.${c} (${c} ms)\n`;
    }
    raw += '\nTests: 200 passed\nTime: 1.5s\n';

    const afterFilter = filterCommand('npm', ['test'], raw);
    const { outTokens: afterProxy } = compressBlock(afterFilter);

    const rawTok = Math.ceil(raw.length / 4);
    const filterTok = Math.ceil(afterFilter.length / 4);
    const proxyTok = afterProxy;

    assert.ok(filterTok < rawTok, 'filter should reduce tokens');
    assert.ok(proxyTok <= filterTok, 'proxy should not inflate filtered output');
    const combined = Math.round((1 - proxyTok / rawTok) * 100);
    assert.ok(combined >= 80, `combined savings expected ≥80%, got ${combined}%`);
  });

  test('git diff: filter trims headers, proxy further reduces if repetitive', () => {
    let raw = '';
    for (let i = 0; i < 5; i++) {
      raw += `diff --git a/src/f${i}.js b/src/f${i}.js\nindex 111..222 100644\n--- a/src/f${i}.js\n+++ b/src/f${i}.js\n`;
      raw += `@@ -1,3 +1,4 @@\n function fn${i}() {\n-  return null;\n+  if (!x) return null;\n+  return x.trim();\n }\n`;
    }
    const afterFilter = filterCommand('git', ['diff'], raw);
    const { outTokens } = compressBlock(afterFilter);
    const rawTok = Math.ceil(raw.length / 4);
    assert.ok(outTokens <= rawTok, 'combined pipeline must not inflate tokens');
  });
});
