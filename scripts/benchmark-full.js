#!/usr/bin/env node
'use strict';

// Full lakonai benchmark: filters + proxy compression + pixel estimate
// Usage: node scripts/benchmark-full.js [--save]
// --save writes results to docs/benchmark-full-YYYY-MM-DD.md

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { filterCommand } = require(path.join(ROOT, 'src/filters'));
const { compressBlock } = require(path.join(ROOT, 'src/proxy/compress'));
const { estimateSavings } = require(path.join(ROOT, 'src/pixel/estimate'));
const { findInstalledSkills, parseSkill } = require(path.join(ROOT, 'src/pixel/paths'));
const bench = require(path.join(ROOT, 'src/bench'));

const tokApprox = (s) => Math.ceil(s.length / 4);
const pct = (raw, out) => (raw === 0 ? 0 : Math.round((1 - out / raw) * 100));

// ─── helpers ────────────────────────────────────────────────────────────────

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, maxBuffer: 4 * 1024 * 1024, ...opts });
  return r.stdout ? r.stdout.toString() : '';
}

function row(name, raw, out) {
  const p = pct(raw, out);
  return { name, raw, out, saved: p };
}

function tableLines(rows, cols) {
  const [c1, c2, c3, c4] = cols || [28, 8, 10, 8];
  const pad = (s, n) => String(s).padEnd(n);
  const padR = (s, n) => String(s).padStart(n);
  const hdr = pad('case', c1) + padR('raw tok', c2) + padR('lakonai', c3) + padR('saved', c4);
  const sep = '-'.repeat(c1 + c2 + c3 + c4);
  const lines = [hdr, sep];
  for (const r of rows) {
    lines.push(pad(r.name, c1) + padR(r.raw, c2) + padR(r.out, c3) + padR(r.saved + '%', c4));
  }
  const totalRaw = rows.reduce((s, r) => s + r.raw, 0);
  const totalOut = rows.reduce((s, r) => s + r.out, 0);
  lines.push(sep);
  lines.push(pad('TOTAL', c1) + padR(totalRaw, c2) + padR(totalOut, c3) + padR(pct(totalRaw, totalOut) + '%', c4));
  return { lines, totalRaw, totalOut };
}

// ─── Layer 1: CLI filters ────────────────────────────────────────────────────

function benchFilters() {
  const rows = bench.runBench().map((r) => row(r.name, r.before, r.after));

  // Also run against real commands in the repo
  const realCmds = [
    { name: 'git log (real)', cmd: 'git', args: ['log', '--oneline', '-30'] },
    { name: 'git diff (real)', cmd: 'git', args: ['diff', 'HEAD~1'] },
    { name: 'git status (real)', cmd: 'git', args: ['status'] },
    { name: 'ls -la (real)', cmd: 'ls', args: ['-la', ROOT] },
    { name: 'find src/ (real)', cmd: 'find', args: ['src', '-name', '*.js'] },
  ];

  for (const c of realCmds) {
    const raw = run(c.cmd, c.args);
    if (!raw.trim()) continue;
    const filtered = filterCommand(c.cmd, c.args, raw);
    rows.push(row(c.name, tokApprox(raw), tokApprox(filtered)));
  }

  return rows;
}

// ─── Layer 2: Proxy compression ─────────────────────────────────────────────

function buildLogSample() {
  let s = '';
  for (let i = 0; i < 30; i++) {
    s += `[2026-08-22T10:${String(i).padStart(2,'0')}:00Z] INFO  RequestHandler: processing request ${i} from 192.168.1.${i % 256}\n`;
    if (i % 5 === 0) s += `[2026-08-22T10:${String(i).padStart(2,'0')}:01Z] DEBUG cache hit for key=user:${i}:profile\n`;
  }
  return s;
}

function jsonSample() {
  const obj = { users: [] };
  for (let i = 0; i < 50; i++) {
    obj.users.push({ id: i, name: `user${i}`, email: `user${i}@example.com`, role: i % 3 === 0 ? 'admin' : 'user', createdAt: '2026-01-01T00:00:00Z', active: true });
  }
  return JSON.stringify(obj);
}

function codeSample() {
  let s = '';
  for (let i = 0; i < 15; i++) {
    s += `function handler${i}(req, res) {\n  const data = req.body;\n  if (!data.id) return res.status(400).json({ error: 'missing id' });\n  const result = processData${i}(data);\n  return res.json({ success: true, result });\n}\n\n`;
  }
  return s;
}

function diffSample() {
  return run('git', ['diff', 'HEAD~2', '--', 'src/proxy/compress/index.js', 'src/filters/index.js']);
}

function benchProxy() {
  const proxyInputs = [
    { name: 'build log (30 lines)', input: buildLogSample() },
    { name: 'minified JSON (50 users)', input: jsonSample() },
    { name: 'JS code (15 fns)', input: codeSample() },
    { name: 'git diff (2 files)', input: diffSample() },
    { name: 'system prompt (npm test)', input: run('npm', ['test'], { env: { ...process.env, CI: '1' } }).slice(0, 4000) || '' },
  ];

  const rows = [];
  for (const { name, input } of proxyInputs) {
    if (!input || !input.trim()) continue;
    const { compressed, type } = compressBlock(input);
    const raw = tokApprox(input);
    const out = tokApprox(compressed);
    rows.push({ ...row(name, raw, out), type });
  }
  return rows;
}

// ─── Layer 4: Graph read-guard ───────────────────────────────────────────────

const { graphSubgraphFor } = require(path.join(ROOT, 'src/hooks/read-guard'));

function benchGraph() {
  const graphJson = path.join(ROOT, 'lakonai-graph', 'graph.json');
  if (!fs.existsSync(graphJson)) return { rows: [], meta: null };

  const graph = JSON.parse(fs.readFileSync(graphJson, 'utf8'));
  const fileNodes = graph.nodes.filter((n) => n.kind === 'file');

  const rows = [];
  let skipped = 0;

  // Sample up to 20 files that actually have symbols (non-trivial content)
  const candidates = fileNodes.filter((n) => {
    const symbols = graph.nodes.filter((s) => s.file === n.id && s.kind !== 'file');
    return symbols.length >= 2;
  }).slice(0, 20);

  for (const fileNode of candidates) {
    const absPath = path.join(ROOT, fileNode.id);
    let rawContent;
    try { rawContent = fs.readFileSync(absPath, 'utf8'); } catch { continue; }
    const subgraph = graphSubgraphFor(absPath);
    if (!subgraph) { skipped++; continue; }

    const rawTok = tokApprox(rawContent);
    const outTok = tokApprox(subgraph);
    rows.push(row(fileNode.id, rawTok, outTok));
  }

  return { rows, skipped, meta: graph.meta };
}

// ─── Layer 3: Pixel (skill PNG conversion) ───────────────────────────────────

function benchPixel() {
  const skills = findInstalledSkills({});
  const rows = [];
  let skipped = 0;

  for (const { filePath } of skills) {
    const parsed = parseSkill(filePath);
    if (!parsed) continue;
    const est = estimateSavings(parsed.body);
    const name = path.relative(process.env.HOME || '', filePath);
    if (est.profitable) {
      rows.push(row(name, est.textTokens, est.imgTokens));
    } else {
      skipped++;
    }
  }

  return { rows, skipped };
}

// ─── Combined report ─────────────────────────────────────────────────────────

function main() {
  const save = process.argv.includes('--save');
  const now = new Date().toISOString().slice(0, 10);
  const lines = [];

  const h = (s) => lines.push(s);

  h(`# lakonai Full Benchmark — ${now}`);
  h('');
  h('All three layers measured independently. Token count: `ceil(chars / 4)`.');
  h('');

  // Layer 1
  h('## Layer 1 — CLI Filters');
  h('');
  h('Filters strip noise from CLI command output before it reaches the model.');
  h('');
  const filterRows = benchFilters();
  const { lines: fl, totalRaw: fr, totalOut: fo } = tableLines(filterRows);
  h('```');
  fl.forEach((l) => h(l));
  h('```');
  h('');

  // Layer 2 (graph)
  h('## Layer 2 — Graph Read-Guard');
  h('');
  h('Intercepts file reads: serves compact subgraph summary instead of raw file content.');
  h('');
  const { rows: graphRows, skipped: graphSkipped, meta: graphMeta } = benchGraph();
  if (!graphMeta) {
    h('_No graph built. Run `lakonai graph build` first._');
  } else {
    h(`Graph: ${graphMeta.nodeCount} nodes, ${graphMeta.edgeCount} edges, ${graphMeta.fileCount} files.`);
    h('');
    if (graphRows.length === 0) {
      h('_No files with symbols found._');
    } else {
      const { lines: gl, totalRaw: gr, totalOut: go } = tableLines(graphRows, [42, 8, 10, 8]);
      h('```');
      gl.forEach((l) => h(l));
      h('```');
      h('');
      h(`${graphSkipped} file(s) skipped — not in graph or no subgraph available.`);
    }
  }
  h('');

  // Layer 3
  h('## Layer 3 — Proxy Compression');
  h('');
  h('Compresses LLM request/response bodies (build logs, JSON, code, diffs).');
  h('');
  const proxyRows = benchProxy();
  const { lines: pl, totalRaw: pr, totalOut: po } = tableLines(
    proxyRows.map((r) => ({ ...r, name: `${r.name} [${r.type}]` }))
  );
  h('```');
  pl.forEach((l) => h(l));
  h('```');
  h('');

  // Layer 4
  h('## Layer 4 — Pixel (Skill PNG Conversion)');
  h('');
  h('Converts verbose skill markdown to PNG images (vision tokens < text tokens).');
  h('');
  const { rows: pixRows, skipped } = benchPixel();
  if (pixRows.length === 0) {
    h('_No installed skills found (run `lakonai install` first)._');
  } else {
    const { lines: xl, totalRaw: xr, totalOut: xo } = tableLines(pixRows);
    h('```');
    xl.forEach((l) => h(l));
    h('```');
    h('');
    h(`${skipped} skill(s) skipped — below break-even (~255 tokens per tile).`);
    h('');
  }

  // Summary
  h('## Combined Summary');
  h('');

  const summaryRows = [
    row('CLI filters', fr, fo),
  ];
  if (graphRows.length > 0) {
    const gr2 = graphRows.reduce((s, r) => s + r.raw, 0);
    const go2 = graphRows.reduce((s, r) => s + r.out, 0);
    summaryRows.push(row('Graph read-guard (sampled)', gr2, go2));
  }
  summaryRows.push(row('Proxy compression', pr, po));
  if (pixRows.length > 0) {
    const xr2 = pixRows.reduce((s, r) => s + r.raw, 0);
    const xo2 = pixRows.reduce((s, r) => s + r.out, 0);
    summaryRows.push(row('Pixel (profitable skills)', xr2, xo2));
  }

  const { lines: sl } = tableLines(summaryRows, [30, 10, 12, 8]);
  h('```');
  sl.forEach((l) => h(l));
  h('```');
  h('');
  h('> Layers are independent — each operates on a different surface.');
  h('> Combined savings are additive across separate contexts, not compounded.');
  h('');

  const report = lines.join('\n');
  process.stdout.write(report + '\n');

  if (save) {
    const outPath = path.join(ROOT, 'docs', `benchmark-full-${now}.md`);
    fs.writeFileSync(outPath, report, 'utf8');
    process.stderr.write(`\nSaved: ${outPath}\n`);
  }
}

main();
