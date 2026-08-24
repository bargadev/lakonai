'use strict';

// Semantic embeddings via @xenova/transformers (optional dependency).
// Falls back gracefully when not installed — callers check tryXenova() first.
//
// All vectors are L2-normalized (normalize: true), so cosine similarity = dot product.

const MODEL = 'Xenova/bge-small-en-v1.5';

// Try to load @xenova/transformers. Returns the module or null.
async function tryXenova() {
  try {
    // @xenova/transformers is ESM-only — must use dynamic import.
    return await import('@xenova/transformers');
  } catch {
    return null;
  }
}

// Check synchronously if @xenova/transformers is installed (no import).
function hasXenova() {
  try {
    require.resolve('@xenova/transformers');
    return true;
  } catch {
    return false;
  }
}

// Dot product of two normalized vectors (= cosine similarity when normalized).
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// Build the text to embed for a node.
// Including param names dramatically improves semantic queries:
//   "writeStats(stats, filePath)" → model connects "save ... to disk" correctly.
function nodeText(n) {
  const base = `${n.label} ${n.kind} ${n.file}`;
  const params = Array.isArray(n.params) && n.params.length
    ? ` params ${n.params.join(' ')}`
    : '';
  return base + params;
}

// Generate embeddings for all nodes. Returns [{id, embedding: number[]}].
// Throws if @xenova/transformers is not installed.
async function generateEmbeddings(nodes) {
  const xeno = await tryXenova();
  if (!xeno) throw new Error('@xenova/transformers not installed');

  const { pipeline } = xeno;
  const embedder = await pipeline('feature-extraction', MODEL, { quantized: true });

  const results = [];
  // Batch in groups of 32 to avoid OOM on large graphs.
  const BATCH = 32;
  for (let i = 0; i < nodes.length; i += BATCH) {
    const batch = nodes.slice(i, i + BATCH);
    const texts = batch.map(nodeText);
    const out = await embedder(texts, { pooling: 'mean', normalize: true });
    // out.data is a flat Float32Array: [vec0...vec1...vec2...]
    const dim = out.dims[1];
    for (let j = 0; j < batch.length; j++) {
      const start = j * dim;
      results.push({
        id: batch[j].id,
        embedding: Array.from(out.data.slice(start, start + dim)),
      });
    }
  }

  embedder.dispose();
  return results;
}

// Embed a single query string. Returns number[].
async function embedQuery(question) {
  const xeno = await tryXenova();
  if (!xeno) throw new Error('@xenova/transformers not installed');

  const { pipeline } = xeno;
  const embedder = await pipeline('feature-extraction', MODEL, { quantized: true });
  const out = await embedder([question], { pooling: 'mean', normalize: true });
  embedder.dispose();
  return Array.from(out.data);
}

// Score nodes by cosine similarity to a query embedding.
// embeddingMap: Map<nodeId, number[]>
// Returns [{node, score}] sorted desc, limited to topK.
function scoreByEmbedding(nodes, embeddingMap, queryVec, topK) {
  return nodes
    .map((n) => {
      const vec = embeddingMap.get(n.id);
      return { node: n, score: vec ? dot(vec, queryVec) : 0 };
    })
    .filter((x) => x.score > 0.2) // cosine threshold — avoids returning noise
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

module.exports = { tryXenova, hasXenova, generateEmbeddings, embedQuery, scoreByEmbedding, nodeText, dot };
