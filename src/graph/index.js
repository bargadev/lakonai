'use strict';

const fs = require('fs');
const path = require('path');
const { parseDir } = require('./parser');
const { buildGraph, writeGraph, readGraph, graphDir, GRAPH_FILE } = require('./store');
const { detectCommunities } = require('./leiden');
const { buildReport } = require('./report');
const { buildHtml } = require('./html');
const { explain, shortestPath, nlQuery, nlQuerySemantic, nlQueryHybrid, formatExplain, formatPath, formatNlQuery } = require('./query');
const { hasXenova, generateEmbeddings, embedQuery } = require('./embed');
const { watchDir } = require('./watch');

const REPORT_FILE = 'GRAPH_REPORT.md';
const HTML_FILE = 'graph.html';
const EMBEDDINGS_FILE = 'embeddings.json';

// Ensure lakonai-graph/ is in .gitignore — it's generated output, not source.
function ensureGitignore(rootDir) {
  const gitignorePath = path.join(rootDir, '.gitignore');
  const entry = 'lakonai-graph/';
  try {
    let content = '';
    try { content = fs.readFileSync(gitignorePath, 'utf8'); } catch { /* new file */ }
    if (!content.split('\n').some((l) => l.trim() === entry)) {
      fs.writeFileSync(gitignorePath, content + (content.endsWith('\n') || !content ? '' : '\n') + entry + '\n');
    }
  } catch { /* best-effort */ }
}

// Build graph from rootDir, write all output files, return graph.
// Also generates embeddings if @xenova/transformers is installed.
async function build(rootDir) {
  const absRoot = path.resolve(rootDir);
  ensureGitignore(absRoot);
  const parsed = parseDir(absRoot);
  const communities = detectCommunities(parsed.nodes, parsed.edges);
  const graph = buildGraph(parsed, communities);

  writeGraph(absRoot, graph);

  const dir = graphDir(absRoot);
  fs.writeFileSync(path.join(dir, REPORT_FILE), buildReport(graph));
  fs.writeFileSync(path.join(dir, HTML_FILE), buildHtml(graph));

  if (hasXenova()) {
    try {
      const embeddings = await generateEmbeddings(graph.nodes);
      fs.writeFileSync(path.join(dir, EMBEDDINGS_FILE), JSON.stringify(embeddings));
      graph._embeddingsGenerated = true;
    } catch {
      // best-effort — graph still works without embeddings
    }
  }

  return graph;
}

// Synchronous build for callers that can't await (watch, tests).
function buildSync(rootDir) {
  const absRoot = path.resolve(rootDir);
  ensureGitignore(absRoot);
  const parsed = parseDir(absRoot);
  const communities = detectCommunities(parsed.nodes, parsed.edges);
  const graph = buildGraph(parsed, communities);

  writeGraph(absRoot, graph);

  const dir = graphDir(absRoot);
  fs.writeFileSync(path.join(dir, REPORT_FILE), buildReport(graph));
  fs.writeFileSync(path.join(dir, HTML_FILE), buildHtml(graph));

  return graph;
}

// CLI command handler
function runGraph(args) {
  const [sub, ...rest] = args;

  if (!sub || sub === 'build') {
    const rootDir = rest[0] || '.';
    process.stdout.write(`lakonai graph: building ${path.resolve(rootDir)}\n`);
    const t0 = Date.now();
    const graph = buildSync(rootDir);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(
      `\ndone in ${elapsed}s\n` +
      `  nodes: ${graph.meta.nodeCount}  edges: ${graph.meta.edgeCount}  files: ${graph.meta.fileCount}\n` +
      `  output: ${path.join(path.resolve(rootDir), 'lakonai-graph/')}\n` +
      `    ${GRAPH_FILE} — queryable graph\n` +
      `    ${REPORT_FILE} — highlights\n` +
      `    ${HTML_FILE} — interactive viz\n`
    );
    // Fire-and-forget embedding generation (non-blocking)
    if (hasXenova()) {
      process.stdout.write('  embeddings: generating (first run downloads ~23MB model)…\n');
      const absRoot = path.resolve(rootDir);
      const dir = graphDir(absRoot);
      generateEmbeddings(graph.nodes).then((embeddings) => {
        fs.writeFileSync(path.join(dir, EMBEDDINGS_FILE), JSON.stringify(embeddings));
        process.stdout.write(`  embeddings: ${graph.meta.nodeCount} vectors written (semantic query enabled)\n    ${EMBEDDINGS_FILE} — semantic embeddings\n`);
      }).catch(() => { /* best-effort */ });
    }
    return;
  }

  if (sub === 'explain') {
    const [nodeId] = rest;
    if (!nodeId) { process.stderr.write('usage: lakonai graph explain <nodeId>\n'); process.exitCode = 1; return; }
    const graph = readGraph('.');
    if (!graph) { process.stderr.write('no graph.json found — run: lakonai graph build\n'); process.exitCode = 1; return; }
    process.stdout.write(formatExplain(explain(graph, nodeId)) + '\n');
    return;
  }

  if (sub === 'path') {
    const [fromId, toId] = rest;
    if (!fromId || !toId) { process.stderr.write('usage: lakonai graph path <from> <to>\n'); process.exitCode = 1; return; }
    const graph = readGraph('.');
    if (!graph) { process.stderr.write('no graph.json found — run: lakonai graph build\n'); process.exitCode = 1; return; }
    process.stdout.write(formatPath(shortestPath(graph, fromId, toId), graph) + '\n');
    return;
  }

  if (sub === 'query') {
    const question = rest.join(' ');
    if (!question) { process.stderr.write('usage: lakonai graph query "<question>"\n'); process.exitCode = 1; return; }
    const graph = readGraph('.');
    if (!graph) { process.stderr.write('no graph.json found — run: lakonai graph build\n'); process.exitCode = 1; return; }

    const embPath = path.join('.', 'lakonai-graph', EMBEDDINGS_FILE);
    const hasEmb = fs.existsSync(embPath);

    if (hasEmb && hasXenova()) {
      // Async hybrid query (BM25 + semantic RRF)
      const embeddingsData = JSON.parse(fs.readFileSync(embPath, 'utf8'));
      embedQuery(question).then((queryVec) => {
        const result = nlQueryHybrid(graph, embeddingsData, question, queryVec);
        process.stdout.write(`[hybrid]\n${formatNlQuery(result, graph)}\n`);
      }).catch(() => {
        process.stdout.write(`[bm25]\n${formatNlQuery(nlQuery(graph, question), graph)}\n`);
      });
    } else {
      process.stdout.write(`[bm25]\n${formatNlQuery(nlQuery(graph, question), graph)}\n`);
    }
    return;
  }

  if (sub === 'html') {
    const rootDir = rest[0] || '.';
    const htmlPath = path.join(path.resolve(rootDir), 'lakonai-graph', HTML_FILE);
    if (!fs.existsSync(htmlPath)) {
      process.stderr.write(`no graph.html found — run: lakonai graph build ${rootDir}\n`);
      process.exitCode = 1;
      return;
    }
    // Open in default browser
    /* istanbul ignore next */
    const open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    require('child_process').spawn(open, [htmlPath], { detached: true, stdio: 'ignore' }).unref();
    process.stdout.write(`opened: ${htmlPath}\n`);
    return;
  }

  /* istanbul ignore next -- long-running interactive; SIGINT tested manually */
  if (sub === 'watch') {
    const rootDir = rest[0] || '.';
    const absRoot = path.resolve(rootDir);
    process.stdout.write(`lakonai graph watch: ${absRoot}\n`);
    buildSync(rootDir);
    process.stdout.write('watching for changes (ctrl+c to stop)…\n');
    const watcher = watchDir(absRoot, (changed) => {
      process.stdout.write(`changed: ${changed.map((f) => path.relative(absRoot, f)).join(', ')} — rebuilding…\n`);
      try {
        buildSync(rootDir);
        process.stdout.write('rebuilt\n');
      } catch (err) {
        process.stderr.write(`rebuild error: ${err.message}\n`);
      }
    });
    process.on('SIGINT', () => { watcher.close(); process.exit(0); });
    return;
  }

  process.stderr.write(`lakonai graph: unknown subcommand "${sub}"\nuse: build | explain | path | query | html | watch\n`);
  process.exitCode = 1;
}

module.exports = { build, buildSync, runGraph, explain, shortestPath, nlQuery, nlQuerySemantic, nlQueryHybrid };
