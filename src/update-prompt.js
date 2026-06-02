'use strict';

// Decide how to surface a pending update, oh-my-zsh style. The interactive
// "Update now? [Y/n]" prompt is only safe at a human TTY — never on the filter
// path (would block a pipe) or inside agent hooks (no human to answer). When not
// interactive (or snoozed/opted-out) we fall back to the passive stderr notice.
//
// Pure decision function; the readline + spawn live in bin/lakonai.js.

// Returns 'prompt' (ask Y/n), 'notice' (passive line), or 'none'.
function decideUpdateAction({ update, ttyIn, ttyOut, disabled, snoozeUntil = 0, now = 0 }) {
  if (!update || !update.available) return 'none';
  if (disabled || !ttyIn || !ttyOut) return 'notice';
  if (now < snoozeUntil) return 'notice';
  return 'prompt';
}

const SNOOZE_MS = 24 * 60 * 60 * 1000; // after a "no", don't re-ask for a day

module.exports = { decideUpdateAction, SNOOZE_MS };
