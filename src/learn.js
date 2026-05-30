'use strict';

// Automatic filter learning.
//
// Reads the Claude Code session transcript (same data source rtk's `discover`
// uses) at session end, counts how often each *unfiltered* shell command shows
// up and how much output it produces, and — once a command crosses a confidence
// floor — promotes it to the "learned" list so it gets a conservative auto-filter
// from then on. No user action required: the more you use it, the more it covers.
//
// Activation goes BEYOND rtk (which only reports/suggests). Safety is preserved
// by only ever applying the near-lossless filter in src/filters/auto.js.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { countTokensApprox } = require('./filters/utils');

const MIN_CALLS = Number(process.env.LAKON_LEARN_MIN_CALLS) || 3;
const MIN_AVG_TOKENS = Number(process.env.LAKON_LEARN_MIN_TOKENS) || 300;

/* istanbul ignore next */
function lakonHome() {
  return process.env.LAKON_HOME || path.join(os.homedir(), '.lakon');
}
const statsPath = () => path.join(lakonHome(), 'learn-stats.json');
const learnedPath = () => path.join(lakonHome(), 'learned.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(lakonHome(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
    /* istanbul ignore next */
  } catch {
    // never let learning break the hook
  }
}

// Base command of a shell string, skipping env assignments / sudo / env.
function baseCommand(command) {
  const tokens = String(command).trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && (/^\w+=/.test(tokens[i]) || tokens[i] === 'sudo' || tokens[i] === 'env')) i++;
  return tokens[i] || '';
}

// Parse a Claude Code transcript (JSONL) into [{ cmd, tokens }] for every Bash
// tool call, where tokens approximates the size of that call's output.
function extractBashUsage(transcript) {
  const cmds = new Map(); // tool_use_id -> base command
  const results = []; // { id, tokens }
  for (const line of transcript.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = obj.message || obj;
    const content = msg && msg.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (item.type === 'tool_use' && item.name === 'Bash' && item.input && typeof item.input.command === 'string') {
        cmds.set(item.id, baseCommand(item.input.command));
      } else if (item.type === 'tool_result') {
        const c = item.content;
        const text =
          typeof c === 'string'
            ? c
            : Array.isArray(c)
              ? c.map((x) => (typeof x === 'string' ? x : x.text || '')).join('\n')
              : '';
        results.push({ id: item.tool_use_id, tokens: countTokensApprox(text) });
      }
    }
  }
  const out = [];
  for (const r of results) {
    const cmd = cmds.get(r.id);
    if (cmd) out.push({ cmd, tokens: r.tokens });
  }
  return out;
}

// Promote stats entries that cross the floor (and aren't already built-in or
// learned) into the learned list. Returns the (possibly grown) learned array.
function promote(stats, isBuiltin) {
  const learned = new Set(readJson(learnedPath(), []));
  let changed = false;
  for (const [cmd, s] of Object.entries(stats)) {
    if (learned.has(cmd) || isBuiltin(cmd)) continue;
    if (s.count >= MIN_CALLS && s.tokens / s.count >= MIN_AVG_TOKENS) {
      learned.add(cmd);
      changed = true;
    }
  }
  const arr = [...learned];
  if (changed) writeJson(learnedPath(), arr);
  return arr;
}

// Orchestrator called at session end by the stop hook.
function analyzeTranscript(transcriptPath, isBuiltin) {
  if (process.env.LAKON_NO_LEARN === '1' || process.env.LAKON_NO_TRACK === '1') return;
  let text;
  try {
    text = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return;
  }
  const usage = extractBashUsage(text);
  if (!usage.length) return;
  const stats = readJson(statsPath(), {});
  for (const u of usage) {
    if (!u.cmd || isBuiltin(u.cmd)) continue;
    const s = stats[u.cmd] || { count: 0, tokens: 0 };
    s.count += 1;
    s.tokens += u.tokens;
    stats[u.cmd] = s;
  }
  writeJson(statsPath(), stats);
  promote(stats, isBuiltin);
}

// Platform-agnostic learning. The transcript reader above is Claude-Code-only;
// this learns from `~/.lakon/log.jsonl` instead — populated by EVERY `lakonai`
// invocation (shim wrappers + rule-prefixed calls) on ANY agent. So auto-learning
// runs automatically everywhere, not just on Claude. Smaller observation window
// (only commands routed through lakonai), but no hook required.
function analyzeLog(isBuiltin) {
  if (process.env.LAKON_NO_LEARN === '1' || process.env.LAKON_NO_TRACK === '1') return;
  let text;
  try {
    text = fs.readFileSync(path.join(lakonHome(), 'log.jsonl'), 'utf8');
  } catch {
    return;
  }
  const stats = {};
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const cmd = e && typeof e.cmd === 'string' ? e.cmd : null;
    if (!cmd || cmd === 'session' || isBuiltin(cmd)) continue;
    const s = stats[cmd] || { count: 0, tokens: 0 };
    s.count += 1;
    s.tokens += e.raw || 0;
    stats[cmd] = s;
  }
  if (Object.keys(stats).length) promote(stats, isBuiltin);
}

const LEARN_LOG_TTL_MS = 60 * 60 * 1000; // scan the log at most once per hour

// Throttled entry point for the per-call path (runAndFilter): scans the log at
// most hourly, so learning is automatic on every agent but costs nothing hot.
function maybeLearnFromLog(isBuiltin, now = Date.now()) {
  if (process.env.LAKON_NO_LEARN === '1' || process.env.LAKON_NO_TRACK === '1') return false;
  const stamp = path.join(lakonHome(), '.learn-log-stamp');
  const last = Number(readJson(stamp, { t: 0 }).t) || 0;
  if (last && now - last < LEARN_LOG_TTL_MS) return false; // last===0 ⇒ never run ⇒ run now
  writeJson(stamp, { t: now });
  analyzeLog(isBuiltin);
  return true;
}

let _learnedCache;
function learnedCommands() {
  if (_learnedCache === undefined) _learnedCache = new Set(readJson(learnedPath(), []));
  return _learnedCache;
}
function isLearned(cmd) {
  return learnedCommands().has(cmd);
}
/* istanbul ignore next -- test helper to reset the per-process cache */
function _resetCache() {
  _learnedCache = undefined;
}

module.exports = {
  baseCommand,
  extractBashUsage,
  promote,
  analyzeTranscript,
  analyzeLog,
  maybeLearnFromLog,
  learnedCommands,
  isLearned,
  _resetCache,
  statsPath,
  learnedPath,
};
