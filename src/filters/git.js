'use strict';

const { stripAnsi, truncateLines } = require('./utils');

const LOG_COMMIT_RE = /^commit\s+([0-9a-f]{7,40})/i;
const LOG_AUTHOR_RE = /^Author:\s+/i;
const LOG_DATE_RE = /^Date:\s+/i;
const STATUS_HEADER_RE = /^(On branch |Your branch |Untracked files:|Changes |\s*\(use "git )/;
const DIFF_INDEX_RE = /^(index [0-9a-f]+\.\.[0-9a-f]+|diff --git |---|\+\+\+|@@)/;

function filterLog(raw) {
  const text = stripAnsi(raw);
  const lines = text.split('\n');
  const out = [];
  let pendingHash = null;
  let captured = false;

  for (const line of lines) {
    const m = line.match(LOG_COMMIT_RE);
    if (m) {
      pendingHash = m[1].slice(0, 7);
      captured = false;
      continue;
    }
    if (LOG_AUTHOR_RE.test(line) || LOG_DATE_RE.test(line) || line.startsWith('Merge:')) continue;
    /* istanbul ignore next */
    if (pendingHash && !captured && line.trim() && !line.startsWith(' ')) continue;
    if (pendingHash && !captured && line.trim()) {
      out.push(`${pendingHash} ${line.trim()}`);
      captured = true;
      pendingHash = null;
    }
  }
  return truncateLines(out.join('\n'), 50);
}

function filterStatus(raw) {
  const text = stripAnsi(raw);
  const lines = text.split('\n');
  const changed = [];
  const untracked = [];
  let mode = null;

  for (const line of lines) {
    if (line.startsWith('Changes to be committed') || line.startsWith('Changes not staged')) {
      mode = 'changed';
      continue;
    }
    if (line.startsWith('Untracked files:')) {
      mode = 'untracked';
      continue;
    }
    if (STATUS_HEADER_RE.test(line)) continue;
    if (!line.trim()) continue;
    const cleaned = line.replace(/^\s+/, '').replace(/^\(use.*/, '').trim();
    /* istanbul ignore next */
    if (!cleaned) continue;
    if (mode === 'changed') changed.push(cleaned);
    else if (mode === 'untracked') untracked.push(cleaned);
  }

  const parts = [];
  if (changed.length) parts.push(`changed:\n${changed.join('\n')}`);
  if (untracked.length) parts.push(`untracked:\n${untracked.join('\n')}`);
  return parts.join('\n\n') || 'clean';
}

function filterDiff(raw) {
  const text = stripAnsi(raw);
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      out.push(line);
      continue;
    }
    if (DIFF_INDEX_RE.test(line) && !line.startsWith('@@')) continue;
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith('@@')) {
      out.push(line);
    }
  }
  return truncateLines(out.join('\n'), 120);
}

function filter(subcmd, raw) {
  switch (subcmd) {
    case 'log': return filterLog(raw);
    case 'status': return filterStatus(raw);
    case 'diff':
    case 'show': return filterDiff(raw);
    default: return raw;
  }
}

module.exports = { filter, filterLog, filterStatus, filterDiff };
