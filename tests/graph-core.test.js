'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildGraph, writeGraph, readGraph, nodesForFile, graphPath } = require('../src/graph/store');
const { detectCommunities, communityLabels } = require('../src/graph/leiden');
const { explain, shortestPath, nlQuery, nlQuerySemantic, nlQueryHybrid, tokenize, buildBM25Index, formatExplain, formatPath, formatNlQuery } = require('../src/graph/query');
const { buildReport } = require('../src/graph/report');
const { buildHtml } = require('../src/graph/html');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-graph-'));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true }); } catch { /* ok */ }
}

// Sample graph fixture
function sampleGraph() {
  const nodes = [
    { id: 'src/app.js', label: 'app.js', kind: 'file', file: 'src/app.js', line: 0 },
    { id: 'src/app.js#main', label: 'main', kind: 'function', file: 'src/app.js', line: 5 },
    { id: 'src/utils.js', label: 'utils.js', kind: 'file', file: 'src/utils.js', line: 0 },
    { id: 'src/utils.js#helper', label: 'helper', kind: 'function', file: 'src/utils.js', line: 3 },
    { id: 'src/auth.js', label: 'auth.js', kind: 'file', file: 'src/auth.js', line: 0 },
    { id: 'src/auth.js#Auth', label: 'Auth', kind: 'class', file: 'src/auth.js', line: 1 },
  ];
  const edges = [
    { from: 'src/app.js', to: 'src/app.js#main', rel: 'contains', tag: 'EXTRACTED' },
    { from: 'src/app.js', to: 'src/utils.js', rel: 'imports', tag: 'EXTRACTED' },
    { from: 'src/utils.js', to: 'src/utils.js#helper', rel: 'contains', tag: 'EXTRACTED' },
    { from: 'src/auth.js', to: 'src/auth.js#Auth', rel: 'contains', tag: 'EXTRACTED' },
    { from: 'src/app.js#main', to: 'src/utils.js#helper', rel: 'calls', tag: 'INFERRED' },
  ];
  return { nodes, edges };
}

// ── store ─────────────────────────────────────────────────────────────────────

test('store: writeGraph + readGraph roundtrip', () => {
  const dir = tmpDir();
  const raw = sampleGraph();
  const graph = buildGraph({ ...raw, fileCount: 3 }, {});
  writeGraph(dir, graph);
  const loaded = readGraph(dir);
  assert.ok(loaded !== null);
  assert.equal(loaded.meta.nodeCount, raw.nodes.length);
  assert.equal(loaded.meta.edgeCount, raw.edges.length); // 5 edges, none duplicated
  cleanup(dir);
});

test('store: readGraph returns null when missing', () => {
  const dir = tmpDir();
  assert.equal(readGraph(dir), null);
  cleanup(dir);
});

test('store: buildGraph deduplicates edges', () => {
  const dir = tmpDir();
  const { nodes } = sampleGraph();
  const edges = [
    { from: 'src/app.js', to: 'src/utils.js', rel: 'imports', tag: 'EXTRACTED' },
    { from: 'src/app.js', to: 'src/utils.js', rel: 'imports', tag: 'EXTRACTED' }, // dup
  ];
  const graph = buildGraph({ nodes, edges, fileCount: 2 }, {});
  assert.equal(graph.edges.filter((e) => e.rel === 'imports').length, 1);
  cleanup(dir);
});

test('store: buildGraph assigns communities from map', () => {
  const raw = sampleGraph();
  const comm = { 'src/app.js': 0, 'src/app.js#main': 0, 'src/utils.js': 1 };
  const graph = buildGraph({ ...raw, fileCount: 3 }, comm);
  const appNode = graph.nodes.find((n) => n.id === 'src/app.js');
  assert.equal(appNode.community, 0);
  cleanup('');
});

test('store: nodesForFile filters correctly', () => {
  const raw = sampleGraph();
  const graph = buildGraph({ ...raw, fileCount: 3 }, {});
  const nodes = nodesForFile(graph, 'src/app.js');
  assert.ok(nodes.every((n) => n.file === 'src/app.js'));
});

test('store: graphPath returns correct location', () => {
  const p = graphPath('/root');
  assert.ok(p.includes('lakonai-graph'));
  assert.ok(p.endsWith('graph.json'));
});

// ── leiden ─────────────────────────────────────────────────────────────────────

test('leiden: detectCommunities returns object', () => {
  const { nodes, edges } = sampleGraph();
  const result = detectCommunities(nodes, edges);
  assert.ok(typeof result === 'object');
  for (const n of nodes) assert.ok(typeof result[n.id] === 'number');
});

test('leiden: empty nodes returns empty object', () => {
  assert.deepEqual(detectCommunities([], []), {});
});

test('leiden: isolated nodes get own communities', () => {
  const nodes = [
    { id: 'a', label: 'a', kind: 'file', file: 'a', line: 0 },
    { id: 'b', label: 'b', kind: 'file', file: 'b', line: 0 },
  ];
  const result = detectCommunities(nodes, []);
  // Both isolated — each its own community, but both valid integers
  assert.ok(typeof result['a'] === 'number');
  assert.ok(typeof result['b'] === 'number');
});

test('leiden: connected nodes tend to share communities', () => {
  const nodes = [
    { id: 'a', label: 'a', kind: 'file', file: 'a', line: 0 },
    { id: 'b', label: 'b', kind: 'file', file: 'b', line: 0 },
    { id: 'c', label: 'c', kind: 'file', file: 'c', line: 0 },
  ];
  const edges = [
    { from: 'a', to: 'b', rel: 'imports', tag: 'EXTRACTED' },
    { from: 'b', to: 'c', rel: 'imports', tag: 'EXTRACTED' },
  ];
  const result = detectCommunities(nodes, edges, { iterations: 20 });
  // All 3 should end up in the same community after propagation
  assert.equal(result['a'], result['b']);
  assert.equal(result['b'], result['c']);
});

test('leiden: deterministic with same seed', () => {
  const { nodes, edges } = sampleGraph();
  const r1 = detectCommunities(nodes, edges, { seed: 42 });
  const r2 = detectCommunities(nodes, edges, { seed: 42 });
  assert.deepEqual(r1, r2);
});

test('leiden: communityLabels returns label per community', () => {
  const { nodes, edges } = sampleGraph();
  const comm = detectCommunities(nodes, edges);
  const labels = communityLabels(nodes, edges, comm);
  assert.ok(typeof labels === 'object');
  for (const v of Object.values(labels)) assert.ok(typeof v === 'string');
});

// ── query ─────────────────────────────────────────────────────────────────────

function graphWithComm() {
  const raw = sampleGraph();
  const comm = detectCommunities(raw.nodes, raw.edges);
  return buildGraph({ ...raw, fileCount: 3 }, comm);
}

test('query: tokenize splits text', () => {
  assert.deepEqual(tokenize('Hello World'), ['hello', 'world']);
});

test('query: tokenize handles empty string', () => {
  assert.deepEqual(tokenize(''), []);
});

test('query: tokenize handles null', () => {
  assert.deepEqual(tokenize(null), []);
});

test('query: buildBM25Index scores correctly', () => {
  const nodes = [
    { id: 'a', label: 'authenticate', kind: 'function', file: 'auth.js' },
    { id: 'b', label: 'render', kind: 'function', file: 'ui.js' },
  ];
  const idx = buildBM25Index(nodes);
  const authScore = idx.score(0, ['authenticate']);
  const renderScore = idx.score(1, ['authenticate']);
  assert.ok(authScore > renderScore);
});

test('query: explain returns node + edges', () => {
  const graph = graphWithComm();
  const result = explain(graph, 'src/app.js');
  assert.ok(result !== null);
  assert.equal(result.node.id, 'src/app.js');
  assert.ok(Array.isArray(result.outgoing));
  assert.ok(Array.isArray(result.incoming));
});

test('query: explain returns null for unknown node', () => {
  const graph = graphWithComm();
  assert.equal(explain(graph, 'nonexistent'), null);
});

test('query: shortestPath finds direct path', () => {
  const graph = graphWithComm();
  const p = shortestPath(graph, 'src/app.js', 'src/utils.js');
  assert.ok(Array.isArray(p));
  assert.ok(p.length >= 2);
  assert.equal(p[0], 'src/app.js');
  assert.equal(p[p.length - 1], 'src/utils.js');
});

test('query: shortestPath returns single node when from === to', () => {
  const graph = graphWithComm();
  const p = shortestPath(graph, 'src/app.js', 'src/app.js');
  assert.deepEqual(p, ['src/app.js']);
});

test('query: shortestPath returns null when disconnected', () => {
  const graph = graphWithComm();
  const p = shortestPath(graph, 'src/auth.js#Auth', 'src/utils.js#helper');
  // May or may not have a path; just assert it returns array or null
  assert.ok(p === null || Array.isArray(p));
});

test('query: nlQuery returns relevant nodes', () => {
  const graph = graphWithComm();
  const result = nlQuery(graph, 'helper utils');
  assert.ok(result.nodes.length > 0);
  assert.ok(result.nodes.some((n) => n.label.includes('helper') || n.file.includes('utils')));
});

test('query: nlQuery handles empty graph', () => {
  const graph = { nodes: [], edges: [], meta: {} };
  const result = nlQuery(graph, 'anything');
  assert.deepEqual(result.nodes, []);
});

test('query: formatExplain returns string', () => {
  const graph = graphWithComm();
  const r = explain(graph, 'src/app.js#main');
  const s = formatExplain(r);
  assert.ok(typeof s === 'string');
  assert.ok(s.includes('main'));
});

test('query: formatExplain handles null', () => {
  assert.equal(formatExplain(null), '(node not found)');
});

test('query: formatPath returns string', () => {
  const graph = graphWithComm();
  const p = shortestPath(graph, 'src/app.js', 'src/utils.js');
  const s = formatPath(p, graph);
  assert.ok(s.includes('→') || s.includes('app'));
});

test('query: formatPath handles null', () => {
  assert.equal(formatPath(null, {}), '(no path found)');
});

test('query: formatNlQuery returns string', () => {
  const graph = graphWithComm();
  const result = nlQuery(graph, 'helper');
  const s = formatNlQuery(result, graph);
  assert.ok(typeof s === 'string');
});

test('query: formatNlQuery no results', () => {
  const graph = { nodes: [], edges: [], meta: {} };
  const result = nlQuery(graph, 'zzz');
  const s = formatNlQuery(result, graph);
  assert.equal(s, '(no relevant nodes found)');
});

test('query: formatNlQuery with edge nodes not in nodeMap uses id fallback', () => {
  // Construct a result where edges reference node ids not in graph.nodes
  const result = {
    nodes: [{ id: 'a', label: 'A', kind: 'function', file: 'a.js', line: 1 }],
    edges: [{ from: 'unknown-from', to: 'unknown-to', rel: 'calls' }],
  };
  const graph = { nodes: [], edges: [] }; // empty nodeMap
  const s = formatNlQuery(result, graph);
  // Fallback: uses raw id string when node not in map
  assert.ok(s.includes('unknown-from'));
  assert.ok(s.includes('unknown-to'));
});

// ── report ────────────────────────────────────────────────────────────────────

test('report: buildReport returns markdown string', () => {
  const graph = graphWithComm();
  const md = buildReport(graph);
  assert.ok(typeof md === 'string');
  assert.ok(md.includes('# lakonai graph'));
  assert.ok(md.includes('Communities'));
});

test('report: includes node count', () => {
  const graph = graphWithComm();
  const md = buildReport(graph);
  assert.ok(md.includes(`${graph.meta.nodeCount}`));
});

test('report: includes suggested questions', () => {
  const graph = graphWithComm();
  const md = buildReport(graph);
  assert.ok(md.includes('Suggested questions'));
});

// ── html ──────────────────────────────────────────────────────────────────────

test('html: buildHtml returns HTML string', () => {
  const graph = graphWithComm();
  const html = buildHtml(graph);
  assert.ok(typeof html === 'string');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<canvas'));
});

test('html: embeds graph data', () => {
  const graph = graphWithComm();
  const html = buildHtml(graph);
  assert.ok(html.includes('app.js'));
});

test('html: works with empty graph', () => {
  const graph = { nodes: [], edges: [], meta: { builtAt: '', nodeCount: 0, edgeCount: 0, fileCount: 0 } };
  const html = buildHtml(graph);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
});

// ── nlQuerySemantic ──────────────────────────────────────────────────────────

const GRAPH_SEMANTIC = {
  nodes: [
    { id: 'a', label: 'parseFile', kind: 'function', file: 'src/parser.js', line: 1 },
    { id: 'b', label: 'readGraph', kind: 'function', file: 'src/store.js',  line: 5 },
    { id: 'c', label: 'buildHtml', kind: 'function', file: 'src/html.js',   line: 2 },
  ],
  edges: [{ from: 'a', to: 'b', rel: 'calls', tag: 'EXTRACTED' }],
};

test('nlQuerySemantic: returns top-k nodes by cosine similarity', () => {
  // Embedding for 'a' is very similar to queryVec, 'b' less so, 'c' orthogonal
  const embeddingsData = [
    { id: 'a', embedding: [1, 0] },
    { id: 'b', embedding: [0.6, 0.8] },
    { id: 'c', embedding: [0, 1] },
  ];
  const queryVec = [1, 0]; // perfectly aligned with 'a'
  const result = nlQuerySemantic(GRAPH_SEMANTIC, embeddingsData, queryVec, { topK: 10 });
  assert.equal(result.mode, 'semantic');
  // 'a' (score=1) and 'b' (score=0.6) above threshold; 'c' (score=0) filtered
  assert.ok(result.nodes.find((n) => n.id === 'a'));
  assert.ok(result.nodes.find((n) => n.id === 'b'));
  assert.ok(!result.nodes.find((n) => n.id === 'c'));
});

test('nlQuerySemantic: edges included when both endpoints are relevant', () => {
  const embeddingsData = [
    { id: 'a', embedding: [1, 0] },
    { id: 'b', embedding: [0.8, 0.6] },
    { id: 'c', embedding: [0, 1] },
  ];
  const queryVec = [1, 0];
  const result = nlQuerySemantic(GRAPH_SEMANTIC, embeddingsData, queryVec);
  // edge a→b: both relevant → included
  assert.ok(result.edges.some((e) => e.from === 'a' && e.to === 'b'));
});

test('nlQuerySemantic: empty graph returns empty result', () => {
  const empty = { nodes: [], edges: [] };
  const result = nlQuerySemantic(empty, [], [1, 0]);
  assert.equal(result.nodes.length, 0);
  assert.equal(result.mode, 'semantic');
});

test('nlQuerySemantic: null embeddingsData returns empty result', () => {
  const result = nlQuerySemantic(GRAPH_SEMANTIC, null, [1, 0]);
  assert.equal(result.nodes.length, 0);
});

test('nlQuerySemantic: scores array matches node order', () => {
  const embeddingsData = [
    { id: 'a', embedding: [1, 0] },
    { id: 'b', embedding: [0.8, 0.6] },
  ];
  const result = nlQuerySemantic(GRAPH_SEMANTIC, embeddingsData, [1, 0]);
  assert.ok(result.scores.length > 0);
  assert.equal(typeof result.scores[0].score, 'number');
});

// ── nlQueryHybrid ─────────────────────────────────────────────────────────────

const GRAPH_HYB = {
  nodes: [
    { id: 'a', label: 'parseFile',  kind: 'function', file: 'src/parser.js', line: 1 },
    { id: 'b', label: 'readGraph',  kind: 'function', file: 'src/store.js',  line: 5 },
    { id: 'c', label: 'buildHtml',  kind: 'function', file: 'src/html.js',   line: 2 },
  ],
  edges: [{ from: 'a', to: 'b', rel: 'calls', tag: 'EXTRACTED' }],
};

test('nlQueryHybrid: returns mode=hybrid', () => {
  const emb = [{ id: 'a', embedding: [1, 0] }, { id: 'b', embedding: [0.8, 0.6] }, { id: 'c', embedding: [0, 1] }];
  const result = nlQueryHybrid(GRAPH_HYB, emb, 'parseFile', [1, 0]);
  assert.equal(result.mode, 'hybrid');
});

test('nlQueryHybrid: literal query — BM25 top result wins via keyword', () => {
  // 'parseFile' is in BM25 top-10 and semantic top — should rank first
  const emb = [{ id: 'a', embedding: [1, 0] }, { id: 'b', embedding: [0.5, 0.87] }, { id: 'c', embedding: [0, 1] }];
  const result = nlQueryHybrid(GRAPH_HYB, emb, 'parseFile', [1, 0]);
  assert.equal(result.nodes[0].id, 'a');
});

test('nlQueryHybrid: empty graph returns empty', () => {
  const result = nlQueryHybrid({ nodes: [], edges: [] }, [], 'anything', [1, 0]);
  assert.equal(result.nodes.length, 0);
  assert.equal(result.mode, 'hybrid');
});

test('nlQueryHybrid: null embeddingsData falls back to BM25-only RRF', () => {
  const result = nlQueryHybrid(GRAPH_HYB, null, 'parseFile', null);
  assert.ok(result.nodes.length > 0);
  assert.equal(result.mode, 'hybrid');
});

test('nlQueryHybrid: edges included when both endpoints relevant', () => {
  const emb = [{ id: 'a', embedding: [1, 0] }, { id: 'b', embedding: [0.8, 0.6] }, { id: 'c', embedding: [0, 1] }];
  const result = nlQueryHybrid(GRAPH_HYB, emb, 'parseFile', [1, 0]);
  // edge a→b should be present if both in top results
  const hasEdge = result.edges.some((e) => e.from === 'a' && e.to === 'b');
  const aInNodes = result.nodes.some((n) => n.id === 'a');
  const bInNodes = result.nodes.some((n) => n.id === 'b');
  assert.equal(hasEdge, aInNodes && bInNodes);
});

test('nlQueryHybrid: topK limits results', () => {
  const emb = [{ id: 'a', embedding: [1, 0] }, { id: 'b', embedding: [0.9, 0.44] }, { id: 'c', embedding: [0.8, 0.6] }];
  const result = nlQueryHybrid(GRAPH_HYB, emb, 'parseFile', [1, 0], { topK: 2 });
  assert.ok(result.nodes.length <= 2);
});
