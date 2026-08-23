#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function lakonHome() {
  /* istanbul ignore next */
  return process.env.LAKON_HOME || path.join(os.homedir(), '.lakon');
}

/* istanbul ignore next */
function trackSession(payload) {
  if (process.env.LAKON_NO_TRACK === '1') return;
  try {
    const dir = lakonHome();
    fs.mkdirSync(dir, { recursive: true });
    const entry = { t: Date.now(), cmd: 'session', ...payload };
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

function extractUsage(transcriptPath) {
  try {
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        const msg = obj.message;
        if (msg && msg.role === 'assistant' && msg.usage) {
          return {
            in_tokens: msg.usage.input_tokens || 0,
            out_tokens: msg.usage.output_tokens || 0,
            cache_read: msg.usage.cache_read_input_tokens || 0,
            cache_create: msg.usage.cache_creation_input_tokens || 0,
          };
        }
      } catch {
        // skip malformed lines
      }
    }
    /* istanbul ignore next */
  } catch {
    return null;
  }
  return null;
}

/* istanbul ignore next */
async function main() {
  try {
    const raw = await readStdin();
    if (!raw.trim()) process.exit(0);
    const data = JSON.parse(raw);
    if (!data.transcript_path) process.exit(0);

    // Learn which unfiltered commands are worth auto-filtering (best effort).
    const learn = require('../learn');
    const { isBuiltinSupported } = require('../filters');
    learn.analyzeTranscript(data.transcript_path, isBuiltinSupported);

    // Daily sink report — written silently to ~/.lakon/learn-report.md.
    // session-start will surface a one-line summary the next time around.
    try {
      require('../learn-report').maybeWriteReport(isBuiltinSupported);
    } catch { /* never break the hook */ }

    const usage = extractUsage(data.transcript_path);
    if (!usage) process.exit(0);

    trackSession({
      session_id: data.session_id || null,
      ...usage,
    });
    process.exit(0);
  } catch {
    process.exit(0);
  }
}
/* istanbul ignore next */
if (require.main === module) main();

module.exports = { extractUsage, trackSession, lakonHome };
