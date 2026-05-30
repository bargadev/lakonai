'use strict';

// MCP catalog compression. An MCP server's tool/prompt/resource *descriptions*
// load into context every session. This is machine-generated catalog metadata
// (NOT user-authored memory), so compressing it is safe and we do it
// automatically (the installer wraps detected MCP servers). Offline, regex only.
//
// `lakonai __mcp <upstream-cmd>` runs a stdio proxy: requests and tool-call
// results pass through untouched; only list-response description fields shrink.

const { spawn } = require('child_process');

const INLINE = /`[^`]+`/g;
const URL = /\bhttps?:\/\/\S+/g;
const PATHY = /\b[\w-]+(?:[_./][\w-]+)+\b/g; // config.json, src/app/main.ts, user_id
const CAMEL = /\b[a-z]+[A-Z]\w*\b/g; // getUserById

const FILLER = [
  'please', 'just', 'really', 'basically', 'simply', 'actually', 'very',
  'kindly', 'note that', 'in order to', 'as well as',
];
const LEAD = /^(this (tool|function|endpoint|command)\s+(is used\s+)?(to|for|that)?\s*|use this (tool\s+)?to\s+|a tool (that|to)\s+|allows you to\s+)/i;

function shrink(text) {
  if (typeof text !== 'string' || !text) return text;
  const spans = [];
  const stash = (m) => `\x00${spans.push(m) - 1}\x00`;
  let s = text.replace(INLINE, stash).replace(URL, stash).replace(PATHY, stash).replace(CAMEL, stash);

  s = s.replace(LEAD, '');
  for (const w of FILLER) s = s.replace(new RegExp(`\\b${w}\\b`, 'gi'), ' ');
  s = s.replace(/\b(the|a|an)\b/gi, ' ');
  s = s.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => spans[Number(i)]);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shrinkMessage(obj, fields) {
  if (!obj || typeof obj !== 'object' || !obj.result) return obj;
  for (const key of ['tools', 'prompts', 'resources']) {
    const arr = obj.result[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      for (const f of fields) {
        if (typeof item[f] === 'string') item[f] = shrink(item[f]);
      }
    }
  }
  return obj;
}

function fields() {
  return (process.env.LAKONAI_SHRINK_FIELDS || 'description')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function transformLine(line, flds) {
  if (!line.trim()) return line;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return line;
  }
  return JSON.stringify(shrinkMessage(obj, flds));
}

/* istanbul ignore next -- stdio proxy wiring; logic is covered via transformLine */
function runProxy(argv) {
  const [cmd, ...args] = argv;
  if (!cmd) {
    process.stderr.write('usage: lakonai __mcp <upstream-command> [args...]\n');
    process.exit(2);
  }
  const flds = fields();
  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  process.stdin.pipe(child.stdin);
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      process.stdout.write(transformLine(line, flds) + '\n');
    }
  });
  child.stdout.on('end', () => {
    if (buf) process.stdout.write(transformLine(buf, flds));
  });
  child.on('exit', (code) => process.exit(code == null ? 0 : code));
}

module.exports = { shrink, shrinkMessage, transformLine, fields, runProxy };
