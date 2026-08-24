#!/usr/bin/env node
'use strict';

// Benchmark: BM25 vs semantic graph query on the lakonai codebase itself.
// Run:  node scripts/benchmark-query.js
// With xenova: npm install @xenova/transformers  then rebuild: lakonai graph build

const fs = require('fs');
const path = require('path');
const { buildSync } = require('../src/graph/index');
const { nlQuery, nlQuerySemantic, nlQueryHybrid } = require('../src/graph/query');
const { hasXenova, embedQuery } = require('../src/graph/embed');
const { mergeAnnotations } = require('../src/graph/annotate');

const ROOT = path.resolve(__dirname, '..');
const GRAPH_DIR = path.join(ROOT, 'lakonai-graph');
const EMB_PATH = path.join(GRAPH_DIR, 'embeddings.json');

// Queries: mix of literal (BM25 works well) and semantic (BM25 struggles).
const QUERIES = [
  // ── Literal (keyword present in label/file/function name) ──────────────────
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

  // ── Semantic (concept query — keyword NOT in label) ─────────────────────────
  { q: 'function that counts tokens',                                  type: 'semantic', expect: 'src/proxy/compress' },
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

function topK(result, k = 3) {
  return result.nodes.slice(0, k).map((n) => `${n.file}  [${n.kind}] ${n.label}`);
}

function hit(result, expect) {
  return result.nodes.some((n) => n.file && n.file.includes(expect)) ? '✅' : '❌';
}

async function run() {
  console.log('building graph…');
  const graph = buildSync(ROOT);
  console.log(`  ${graph.meta.nodeCount} nodes  ${graph.meta.edgeCount} edges\n`);

  let embeddingsData = null;
  if (hasXenova()) {
    if (!fs.existsSync(EMB_PATH)) {
      console.log('semantic: generating embeddings (first run downloads ~23MB model)…');
      const { generateEmbeddings } = require('../src/graph/embed');
      const enriched = mergeAnnotations(graph.nodes, GRAPH_DIR);
      const embs = await generateEmbeddings(enriched);
      fs.mkdirSync(GRAPH_DIR, { recursive: true });
      fs.writeFileSync(EMB_PATH, JSON.stringify(embs));
      console.log(`  saved: ${embs.length} vectors → ${EMB_PATH}\n`);
    }
    embeddingsData = JSON.parse(fs.readFileSync(EMB_PATH, 'utf8'));
    console.log(`semantic: ${embeddingsData.length} vectors loaded\n`);
  } else {
    console.log('semantic: @xenova/transformers not installed — BM25 only\n');
    console.log('  to enable:  npm install @xenova/transformers && lakonai graph build\n');
  }

  const rows = [];
  const COL = 60;

  for (const { q, type, expect } of QUERIES) {
    // BM25
    const bm25 = nlQuery(graph, q, { topK: 5 });
    const bm25Hit = hit(bm25, expect);
    const bm25Top = bm25.nodes[0] ? `${bm25.nodes[0].file}` : '(no results)';

    // Semantic + Hybrid (if available)
    let semHit = '—', semTop = '—';
    let hybHit = '—', hybTop = '—';
    if (embeddingsData) {
      const qVec = await embedQuery(q);
      const sem = nlQuerySemantic(graph, embeddingsData, qVec, { topK: 5 });
      semHit = hit(sem, expect);
      semTop = sem.nodes[0] ? sem.nodes[0].file : '(no results)';

      const hyb = nlQueryHybrid(graph, embeddingsData, q, qVec, { topK: 5 });
      hybHit = hit(hyb, expect);
      hybTop = hyb.nodes[0] ? hyb.nodes[0].file : '(no results)';
    }

    rows.push({ q, type, bm25Hit, bm25Top, semHit, semTop, hybHit, hybTop });
  }

  // Print table
  const W = { q: 45, type: 9, hit: 5, top: 30 };
  const header = `${'Query'.padEnd(W.q)} ${'Type'.padEnd(W.type)} ${'BM25'.padEnd(W.hit)} ${'BM25 top'.padEnd(W.top)} ${'Sem'.padEnd(W.hit)} ${'Sem top'.padEnd(W.top)} ${'Hyb'.padEnd(W.hit)} ${'Hyb top'}`;
  console.log(header);
  console.log('─'.repeat(header.length + 4));

  let bm25Hits = 0, semHits = 0, hybHits = 0, hasEmbed = false;
  for (const r of rows) {
    const qT = r.q.length > W.q - 1 ? r.q.slice(0, W.q - 4) + '…' : r.q;
    const bT = r.bm25Top.length > W.top - 1 ? r.bm25Top.slice(0, W.top - 4) + '…' : r.bm25Top;
    const sT = r.semTop.length > W.top - 1 ? r.semTop.slice(0, W.top - 4) + '…' : r.semTop;
    const hT = r.hybTop.length > W.top - 1 ? r.hybTop.slice(0, W.top - 4) + '…' : r.hybTop;
    console.log(
      `${qT.padEnd(W.q)} ${r.type.padEnd(W.type)} ${r.bm25Hit.padEnd(W.hit)} ${bT.padEnd(W.top)} ${r.semHit.padEnd(W.hit)} ${sT.padEnd(W.top)} ${r.hybHit.padEnd(W.hit)} ${hT}`
    );
    if (r.bm25Hit === '✅') bm25Hits++;
    if (r.semHit === '✅') semHits++;
    if (r.hybHit === '✅') hybHits++;
    if (r.hybHit !== '—') hasEmbed = true;
  }

  const N = QUERIES.length;
  console.log('─'.repeat(header.length + 4));
  console.log(`\nBM25:     ${bm25Hits}/${N}`);
  if (hasEmbed) {
    console.log(`Semantic: ${semHits}/${N}`);
    console.log(`Hybrid:   ${hybHits}/${N}  ← BM25 + semantic (RRF)`);
    const lit  = rows.filter((r) => r.type === 'literal');
    const sem  = rows.filter((r) => r.type === 'semantic');
    console.log(`\n  literal   BM25 ${lit.filter(r=>r.bm25Hit==='✅').length}/${lit.length}  Sem ${lit.filter(r=>r.semHit==='✅').length}/${lit.length}  Hyb ${lit.filter(r=>r.hybHit==='✅').length}/${lit.length}`);
    console.log(`  semantic  BM25 ${sem.filter(r=>r.bm25Hit==='✅').length}/${sem.length}  Sem ${sem.filter(r=>r.semHit==='✅').length}/${sem.length}  Hyb ${sem.filter(r=>r.hybHit==='✅').length}/${sem.length}`);
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
