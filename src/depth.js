'use strict';

// Output-side brevity: lakonai's filters shrink what the model *reads*; this
// module shrinks what it *writes*. The contract is summary-first — every answer
// stays inside a line budget unless the user explicitly asks to go deeper.
//
// Depth is opt-in and consumable: one request for detail buys one long answer,
// not a permanently verbose session.

const fs = require('fs');
const path = require('path');
const { homedir } = require('./install/paths');

function dataDir() {
  /* istanbul ignore next -- LAKON_HOME is always set under test */
  return process.env.LAKON_HOME || path.join(homedir(), '.lakon');
}

function statePath() {
  return path.join(dataDir(), 'depth.json');
}

// A granted depth token outlives a couple of turns but not a whole day — a
// stale flag would silently turn brevity off for a session that never asked.
const TTL_MS = 2 * 60 * 60 * 1000;

// Line budgets by answer shape. These are caps on prose lines, never on code
// blocks, diffs or verbatim output (rule 6 outranks rule 8).
const BUDGETS = {
  factual: 3,
  explanation: 10,
  plan: 20,
  review: 20,
};

const DEFAULT_BUDGET = BUDGETS.explanation;

function budgetFor(kind) {
  return BUDGETS[kind] || DEFAULT_BUDGET;
}

// Phrases that mean "open it up". Portuguese and English, since the rule block
// ships to users in both.
const DEPTH_TRIGGERS = [
  /\bdetalh(a|e|ar|es|ando)\b/i,
  /\baprofund(a|e|ar|ando)\b/i,
  /\bexplica(\s+melhor|\s+direito|\s+tudo)\b/i,
  /\bmais\s+(detalhes?|contexto|profundidade)\b/i,
  /\bpor\s+extenso\b/i,
  /\bsem\s+resumir\b/i,
  /\b(be\s+)?verbose\b/i,
  /\bin\s+(full|detail)\b/i,
  /\bdeep\s*dive\b/i,
  /\bwalk\s+me\s+through\b/i,
  /\bmore\s+detail(s)?\b/i,
  /\bexplain\s+(fully|in\s+depth)\b/i,
  /\bdon'?t\s+summarize\b/i,
];

// Phrases that mean "back to short" — an explicit way out of a depth grant.
const BRIEF_TRIGGERS = [
  /\bresum(e|a|ido|idamente)\b/i,
  /\bmais\s+curto\b/i,
  /\bs(e|ê|eja)\s+objetiv[oa]\b/i,
  /\bbrief(ly)?\b/i,
  /\bshorter\b/i,
  /\btl;?dr\b/i,
];

function matchesAny(patterns, text) {
  if (!text || typeof text !== 'string') return false;
  return patterns.some((re) => re.test(text));
}

function wantsDepth(text) {
  return matchesAny(DEPTH_TRIGGERS, text);
}

function wantsBrief(text) {
  return matchesAny(BRIEF_TRIGGERS, text);
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions) return { sessions: {} };
    return parsed;
  } catch {
    return { sessions: {} };
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state), 'utf8');
    return true;
    /* istanbul ignore next -- never let a flag write break a hook */
  } catch {
    return false;
  }
}

// Drop expired grants so the file cannot grow without bound across sessions.
function prune(state, now = Date.now()) {
  for (const [id, entry] of Object.entries(state.sessions)) {
    if (!entry || typeof entry.t !== 'number' || now - entry.t > TTL_MS) {
      delete state.sessions[id];
    }
  }
  return state;
}

const GLOBAL_KEY = 'default';

function sessionKey(sessionId) {
  return sessionId || GLOBAL_KEY;
}

// A grant can be addressed to this session, or made globally by the CLI
// (`lakonai depth on`) — the slash command has no way to learn the session id,
// so it writes the global key and any session honours it.
function candidateKeys(sessionId) {
  const own = sessionKey(sessionId);
  return own === GLOBAL_KEY ? [GLOBAL_KEY] : [own, GLOBAL_KEY];
}

// Grant depth for the next `turns` answers in this session.
function grantDepth(sessionId, turns = 1) {
  const state = prune(readState());
  state.sessions[sessionKey(sessionId)] = { turns: Math.max(1, turns), t: Date.now() };
  writeState(state);
  return turns;
}

// Revoking clears the session's own grant *and* the global one — "resume isso"
// must not leave a CLI grant standing behind it.
function revokeDepth(sessionId) {
  const state = prune(readState());
  let had = false;
  for (const key of candidateKeys(sessionId)) {
    if (state.sessions[key]) had = true;
    delete state.sessions[key];
  }
  writeState(state);
  return had;
}

// Is depth active right now? Read-only — does not spend the grant.
function depthActive(sessionId, now = Date.now()) {
  const state = readState();
  return candidateKeys(sessionId).some((key) => {
    const entry = state.sessions[key];
    if (!entry || typeof entry.t !== 'number') return false;
    if (now - entry.t > TTL_MS) return false;
    return (entry.turns || 0) > 0;
  });
}

// Spend one turn of the grant. Returns true if this turn is allowed to be long.
function consumeDepth(sessionId) {
  const state = prune(readState());
  for (const key of candidateKeys(sessionId)) {
    const entry = state.sessions[key];
    if (!entry || (entry.turns || 0) <= 0) continue;
    entry.turns -= 1;
    if (entry.turns <= 0) delete state.sessions[key];
    writeState(state);
    return true;
  }
  return false;
}

// The per-turn reminder injected into context. Deliberately tiny — it is paid
// on every single turn, so spending 40 lines to ask for brevity would be
// self-defeating.
function briefReminder() {
  return [
    'lakonai brief mode — answer budget:',
    `  factual ≤${BUDGETS.factual} lines · explanation ≤${BUDGETS.explanation} · plan/review ≤${BUDGETS.plan}`,
    '  Summary first. Depth only when asked.',
    '  Code, diffs, identifiers and verbatim output do not count and are never truncated.',
    '  Cut something the user may want? End with one line: → ask "detalha" to expand.',
  ].join('\n');
}

function depthNotice() {
  return 'lakonai depth mode — this one answer may run long. Reverts to brief next turn.';
}

module.exports = {
  BUDGETS,
  GLOBAL_KEY,
  candidateKeys,
  DEFAULT_BUDGET,
  DEPTH_TRIGGERS,
  BRIEF_TRIGGERS,
  TTL_MS,
  budgetFor,
  wantsDepth,
  wantsBrief,
  grantDepth,
  revokeDepth,
  depthActive,
  consumeDepth,
  readState,
  writeState,
  prune,
  statePath,
  briefReminder,
  depthNotice,
};
