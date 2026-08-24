#!/usr/bin/env node
'use strict';

const { supportedFirstWords } = require('../filters');

const FILTERED_CMDS = supportedFirstWords();

function rewriteIfNeeded(command) {
  if (typeof command !== 'string') return null;
  const trimmed = command.trim();
  if (!trimmed) return null;
  if (/^lakonai(\s|$)/.test(trimmed)) return null;
  const firstWord = trimmed.split(/\s+/)[0];
  if (!FILTERED_CMDS.has(firstWord)) return null;
  return `lakonai ${trimmed}`;
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
    if (data.tool_name !== 'Bash') process.exit(0);

    const command = data.tool_input && data.tool_input.command;
    const rewritten = rewriteIfNeeded(command);
    if (!rewritten) process.exit(0);

    const response = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: {
          ...data.tool_input,
          command: rewritten,
        },
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

module.exports = { rewriteIfNeeded, FILTERED_CMDS };
