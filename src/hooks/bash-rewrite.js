#!/usr/bin/env node
'use strict';

const { supportedFirstWords } = require('../filters');
const { topLevelOps, splitCdPrefix } = require('../shell');
const permissions = require('./permissions');

const FILTERED_CMDS = supportedFirstWords();

// Commands that may sit after a `|` without changing what the filter is for:
// they only cut the (already filtered) display. `| wc -l`, `| jq`, `| sh` or
// `| git apply` would consume filtered bytes as if they were the real output.
const PIPE_SINKS = new Set(['head', 'tail']);

// Redirections that never capture the filtered stdout into a file.
const HARMLESS_OPS = new Set(['dup', 'null']);

// Forms whose output is empty: rewriting them saves nothing, and the hook
// answers "allow", so leave them to the normal permission flow.
function isNoOutputForm(firstWord, rest) {
  if (firstWord === 'sed') return /(^|\s)(-i|--in-place)/.test(rest);
  return false;
}

// Rewrite a single command (no `cd` prefix). The hook approves what it
// rewrites, so it must only ever rewrite the command it can see: anything that
// chains another command (`&&`, `;`, `||`, `&`, newline), substitutes one
// (`$(…)`, backticks), writes the filtered output to a file (`>`), or pipes it
// into a consumer other than head/tail is left alone.
function rewriteSimple(command) {
  const firstWord = command.split(/\s+/)[0];
  if (!FILTERED_CMDS.has(firstWord)) return null;
  if (isNoOutputForm(firstWord, command.slice(firstWord.length))) return null;
  const ops = topLevelOps(command);
  if (!ops) return null;
  for (const { op, i } of ops) {
    if (HARMLESS_OPS.has(op)) continue;
    if (op !== '|') return null;
    const sink = command.slice(i + 1).trim().split(/\s+/)[0];
    if (!PIPE_SINKS.has(sink)) return null;
  }
  return `lakonai ${command}`;
}

function rewriteIfNeeded(command) {
  if (typeof command !== 'string') return null;
  const trimmed = command.trim();
  if (!trimmed) return null;
  if (/^lakonai(\s|$)/.test(trimmed)) return null;
  // `cd <dir> && cmd` is the dominant shape agents emit. Rewrite the command
  // behind the prefix; `cd` itself has nothing to filter.
  const cd = splitCdPrefix(trimmed);
  if (cd) {
    const inner = rewriteIfNeeded(cd.rest);
    return inner ? `cd ${cd.dir} ${cd.op} ${inner}` : null;
  }
  return rewriteSimple(trimmed);
}

// The PreToolUse answer. With `allow` the call skips the permission prompt;
// without a decision the rewritten command goes through the normal flow (the
// prompt, or auto mode's review). Codex accepts only the `allow` form.
function buildResponse(toolInput, rewritten, decision = 'allow') {
  const out = { hookEventName: 'PreToolUse' };
  if (decision === 'allow') out.permissionDecision = 'allow';
  out.updatedInput = { ...toolInput, command: rewritten };
  return { hookSpecificOutput: out };
}

// The command that actually runs, behind any `cd <dir> &&` prefixes.
function coreCommand(command) {
  let s = command.trim();
  for (let cd = splitCdPrefix(s); cd; cd = splitCdPrefix(s)) s = cd.rest;
  return s;
}

// Full hook decision for one PreToolUse payload. Returns the JSON answer, or
// null to stay silent (the call proceeds untouched).
function respond(data, { env = process.env, rules } = {}) {
  if (!data || data.tool_name !== 'Bash') return null;
  const command = data.tool_input && data.tool_input.command;
  const rewritten = rewriteIfNeeded(command);
  if (!rewritten) return null;
  const decision = permissions.decide({
    core: coreCommand(command),
    mode: data.permission_mode,
    agent: env.LAKON_HOOK_AGENT === 'codex' ? 'codex' : 'claude',
    rules: rules || permissions.loadRules({ cwd: data.cwd }),
  });
  if (decision === 'skip') return null;
  return buildResponse(data.tool_input, rewritten, decision);
}

/* istanbul ignore next */
async function readStdin() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

/* istanbul ignore next */
async function main() {
  try {
    const raw = await readStdin();
    if (!raw.trim()) process.exit(0);

    const response = respond(JSON.parse(raw));
    if (response) process.stdout.write(JSON.stringify(response));
    process.exit(0);
  } catch {
    process.exit(0);
  }
}

/* istanbul ignore next */
if (require.main === module) main();

module.exports = { rewriteIfNeeded, rewriteSimple, buildResponse, coreCommand, respond, FILTERED_CMDS, PIPE_SINKS };
