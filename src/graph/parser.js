'use strict';

const fs = require('fs');
const path = require('path');

// Language detection by extension
const EXT_LANG = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
};

const SUPPORTED_EXTS = new Set(Object.keys(EXT_LANG));

function langFor(filePath) {
  return EXT_LANG[path.extname(filePath).toLowerCase()] || null;
}

// Strip strings and comments to avoid false positives in pattern matching.
// Rough but effective for import/export/function detection.
function stripStrings(src) {
  // Remove single-line comments
  src = src.replace(/\/\/[^\n]*/g, '');
  // Remove multi-line comments
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove Python # comments
  src = src.replace(/#[^\n]*/g, '');
  // Replace string contents with placeholder (keeps quotes)
  src = src.replace(/(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, (_m, q) => q + 'S' + q);
  return src;
}

// Resolve an import specifier relative to the importing file.
// Returns null if it looks like an npm package (no ./ or ../).
function resolveImport(specifier, fromFile, rootDir) {
  const s = specifier.replace(/["'`]/g, '');
  if (!s.startsWith('.')) return null; // external package
  const dir = path.dirname(fromFile);
  let resolved = path.resolve(dir, s);
  // Try with common extensions if no ext given
  if (!path.extname(resolved)) {
    for (const ext of ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs']) {
      const candidate = resolved + ext;
      if (fs.existsSync(candidate)) { resolved = candidate; break; }
    }
    if (!path.extname(resolved)) {
      // Try index file
      for (const ext of ['.js', '.ts']) {
        const candidate = path.join(resolved, 'index' + ext);
        if (fs.existsSync(candidate)) { resolved = candidate; break; }
      }
    }
  }
  return path.relative(rootDir, resolved);
}

// Extract parameter names from a raw param string, stripping types/defaults/destructuring.
// "stats, filePath" → ["stats", "filePath"]
// "{ topK = 10 } = {}" → ["topK"]
// "a: number, b = 0" → ["a", "b"]
function parseParams(raw) {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((p) => p.trim()
      .replace(/[{}\[\]]/g, '')   // strip destructure brackets
      .replace(/\s*=.*$/, '')     // strip default values
      .replace(/\s*:\s*\S+/, '')  // strip TypeScript type annotations
      .replace(/\.\.\./g, '')     // strip rest operator
      .trim()
    )
    .filter((p) => p && /^[A-Za-z_$]/.test(p));
}

// --- JS/TS parser ---
function parseJS(src, relPath, rootDir) {
  const stripped = stripStrings(src);
  const nodes = [];
  const edges = [];
  const nodeId = (sym) => `${relPath}#${sym}`;
  const fileId = relPath;

  // File node
  nodes.push({ id: fileId, label: path.basename(relPath), kind: 'file', file: relPath, line: 0 });

  // ES imports: import X from 'y' / import { X } from 'y' / import 'y'
  // Run on original src — import paths are not inside strings/comments
  const importRe = /^import\s+(?:[^'";\n]*\s+from\s+)?(['"`][^'"`]+['"`])/gm;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const target = resolveImport(m[1], relPath, rootDir);
    if (target) edges.push({ from: fileId, to: target, rel: 'imports', tag: 'EXTRACTED' });
  }

  // CommonJS require — run on original src
  const requireRe = /\brequire\s*\(\s*(['"`][^'"`]+['"`])\s*\)/g;
  while ((m = requireRe.exec(src)) !== null) {
    const target = resolveImport(m[1], relPath, rootDir);
    if (target) edges.push({ from: fileId, to: target, rel: 'imports', tag: 'EXTRACTED' });
  }

  // Function declarations: function name(params) / async function name(params)
  const funcRe = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)/gm;
  while ((m = funcRe.exec(src)) !== null) {
    const name = m[1];
    const params = parseParams(m[2]);
    const line = src.slice(0, m.index).split('\n').length;
    const id = nodeId(name);
    nodes.push({ id, label: name, kind: 'function', file: relPath, line, params });
    edges.push({ from: fileId, to: id, rel: 'contains', tag: 'EXTRACTED' });
  }

  // Arrow / const assignments: const name = (params) => / const name = function(
  const arrowRe = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:\(([^)]*)\)\s*=>|function\s*\(([^)]*)\))/gm;
  while ((m = arrowRe.exec(src)) !== null) {
    const name = m[1];
    const params = parseParams(m[2] || m[3] || '');
    const line = src.slice(0, m.index).split('\n').length;
    const id = nodeId(name);
    if (!nodes.find((n) => n.id === id)) {
      nodes.push({ id, label: name, kind: 'function', file: relPath, line, params });
      edges.push({ from: fileId, to: id, rel: 'contains', tag: 'EXTRACTED' });
    }
  }

  // Class declarations: class Name / class Name extends Base
  const classRe = /^(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+extends\s+([A-Za-z_$][A-Za-z0-9_$.]*))?\s*\{/gm;
  while ((m = classRe.exec(src)) !== null) {
    const name = m[1];
    const base = m[2];
    const line = src.slice(0, m.index).split('\n').length;
    const id = nodeId(name);
    nodes.push({ id, label: name, kind: 'class', file: relPath, line });
    edges.push({ from: fileId, to: id, rel: 'contains', tag: 'EXTRACTED' });
    if (base) edges.push({ from: id, to: base, rel: 'inherits', tag: 'INFERRED' });
  }

  return { nodes, edges };
}

// --- Python parser ---
function parsePython(src, relPath, rootDir) {
  const nodes = [];
  const edges = [];
  const fileId = relPath;
  const nodeId = (sym) => `${relPath}#${sym}`;

  nodes.push({ id: fileId, label: path.basename(relPath), kind: 'file', file: relPath, line: 0 });

  // from x import y / import x
  const fromImportRe = /^from\s+([\w.]+)\s+import/gm;
  const importRe = /^import\s+([\w.,\s]+)/gm;
  let m;
  while ((m = fromImportRe.exec(src)) !== null) {
    const mod = m[1].replace(/\./g, '/');
    const target = resolveImport('./' + mod, relPath, rootDir);
    if (target) edges.push({ from: fileId, to: target, rel: 'imports', tag: 'EXTRACTED' });
  }
  while ((m = importRe.exec(src)) !== null) {
    const mods = m[1].split(',').map((s) => s.trim());
    for (const mod of mods) {
      const target = resolveImport('./' + mod.replace(/\./g, '/'), relPath, rootDir);
      if (target) edges.push({ from: fileId, to: target, rel: 'imports', tag: 'EXTRACTED' });
    }
  }

  // def name(params):
  const defRe = /^(?:    )*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/gm;
  while ((m = defRe.exec(src)) !== null) {
    const name = m[1];
    const params = parseParams(m[2]);
    const line = src.slice(0, m.index).split('\n').length;
    const id = nodeId(name);
    nodes.push({ id, label: name, kind: 'function', file: relPath, line, params });
    edges.push({ from: fileId, to: id, rel: 'contains', tag: 'EXTRACTED' });
  }

  // class Name(Base):
  const classRe = /^class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?\s*:/gm;
  while ((m = classRe.exec(src)) !== null) {
    const name = m[1];
    const bases = m[2] ? m[2].split(',').map((s) => s.trim()).filter(Boolean) : [];
    const line = src.slice(0, m.index).split('\n').length;
    const id = nodeId(name);
    nodes.push({ id, label: name, kind: 'class', file: relPath, line });
    edges.push({ from: fileId, to: id, rel: 'contains', tag: 'EXTRACTED' });
    for (const base of bases) {
      if (base !== 'object') edges.push({ from: id, to: base, rel: 'inherits', tag: 'INFERRED' });
    }
  }

  return { nodes, edges };
}

// --- Go parser ---
function parseGo(src, relPath, _rootDir) {
  const nodes = [];
  const edges = [];
  const fileId = relPath;
  const nodeId = (sym) => `${relPath}#${sym}`;

  nodes.push({ id: fileId, label: path.basename(relPath), kind: 'file', file: relPath, line: 0 });

  // func Name(params) / func (r *Type) Name(params)
  const funcRe = /^func\s+(?:\([^)]+\)\s+)?([A-Z][A-Za-z0-9_]*)\s*\(([^)]*)\)/gm;
  let m;
  while ((m = funcRe.exec(src)) !== null) {
    const name = m[1];
    const params = parseParams(m[2]);
    const line = src.slice(0, m.index).split('\n').length;
    const id = nodeId(name);
    nodes.push({ id, label: name, kind: 'function', file: relPath, line, params });
    edges.push({ from: fileId, to: id, rel: 'contains', tag: 'EXTRACTED' });
  }

  // type Name struct
  const typeRe = /^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+struct/gm;
  while ((m = typeRe.exec(src)) !== null) {
    const name = m[1];
    const line = src.slice(0, m.index).split('\n').length;
    const id = nodeId(name);
    nodes.push({ id, label: name, kind: 'struct', file: relPath, line });
    edges.push({ from: fileId, to: id, rel: 'contains', tag: 'EXTRACTED' });
  }

  return { nodes, edges };
}

// --- Rust parser ---
function parseRust(src, relPath, _rootDir) {
  const nodes = [];
  const edges = [];
  const fileId = relPath;
  const nodeId = (sym) => `${relPath}#${sym}`;

  nodes.push({ id: fileId, label: path.basename(relPath), kind: 'file', file: relPath, line: 0 });

  // pub fn name / fn name / async fn name
  const fnRe = /^(?:pub\s+)?(?:async\s+)?fn\s+([a-z_][a-z0-9_]*)\s*[<(]/gm;
  let m;
  while ((m = fnRe.exec(src)) !== null) {
    const name = m[1];
    const line = src.slice(0, m.index).split('\n').length;
    const id = nodeId(name);
    nodes.push({ id, label: name, kind: 'function', file: relPath, line });
    edges.push({ from: fileId, to: id, rel: 'contains', tag: 'EXTRACTED' });
  }

  // struct Name / pub struct Name
  const structRe = /^(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  while ((m = structRe.exec(src)) !== null) {
    const name = m[1];
    const line = src.slice(0, m.index).split('\n').length;
    const id = nodeId(name);
    nodes.push({ id, label: name, kind: 'struct', file: relPath, line });
    edges.push({ from: fileId, to: id, rel: 'contains', tag: 'EXTRACTED' });
  }

  // impl Trait for Type
  const implRe = /^impl(?:<[^>]+>)?\s+(?:([A-Za-z_][A-Za-z0-9_<>]*)\s+for\s+)?([A-Za-z_][A-Za-z0-9_]*)/gm;
  while ((m = implRe.exec(src)) !== null) {
    const trait = m[1];
    const type = m[2];
    if (trait) edges.push({ from: nodeId(type), to: nodeId(trait), rel: 'inherits', tag: 'INFERRED' });
  }

  return { nodes, edges };
}

const PARSERS = { javascript: parseJS, typescript: parseJS, python: parsePython, go: parseGo, rust: parseRust };

// Parse a single file. Returns { nodes, edges } or null if unsupported.
function parseFile(filePath, rootDir) {
  const lang = langFor(filePath);
  if (!lang) return null;
  let src;
  try { src = fs.readFileSync(filePath, 'utf8'); } catch { return null; }
  const relPath = path.relative(rootDir, filePath);
  return PARSERS[lang](src, relPath, rootDir);
}

// Walk a directory and collect all supported source files, skipping noise dirs.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', '.next', '.nuxt',
  'coverage', '__pycache__', '.venv', 'venv', 'vendor', '.turbo',
  'lakonai-graph', '.mypy_cache', '.pytest_cache',
]);

function collectFiles(dir, files = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) collectFiles(path.join(dir, e.name), files);
    } else if (e.isFile() && SUPPORTED_EXTS.has(path.extname(e.name).toLowerCase())) {
      files.push(path.join(dir, e.name));
    }
  }
  return files;
}

// Parse an entire directory tree. Returns merged { nodes, edges }.
function parseDir(rootDir) {
  const files = collectFiles(rootDir);
  const allNodes = [];
  const allEdges = [];
  const seenNodeIds = new Set();

  for (const filePath of files) {
    const result = parseFile(filePath, rootDir);
    if (!result) continue;
    for (const n of result.nodes) {
      if (!seenNodeIds.has(n.id)) {
        seenNodeIds.add(n.id);
        allNodes.push(n);
      }
    }
    for (const e of result.edges) {
      allEdges.push(e);
    }
  }

  return { nodes: allNodes, edges: allEdges, fileCount: files.length };
}

module.exports = { parseFile, parseDir, collectFiles, langFor, SUPPORTED_EXTS, resolveImport };
