#!/usr/bin/env node
/* istanbul ignore file -- thin SessionStart I/O shell: stdin + version check */
'use strict';

const { checkForUpdate, formatNotice } = require('./version-check');

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

    const parts = [];

    const update = await checkForUpdate();
    if (update) parts.push(formatNotice(update));

    try {
      const learnReport = require('../learn-report');
      const summary = learnReport.maybeGetUnseen();
      if (summary) parts.push(`lakonai learn: ${summary}`);
    } catch { /* best-effort */ }

    if (!parts.length) process.exit(0);

    const response = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: parts.join('\n\n'),
      },
    };
    process.stdout.write(JSON.stringify(response));
    process.exit(0);
    /* istanbul ignore next */
  } catch {
    process.exit(0);
  }
}

/* istanbul ignore next */
if (require.main === module) main();
