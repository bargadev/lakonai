'use strict';

const fs = require('fs');
const path = require('path');

const GRAPH_DIR = 'lakonai-graph';
const GRAPH_FILE = 'graph.json';

function graphDir(rootDir) {
  return path.join(rootDir, GRAPH_DIR);
}

function graphPath(rootDir) {
  return path.join(graphDir(rootDir), GRAPH_FILE);
}

function readGraph(rootDir) {
  try {
    return JSON.parse(fs.readFileSync(graphPath(rootDir), 'utf8'));
  } catch {
    return null;
  }
}

function writeGraph(rootDir, graph) {
  const dir = graphDir(rootDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(graphPath(rootDir), JSON.stringify(graph, null, 2));
}

// Build a graph object from raw parse result + community assignments.
function buildGraph(parseResult, communities = {}) {
  const { nodes, edges } = parseResult;

  const nodesWithComm = nodes.map((n) => ({
    ...n,
    community: communities[n.id] ?? 0,
  }));

  // Deduplicate edges
  const seen = new Set();
  const dedupEdges = [];
  for (const e of edges) {
    const key = `${e.from}→${e.to}→${e.rel}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedupEdges.push(e);
    }
  }

  return {
    nodes: nodesWithComm,
    edges: dedupEdges,
    meta: {
      builtAt: new Date().toISOString(),
      nodeCount: nodesWithComm.length,
      edgeCount: dedupEdges.length,
      fileCount: parseResult.fileCount || 0,
    },
  };
}

// Find all nodes belonging to a specific file (by relative path).
function nodesForFile(graph, relPath) {
  return graph.nodes.filter((n) => n.file === relPath);
}

module.exports = { graphDir, graphPath, readGraph, writeGraph, buildGraph, nodesForFile, GRAPH_DIR, GRAPH_FILE };
