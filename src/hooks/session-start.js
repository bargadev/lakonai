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
    const update = await checkForUpdate();
    if (!update) process.exit(0);

    const response = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: formatNotice(update),
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
