'use strict';

// E2E proxy test: validates real savings using the same compressors the proxy
// runs in production. Two levels:
//   1. Per-type: representative payloads through compressBlock, min-savings assertions
//   2. Session: reads ~/.lakon/proxy-stats.json if present (accumulated from whoever
//      is running), asserts the live proxy is actually saving tokens

const assert = require('assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');

const { compressBlock } = require('../src/proxy/compress');

const ROOT = path.resolve(__dirname, '..');

// ─── helpers ────────────────────────────────────────────────────────────────

function tokApprox(s) { return Math.ceil(s.length / 4); }
function savedPct(raw, out) { return raw === 0 ? 0 : Math.round((1 - out / raw) * 100); }

function npmTestSample() {
  let s = '> lakonai@0.17.1 test\n> jest\n\n';
  for (let f = 0; f < 44; f++) {
    s += `PASS tests/suite${f}.test.js\n`;
    for (let c = 0; c < 15; c++) s += `  ✓ handles case ${f}.${c} (${c} ms)\n`;
  }
  return s + '\nTest Suites: 44 passed, 44 total\nTests: 652 passed\nTime: 3.2s\n';
}

function buildLogSample() {
  let s = '';
  for (let i = 0; i < 80; i++)
    s += `[2026-08-22T10:${String(i % 60).padStart(2, '0')}:00Z] INFO  Compiler: processing src/module${i}.js\n`;
  return s;
}

function jsonSample() {
  return JSON.stringify({
    users: Array.from({ length: 120 }, (_, i) => ({
      id: i, email: `u${i}@x.com`, createdAt: '2026-01-01T00:00:00Z', active: i % 7 !== 0,
    })),
    total: 120,
  });
}

function grepSample() {
  let s = '';
  for (let i = 0; i < 60; i++) s += `src/file${i}.js:${i + 10}:  const value = compute(${i});\n`;
  return s;
}

// ─── per-type assertions ─────────────────────────────────────────────────────

describe('E2E proxy — per-type compression', () => {
  test('npm test output compresses ≥ 90%', () => {
    const input = npmTestSample();
    const { rawTokens, outTokens, type } = compressBlock(input);
    const pct = savedPct(rawTokens, outTokens);
    assert.ok(pct >= 90, `npm test: expected ≥90% savings, got ${pct}% (type: ${type})`);
  });

  test('build log compresses ≥ 95%', () => {
    const input = buildLogSample();
    const { rawTokens, outTokens, type } = compressBlock(input);
    const pct = savedPct(rawTokens, outTokens);
    assert.ok(pct >= 95, `build log: expected ≥95% savings, got ${pct}% (type: ${type})`);
    assert.equal(type, 'log', `build log should be detected as "log", got "${type}"`);
  });

  test('minified JSON compresses ≥ 90%', () => {
    const input = jsonSample();
    const { rawTokens, outTokens, type } = compressBlock(input);
    const pct = savedPct(rawTokens, outTokens);
    assert.ok(pct >= 90, `JSON: expected ≥90% savings, got ${pct}% (type: ${type})`);
    assert.equal(type, 'json', `minified JSON should be detected as "json", got "${type}"`);
  });

  test('grep output passes through unchanged (proxy layer; CLI filter handles it)', () => {
    // grep output is already compact — the CLI filter layer (not proxy) handles savings.
    // The proxy should never inflate it.
    const input = grepSample();
    const { rawTokens, outTokens } = compressBlock(input);
    assert.ok(outTokens <= rawTokens, `proxy inflated grep output: ${rawTokens}→${outTokens}`);
  });

  test('detect: build log with timestamps is "log" not "json"', () => {
    const { detect } = require('../src/proxy/detect');
    const log = buildLogSample();
    assert.equal(detect(log), 'log');
  });

  test('detect: object JSON is "json" even with timestamp values', () => {
    const { detect } = require('../src/proxy/detect');
    const json = JSON.stringify({ users: [{ createdAt: '2026-01-01T00:00:00Z', level: 'INFO' }] });
    assert.equal(detect(json), 'json');
  });

  test('detect: JSON array is "json"', () => {
    const { detect } = require('../src/proxy/detect');
    const arr = JSON.stringify([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
    assert.equal(detect(arr), 'json');
  });

  test('detect: array starting with "[2026..." is "log" not "json"', () => {
    const { detect } = require('../src/proxy/detect');
    // invalid JSON that starts with [ (like a log line)
    const logLike = '[2026-08-22T10:00:00Z] INFO server started\n[2026-08-22T10:00:01Z] INFO ready\n'.repeat(5);
    assert.equal(detect(logLike), 'log');
  });

  test('weighted mix across a typical session saves ≥ 40%', () => {
    // Representative mix: tests(20%) + logs(15%) + json(10%) + grep(10%) + diff-like(45%)
    // Conservative: code/diff (the hard cases) dominate
    const inputs = [
      { input: npmTestSample(), weight: 0.20 },
      { input: buildLogSample(), weight: 0.15 },
      { input: jsonSample(), weight: 0.10 },
      { input: grepSample(), weight: 0.10 },
      // diff and code: pass through unchanged — represented by raw === out
      { input: grepSample().repeat(3), weight: 0.45 },
    ];

    let totalRaw = 0, totalOut = 0;
    for (const { input, weight } of inputs) {
      const { rawTokens, outTokens } = compressBlock(input);
      totalRaw += rawTokens * weight;
      totalOut += outTokens * weight;
    }
    const pct = savedPct(totalRaw, totalOut);
    assert.ok(pct >= 40, `weighted mix: expected ≥40% savings, got ${pct}%`);
  });
});

// ─── live session assertions ─────────────────────────────────────────────────

describe('E2E proxy — live session stats', () => {
  const statsPath = path.join(
    process.env.LAKON_HOME || path.join(os.homedir(), '.lakon'),
    'proxy-stats.json'
  );

  const hasStats = fs.existsSync(statsPath);

  test('proxy-stats.json exists (proxy ran at least once)', () => {
    assert.ok(hasStats, `No proxy stats at ${statsPath} — run lakonai install and use Claude Code through the proxy first`);
  });

  const maybeTest = hasStats ? test : test.skip;

  maybeTest('session savings ≥ 50% (proxy is working)', () => {
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    assert.ok(stats.requests > 0, 'no requests recorded');
    const pct = savedPct(stats.rawTokens, stats.outTokens);
    assert.ok(
      pct >= 50,
      `Session savings ${pct}% < 50% — proxy may not be compressing (${stats.requests} requests, ${stats.rawTokens}→${stats.outTokens} tok)`
    );
  });

  maybeTest('session has processed at least one request', () => {
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    assert.ok(stats.requests >= 1, `expected ≥1 requests, got ${stats.requests}`);
  });

  maybeTest('proxy never inflates tokens (out ≤ raw)', () => {
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    assert.ok(
      stats.outTokens <= stats.rawTokens,
      `proxy inflated tokens: ${stats.rawTokens} raw → ${stats.outTokens} out`
    );
  });

  maybeTest('per-type: log blocks save ≥ 90%', () => {
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    const logStats = stats.byType?.log;
    if (!logStats || logStats.count === 0) return; // no log blocks this session — skip silently
    const pct = savedPct(logStats.raw, logStats.out);
    assert.ok(pct >= 90, `log blocks: expected ≥90% savings, got ${pct}% (${logStats.count} blocks)`);
  });
});
