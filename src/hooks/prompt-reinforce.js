#!/usr/bin/env node
'use strict';

// UserPromptSubmit hook: re-injects a short terse-mode reminder every turn.
// The SessionStart rule is injected once, but competing instructions from other
// plugins/long conversations make the model drift back to verbose prose. This
// keeps lakonai's terse rule in the model's attention on each user message.
// Opt out with LAKON_NO_REINFORCE=1.

const { getMode } = require('../mode');

const REMINDERS = {
  lite: 'lakonai (lite): no filler/hedging; keep full sentences. Code, security warnings and irreversible-action confirmations: normal prose.',
  full: 'lakonai (full): drop preamble/articles/filler, fragments OK, bullets over prose, keep identifiers/paths/errors verbatim. Code, security warnings and irreversible-action confirmations: normal prose.',
  ultra: 'lakonai (ultra): maximum terseness — abbreviate, arrows for causality (X→Y), drop conjunctions. Code, security warnings and irreversible-action confirmations: normal prose.',
};

function buildReminder(mode) {
  return REMINDERS[mode] || REMINDERS.full;
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
    await readStdin();
    if (process.env.LAKON_NO_REINFORCE === '1') process.exit(0);
    const response = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: buildReminder(getMode()),
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

module.exports = { buildReminder, REMINDERS };
