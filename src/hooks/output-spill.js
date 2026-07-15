#!/usr/bin/env node
'use strict';

// PostToolUse: the universal net.
//
// bash-rewrite.js can only spill commands lakonai executes itself — the 34 in the
// allowlist, stdout only. This hook runs AFTER any tool and gets the real result,
// so it catches everything the rewrite can't: `terraform plan`, `./deploy.sh`,
// stderr, plus Read/Grep/WebFetch output that no filter ever sees.
//
// PostToolUse is the only hook that can replace a tool result
// (`updatedToolOutput`); PreToolUse fires before the output exists, so it can
// cap input but never park output.

const sandbox = require('../sandbox');
const { countTokensApprox } = require('../filters');

// Tools whose output is worth parking. Deliberately not everything: Edit/Write
// results are short, and TodoWrite & friends are structural.
const SPILLABLE_TOOLS = new Set(['Bash', 'Read', 'Grep', 'Glob', 'WebFetch', 'Task']);

// The result arrives as a string or as a structured object depending on the tool.
function extractText(data) {
  const r = data.tool_response !== undefined ? data.tool_response : data.tool_output;
  if (r == null) return null;
  if (typeof r === 'string') return r;
  // Read returns {file: {content}}; others vary. Prefer a real content field over
  // stringifying the wrapper, which would park JSON noise instead of the payload.
  if (typeof r === 'object') {
    const content = r.content ?? r.file?.content ?? r.output ?? r.stdout;
    if (typeof content === 'string') return content;
    try {
      return JSON.stringify(r);
    } catch {
      return null;
    }
  }
  return null;
}

// bin/lakonai.js may already have parked this very output; re-parking a digest
// would nest one spill inside another and lose the original id.
function isAlreadyDigest(text) {
  return /^lakonai: \d+ lines \/ \d+KB parked in sandbox /.test(text);
}

function decide({ toolName, text, threshold }) {
  if (!SPILLABLE_TOOLS.has(toolName)) return null;
  if (typeof text !== 'string' || !text) return null;
  if (isAlreadyDigest(text)) return null;
  const tokens = countTokensApprox(text);
  if (!sandbox.shouldSpill(tokens, threshold)) return null;
  return { tokens };
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

    const toolName = data.tool_name;
    const text = extractText(data);
    if (!decide({ toolName, text, threshold: sandbox.spillThreshold() })) process.exit(0);

    const label = toolName === 'Bash' ? data.tool_input?.command || 'Bash' : toolName;
    const parked = sandbox.spill({ cmd: label, args: [], exitCode: null, text });
    // Disk failure must leave the original result untouched, not blank it.
    if (!parked) process.exit(0);

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          updatedToolOutput: parked.digest,
        },
      })
    );
    process.exit(0);
  } catch {
    // A broken net must never break the tool it is netting.
    process.exit(0);
  }
}

/* istanbul ignore next */
if (require.main === module) main();

module.exports = { extractText, isAlreadyDigest, decide, SPILLABLE_TOOLS };
