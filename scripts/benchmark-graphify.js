#!/usr/bin/env node
'use strict';

// Benchmark graphify query vs lakonai BM25/semantic on the same 30 queries.
// Requires: graphify installed (pip install graphifyy) and graphify update . already run.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH_PATH = path.join(ROOT, 'graphify-out', 'graph.json');

const QUERIES = [
  // ── Literal ──────────────────────────────────────────────────────────────
  { q: 'parseFile',                        type: 'literal',  expect: 'src/graph/parser.js' },
  { q: 'compress log',                     type: 'literal',  expect: 'src/proxy/compress/log.js' },
  { q: 'BM25 tokenize',                    type: 'literal',  expect: 'src/graph/query.js' },
  { q: 'detectCommunities leiden',         type: 'literal',  expect: 'src/graph/leiden.js' },
  { q: 'writeStats mergeStats proxy',      type: 'literal',  expect: 'src/proxy/server.js' },
  { q: 'buildGraph store',                 type: 'literal',  expect: 'src/graph/store.js' },
  { q: 'watchDir graph',                   type: 'literal',  expect: 'src/graph/watch.js' },
  { q: 'generateEmbeddings embed',         type: 'literal',  expect: 'src/graph/embed.js' },
  { q: 'buildReport report',               type: 'literal',  expect: 'src/graph/report.js' },
  { q: 'installShim install',              type: 'literal',  expect: 'src/install' },
  { q: 'compressCode code',                type: 'literal',  expect: 'src/proxy/compress/code.js' },
  { q: 'filterGit git filter',             type: 'literal',  expect: 'src/filters/git.js' },
  { q: 'rewriteBash bash',                 type: 'literal',  expect: 'src/hooks/bash-rewrite.js' },
  { q: 'throttle hook',                    type: 'literal',  expect: 'src/hooks/throttle.js' },
  { q: 'nlQueryHybrid RRF',                type: 'literal',  expect: 'src/graph/query.js' },

  // ── Semantic ──────────────────────────────────────────────────────────────
  { q: 'function that counts tokens',                                  type: 'semantic', expect: 'src/filters/utils.js' },
  { q: 'module that builds the dependency graph from source files',    type: 'semantic', expect: 'src/graph/parser.js' },
  { q: 'how to detect file type for compression',                      type: 'semantic', expect: 'src/proxy/detect.js' },
  { q: 'save token usage to disk',                                     type: 'semantic', expect: 'src/proxy/server.js' },
  { q: 'intercept file reads and return summary',                      type: 'semantic', expect: 'src/hooks/read-guard.js' },
  { q: 'watch source files for changes and rebuild',                   type: 'semantic', expect: 'src/graph/watch.js' },
  { q: 'convert code to vector for similarity search',                 type: 'semantic', expect: 'src/graph/embed.js' },
  { q: 'group related nodes into clusters',                            type: 'semantic', expect: 'src/graph/leiden.js' },
  { q: 'install platform-specific shell integration',                  type: 'semantic', expect: 'src/install' },
  { q: 'strip comments and shrink output before sending to LLM',       type: 'semantic', expect: 'src/proxy/compress' },
  { q: 'prevent oversized tool output from filling context window',    type: 'semantic', expect: 'src/hooks/output-spill.js' },
  { q: 'block dangerous shell commands before they run',               type: 'semantic', expect: 'src/hooks/bash-rewrite.js' },
  { q: 'generate interactive HTML visualization of the code graph',    type: 'semantic', expect: 'src/graph/html.js' },
  { q: 'find shortest dependency path between two modules',            type: 'semantic', expect: 'src/graph/query.js' },
  { q: 'rate limit requests to avoid overloading the proxy',           type: 'semantic', expect: 'src/hooks/throttle.js' },
];

function queryGraphify(q) {
  try {
    const out = execFileSync('graphify', ['query', q, '--graph', GRAPH_PATH], {
      encoding: 'utf8', timeout: 15000, cwd: ROOT,
    });
    // Extract source_file values from output lines like: NODE foo [src=path/to/file.js ...]
    const files = [];
    for (const line of out.split('\n')) {
      const m = line.match(/\[src=([^\s\]]+)/);
      if (m) files.push(m[1]);
    }
    // Deduplicate, preserve order
    return [...new Set(files)];
  } catch {
    return [];
  }
}

function hit(files, expect) {
  return files.some((f) => f.includes(expect)) ? '✅' : '❌';
}

function run() {
  if (!fs.existsSync(GRAPH_PATH)) {
    console.error('graphify-out/graph.json not found — run: graphify update .');
    process.exit(1);
  }

  const rows = [];
  const W = { q: 45, type: 9, hit: 5, top: 35 };

  for (const { q, type, expect } of QUERIES) {
    const files = queryGraphify(q);
    const h = hit(files, expect);
    const top = files.find((f) => f !== 'package.json') || files[0] || '(no results)';
    rows.push({ q, type, hit: h, top });
    process.stdout.write(`${h} ${q}\n`);
  }

  const header = `${'Query'.padEnd(W.q)} ${'Type'.padEnd(W.type)} ${'Hit'.padEnd(W.hit)} ${'Top file'}`;
  console.log('\n' + header);
  console.log('─'.repeat(header.length + 4));
  for (const r of rows) {
    const qT = r.q.length > W.q - 1 ? r.q.slice(0, W.q - 4) + '…' : r.q;
    const tT = r.top.length > W.top - 1 ? r.top.slice(0, W.top - 4) + '…' : r.top;
    console.log(`${qT.padEnd(W.q)} ${r.type.padEnd(W.type)} ${r.hit.padEnd(W.hit)} ${tT}`);
  }
  console.log('─'.repeat(header.length + 4));

  const N = QUERIES.length;
  const total = rows.filter((r) => r.hit === '✅').length;
  const lit = rows.filter((r) => r.type === 'literal');
  const sem = rows.filter((r) => r.type === 'semantic');
  console.log(`\nGraphify BFS: ${total}/${N}`);
  console.log(`  literal   ${lit.filter((r) => r.hit === '✅').length}/${lit.length}`);
  console.log(`  semantic  ${sem.filter((r) => r.hit === '✅').length}/${sem.length}`);
}

run();
