#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { shouldEmit } = require('./throttle');

const DEFAULT_HEAD_LIMIT = 30;

function lakonHome() {
  /* istanbul ignore next */
  return process.env.LAKON_HOME || path.join(os.homedir(), '.lakon');
}

/* istanbul ignore next */
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
    const data = JSON.parse(raw);
    if (data.tool_name !== 'Grep') process.exit(0);

    const input = data.tool_input || {};
    if (input.head_limit != null) process.exit(0);

    const updatedInput = { ...input, head_limit: DEFAULT_HEAD_LIMIT };
    const reason = shouldEmit('grep-head-cap')
      ? `lakonai: head_limit auto-set to ${DEFAULT_HEAD_LIMIT}. Pass head_limit explicitly to override; pass output_mode:"count" for a tally instead of matches.`
      : undefined;

    trackRecord({
      cmd: 'Grep',
      args: [input.pattern || '', 'cap'],
      rawTokens: 200,
      filteredTokens: 50,
    });

    const response = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput,
        ...(reason ? { permissionDecisionReason: reason } : {}),
      },
    };
    process.stdout.write(JSON.stringify(response));
    process.exit(0);
  } catch {
    process.exit(0);
  }
}
/* istanbul ignore next */
if (require.main === module) main();

module.exports = { trackRecord, lakonHome, DEFAULT_HEAD_LIMIT };
