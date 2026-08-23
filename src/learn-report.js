'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DAY_MS = 24 * 60 * 60 * 1000;
const REPORT_TTL_MS = DAY_MS;
const TOP_SINKS = 5;

function lakonHome() {
  /* istanbul ignore next */
  return process.env.LAKON_HOME || path.join(os.homedir(), '.lakon');
}

const reportPath = () => path.join(lakonHome(), 'learn-report.md');
const seenPath = () => path.join(lakonHome(), 'report-seen');
const stampPath = () => path.join(lakonHome(), 'last-report-ts');
const statsPath = () => path.join(lakonHome(), 'learn-stats.json');
const logPath = () => path.join(lakonHome(), 'log.jsonl');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeFile(file, content) {
  try {
    fs.mkdirSync(lakonHome(), { recursive: true });
    fs.writeFileSync(file, content);
  } catch { /* best-effort */ }
}

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

// Read all commands from log.jsonl that went through lakonai (have raw + out).
function readLogSinks() {
  let text;
  try { text = fs.readFileSync(logPath(), 'utf8'); } catch { return []; }
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e.cmd || e.cmd === 'session' || !e.raw) continue;
    const acc = map.get(e.cmd) || { cmd: e.cmd, calls: 0, raw: 0, out: 0, saved: 0, filtered: true };
    acc.calls++;
    acc.raw += e.raw || 0;
    acc.out += e.out || e.raw || 0;
    acc.saved += e.saved || 0;
    map.set(e.cmd, acc);
  }
  return [...map.values()];
}

// Read unfiltered commands from transcript analysis (learn-stats.json).
// These are commands that ran through the agent but NOT through lakonai.
function readUnfilteredSinks(isBuiltin) {
  const stats = readJson(statsPath(), {});
  return Object.entries(stats)
    .filter(([cmd]) => !isBuiltin(cmd))
    .map(([cmd, s]) => ({
      cmd,
      calls: s.count,
      raw: s.tokens,
      out: s.tokens,
      saved: 0,
      filtered: false,
      avgTokens: s.count ? Math.round(s.tokens / s.count) : 0,
    }))
    .filter((s) => s.avgTokens >= 200);
}

// Compute a 0-100 score: ratio of tokens lakonai saved vs total raw tokens seen.
function computeScore(logSinks) {
  const totalRaw = logSinks.reduce((a, s) => a + s.raw, 0);
  const totalSaved = logSinks.reduce((a, s) => a + s.saved, 0);
  if (!totalRaw) return null;
  return Math.round((totalSaved / totalRaw) * 100);
}

// Build the report text from both data sources.
function buildReport(isBuiltin) {
  const logSinks = readLogSinks();
  const unfilteredSinks = readUnfilteredSinks(isBuiltin);
  const score = computeScore(logSinks);

  const lines = ['# lakonai — token sink report', ''];

  if (score !== null) {
    lines.push(`**Score: ${score}/100** — ${fmt(logSinks.reduce((a, s) => a + s.saved, 0))} tok saved across ${logSinks.reduce((a, s) => a + s.calls, 0)} filtered commands`, '');
  }

  if (unfilteredSinks.length) {
    const top = unfilteredSinks.sort((a, b) => b.raw - a.raw).slice(0, TOP_SINKS);
    lines.push('## Unfiltered sinks (not going through lakonai)');
    lines.push('');
    lines.push('These commands ran through the agent unfiltered. Routing them through lakonai would save tokens automatically.');
    lines.push('');
    for (const s of top) {
      const perCall = fmt(s.avgTokens);
      lines.push(`- **${s.cmd}** — ${fmt(s.raw)} tok total, ~${perCall} tok/call, ${s.calls} calls`);
    }
    lines.push('');
    lines.push('These will be auto-filtered once lakonai confirms a pattern (auto-learn threshold: 3 calls, 300 tok/call avg).');
    lines.push('');
  }

  if (logSinks.length) {
    const inefficient = logSinks
      .filter((s) => s.raw > 0 && (s.saved / s.raw) < 0.3 && s.raw > 5000)
      .sort((a, b) => b.raw - a.raw)
      .slice(0, 3);

    if (inefficient.length) {
      lines.push('## Low-efficiency filters');
      lines.push('');
      lines.push('These commands go through lakonai but the filter is not saving much:');
      lines.push('');
      for (const s of inefficient) {
        const pct = Math.round((s.saved / s.raw) * 100);
        lines.push(`- **${s.cmd}** — only ${pct}% saved (${fmt(s.saved)} of ${fmt(s.raw)} tok)`);
      }
      lines.push('');
    }
  }

  if (!unfilteredSinks.length && !logSinks.length) {
    lines.push('No data yet. Run some commands through lakonai first.');
  }

  lines.push(`_Generated: ${new Date().toISOString()}_`);
  return lines.join('\n');
}

// Returns true if a new report was written (ran daily max).
function maybeWriteReport(isBuiltin, now = Date.now()) {
  if (process.env.LAKON_NO_LEARN === '1' || process.env.LAKON_NO_TRACK === '1') return false;

  const last = Number(readJson(stampPath(), { t: 0 }).t) || 0;
  if (last && now - last < REPORT_TTL_MS) return false;

  const report = buildReport(isBuiltin);
  writeFile(reportPath(), report);
  writeFile(stampPath(), JSON.stringify({ t: now }));
  writeFile(seenPath(), '0');
  return true;
}

// Returns a short summary to surface in session-start (≤3 lines).
// Returns null if already seen or no report exists.
function maybeGetUnseen() {
  try {
    const seen = fs.readFileSync(seenPath(), 'utf8').trim();
    if (seen === '1') return null;
    const report = fs.readFileSync(reportPath(), 'utf8');
    writeFile(seenPath(), '1');

    // Extract the score line + count of unfiltered sinks from the report.
    const scoreLine = report.split('\n').find((l) => l.startsWith('**Score:'));
    const unfilteredMatch = report.match(/## Unfiltered sinks[\s\S]*?^- \*\*(.+?)\*\*/m);
    const sinkCount = (report.match(/^- \*\*/gm) || []).length;

    const parts = [];
    if (scoreLine) parts.push(scoreLine.replace(/\*\*/g, ''));
    if (sinkCount > 0) parts.push(`${sinkCount} unfiltered sink${sinkCount > 1 ? 's' : ''} found — will be auto-filtered once threshold is reached.`);
    return parts.length ? parts.join(' ') : null;
  } catch {
    return null;
  }
}

module.exports = { maybeWriteReport, maybeGetUnseen, buildReport, computeScore, readLogSinks, readUnfilteredSinks, reportPath, seenPath, stampPath };
