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

// The assistant's own text for the turn that just ended, concatenated across
// text blocks. Tool calls and thinking are not part of what the user reads.
function extractLastAssistantText(transcriptPath) {
  try {
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let obj;
      try { obj = JSON.parse(lines[i]); } catch { continue; }
      const msg = obj.message;
      if (!msg || msg.role !== 'assistant') continue;
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        const text = msg.content
          .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join('\n');
        if (text.trim()) return text;
      }
    }
    /* istanbul ignore next -- unreadable transcript */
  } catch {
    return null;
  }
  return null;
}

// Prose lines only. Fenced code, diffs and tables are exempt from the answer
// budget (rule 8), so counting them would misreport every turn that ships a
// patch as a budget violation.
function proseLines(text) {
  if (!text || typeof text !== 'string') return 0;
  let inFence = false;
  let count = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!line) continue;
    if (line.startsWith('|')) continue; // table row
    count += 1;
  }
  return count;
}

function responseShape(transcriptPath) {
  const text = extractLastAssistantText(transcriptPath);
  if (text === null) return null;
  return { out_lines: proseLines(text), out_chars: text.length };
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
      // Output-side brevity telemetry: without a baseline there is no way to
      // tell whether the answer budget actually changed anything.
      ...(responseShape(data.transcript_path) || {}),
    });
    process.exit(0);
  } catch {
    process.exit(0);
  }
}
/* istanbul ignore next */
if (require.main === module) main();

module.exports = { extractUsage, trackSession, lakonHome, extractLastAssistantText, proseLines, responseShape };
