'use strict';

// Proxy-side half of output brevity.
//
// The UserPromptSubmit hook only exists inside Claude Code. Every other client
// that speaks the Messages API through this proxy (Codex, Cursor, a raw SDK
// script) gets the contract here instead, appended to the system prompt.
//
// Appended as a NEW trailing block, never by editing an existing one: the
// existing blocks carry the cache breakpoints, and rewriting them would
// invalidate the prompt cache on every request — spending far more tokens than
// brevity saves.

const depth = require('../depth');

const MARKER = 'lakonai brief mode';

function contract() {
  return depth.briefReminder();
}

// Already injected? Also catches the rule block a user installed into their own
// system prompt, so we never state the contract twice.
function hasContract(system) {
  if (typeof system === 'string') return system.includes(MARKER);
  if (Array.isArray(system)) {
    return system.some((b) => typeof b === 'string' ? b.includes(MARKER) : String(b && b.text || '').includes(MARKER));
  }
  return false;
}

// Append the brevity contract to a request body's system prompt.
// Returns { body, injected } — body is the same object reference when untouched.
function injectBrevity(body, { active = true } = {}) {
  if (!active) return { body, injected: false };
  if (!body || typeof body !== 'object') return { body, injected: false };
  if (hasContract(body.system)) return { body, injected: false };

  const text = contract();

  if (typeof body.system === 'string') {
    return { body: { ...body, system: `${body.system}\n\n${text}` }, injected: true };
  }
  if (Array.isArray(body.system)) {
    return { body: { ...body, system: [...body.system, { type: 'text', text }] }, injected: true };
  }
  if (body.system === undefined || body.system === null) {
    return { body: { ...body, system: text }, injected: true };
  }
  // Unknown shape — leave it alone rather than risk a malformed request.
  return { body, injected: false };
}

// Whether the proxy should inject right now. A depth grant suppresses it so an
// explicit "detalha" is not overridden by the proxy a moment later.
function shouldInject() {
  if (process.env.LAKON_NO_BRIEF === '1') return false;
  return !depth.depthActive(null);
}

module.exports = { injectBrevity, hasContract, contract, shouldInject, MARKER };
