'use strict';

// LLM-backed memory compression. The compressor is a model, not a regex — it can
// rephrase, merge redundant bullets and restructure, which a lexical pass cannot.
// We call whichever local AI CLI the user already has (the same agents lakonai
// installs into), so there is NO API key to manage. The bytes cross a model
// boundary, so a sensitive-filename guard (mem-compress.js) refuses obvious
// secrets first, and every result is validated before it is written.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Hard wall-clock cap per CLI call so a hung agent (auth prompt, network stall)
// can never block the caller forever — `lakonai gain` fires 8 of these in a row.
// Override with LAKONAI_LLM_TIMEOUT_MS; 0/invalid disables the cap.
const DEFAULT_TIMEOUT_MS = 120000;
function defaultTimeout(env = process.env) {
  const raw = env.LAKONAI_LLM_TIMEOUT_MS;
  if (raw == null || raw === '') return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TIMEOUT_MS;
}

// Local agent CLIs that can run a one-shot, non-interactive prompt. Order is the
// detection preference. `args(prompt)` builds argv; when `stdin` is true the
// prompt is piped instead of passed as an argument. `modelFlag` (+ env
// LAKONAI_MEM_MODEL) optionally overrides the model.
//
// Windsurf and Cline ship no headless one-shot CLI (they are IDE/extension only),
// so they cannot drive compression directly — a user on those platforms relies on
// whichever of the CLIs below they also have installed.
const PROVIDERS = [
  { id: 'claude', platform: 'Claude Code', bin: 'claude', stdin: true, args: () => ['--print'], modelFlag: '--model', systemFlag: '--append-system-prompt', ruleFreeArgs: ['--setting-sources', 'project'] },
  { id: 'gemini', platform: 'Gemini CLI', bin: 'gemini', stdin: false, args: (p) => ['-p', p], modelFlag: '-m' },
  { id: 'codex', platform: 'Codex', bin: 'codex', stdin: true, args: () => ['exec', '-'], modelFlag: '-m' },
  { id: 'cursor', platform: 'Cursor', bin: 'cursor-agent', stdin: false, args: (p) => ['-p', p], modelFlag: '--model' },
];

// Is `bin` an executable on PATH? Pure filesystem check (no process spawn).
function onPath(bin, env = process.env, statSync = fs.statSync) {
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      try {
        if (statSync(path.join(dir, bin + ext)).isFile()) return true;
      } catch {
        /* keep looking */
      }
    }
  }
  return false;
}

// Choose the agent CLI to use: an explicit LAKONAI_MEM_CLI wins (must be on PATH),
// otherwise the first detected provider in preference order. Throws a clear,
// actionable error when nothing usable is found.
function pickProvider({ env = process.env, exists = onPath } = {}) {
  const forced = env.LAKONAI_MEM_CLI;
  if (forced) {
    const p = PROVIDERS.find((x) => x.id === forced || x.bin === forced);
    if (!p) {
      throw new Error(`LAKONAI_MEM_CLI="${forced}" is not a known agent CLI (${PROVIDERS.map((x) => x.id).join(', ')}).`);
    }
    if (!exists(p.bin, env)) {
      throw new Error(`LAKONAI_MEM_CLI="${forced}" selected, but \`${p.bin}\` is not on PATH.`);
    }
    return p;
  }
  const found = PROVIDERS.find((p) => exists(p.bin, env));
  if (!found) {
    throw new Error(
      `no local AI CLI found. Install one of: ${PROVIDERS.map((p) => `${p.bin} (${p.platform})`).join(', ')} — ` +
        `or set LAKONAI_MEM_CLI.`
    );
  }
  return found;
}

// Strip an outer ```markdown ... ``` (or bare ``` ... ```) fence the model may
// wrap the whole answer in. Inner fences from the original are left intact.
function stripWrapper(text) {
  let s = String(text).trim();
  const m = s.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
  if (m) s = m[1].trim();
  return s;
}

function buildCompressPrompt(original, instruction) {
  const steer = instruction
    ? `\nADDITIONAL INSTRUCTION FROM THE USER — follow it, but the STRICT RULES above still win on any conflict:\n${instruction}\n`
    : '';
  return `Compress this Markdown memory file to use fewer tokens while preserving 100% of its meaning and every instruction. It is an AI agent's instruction file — losing or altering a directive is unacceptable.

STRICT RULES:
- Do NOT modify anything inside fenced code blocks (\`\`\`) — copy them byte-for-byte.
- Do NOT modify anything inside inline backticks.
- Preserve ALL URLs, file paths, commands, env vars and version numbers exactly.
- Preserve ALL headings exactly (same text, same level).
- Keep list/table structure and nesting.
- NEVER drop, weaken, or invert a negation or a "must/never/do not" directive.
- Compress only natural-language prose: drop articles/filler, merge redundant sentences, use shorter synonyms, prefer fragments.
- Return ONLY the compressed Markdown body. Do NOT add an outer code fence around the whole file and do NOT add any commentary.
${steer}
FILE:
${original}`;
}

function buildFixPrompt(original, compressed, missing) {
  const list = missing.map((m) => `- ${m}`).join('\n');
  return `A compressed Markdown file dropped some content that MUST be preserved. Restore ONLY the listed items into the COMPRESSED version, in the right place, byte-for-byte from the ORIGINAL. Do not recompress or rephrase anything else.

MISSING (restore each exactly):
${list}

ORIGINAL (reference only):
${original}

COMPRESSED (fix this, return ONLY the fixed file):
${compressed}`;
}

// Run the chosen agent CLI in non-interactive mode. `run` is injectable for tests
// (production: spawnSync). Throws a clear error when the CLI is missing or returns
// non-zero so the caller can surface it.
function callAgent(prompt, { run = spawnSync, provider, model = process.env.LAKONAI_MEM_MODEL, systemPrompt, ruleFree, cwd, timeout = defaultTimeout() } = {}) {
  const p = provider || pickProvider();
  // Prefer the CLI's real system-prompt flag (stronger behavioral effect); fall
  // back to prepending it to the prompt when the CLI has no such flag.
  const useFlag = systemPrompt && p.systemFlag;
  const effective = systemPrompt && !useFlag ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
  const args = p.args(effective);
  if (model && p.modelFlag) args.push(p.modelFlag, model);
  if (useFlag) args.push(p.systemFlag, systemPrompt);
  // For a clean benchmark baseline: stop the CLI auto-loading the installed rule
  // (e.g. ~/.claude/CLAUDE.md) so the "no rule" arm is truly rule-free. We do this
  // via the CLI's own flag (claude: --setting-sources project, dropping the `user`
  // source) — NOT by redirecting the config dir, which on macOS switches the CLI to
  // file-based auth and leaves it "Not logged in" (the credential lives in the
  // Keychain, keyed to the default config dir). Pair it with an empty `cwd` so no
  // project CLAUDE.md leaks in either.
  if (ruleFree && p.ruleFreeArgs) args.push(...p.ruleFreeArgs);
  const opts = { input: p.stdin ? effective : undefined, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 };
  if (cwd) opts.cwd = cwd;
  if (timeout > 0) {
    opts.timeout = timeout;
    opts.killSignal = 'SIGKILL';
  }
  const res = run(p.bin, args, opts);
  if (res.error) {
    if (res.error.code === 'ENOENT') {
      throw new Error(`\`${p.bin}\` (${p.platform}) not found on PATH.`);
    }
    if (res.error.code === 'ETIMEDOUT') {
      throw new Error(`${p.bin} timed out after ${timeout}ms (set LAKONAI_LLM_TIMEOUT_MS to adjust).`);
    }
    throw new Error(`${p.bin} failed: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`${p.bin} exited ${res.status}: ${(res.stderr || '').trim()}`);
  }
  return stripWrapper(res.stdout || '');
}

function compressWith(original, opts = {}) {
  return callAgent(buildCompressPrompt(original, opts.instruction), opts);
}

function fixWith(original, compressed, missing, opts = {}) {
  return callAgent(buildFixPrompt(original, compressed, missing), opts);
}

module.exports = {
  PROVIDERS,
  onPath,
  pickProvider,
  stripWrapper,
  buildCompressPrompt,
  buildFixPrompt,
  callAgent,
  compressWith,
  fixWith,
};
