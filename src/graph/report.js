'use strict';

const { communityLabels } = require('./leiden');

// Generate GRAPH_REPORT.md from a built graph.
function buildReport(graph) {
  const { nodes, edges, meta } = graph;
  const communities = {};
  for (const n of nodes) communities[n.id] = n.community ?? 0;

  const commLabels = communityLabels(nodes, edges, communities);
  const commGroups = new Map();
  for (const n of nodes) {
    const c = n.community ?? 0;
    if (!commGroups.has(c)) commGroups.set(c, []);
    commGroups.get(c).push(n);
  }

  // Degree map
  const degree = new Map();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  }

  // Top connected nodes
  const topNodes = nodes
    .slice()
    .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))
    .slice(0, 10);

  // Hub files (files with most symbols)
  const symbolsPerFile = new Map();
  for (const n of nodes) {
    if (n.kind === 'file') continue;
    symbolsPerFile.set(n.file, (symbolsPerFile.get(n.file) || 0) + 1);
  }
  const topFiles = [...symbolsPerFile.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // External import targets (edges to nodes not in graph)
  const nodeIds = new Set(nodes.map((n) => n.id));
  const externalTargets = edges
    .filter((e) => e.rel === 'imports' && !nodeIds.has(e.to))
    .map((e) => e.to)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 10);

  const lines = [
    '# lakonai graph — report',
    '',
    `Built: ${meta.builtAt}`,
    `Files parsed: ${meta.fileCount}  |  Nodes: ${meta.nodeCount}  |  Edges: ${meta.edgeCount}  |  Communities: ${commGroups.size}`,
    '',
    '## Communities',
    '',
  ];

  for (const [c, members] of [...commGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const label = commLabels[c] || `cluster-${c}`;
    const kinds = members.map((m) => m.kind);
    const kindCounts = kinds.reduce((acc, k) => { acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const kindStr = Object.entries(kindCounts).map(([k, n]) => `${n} ${k}`).join(', ');
    lines.push(`### ${label} (community ${c})`);
    lines.push(`${members.length} nodes — ${kindStr}`);
    const top = members.sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0)).slice(0, 5);
    for (const n of top) lines.push(`  - \`${n.label}\` [${n.kind}] \`${n.file}:${n.line}\``);
    lines.push('');
  }

  lines.push('## Key nodes (by degree)');
  lines.push('');
  for (const n of topNodes) {
    lines.push(`- \`${n.label}\` [${n.kind}] — degree ${degree.get(n.id) || 0} — \`${n.file}:${n.line}\``);
  }

  if (topFiles.length) {
    lines.push('', '## Hub files (most symbols)', '');
    for (const [file, count] of topFiles) {
      lines.push(`- \`${file}\` — ${count} symbols`);
    }
  }

  if (externalTargets.length) {
    lines.push('', '## External dependencies (imported, not in tree)', '');
    for (const t of externalTargets) lines.push(`- \`${t}\``);
  }

  lines.push('', '## Suggested questions', '');
  if (topNodes[0]) lines.push(`- What does \`${topNodes[0].label}\` do and what does it connect to?`);
  if (topFiles[0]) lines.push(`- What is the responsibility of \`${topFiles[0][0]}\`?`);
  if (commGroups.size > 1) {
    const [c1, c2] = [...commGroups.keys()];
    lines.push(`- How does the \`${commLabels[c1]}\` cluster relate to \`${commLabels[c2]}\`?`);
  }

  return lines.join('\n') + '\n';
}

module.exports = { buildReport };
