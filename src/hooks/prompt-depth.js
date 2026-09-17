#!/usr/bin/env node
'use strict';

// UserPromptSubmit: the enforcement point for output-side brevity.
//
// The rule block in ~/.claude/CLAUDE.md states the budget once, at session
// start, and then drifts out of attention as the context fills. This hook
// restates it on every single turn, which is the only way the contract survives
// a long session — and it is also where a depth request ("detalha") is detected
// and spent.

const depth = require('../depth');

/* istanbul ignore next -- I/O shell */
async function readStdin() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

// Pure decision: given a prompt, say which mode this turn runs in and what
// context to inject. No I/O beyond the depth flag file.
function decide({ sessionId, prompt }) {
  if (process.env.LAKON_NO_BRIEF === '1') return { mode: 'off', context: null };

  // An explicit "resume isso" cancels a standing grant before it is spent.
  if (depth.wantsBrief(prompt)) depth.revokeDepth(sessionId);
  else if (depth.wantsDepth(prompt)) depth.grantDepth(sessionId, 1);

  if (depth.consumeDepth(sessionId)) {
    return { mode: 'depth', context: depth.depthNotice() };
  }
  return { mode: 'brief', context: depth.briefReminder() };
}

function buildResponse(decision) {
  if (!decision.context) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: decision.context,
    },
  };
}

/* istanbul ignore next -- process entry point; decide()/buildResponse() are unit-tested */
async function main() {
  try {
    const raw = await readStdin();
    if (!raw.trim()) process.exit(0);
    const data = JSON.parse(raw);
    const decision = decide({ sessionId: data.session_id, prompt: data.prompt || '' });
    const response = buildResponse(decision);
    if (response) process.stdout.write(JSON.stringify(response));
    process.exit(0);
  } catch {
    // Never block a prompt because brevity bookkeeping failed.
    process.exit(0);
  }
}

/* istanbul ignore next */
if (require.main === module) main();

module.exports = { decide, buildResponse };
