'use strict';

// Generates one-line docblocks for file nodes that lack comments.
// Stores results in lakonai-graph/annotations.json — never modifies source files.
// On build, annotations are merged into nodes before embedding generation.

const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

const ANNOTATIONS_FILE = 'annotations.json';
const PROMPT = (src) =>
  `Write a ONE-line search index entry (max 120 chars) for this source file. Lead with the primary action verb and main concept a developer would search for. Include key synonyms inline (e.g. "Rate-limits / throttles requests", "Blocks / intercepts dangerous commands", "Compresses / strips / shrinks output"). No preamble, no quotes — just the description.\n\n${src}`;

// --- LLM backends ---

function callClaudeCLI(src) {
  try {
    const result = execFileSync('claude', [
      '--print',
      '--model', 'claude-haiku-4-5-20251001',
      PROMPT(src),
    ], { encoding: 'utf8', timeout: 30000 });
    return result.trim();
  } catch (err) {
    throw new Error('claude CLI failed: ' + (err.stderr || err.message).slice(0, 100));
  }
}

function callAnthropic(src) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 128,
    messages: [{ role: 'user', content: PROMPT(src) }],
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data).content[0].text.trim()); }
        catch { reject(new Error('Anthropic parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function callOllama(src, model = 'llama3.2') {
  const body = JSON.stringify({ model, prompt: PROMPT(src), stream: false });
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/generate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data).response.trim()); }
        catch { reject(new Error('Ollama parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function detectBackend() {
  // Prefer claude CLI (zero config for Claude Code users)
  try { execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 3000 }); return 'claude-cli'; } catch { /* not available */ }
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  // Probe Ollama
  try {
    await new Promise((res, rej) => {
      const r = http.get('http://127.0.0.1:11434/', (resp) => { resp.resume(); res(resp.statusCode); });
      r.on('error', rej);
      r.setTimeout(1000, () => { r.destroy(); rej(new Error('timeout')); });
    });
    return 'ollama';
  } catch {
    return null;
  }
}

async function callLLM(src, backend) {
  if (backend === 'claude-cli') return callClaudeCLI(src);
  if (backend === 'anthropic') return callAnthropic(src);
  if (backend === 'ollama') return callOllama(src);
  throw new Error('no LLM backend — install claude CLI, set ANTHROPIC_API_KEY, or start Ollama');
}

// --- Main annotate logic ---

async function annotateGraph(rootDir, graphDir, graph) {
  const annotPath = path.join(graphDir, ANNOTATIONS_FILE);
  const annotations = fs.existsSync(annotPath)
    ? JSON.parse(fs.readFileSync(annotPath, 'utf8'))
    : {};

  const pending = graph.nodes.filter(
    (n) => n.kind === 'file' && !n.docblock && !annotations[n.file]
  );

  if (!pending.length) {
    process.stdout.write('  annotate: all files already annotated\n');
    return annotations;
  }

  const backend = await detectBackend();
  if (!backend) {
    process.stderr.write('  annotate: no LLM backend found — set ANTHROPIC_API_KEY or start Ollama\n');
    return annotations;
  }

  process.stdout.write(`  annotate: ${pending.length} files → ${backend}\n`);

  for (const node of pending) {
    const filePath = path.join(rootDir, node.file);
    let src = '';
    try { src = fs.readFileSync(filePath, 'utf8').split('\n').slice(0, 40).join('\n'); }
    catch { continue; }

    try {
      const raw = await callLLM(src, backend);
      const docblock = raw.split('\n')[0].replace(/^["']|["']$/g, '').slice(0, 120);
      annotations[node.file] = docblock;
      process.stdout.write(`    ${node.file}: ${docblock}\n`);
    } catch (err) {
      process.stdout.write(`    ${node.file}: skipped (${err.message})\n`);
    }
  }

  fs.writeFileSync(annotPath, JSON.stringify(annotations, null, 2));
  return annotations;
}

// Merge stored annotations into graph nodes (called during build before embedding).
function mergeAnnotations(nodes, graphDir) {
  const annotPath = path.join(graphDir, ANNOTATIONS_FILE);
  if (!fs.existsSync(annotPath)) return nodes;
  const annotations = JSON.parse(fs.readFileSync(annotPath, 'utf8'));
  return nodes.map((n) => {
    if (n.kind === 'file' && !n.docblock && annotations[n.file]) {
      return { ...n, docblock: annotations[n.file] };
    }
    return n;
  });
}

module.exports = { annotateGraph, mergeAnnotations, ANNOTATIONS_FILE };
