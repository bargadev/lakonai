'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'lakonai.js');

function workspaceWithScript(lines, exitCode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-testcli-'));
  fs.writeFileSync(path.join(dir, 'print.js'), `${lines.map((l) => `console.log(${JSON.stringify(l)});`).join('\n')}\nprocess.exit(${exitCode});\n`);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', scripts: { 'test:e2e': 'node print.js' } }));
  return dir;
}

function run(dir) {
  return spawnSync('node', [CLI, 'npm', '--prefix', dir, 'run', 'test:e2e'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-home-')), LAKON_NO_UPDATE_CHECK: '1', LAKON_COLOR: '0' },
  });
}

const NEST_NOISE = Array.from({ length: 300 }, (_, i) => `[Nest] 1  - 11/27/2026, 12:47:22 AM     LOG [RouterExplorer] Mapped {/v1/route-${i}, GET} route`);

test('a workspace test:e2e script with app logs collapses to the jest summary', () => {
  const dir = workspaceWithScript([...NEST_NOISE, 'PASS test/video-import.e2e-spec.ts', 'Test Suites: 1 passed, 1 total', 'Tests:       9 passed, 9 total'], 0);
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Tests:\s+9 passed, 9 total/);
  assert.doesNotMatch(r.stdout, /RouterExplorer/);
});

test('a failing test:e2e run keeps the failure, drops the app logs and the exit code', () => {
  const dir = workspaceWithScript([...NEST_NOISE, 'FAIL test/video-import.e2e-spec.ts', '  ✕ imports a video', '    Received: 500', 'Tests:       1 failed, 8 passed, 9 total'], 1);
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Received: 500/);
  assert.match(r.stdout, /1 failed, 8 passed/);
  assert.doesNotMatch(r.stdout, /RouterExplorer/);
});

test('node --test with app logs on stdout collapses to the tap summary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-nodetest-'));
  fs.writeFileSync(path.join(dir, 'a.test.mjs'), `import test from 'node:test';\nfor (let i = 0; i < 300; i++) console.log('[Nest] 1  - x     LOG [RouterExplorer] Mapped {/r' + i + ', GET} route');\ntest('adds', () => {});\n`);
  const r = spawnSync('node', [CLI, 'node', '--test', path.join(dir, 'a.test.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-home-')), LAKON_NO_UPDATE_CHECK: '1', LAKON_COLOR: '0' },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /# pass 1/);
  assert.doesNotMatch(r.stdout, /RouterExplorer|parked in sandbox/);
});
