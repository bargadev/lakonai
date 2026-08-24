'use strict';

const assert = require('node:assert/strict');
const { detect } = require('../src/proxy/detect');
const { compress: compressLog } = require('../src/proxy/compress/log');
const { compress: compressDiff } = require('../src/proxy/compress/diff');
const { compress: compressCode } = require('../src/proxy/compress/code');
const { compress: compressJson } = require('../src/proxy/compress/json');
const { compress: compressText } = require('../src/proxy/compress/text');
const { compressBlock, compressRequest, extractText } = require('../src/proxy/compress/index');

// ── detect ────────────────────────────────────────────────────────────────────

test('detect: diff by header', () => {
  assert.equal(detect('diff --git a/foo.js b/foo.js\n--- a/foo.js\n+++ b/foo.js\n@@ -1,3 +1,4 @@\n'), 'diff');
});
test('detect: log by ERROR keyword', () => {
  assert.equal(detect('2026-01-01 10:00:00 ERROR something failed\n at someFile.js:42\n'), 'log');
});
test('detect: log by timestamp', () => {
  assert.equal(detect('2026-08-01T12:00:00 starting server\n connecting to db\n'), 'log');
});
test('detect: log by stack trace', () => {
  assert.equal(detect('Error: boom\n    at Object.doThing (index.js:10:5)\n    at main (index.js:20:3)\n'), 'log');
});
test('detect: json object', () => {
  assert.equal(detect('{"error":"not found","status":404,"detail":"resource missing for this query"}'), 'json');
});
test('detect: json array', () => {
  assert.equal(detect('[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":6},{"id":7},{"id":8}]'), 'json');
});
test('detect: code by import', () => {
  assert.equal(detect('import React from "react";\nimport { useState } from "react";\n\nfunction App() {}'), 'code');
});
test('detect: text fallback', () => {
  const long = 'This is just a plain paragraph with no special markers at all in this long text body that goes on quite a bit.';
  assert.equal(detect(long), 'text');
});
test('detect: short text returns short', () => {
  assert.equal(detect('hello world'), 'short');
});
test('detect: null/empty returns short', () => {
  assert.equal(detect(null), 'short');
  assert.equal(detect(''), 'short');
});

// ── log compressor ────────────────────────────────────────────────────────────

test('log: keeps ERROR lines', () => {
  const input = Array(200).fill('INFO: doing stuff').concat(['ERROR: something broke']).join('\n');
  const out = compressLog(input);
  assert.ok(out.includes('ERROR: something broke'));
});
test('log: drops INFO lines in middle and shows elided marker', () => {
  // Put signal lines at start and end, INFO noise in the middle
  const lines = ['server start', 'server ready', ...Array(150).fill('INFO: progress'), 'ERROR: fail', 'server stop'];
  const out = compressLog(lines.join('\n'));
  assert.ok(out.includes('ERROR: fail'), 'ERROR line must be kept');
  assert.ok(out.includes('elided'), 'must show elided marker');
});
test('log: passes short logs through', () => {
  const input = 'INFO: step 1\nINFO: step 2\nDone.';
  const out = compressLog(input);
  // Short log filtered but not truncated
  assert.ok(out.includes('Done.'));
});
test('log: keeps stack trace lines', () => {
  const input = Array(200).fill('INFO: noise').concat([
    'Error: boom',
    '    at Object.doThing (index.js:10:5)',
  ]).join('\n');
  const out = compressLog(input);
  assert.ok(out.includes('at Object.doThing'));
});

// ── diff compressor ────────────────────────────────────────────────────────────

test('diff: keeps headers and changed lines', () => {
  const input = [
    'diff --git a/foo.js b/foo.js',
    '--- a/foo.js',
    '+++ b/foo.js',
    '@@ -1,6 +1,7 @@',
    ' context1',
    ' context2',
    ' context3',
    '-old line',
    '+new line',
    ' context4',
    ' context5',
    ' context6',
  ].join('\n');
  const out = compressDiff(input);
  assert.ok(out.includes('diff --git'));
  assert.ok(out.includes('+new line'));
  assert.ok(out.includes('-old line'));
});
test('diff: elides excess context lines', () => {
  const manyContext = Array(10).fill(' unchanged line');
  const input = ['diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -1,12 +1,12 @@', ...manyContext, '-old', '+new'].join('\n');
  const out = compressDiff(input);
  assert.ok(out.includes('context lines') || out.split(' unchanged line').length < manyContext.length);
});

// ── code compressor ────────────────────────────────────────────────────────────

test('code: passes short files through unchanged', () => {
  const input = 'import foo from "bar";\nconst x = 1;\n';
  assert.equal(compressCode(input), input);
});
test('code: keeps imports in large files', () => {
  const body = Array(500).fill('  const x = doSomethingVeryLong();').join('\n');
  const input = `import React from 'react';\nimport { useState } from 'react';\n\nfunction App() {\n${body}\n}\n`;
  const out = compressCode(input);
  assert.ok(out.includes("import React from 'react'"));
});
test('code: elides function body in large files', () => {
  const body = Array(500).fill('  const x = doSomethingVeryLong();').join('\n');
  const input = `import x from 'y';\n\nfunction bigFn() {\n${body}\n}\n`;
  const out = compressCode(input);
  assert.ok(out.includes('elided'));
  assert.ok(out.length < input.length);
});

// ── json compressor ────────────────────────────────────────────────────────────

test('json: collapses long arrays', () => {
  const input = JSON.stringify({ items: Array(20).fill({ id: 1, name: 'test' }) });
  const out = compressJson(input);
  const parsed = JSON.parse(out);
  assert.ok(parsed.items.length <= 4); // 3 items + ellipsis string
});
test('json: preserves error keys', () => {
  const input = JSON.stringify({ error: 'not found', status: 404, detail: 'missing' });
  const out = compressJson(input);
  const parsed = JSON.parse(out);
  assert.equal(parsed.error, 'not found');
  assert.equal(parsed.detail, 'missing');
});
test('json: truncates long strings', () => {
  const long = 'x'.repeat(500);
  const input = JSON.stringify({ message: long });
  const out = compressJson(input);
  const parsed = JSON.parse(out);
  assert.ok(parsed.message.length < 500);
  assert.ok(parsed.message.includes('chars)'));
});
test('json: handles invalid json with raw fallback', () => {
  const input = '{not valid json but long enough to trigger something interesting here yes}';
  const out = compressJson(input);
  assert.ok(typeof out === 'string');
});

// ── text compressor ────────────────────────────────────────────────────────────

test('text: passes short text through', () => {
  const input = 'Hello world\nThis is fine.\n';
  assert.equal(compressText(input), input);
});
test('text: collapses blank line runs', () => {
  const input = 'line1\n\n\n\nline2\n';
  const out = compressText(input);
  assert.ok(out.split('\n\n\n').length === 1, 'should not have triple blank lines');
});
test('text: truncates long text keeping head and tail', () => {
  const lines = Array(200).fill('this is a content line with enough words to be interesting');
  const input = lines.join('\n');
  const out = compressText(input);
  assert.ok(out.includes('elided'));
  assert.ok(out.split('\n').length < lines.length);
});
test('text: keeps headings in middle', () => {
  const middle = Array(100).fill('plain line').concat(['## Important Section']).concat(Array(100).fill('more plain'));
  const input = ['# Title', ...middle].join('\n');
  const out = compressText(input);
  assert.ok(out.includes('## Important Section'));
});

// ── compressBlock ─────────────────────────────────────────────────────────────

test('compressBlock: returns original when compressed is larger', () => {
  // Very short input — compressor can't make it smaller
  const r = compressBlock('hello');
  assert.equal(r.compressed, 'hello');
});
test('compressBlock: handles null input', () => {
  const r = compressBlock(null);
  assert.equal(r.type, 'skip');
});
test('compressBlock: reduces a log with errors', () => {
  const log = ['server start', ...Array(200).fill('INFO: polling'), 'ERROR: db timeout', 'server stop'].join('\n');
  const r = compressBlock(log);
  assert.ok(r.outTokens <= r.rawTokens);
  assert.equal(r.type, 'log');
});

// ── extractText ───────────────────────────────────────────────────────────────

test('extractText: string passthrough', () => {
  assert.equal(extractText('hello'), 'hello');
});
test('extractText: array of text items', () => {
  const result = extractText([{ type: 'text', text: 'foo' }, { type: 'text', text: 'bar' }]);
  assert.ok(result.includes('foo') && result.includes('bar'));
});
test('extractText: tool_result string content', () => {
  const result = extractText([{ type: 'tool_result', content: 'big output here' }]);
  assert.ok(result.includes('big output here'));
});
test('extractText: tool_result array content', () => {
  const result = extractText([{ type: 'tool_result', content: [{ text: 'part1' }, { text: 'part2' }] }]);
  assert.ok(result.includes('part1') && result.includes('part2'));
});
test('extractText: unknown type returns empty string', () => {
  const result = extractText([{ type: 'image', source: {} }]);
  assert.equal(result, '');
});

// ── compressRequest ───────────────────────────────────────────────────────────

test('compressRequest: compresses tool_result content', () => {
  const logOutput = ['server start', ...Array(200).fill('INFO: polling'), 'ERROR: db timeout', 'server stop'].join('\n');
  const body = {
    model: 'claude-sonnet-4-5',
    messages: [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: logOutput }] },
    ],
  };
  const { body: result, stats } = compressRequest(body);
  assert.ok(stats.outTokens < stats.rawTokens, 'should save tokens');
  const content = result.messages[0].content[0].content;
  assert.ok(content.length < logOutput.length, 'compressed content should be shorter');
});

test('compressRequest: compresses system prompt', () => {
  const system = Array(200).fill('INFO: this is a long system prompt line').join('\n');
  const body = { model: 'claude-sonnet-4-5', system, messages: [] };
  const { body: result, stats } = compressRequest(body);
  assert.ok(result.system.length < system.length);
  assert.ok(stats.rawTokens > 0);
});

test('compressRequest: compresses text message content', () => {
  const longText = Array(200).fill('This is a long plain text content line.').join('\n');
  const body = {
    model: 'claude-sonnet-4-5',
    messages: [
      { role: 'user', content: [{ type: 'text', text: longText }] },
    ],
  };
  const { body: result, stats } = compressRequest(body);
  assert.ok(stats.rawTokens >= stats.outTokens);
});

test('compressRequest: passes through non-compressible content', () => {
  const body = {
    model: 'claude-sonnet-4-5',
    messages: [{ role: 'user', content: 'hi' }],
  };
  const { body: result } = compressRequest(body);
  assert.equal(result.messages[0].content, 'hi');
});

test('compressRequest: handles string message content', () => {
  const long = Array(200).fill('INFO: background task running').join('\n');
  const body = {
    model: 'claude-sonnet-4-5',
    messages: [{ role: 'user', content: long }],
  };
  const { stats } = compressRequest(body);
  assert.ok(stats.rawTokens > 0);
});

test('compressRequest: stats byType populated', () => {
  const logContent = Array(200).fill('INFO: step').concat(['ERROR: fail']).join('\n');
  const body = {
    model: 'claude-sonnet-4-5',
    messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: logContent }] }],
  };
  const { stats } = compressRequest(body);
  assert.ok(Object.keys(stats.byType).length > 0);
});
