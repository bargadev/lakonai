'use strict';

const assert = require('node:assert/strict');
const { decideUpdateAction, SNOOZE_MS } = require('../src/update-prompt');

const UP = { available: true, latest: '1.0.0', current: '0.9.0' };

test('none when there is no update', () => {
  assert.equal(decideUpdateAction({ update: null, ttyIn: true, ttyOut: true }), 'none');
  assert.equal(decideUpdateAction({ update: { available: false }, ttyIn: true, ttyOut: true }), 'none');
});

test('prompt at an interactive TTY', () => {
  assert.equal(
    decideUpdateAction({ update: UP, ttyIn: true, ttyOut: true, disabled: false, snoozeUntil: 0, now: 1 }),
    'prompt'
  );
});

test('notice (not prompt) when not a TTY', () => {
  assert.equal(decideUpdateAction({ update: UP, ttyIn: false, ttyOut: true, now: 1 }), 'notice');
  assert.equal(decideUpdateAction({ update: UP, ttyIn: true, ttyOut: false, now: 1 }), 'notice');
});

test('notice when opted out (LAKON_NO_AUTOUPDATE)', () => {
  assert.equal(decideUpdateAction({ update: UP, ttyIn: true, ttyOut: true, disabled: true, now: 1 }), 'notice');
});

test('notice while snoozed, prompt again after the snooze', () => {
  const now = 1_000_000;
  assert.equal(decideUpdateAction({ update: UP, ttyIn: true, ttyOut: true, snoozeUntil: now + SNOOZE_MS, now }), 'notice');
  assert.equal(decideUpdateAction({ update: UP, ttyIn: true, ttyOut: true, snoozeUntil: now, now: now + 1 }), 'prompt');
});
