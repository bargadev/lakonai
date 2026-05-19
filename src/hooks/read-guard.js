#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function lakonHome() {
  /* c8 ignore next */
  return process.env.LAKON_HOME || path.join(os.homedir(), '.lakon');
}

/* c8 ignore start */
function trackRecord({ cmd, args, rawTokens, filteredTokens }) {
  if (process.env.LAKON_NO_TRACK === '1') return;
  try {
    const dir = lakonHome();
    fs.mkdirSync(dir, { recursive: true });
    const entry = {
      t: Date.now(),
      cmd,
      args: Array.isArray(args) ? args.slice(0, 4) : [],
      raw: rawTokens,
      out: filteredTokens,
      saved: Math.max(0, rawTokens - filteredTokens),
    };
    fs.appendFileSync(path.join(dir, 'log.jsonl'), JSON.stringify(entry) + '\n');
  } catch {
    // never let tracking break the hook
  }
}
/* c8 ignore stop */

const DENY_DIRS = [
  'node_modules',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'target',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'vendor',
  '.git/objects',
  '__snapshots__',
  '.ipynb_checkpoints',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  '.svelte-kit',
  '.parcel-cache',
  '.vercel',
  'tmp',
  'cypress/screenshots',
  'cypress/videos',
  'playwright-report',
  'test-results',
  '.idea',
  '.vscode',
];

const DENY_FILE_RE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock(b)?|Cargo\.lock|Gemfile\.lock|composer\.lock|poetry\.lock|uv\.lock|go\.sum|.*\.tsbuildinfo|.*\.log|.*\.min\.(js|css|mjs)|.*\.map|.*\.pyc|.*\.pyo|.*\.so|.*\.o|.*\.a|.*\.dylib|.*\.dll|.*\.exe|.*\.class|.*\.wasm)$/;

const AUTO_CAP_LINES = 800;

function isDeniedPath(p) {
  /* c8 ignore next */
  if (typeof p !== 'string' || !p) return null;
  const norm = p.replace(/\\/g, '/');
  for (const dir of DENY_DIRS) {
    if (norm.includes(`/${dir}/`) || norm.endsWith(`/${dir}`) || norm.startsWith(`${dir}/`)) {
      return `path lives under ${dir}/ — read costs context for noise. grep -n the symbol instead, then Read with offset/limit.`;
    }
  }
  if (DENY_FILE_RE.test(norm)) {
    return 'lockfile/build artifact — almost never useful for the agent. grep -n the symbol inside if you must.';
  }
  return null;
}

function fileLineCount(p) {
  try {
    const data = fs.readFileSync(p, 'utf8');
    let n = 0;
    for (let i = 0; i < data.length; i++) if (data.charCodeAt(i) === 10) n++;
    if (data.length && data.charCodeAt(data.length - 1) !== 10) n++;
    return n;
    /* c8 ignore next 3 */
  } catch {
    return null;
  }
}

function estimateTokensByBytes(p) {
  try {
    const size = fs.statSync(p).size;
    return Math.max(1, Math.round(size / 4));
  } catch {
    return 0;
  }
}

async function readStdin() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

/* c8 ignore start */
async function main() {
  try {
    const raw = await readStdin();
    if (!raw.trim()) process.exit(0);
    const data = JSON.parse(raw);
    if (data.tool_name !== 'Read') process.exit(0);

    const input = data.tool_input || {};
    const fp = input.file_path;
    if (typeof fp !== 'string' || !fp) process.exit(0);

    const denyReason = isDeniedPath(fp);
    if (denyReason) {
      const rawTokens = estimateTokensByBytes(fp);
      trackRecord({
        cmd: 'Read',
        args: [fp, 'deny'],
        rawTokens,
        filteredTokens: 0,
      });
      const response = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `lakonai: ${denyReason}`,
        },
      };
      process.stdout.write(JSON.stringify(response));
      process.exit(0);
    }

    if (input.limit == null && input.offset == null) {
      const n = fileLineCount(fp);
      if (n !== null && n > AUTO_CAP_LINES) {
        const rawTokens = estimateTokensByBytes(fp);
        const capRatio = AUTO_CAP_LINES / n;
        const filteredTokens = Math.round(rawTokens * capRatio);
        trackRecord({
          cmd: 'Read',
          args: [fp, 'cap'],
          rawTokens,
          filteredTokens,
        });
        const response = {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            updatedInput: {
              ...input,
              offset: 1,
              limit: AUTO_CAP_LINES,
            },
            permissionDecisionReason: `lakonai: file has ${n} lines, capped at ${AUTO_CAP_LINES}. Read again with offset=${AUTO_CAP_LINES + 1} for more, or grep -n the symbol you need.`,
          },
        };
        process.stdout.write(JSON.stringify(response));
        process.exit(0);
      }
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
}
/* c8 ignore stop */

main();
