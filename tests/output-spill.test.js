'use strict';

const assert = require('node:assert/strict');
const hook = require('../src/hooks/output-spill');

const big = Array.from({ length: 4000 }, (_, i) => `[build] step ${i} done`).join('\n');
const T = 2000;

describe('extractText', () => {
  test('plain string result', () => {
    assert.equal(hook.extractText({ tool_response: 'hello' }), 'hello');
  });

  test('Read-style {file:{content}}', () => {
    assert.equal(hook.extractText({ tool_response: { file: { content: 'body' } } }), 'body');
  });

  test('{content} and {stdout} shapes', () => {
    assert.equal(hook.extractText({ tool_response: { content: 'a' } }), 'a');
    assert.equal(hook.extractText({ tool_response: { stdout: 'b' } }), 'b');
  });

  test('falls back to tool_output when tool_response is absent', () => {
    assert.equal(hook.extractText({ tool_output: 'legacy' }), 'legacy');
  });

  test('unknown object shape is stringified rather than dropped', () => {
    assert.equal(hook.extractText({ tool_response: { weird: 1 } }), '{"weird":1}');
  });

  test('missing result is null, not a throw', () => {
    assert.equal(hook.extractText({}), null);
    assert.equal(hook.extractText({ tool_response: null }), null);
  });
});

describe('isAlreadyDigest', () => {
  test('recognises a digest bin/lakonai.js already produced', () => {
    assert.equal(
      hook.isAlreadyDigest('lakonai: 4000 lines / 120KB parked in sandbox abc123 — too big'),
      true
    );
  });

  test('ordinary output is not a digest', () => {
    assert.equal(hook.isAlreadyDigest('lakonai: something else'), false);
    assert.equal(hook.isAlreadyDigest(big), false);
  });
});

describe('decide', () => {
  test('spills big output from a spillable tool', () => {
    assert.ok(hook.decide({ toolName: 'Bash', text: big, threshold: T }));
    assert.ok(hook.decide({ toolName: 'Read', text: big, threshold: T }));
    assert.ok(hook.decide({ toolName: 'WebFetch', text: big, threshold: T }));
  });

  // The whole point: bash-rewrite only routes its 34-command allowlist, so an
  // unrouted command's output never reaches a filter. PostToolUse sees it anyway.
  test('catches output the PreToolUse rewrite can never reach', () => {
    assert.ok(hook.decide({ toolName: 'Bash', text: big, threshold: T }));
  });

  test('leaves small output alone', () => {
    assert.equal(hook.decide({ toolName: 'Bash', text: 'ok', threshold: T }), null);
  });

  test('ignores tools whose results are structural, not bulk', () => {
    assert.equal(hook.decide({ toolName: 'Edit', text: big, threshold: T }), null);
    assert.equal(hook.decide({ toolName: 'TodoWrite', text: big, threshold: T }), null);
  });

  test('never re-parks an existing digest', () => {
    const digest = 'lakonai: 4000 lines / 120KB parked in sandbox abc123 — too big for context, kept out.';
    assert.equal(hook.decide({ toolName: 'Bash', text: digest.padEnd(20000, ' x'), threshold: T }), null);
  });

  test('threshold 0 disables it entirely', () => {
    assert.equal(hook.decide({ toolName: 'Bash', text: big, threshold: 0 }), null);
  });

  test('empty or non-string output is ignored', () => {
    assert.equal(hook.decide({ toolName: 'Bash', text: '', threshold: T }), null);
    assert.equal(hook.decide({ toolName: 'Bash', text: null, threshold: T }), null);
  });
});

test('SPILLABLE_TOOLS covers the bulk-output tools and nothing structural', () => {
  for (const t of ['Bash', 'Read', 'Grep', 'Glob', 'WebFetch', 'Task']) {
    assert.ok(hook.SPILLABLE_TOOLS.has(t), `${t} should be spillable`);
  }
  for (const t of ['Edit', 'Write', 'TodoWrite']) {
    assert.ok(!hook.SPILLABLE_TOOLS.has(t), `${t} must not be spillable`);
  }
});
