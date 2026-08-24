'use strict';

// ── BM25 ─────────────────────────────────────────────────────────────────────

const BM25_K1 = 1.5;
const BM25_B = 0.75;

function tokenize(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
}

function buildBM25Index(nodes) {
  const docs = nodes.map((n) => tokenize(`${n.label} ${n.file} ${n.kind}`));
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);

  // Term frequency per doc
  const tf = docs.map((d) => {
    const map = new Map();
    for (const t of d) map.set(t, (map.get(t) || 0) + 1);
    return map;
  });

  // Document frequency
  const df = new Map();
  for (const tmap of tf) {
    for (const t of tmap.keys()) df.set(t, (df.get(t) || 0) + 1);
  }

  const N = nodes.length;

  function score(docIdx, queryTerms) {
    let s = 0;
    const docLen = docs[docIdx].length;
    const docTf = tf[docIdx];
    for (const t of queryTerms) {
      const freq = docTf.get(t) || 0;
      if (!freq) continue;
      const idf = Math.log((N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5) + 1);
      const tfNorm = (freq * (BM25_K1 + 1)) / (freq + BM25_K1 * (1 - BM25_B + BM25_B * docLen / avgLen));
      s += idf * tfNorm;
    }
    return s;
  }

  return { score };
}

// ── explain ───────────────────────────────────────────────────────────────────

function explain(graph, nodeId) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const out = graph.edges.filter((e) => e.from === nodeId);
  const inc = graph.edges.filter((e) => e.to === nodeId);

  return { node, outgoing: out, incoming: inc };
}

// ── shortest path (BFS) ───────────────────────────────────────────────────────

function shortestPath(graph, fromId, toId) {
  if (fromId === toId) return [fromId];

  // Build adjacency (undirected for path finding)
  const adj = new Map();
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from).push({ id: e.to, edge: e });
    adj.get(e.to).push({ id: e.from, edge: e });
  }

  const visited = new Set([fromId]);
  const queue = [{ id: fromId, path: [fromId] }];

  while (queue.length) {
    const { id, path } = queue.shift();
    for (const { id: nbId } of (adj.get(id) || [])) {
      if (nbId === toId) return [...path, nbId];
      if (!visited.has(nbId)) {
        visited.add(nbId);
        queue.push({ id: nbId, path: [...path, nbId] });
      }
    }
  }

  return null; // no path
}

// ── nlQuery: BM25 on node labels + files → top-k relevant subgraph ────────────

function nlQuery(graph, question, { topK = 10 } = {}) {
  if (!graph.nodes.length) return { nodes: [], edges: [] };

  const idx = buildBM25Index(graph.nodes);
  const qTerms = tokenize(question);

  const scored = graph.nodes
    .map((n, i) => ({ node: n, score: idx.score(i, qTerms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const relevantIds = new Set(scored.map((x) => x.node.id));

  // Include edges where both ends are relevant
  const relevantEdges = graph.edges.filter((e) => relevantIds.has(e.from) && relevantIds.has(e.to));

  return {
    nodes: scored.map((x) => x.node),
    edges: relevantEdges,
    scores: scored.map((x) => ({ id: x.node.id, score: x.score })),
  };
}

// ── nlQuerySemantic: cosine similarity on pre-computed embeddings ─────────────

const { scoreByEmbedding } = require('./embed');

// embeddingsData: [{id, embedding}] as loaded from embeddings.json
function nlQuerySemantic(graph, embeddingsData, queryVec, { topK = 10 } = {}) {
  if (!graph.nodes.length || !embeddingsData || !embeddingsData.length) {
    return { nodes: [], edges: [], mode: 'semantic' };
  }

  const embeddingMap = new Map(embeddingsData.map((e) => [e.id, e.embedding]));
  const scored = scoreByEmbedding(graph.nodes, embeddingMap, queryVec, topK);
  const relevantIds = new Set(scored.map((x) => x.node.id));
  const relevantEdges = graph.edges.filter((e) => relevantIds.has(e.from) && relevantIds.has(e.to));

  return {
    nodes: scored.map((x) => x.node),
    edges: relevantEdges,
    scores: scored.map((x) => ({ id: x.node.id, score: x.score })),
    mode: 'semantic',
  };
}

// ── nlQueryHybrid: Reciprocal Rank Fusion of BM25 + semantic ─────────────────
// Asymmetric k: semantic gets lower k (5× weight) to compensate for BM25 keyword noise.
// BM25 is capped at top-10 so irrelevant keyword matches don't flood the fusion.

const RRF_K_SEM  = 60;
const RRF_K_BM25 = 300;
const BM25_CAP   = 10;

// question: string (for BM25), queryVec: number[] (for semantic)
function nlQueryHybrid(graph, embeddingsData, question, queryVec, { topK = 10 } = {}) {
  if (!graph.nodes.length) return { nodes: [], edges: [], mode: 'hybrid' };

  // BM25 capped at BM25_CAP — only strong keyword matches contribute
  const bm25Result = nlQuery(graph, question, { topK: BM25_CAP });
  const bm25Ranked = bm25Result.nodes.map((n, i) => [n.id, i]);

  // Semantic ranked list — all nodes above cosine threshold 0.2
  let semRanked = [];
  if (embeddingsData && embeddingsData.length && queryVec) {
    const { scoreByEmbedding } = require('./embed');
    const embeddingMap = new Map(embeddingsData.map((e) => [e.id, e.embedding]));
    semRanked = scoreByEmbedding(graph.nodes, embeddingMap, queryVec, graph.nodes.length)
      .map((x, i) => [x.node.id, i]);
  }

  // Asymmetric RRF: semantic 5× weight via lower k
  const rrfMap = new Map();
  for (const [id, rank] of bm25Ranked) {
    rrfMap.set(id, (rrfMap.get(id) || 0) + 1 / (RRF_K_BM25 + rank));
  }
  for (const [id, rank] of semRanked) {
    rrfMap.set(id, (rrfMap.get(id) || 0) + 1 / (RRF_K_SEM + rank));
  }

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const scored = [...rrfMap.entries()]
    .filter(([id]) => nodeMap.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id, score]) => ({ node: nodeMap.get(id), score }));

  const relevantIds = new Set(scored.map((x) => x.node.id));
  const relevantEdges = graph.edges.filter((e) => relevantIds.has(e.from) && relevantIds.has(e.to));

  return {
    nodes: scored.map((x) => x.node),
    edges: relevantEdges,
    scores: scored.map((x) => ({ id: x.node.id, score: x.score })),
    mode: 'hybrid',
  };
}

// ── format helpers ────────────────────────────────────────────────────────────

function formatExplain(explainResult) {
  if (!explainResult) return '(node not found)';
  const { node, outgoing, incoming } = explainResult;
  const lines = [
    `${node.label} [${node.kind}] ${node.file}:${node.line}`,
    `  community: ${node.community ?? 'n/a'}`,
  ];
  for (const e of outgoing) lines.push(`    --> ${e.to} [${e.rel}] [${e.tag}]`);
  for (const e of incoming) lines.push(`    <-- ${e.from} [${e.rel}] [${e.tag}]`);
  return lines.join('\n');
}

function formatPath(path, graph) {
  if (!path) return '(no path found)';
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  return path.map((id) => {
    const n = nodeMap.get(id);
    return n ? `${n.label} [${n.kind}]` : id;
  }).join(' → ');
}

function formatNlQuery(result, graph) {
  if (!result.nodes.length) return '(no relevant nodes found)';
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const lines = result.nodes.map((n) => `  ${n.label} [${n.kind}] ${n.file}:${n.line}`);

  const edgeLines = result.edges.slice(0, 20).map((e) => {
    const from = nodeMap.get(e.from);
    const to = nodeMap.get(e.to);
    return `  ${from ? from.label : e.from} --[${e.rel}]--> ${to ? to.label : e.to}`;
  });

  return ['nodes:', ...lines, edgeLines.length ? '\nedges:' : '', ...edgeLines].filter((l) => l !== '').join('\n');
}

module.exports = { explain, shortestPath, nlQuery, nlQuerySemantic, nlQueryHybrid, buildBM25Index, tokenize, formatExplain, formatPath, formatNlQuery };
