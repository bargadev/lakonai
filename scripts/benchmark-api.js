#!/usr/bin/env node
'use strict';

// Real API benchmark: sends identical payloads to Claude with and without the
// lakonai proxy. Compares usage.input_tokens from the API response — this is
// the ground-truth token count (what the model actually tokenizes).
//
// Usage: node scripts/benchmark-api.js [--save]

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SAVE = process.argv.includes('--save');
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

const DIRECT_URL = 'https://api.anthropic.com/v1/messages';
const PROXY_URL = `http://localhost:${process.env.LAKON_PROXY_PORT || 7474}/v1/messages`;

// ─── sample payloads ────────────────────────────────────────────────────────

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 });
  return r.stdout ? r.stdout.toString() : '';
}

function npmTestOutput() {
  let s = '> lakonai@0.17.1 test\n> jest\n\n';
  for (let f = 0; f < 44; f++) {
    s += `PASS tests/suite${f}.test.js\n`;
    for (let c = 0; c < 15; c++) s += `  ✓ ${['handles', 'filters', 'compresses', 'detects', 'parses'][c%5]} case ${f}.${c} (${c+1} ms)\n`;
  }
  s += '\nTest Suites: 44 passed, 44 total\nTests:       652 passed, 652 total\nSnapshots:   0 total\nTime:        3.214 s\n';
  return s;
}

function buildLogOutput() {
  let s = '';
  for (let i = 0; i < 80; i++) {
    s += `[2026-08-22T10:${String(i%60).padStart(2,'0')}:00Z] INFO  Compiler: processing file src/module${i}.js\n`;
    if (i % 8 === 0) s += `[2026-08-22T10:${String(i%60).padStart(2,'0')}:01Z] DEBUG  cache miss for src/module${i}.js — recompiling\n`;
    if (i % 20 === 0) s += `[2026-08-22T10:${String(i%60).padStart(2,'0')}:02Z] WARN   slow compile: src/module${i}.js took 1.${i}s\n`;
  }
  s += '[2026-08-22T10:59:59Z] INFO  Build complete: 80 files, 0 errors, 3 warnings\n';
  return s;
}

function gitDiffOutput() {
  return run('git', ['diff', 'HEAD~3']);
}

function largeJsonOutput() {
  const users = Array.from({ length: 120 }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    email: `user${i}@example.com`,
    role: i % 5 === 0 ? 'admin' : 'user',
    createdAt: '2026-01-01T00:00:00Z',
    lastLogin: '2026-08-22T09:00:00Z',
    active: i % 7 !== 0,
    preferences: { theme: 'dark', notifications: true, language: 'en' },
  }));
  return JSON.stringify({ users, total: users.length, page: 1, pageSize: 120 });
}

function fileReadOutput() {
  try { return fs.readFileSync(path.join(ROOT, 'src/graph/parser.js'), 'utf8'); } catch { return ''; }
}

// Build realistic tool_result messages (what an agent session looks like)
const CASES = [
  {
    name: 'npm test (652 tests)',
    system: 'You are a coding assistant. Analyze the test results and summarize failures only.',
    toolResult: npmTestOutput(),
  },
  {
    name: 'build log (80 lines)',
    system: 'You are a build engineer. Diagnose build warnings from the log.',
    toolResult: buildLogOutput(),
  },
  {
    name: 'git diff (real)',
    system: 'You are a code reviewer. Summarize what changed in this diff.',
    toolResult: gitDiffOutput(),
  },
  {
    name: 'JSON API response (120 users)',
    system: 'You are a data analyst. Count how many admin users are in this JSON.',
    toolResult: largeJsonOutput(),
  },
  {
    name: 'file read (parser.js)',
    system: 'You are a code assistant. Describe what this file does in one sentence.',
    toolResult: fileReadOutput(),
  },
];

// ─── API call ────────────────────────────────────────────────────────────────

function callApi(url, body, headers) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': API_KEY,
        ...headers,
      },
    };
    const req = (isHttps ? https : http).request(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`JSON parse failed: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function buildPayload(c) {
  return {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 32,
    system: c.system,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'bench_01',
            content: c.toolResult,
          },
        ],
      },
    ],
  };
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const results = [];
  const now = new Date().toISOString().slice(0, 10);

  process.stderr.write('Running real API calls (direct vs proxy)...\n\n');

  for (const c of CASES) {
    if (!c.toolResult || !c.toolResult.trim()) {
      process.stderr.write(`  skip: ${c.name} (empty payload)\n`);
      continue;
    }

    const payload = buildPayload(c);
    const charCount = c.toolResult.length;

    process.stderr.write(`  ${c.name} (${charCount} chars)...\n`);

    let direct, proxy;
    try {
      direct = await callApi(DIRECT_URL, payload, {});
    } catch (e) {
      process.stderr.write(`    direct failed: ${e.message}\n`);
      continue;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));

    try {
      proxy = await callApi(PROXY_URL, payload, { 'x-lakonai-bench': '1' });
    } catch (e) {
      process.stderr.write(`    proxy failed: ${e.message}\n`);
      continue;
    }

    if (direct.error || proxy.error) {
      process.stderr.write(`    API error: ${JSON.stringify(direct.error || proxy.error)}\n`);
      continue;
    }

    const rawTok = direct.usage?.input_tokens ?? 0;
    const outTok = proxy.usage?.input_tokens ?? 0;
    const saved = rawTok === 0 ? 0 : Math.round((1 - outTok / rawTok) * 100);

    results.push({ name: c.name, rawTok, outTok, saved, chars: charCount });
    process.stderr.write(`    direct: ${rawTok} tok  proxy: ${outTok} tok  saved: ${saved}%\n`);

    await new Promise(r => setTimeout(r, 300));
  }

  // ─── format report ────────────────────────────────────────────────────────

  const pad = (s, n) => String(s).padEnd(n);
  const padR = (s, n) => String(s).padStart(n);
  const C = [30, 10, 10, 8];

  const lines = [];
  const h = (s) => lines.push(s);

  h(`# lakonai API Benchmark — ${now}`);
  h('');
  h('Ground-truth token savings: `usage.input_tokens` from the Anthropic API,');
  h('same payload sent twice — once direct, once through the lakonai proxy.');
  h('Model: claude-haiku-4-5-20251001 (cheapest, same tokenizer as all Claude models).');
  h('');
  h('## Results');
  h('');
  h('```');
  h(pad('case', C[0]) + padR('direct tok', C[1]) + padR('proxy tok', C[2]) + padR('saved', C[3]));
  h('-'.repeat(C[0]+C[1]+C[2]+C[3]));
  for (const r of results) {
    h(pad(r.name, C[0]) + padR(r.rawTok, C[1]) + padR(r.outTok, C[2]) + padR(r.saved+'%', C[3]));
  }
  if (results.length > 0) {
    const tr = results.reduce((s, r) => s + r.rawTok, 0);
    const to = results.reduce((s, r) => s + r.outTok, 0);
    const ts = tr === 0 ? 0 : Math.round((1 - to / tr) * 100);
    h('-'.repeat(C[0]+C[1]+C[2]+C[3]));
    h(pad('TOTAL', C[0]) + padR(tr, C[1]) + padR(to, C[2]) + padR(ts+'%', C[3]));
  }
  h('```');
  h('');
  h('## Notes');
  h('');
  h('- Token counts come from `usage.input_tokens` in the API response — not estimated.');
  h('- The proxy compresses tool_result content before it reaches the model.');
  h('- System prompt and message overhead are constant across both calls.');
  h('- Savings on code/JSON/diffs are the main driver; short text gains little.');

  const report = lines.join('\n');
  process.stdout.write('\n' + report + '\n');

  if (SAVE && results.length > 0) {
    const outPath = path.join(ROOT, 'docs', `benchmark-api-${now}.md`);
    fs.writeFileSync(outPath, report, 'utf8');
    process.stderr.write(`\nSaved: ${outPath}\n`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
