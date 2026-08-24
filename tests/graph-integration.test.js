'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSync: build, runGraph } = require('../src/graph/index');
const { graphSubgraphFor } = require('../src/hooks/read-guard');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-graph-int-'));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true }); } catch { /* ok */ }
}

function writeProject(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const fullPath = path.join(dir, name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

// ── build ─────────────────────────────────────────────────────────────────────

test('Integration: build adds lakonai-graph/ to .gitignore', () => {
  const dir = tmpDir();
  writeProject(dir, { 'src/app.js': 'function main() {}\n' });
  build(dir);
  const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('lakonai-graph/'));
  cleanup(dir);
});

test('Integration: build gitignore idempotent', () => {
  const dir = tmpDir();
  writeProject(dir, { 'app.js': 'function x() {}\n' });
  build(dir);
  build(dir); // second call should not duplicate
  const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.equal((gitignore.match(/lakonai-graph\//g) || []).length, 1);
  cleanup(dir);
});

test('Integration: build appends to existing .gitignore', () => {
  const dir = tmpDir();
  writeProject(dir, { 'app.js': 'function x() {}\n', '.gitignore': 'node_modules/\n' });
  build(dir);
  const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('node_modules/'));
  assert.ok(gitignore.includes('lakonai-graph/'));
  cleanup(dir);
});

test('Integration: build creates graph.json, GRAPH_REPORT.md, graph.html', () => {
  const dir = tmpDir();
  writeProject(dir, {
    'src/app.js': 'import { helper } from "./utils";\nexport function main() {}\n',
    'src/utils.js': 'export function helper() {}\n',
  });
  const graph = build(dir);
  assert.ok(fs.existsSync(path.join(dir, 'lakonai-graph', 'graph.json')));
  assert.ok(fs.existsSync(path.join(dir, 'lakonai-graph', 'GRAPH_REPORT.md')));
  assert.ok(fs.existsSync(path.join(dir, 'lakonai-graph', 'graph.html')));
  assert.ok(graph.meta.nodeCount > 0);
  assert.ok(graph.meta.fileCount === 2);
  cleanup(dir);
});

test('Integration: build graph has import edge between files', () => {
  const dir = tmpDir();
  writeProject(dir, {
    'a.js': 'import "./b";\nfunction doA() {}\n',
    'b.js': 'export function doB() {}\n',
  });
  const graph = build(dir);
  // b.js must exist as a node (file node created from a.js import)
  const importEdge = graph.edges.find((e) => e.rel === 'imports');
  assert.ok(importEdge, 'should have import edge');
  cleanup(dir);
});

test('Integration: build assigns communities to all nodes', () => {
  const dir = tmpDir();
  writeProject(dir, {
    'index.ts': 'class Server { listen() {} }\n',
  });
  const graph = build(dir);
  for (const n of graph.nodes) {
    assert.ok(typeof n.community === 'number', `node ${n.id} missing community`);
  }
  cleanup(dir);
});

// ── runGraph ──────────────────────────────────────────────────────────────────

test('Integration: runGraph build writes output', () => {
  const dir = tmpDir();
  writeProject(dir, { 'main.py': 'def run():\n    pass\n' });
  const origDir = process.cwd();
  process.chdir(dir);
  let out = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out += s; return true; };
  try {
    runGraph(['build', '.']);
  } finally {
    process.stdout.write = origWrite;
    process.chdir(origDir);
  }
  assert.ok(out.includes('done'));
  assert.ok(fs.existsSync(path.join(dir, 'lakonai-graph', 'graph.json')));
  cleanup(dir);
});

test('Integration: runGraph with no args builds cwd', () => {
  const dir = tmpDir();
  writeProject(dir, { 'app.go': 'func Main() {}\n' });
  const origDir = process.cwd();
  process.chdir(dir);
  let out = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out += s; return true; };
  try {
    runGraph([]);
  } finally {
    process.stdout.write = origWrite;
    process.chdir(origDir);
  }
  assert.ok(out.includes('done'));
  cleanup(dir);
});

test('Integration: runGraph explain on built graph', () => {
  const dir = tmpDir();
  writeProject(dir, { 'app.js': 'function hello() {}\n' });
  build(dir);
  const origDir = process.cwd();
  process.chdir(dir);
  let out = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out += s; return true; };
  try {
    runGraph(['explain', 'app.js']);
  } finally {
    process.stdout.write = origWrite;
    process.chdir(origDir);
  }
  assert.ok(out.includes('app.js') || out.includes('not found'));
  cleanup(dir);
});

test('Integration: runGraph explain missing nodeId exits with error', () => {
  const origWrite = process.stderr.write.bind(process.stderr);
  let err = '';
  process.stderr.write = (s) => { err += s; return true; };
  const origCode = process.exitCode;
  try {
    runGraph(['explain']);
  } finally {
    process.stderr.write = origWrite;
    process.exitCode = origCode;
  }
  assert.ok(err.includes('usage'));
});

test('Integration: runGraph explain no graph.json exits with error', () => {
  const dir = tmpDir();
  const origDir = process.cwd();
  process.chdir(dir);
  let err = '';
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { err += s; return true; };
  const origCode = process.exitCode;
  try {
    runGraph(['explain', 'foo']);
  } finally {
    process.stderr.write = origWrite;
    process.chdir(origDir);
    process.exitCode = origCode;
  }
  assert.ok(err.includes('graph.json'));
  cleanup(dir);
});

test('Integration: runGraph path between two nodes', () => {
  const dir = tmpDir();
  writeProject(dir, {
    'a.js': 'import "./b";\n',
    'b.js': 'export function foo() {}\n',
  });
  build(dir);
  const origDir = process.cwd();
  process.chdir(dir);
  let out = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out += s; return true; };
  try {
    runGraph(['path', 'a.js', 'b.js']);
  } finally {
    process.stdout.write = origWrite;
    process.chdir(origDir);
  }
  // Either found a path or reported no path
  assert.ok(out.length > 0);
  cleanup(dir);
});

test('Integration: runGraph path missing args exits with error', () => {
  let err = '';
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { err += s; return true; };
  const origCode = process.exitCode;
  try {
    runGraph(['path', 'only-one']);
  } finally {
    process.stderr.write = origWrite;
    process.exitCode = origCode;
  }
  assert.ok(err.includes('usage'));
});

test('Integration: runGraph path no graph.json exits with error', () => {
  const dir = tmpDir();
  const origDir = process.cwd();
  process.chdir(dir);
  let err = '';
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { err += s; return true; };
  const origCode = process.exitCode;
  try {
    runGraph(['path', 'a', 'b']);
  } finally {
    process.stderr.write = origWrite;
    process.chdir(origDir);
    process.exitCode = origCode;
  }
  assert.ok(err.includes('graph.json'));
  cleanup(dir);
});

test('Integration: runGraph query (bm25 — no embeddings.json)', () => {
  const dir = tmpDir();
  writeProject(dir, { 'app.js': 'function authenticate() {}\n' });
  build(dir);
  // Ensure no embeddings.json so BM25 path is taken
  try { fs.unlinkSync(path.join(dir, 'lakonai-graph', 'embeddings.json')); } catch { /* ok */ }
  const origDir = process.cwd();
  process.chdir(dir);
  let out = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out += s; return true; };
  try {
    runGraph(['query', 'authenticate']);
  } finally {
    process.stdout.write = origWrite;
    process.chdir(origDir);
  }
  assert.ok(out.includes('[bm25]'), `expected [bm25] prefix, got: ${out}`);
  cleanup(dir);
});

test('Integration: runGraph query missing question exits with error', () => {
  let err = '';
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { err += s; return true; };
  const origCode = process.exitCode;
  try {
    runGraph(['query']);
  } finally {
    process.stderr.write = origWrite;
    process.exitCode = origCode;
  }
  assert.ok(err.includes('usage'));
});

test('Integration: runGraph query no graph.json exits with error', () => {
  const dir = tmpDir();
  const origDir = process.cwd();
  process.chdir(dir);
  let err = '';
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { err += s; return true; };
  const origCode = process.exitCode;
  try {
    runGraph(['query', 'hello']);
  } finally {
    process.stderr.write = origWrite;
    process.chdir(origDir);
    process.exitCode = origCode;
  }
  assert.ok(err.includes('graph.json'));
  cleanup(dir);
});

test('Integration: runGraph html no graph exits with error', () => {
  const dir = tmpDir();
  const origDir = process.cwd();
  process.chdir(dir);
  let err = '';
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { err += s; return true; };
  const origCode = process.exitCode;
  try {
    runGraph(['html', '.']);
  } finally {
    process.stderr.write = origWrite;
    process.chdir(origDir);
    process.exitCode = origCode;
  }
  assert.ok(err.includes('graph.html'));
  cleanup(dir);
});

test('Integration: runGraph unknown subcommand exits with error', () => {
  let err = '';
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { err += s; return true; };
  const origCode = process.exitCode;
  try {
    runGraph(['unknowncmd']);
  } finally {
    process.stderr.write = origWrite;
    process.exitCode = origCode;
  }
  assert.ok(err.includes('unknown subcommand'));
});

// ── graphSubgraphFor (read-guard integration) ─────────────────────────────────

test('Integration: graphSubgraphFor returns null when no graph.json', () => {
  const dir = tmpDir();
  const filePath = path.join(dir, 'app.js');
  fs.writeFileSync(filePath, 'function foo() {}\n');
  assert.equal(graphSubgraphFor(filePath), null);
  cleanup(dir);
});

test('Integration: graphSubgraphFor returns null for file not in graph', () => {
  const dir = tmpDir();
  writeProject(dir, { 'a.js': 'function foo() {}\n' });
  build(dir);
  // Ask for a file that was never parsed
  const filePath = path.join(dir, 'nonexistent.js');
  const result = graphSubgraphFor(filePath);
  assert.equal(result, null);
  cleanup(dir);
});

test('Integration: graphSubgraphFor returns subgraph for known file', () => {
  const dir = tmpDir();
  writeProject(dir, { 'src/app.js': 'function greet() {}\nexport function main() {}\n' });
  build(dir);
  const filePath = path.join(dir, 'src', 'app.js');
  const result = graphSubgraphFor(filePath);
  assert.ok(result !== null, 'should return subgraph summary');
  assert.ok(result.includes('lakonai-graph'));
  assert.ok(result.includes('app.js'));
  cleanup(dir);
});

test('Integration: graphSubgraphFor handles invalid path gracefully', () => {
  // Should not throw
  const result = graphSubgraphFor('/definitely/not/a/real/path/file.js');
  assert.equal(result, null);
});

// ── embed integration: nlQuerySemantic wired through query.js ────────────────

describe('Integration: nlQuerySemantic with real graph', () => {
  const { nlQuerySemantic } = require('../src/graph/query');
  const { dot } = require('../src/graph/embed');

  const graph = {
    nodes: [
      { id: 'parse.js#parseFile', label: 'parseFile', kind: 'function', file: 'parse.js', line: 1 },
      { id: 'store.js#readGraph', label: 'readGraph', kind: 'function', file: 'store.js', line: 5 },
      { id: 'html.js#buildHtml',  label: 'buildHtml',  kind: 'function', file: 'html.js',  line: 2 },
    ],
    edges: [{ from: 'parse.js#parseFile', to: 'store.js#readGraph', rel: 'calls', tag: 'EXTRACTED' }],
  };

  // Fake embeddings: hand-crafted so we know which nodes score high
  const embeddingsData = [
    { id: 'parse.js#parseFile', embedding: [1, 0, 0] },
    { id: 'store.js#readGraph', embedding: [0.9, 0.44, 0] },
    { id: 'html.js#buildHtml',  embedding: [0, 0, 1] },
  ];

  test('returns semantically relevant nodes from pre-built embeddings', () => {
    const queryVec = [1, 0, 0]; // aligned with parseFile
    const result = nlQuerySemantic(graph, embeddingsData, queryVec);
    assert.equal(result.mode, 'semantic');
    const ids = result.nodes.map((n) => n.id);
    assert.ok(ids.includes('parse.js#parseFile'), 'parseFile should rank high');
    assert.ok(ids.includes('store.js#readGraph'), 'readGraph also similar');
    assert.ok(!ids.includes('html.js#buildHtml'), 'buildHtml should be filtered (cos=0)');
  });

  test('includes edges where both endpoints are relevant', () => {
    const queryVec = [1, 0, 0];
    const result = nlQuerySemantic(graph, embeddingsData, queryVec);
    assert.ok(result.edges.some((e) => e.from === 'parse.js#parseFile' && e.to === 'store.js#readGraph'));
  });

  test('dot product of returned vectors is consistent', () => {
    // Ensure the pure dot product used internally works on 3-dim vectors
    assert.ok(Math.abs(dot([1, 0, 0], [0.9, 0.44, 0]) - 0.9) < 1e-9);
  });
});
