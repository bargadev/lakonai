'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function dataDir() {
  /* istanbul ignore next */
  return process.env.LAKON_HOME || path.join(os.homedir(), '.lakon');
}

function logPath() {
  return path.join(dataDir(), 'log.jsonl');
}

function record({ cmd, args, rawTokens, filteredTokens }) {
  if (process.env.LAKON_NO_TRACK === '1') return;
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const entry = {
      t: Date.now(),
      cmd,
      args: Array.isArray(args) ? args.slice(0, 4) : [],
      raw: rawTokens,
      out: filteredTokens,
      saved: Math.max(0, rawTokens - filteredTokens),
    };
    fs.appendFileSync(logPath(), JSON.stringify(entry) + '\n');
    /* istanbul ignore next */
  } catch {
    // never let tracking break a user command
  }
}

function readEntries() {
  try {
    const raw = fs.readFileSync(logPath(), 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isSessionEntry(e) {
  return e.cmd === 'session';
}

function aggregate(entries) {
  const filtered = entries.filter((e) => !isSessionEntry(e));
  const sum = (xs, k) => xs.reduce((a, e) => a + (e[k] || 0), 0);
  return {
    calls: filtered.length,
    raw: sum(filtered, 'raw'),
    out: sum(filtered, 'out'),
    saved: sum(filtered, 'saved'),
  };
}

function inWindow(entries, ms) {
  if (ms === Infinity) return entries;
  const cutoff = Date.now() - ms;
  return entries.filter((e) => e.t >= cutoff);
}

function byWindow(entries, ms) {
  return aggregate(inWindow(entries, ms));
}

function byCommand(entries) {
  const map = new Map();
  for (const e of entries) {
    if (isSessionEntry(e)) continue;
    const k = e.cmd || 'unknown';
    if (!map.has(k)) map.set(k, { cmd: k, calls: 0, raw: 0, out: 0, saved: 0 });
    const acc = map.get(k);
    acc.calls += 1;
    acc.raw += e.raw || 0;
    acc.out += e.out || 0;
    acc.saved += e.saved || 0;
  }
  return [...map.values()].sort((a, b) => b.saved - a.saved);
}

function pct(saved, raw) {
  if (!raw) return 0;
  return Math.round((saved / raw) * 100);
}

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function tok(n) {
  return fmt(n) + ' tok';
}

function useColor() {
  if (process.env.NO_COLOR) return false;
  if (process.env.LAKON_COLOR === '0') return false;
  if (process.env.LAKON_COLOR === '1') return true;
  return !!process.stdout.isTTY;
}

function paint(s, codes) {
  if (!useColor()) return s;
  return `\x1b[${codes}m${s}\x1b[0m`;
}
const dim = (s) => paint(s, '2');
const bold = (s) => paint(s, '1');
const green = (s) => paint(s, '32');

function pad(s, n) {
  s = String(s);
  /* istanbul ignore next */
  if (s.length >= n) return s;
  return s + ' '.repeat(n - s.length);
}

function report() {
  const entries = readEntries();
  if (!entries.length) {
    return 'lakonai: no usage recorded yet. Run a few commands through `lakonai` first.\n';
  }

  const all = byWindow(entries, Infinity);
  const lines = [
    `${bold('lakonai')} — saved ${green(tok(all.saved))} ${green(`(${pct(all.saved, all.raw)}% smaller)`)} across ${all.calls} commands`,
    '',
  ];

  for (const [label, ms] of [['today', DAY_MS], ['this week', WEEK_MS]]) {
    const a = byWindow(entries, ms);
    if (!a.calls) continue;
    lines.push(`  ${pad(label, 11)}${green(tok(a.saved))} saved  ${dim(`(${pct(a.saved, a.raw)}%)`)}`);
  }

  const top = byCommand(entries).slice(0, 5);
  if (top.length) {
    lines.push('');
    lines.push('  ' + dim('top: ') + top.map((c) => `${c.cmd} ${green(tok(c.saved))}`).join(dim(' · ')));
  }

  return lines.join('\n') + '\n';
}

function reset() {
  try { fs.unlinkSync(logPath()); return true; }
  catch { return false; }
}

module.exports = { record, report, reset, readEntries, logPath };
