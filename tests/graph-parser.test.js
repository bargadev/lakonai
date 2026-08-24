'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseFile, parseDir, collectFiles, langFor, resolveImport } = require('../src/graph/parser');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-parser-'));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true }); } catch { /* ok */ }
}

// ── langFor ───────────────────────────────────────────────────────────────────

test('langFor: js → javascript', () => assert.equal(langFor('foo.js'), 'javascript'));
test('langFor: ts → typescript', () => assert.equal(langFor('bar.ts'), 'typescript'));
test('langFor: tsx → typescript', () => assert.equal(langFor('App.tsx'), 'typescript'));
test('langFor: py → python', () => assert.equal(langFor('main.py'), 'python'));
test('langFor: go → go', () => assert.equal(langFor('main.go'), 'go'));
test('langFor: rs → rust', () => assert.equal(langFor('lib.rs'), 'rust'));
test('langFor: unknown → null', () => assert.equal(langFor('file.txt'), null));

// ── resolveImport ─────────────────────────────────────────────────────────────

test('resolveImport: npm package returns null', () => {
  assert.equal(resolveImport('"react"', 'src/app.js', '/root'), null);
});

test('resolveImport: relative path resolved', () => {
  const dir = tmpDir();
  const fromFile = path.relative(dir, path.join(dir, 'src', 'app.js'));
  const targetFile = path.join(dir, 'src', 'utils.js');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(targetFile, '');
  const result = resolveImport('"./utils"', fromFile, dir);
  assert.ok(result.includes('utils'));
  cleanup(dir);
});

// ── parseFile ─────────────────────────────────────────────────────────────────

test('parseFile: unsupported extension returns null', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'data.txt');
  fs.writeFileSync(file, 'hello');
  assert.equal(parseFile(file, dir), null);
  cleanup(dir);
});

test('parseFile: unreadable file returns null', () => {
  assert.equal(parseFile('/nonexistent/file.js', '/'), null);
});

test('parseFile JS: extracts file node', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'index.js');
  fs.writeFileSync(file, 'function hello() {}\n');
  const result = parseFile(file, dir);
  assert.ok(result.nodes.some((n) => n.kind === 'file'));
  cleanup(dir);
});

test('parseFile JS: extracts function node', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'app.js');
  fs.writeFileSync(file, 'export function greet(name) { return name; }\n');
  const { nodes } = parseFile(file, dir);
  assert.ok(nodes.some((n) => n.kind === 'function' && n.label === 'greet'));
  cleanup(dir);
});

test('parseFile JS: extracts class node with inherits edge', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'animal.js');
  fs.writeFileSync(file, 'class Dog extends Animal {\n  bark() {}\n}\n');
  const { nodes, edges } = parseFile(file, dir);
  assert.ok(nodes.some((n) => n.kind === 'class' && n.label === 'Dog'));
  assert.ok(edges.some((e) => e.rel === 'inherits'));
  cleanup(dir);
});

test('parseFile JS: extracts ES import edge', () => {
  const dir = tmpDir();
  const utilFile = path.join(dir, 'utils.js');
  fs.writeFileSync(utilFile, 'module.exports = {};\n');
  const appFile = path.join(dir, 'app.js');
  fs.writeFileSync(appFile, 'import { foo } from "./utils";\n');
  const { edges } = parseFile(appFile, dir);
  assert.ok(edges.some((e) => e.rel === 'imports'));
  cleanup(dir);
});

test('parseFile JS: extracts require edge', () => {
  const dir = tmpDir();
  const utilFile = path.join(dir, 'utils.js');
  fs.writeFileSync(utilFile, '');
  const appFile = path.join(dir, 'app.js');
  fs.writeFileSync(appFile, "const u = require('./utils');\n");
  const { edges } = parseFile(appFile, dir);
  assert.ok(edges.some((e) => e.rel === 'imports'));
  cleanup(dir);
});

test('parseFile JS: extracts arrow function', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'fn.js');
  fs.writeFileSync(file, 'const double = (x) => x * 2;\n');
  const { nodes } = parseFile(file, dir);
  assert.ok(nodes.some((n) => n.label === 'double'));
  cleanup(dir);
});

test('parseFile Python: extracts function and class', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'main.py');
  fs.writeFileSync(file, 'def run():\n    pass\n\nclass App(Base):\n    pass\n');
  const { nodes, edges } = parseFile(file, dir);
  assert.ok(nodes.some((n) => n.kind === 'function' && n.label === 'run'));
  assert.ok(nodes.some((n) => n.kind === 'class' && n.label === 'App'));
  assert.ok(edges.some((e) => e.rel === 'inherits' && e.to === 'Base'));
  cleanup(dir);
});

test('parseFile Python: from import with existing local module creates edge', () => {
  const dir = tmpDir();
  // Create both files so resolveImport finds the target
  fs.writeFileSync(path.join(dir, 'utils.py'), 'def helper(): pass\n');
  const file = path.join(dir, 'main.py');
  fs.writeFileSync(file, 'from utils import helper\n\ndef run():\n    helper()\n');
  const { edges } = parseFile(file, dir);
  assert.ok(edges.some((e) => e.rel === 'imports'), 'should have import edge for found module');
  cleanup(dir);
});

test('parseFile Python: plain import with existing local module creates edge', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.py'), '# config\n');
  const file = path.join(dir, 'app.py');
  fs.writeFileSync(file, 'import config\n\ndef run(): pass\n');
  const { edges } = parseFile(file, dir);
  assert.ok(edges.some((e) => e.rel === 'imports'), 'should have import edge for found module');
  cleanup(dir);
});

test('parseFile Python: skips inherits for "object"', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'x.py');
  fs.writeFileSync(file, 'class MyClass(object):\n    pass\n');
  const { edges } = parseFile(file, dir);
  assert.ok(!edges.some((e) => e.rel === 'inherits' && e.to === 'object'));
  cleanup(dir);
});

test('parseFile Go: extracts function and struct', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'main.go');
  fs.writeFileSync(file, 'func Run() error {\n  return nil\n}\n\ntype Config struct {\n  Port int\n}\n');
  const { nodes } = parseFile(file, dir);
  assert.ok(nodes.some((n) => n.kind === 'function' && n.label === 'Run'));
  assert.ok(nodes.some((n) => n.kind === 'struct' && n.label === 'Config'));
  cleanup(dir);
});

test('parseFile Rust: extracts fn and struct', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'lib.rs');
  fs.writeFileSync(file, 'pub fn run() {}\n\npub struct Config {\n  port: u16,\n}\n');
  const { nodes } = parseFile(file, dir);
  assert.ok(nodes.some((n) => n.kind === 'function' && n.label === 'run'));
  assert.ok(nodes.some((n) => n.kind === 'struct' && n.label === 'Config'));
  cleanup(dir);
});

test('parseFile Rust: extracts impl trait edge', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'lib.rs');
  fs.writeFileSync(file, 'impl Display for Config {\n  fn fmt(&self, f: &mut Formatter) {}\n}\n');
  const { edges } = parseFile(file, dir);
  assert.ok(edges.some((e) => e.rel === 'inherits'));
  cleanup(dir);
});

// ── collectFiles ──────────────────────────────────────────────────────────────

test('collectFiles: finds js files, skips node_modules', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), '');
  fs.writeFileSync(path.join(dir, 'app.js'), '');
  const files = collectFiles(dir);
  assert.ok(files.some((f) => f.endsWith('app.js')));
  assert.ok(!files.some((f) => f.includes('node_modules')));
  cleanup(dir);
});

test('collectFiles: skips lakonai-graph dir', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'lakonai-graph'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lakonai-graph', 'graph.json'), '{}');
  fs.writeFileSync(path.join(dir, 'index.ts'), '');
  const files = collectFiles(dir);
  assert.ok(!files.some((f) => f.includes('lakonai-graph')));
  cleanup(dir);
});

test('collectFiles: handles unreadable dir gracefully', () => {
  // Just pass a nonexistent dir — should return []
  const files = collectFiles('/nonexistent/path/that/cant/be/read');
  assert.deepEqual(files, []);
});

// ── parseDir ─────────────────────────────────────────────────────────────────

test('parseDir: parses multiple files and merges', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.js'), 'function foo() {}\n');
  fs.writeFileSync(path.join(dir, 'b.py'), 'def bar():\n    pass\n');
  const { nodes, edges, fileCount } = parseDir(dir);
  assert.ok(nodes.some((n) => n.label === 'foo'));
  assert.ok(nodes.some((n) => n.label === 'bar'));
  assert.equal(fileCount, 2);
  cleanup(dir);
});

test('parseDir: deduplicates node ids', () => {
  const dir = tmpDir();
  // Two files that export same name (shouldn't crash)
  fs.writeFileSync(path.join(dir, 'a.js'), 'function utils() {}\n');
  fs.writeFileSync(path.join(dir, 'b.js'), 'function utils() {}\n');
  const { nodes } = parseDir(dir);
  // Each file produces its own namespaced node id, no global dedup issue
  const utils = nodes.filter((n) => n.label === 'utils');
  assert.equal(utils.length, 2); // one per file, different ids
  cleanup(dir);
});
