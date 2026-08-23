'use strict';

// Label propagation community detection — approximates Leiden/Louvain.
// Pure JS, zero deps. O(nodes * edges * iterations).
// Nodes with no edges each form their own community.

function detectCommunities(nodes, edges, { iterations = 10, seed = 42 } = {}) {
  if (!nodes.length) return {};

  // Build adjacency: nodeId → Set of neighbour nodeIds
  const nodeIds = nodes.map((n) => n.id);
  const nodeSet = new Set(nodeIds);
  const adj = new Map();
  for (const id of nodeIds) adj.set(id, new Set());

  for (const e of edges) {
    if (nodeSet.has(e.from) && nodeSet.has(e.to)) {
      adj.get(e.from).add(e.to);
      adj.get(e.to).add(e.from); // treat as undirected for community purposes
    }
  }

  // Initialise: each node gets its own community label = its own id
  const label = new Map();
  for (const id of nodeIds) label.set(id, id);

  // Deterministic shuffle using simple LCG
  function lcgShuffle(arr, s) {
    let state = s >>> 0;
    for (let i = arr.length - 1; i > 0; i--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = state % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const order = [...nodeIds];
  for (let iter = 0; iter < iterations; iter++) {
    lcgShuffle(order, seed + iter);
    let changed = false;
    for (const id of order) {
      const neighbours = adj.get(id);
      if (!neighbours.size) continue;

      // Count label frequency among neighbours
      const freq = new Map();
      for (const nb of neighbours) {
        const l = label.get(nb);
        freq.set(l, (freq.get(l) || 0) + 1);
      }

      // Pick most frequent label (deterministic tie-break: lexicographic)
      let best = label.get(id);
      let bestCount = freq.get(best) || 0;
      for (const [l, c] of freq) {
        if (c > bestCount || (c === bestCount && l < best)) {
          best = l;
          bestCount = c;
        }
      }

      if (best !== label.get(id)) {
        label.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Map string labels → integer community ids
  const labelToInt = new Map();
  let nextId = 0;

  // Sort label strings for deterministic int assignment
  const uniqueLabels = [...new Set(label.values())].sort();
  for (const l of uniqueLabels) labelToInt.set(l, nextId++);

  const result = {};
  for (const id of nodeIds) {
    result[id] = labelToInt.get(label.get(id));
  }
  return result;
}

// Returns a human-readable label for each community (most-connected node name).
function communityLabels(nodes, edges, communities) {
  const degree = new Map();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  }

  const groups = new Map(); // communityId → [node, ...]
  for (const n of nodes) {
    const c = communities[n.id] ?? 0;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(n);
  }

  const labels = {};
  for (const [c, members] of groups) {
    const top = members.slice().sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))[0];
    labels[c] = top ? top.label : `cluster-${c}`;
  }
  return labels;
}

module.exports = { detectCommunities, communityLabels };
