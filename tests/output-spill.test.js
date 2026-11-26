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
    assert.equal(hook.extractText({ tool_response: { code: 200, result: 'c' } }), 'c');
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

describe('replaceText', () => {
  const D = 'lakonai: 4000 lines / 120KB parked in sandbox abc123';

  // The bug: a bare string came back for Bash and Claude Code rejected it with
  // "does not match Bash's output shape; using original output".
  test("Bash keeps its {stdout, stderr, interrupted, isImage} shape", () => {
    const r = { stdout: big, stderr: 'warn', interrupted: false, isImage: false };
    assert.deepEqual(hook.replaceText({ tool_response: r }, D), { ...r, stdout: D });
    assert.equal(r.stdout, big, 'original response is not mutated');
  });

  test('Read keeps {type, file:{filePath, content, ...}}', () => {
    const r = { type: 'text', file: { filePath: '/a', content: big, numLines: 4000 } };
    assert.deepEqual(hook.replaceText({ tool_response: r }, D), {
      type: 'text',
      file: { filePath: '/a', content: D, numLines: 4000 },
    });
  });

  test('Grep {content} and WebFetch {result} keep their other fields', () => {
    assert.deepEqual(hook.replaceText({ tool_response: { mode: 'content', content: big } }, D), {
      mode: 'content',
      content: D,
    });
    assert.deepEqual(hook.replaceText({ tool_response: { code: 200, result: big } }, D), {
      code: 200,
      result: D,
    });
  });

  test('string result stays a string', () => {
    assert.equal(hook.replaceText({ tool_response: big }, D), D);
    assert.equal(hook.replaceText({ tool_output: big }, D), D);
  });

  test('no single text field means no replacement, not a wrong shape', () => {
    assert.equal(hook.replaceText({ tool_response: { weird: 1 } }, D), null);
    assert.equal(hook.replaceText({ tool_response: { content: [{ type: 'text' }] } }, D), null);
    assert.equal(hook.replaceText({}, D), null);
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

describe('subagents: only Bash output is parked (unit)', () => {
  test('inside a subagent, non-Bash tools are left alone', () => {
    for (const toolName of ['Read', 'Grep', 'Glob', 'WebFetch', 'Task']) {
      assert.equal(hook.decide({ toolName, text: big, threshold: T, agentId: 'agent-1' }), null, toolName);
    }
  });

  test('inside a subagent, Bash output is still parked (Bash proves `lakonai peek` works)', () => {
    assert.ok(hook.decide({ toolName: 'Bash', text: big, threshold: T, agentId: 'agent-1' }));
  });

  test('empty agent_id behaves like the main agent', () => {
    assert.ok(hook.decide({ toolName: 'WebFetch', text: big, threshold: T, agentId: '' }));
  });
});

describe('subagents (E2E: the real hook process)', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const HOOK = path.join(__dirname, '..', 'src', 'hooks', 'output-spill.js');

  function run(payload) {
    return spawnSync('node', [HOOK], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, LAKON_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-spill-sub-')) },
    });
  }

  test('a WebFetch-only subagent keeps the full page', () => {
    const r = run({ tool_name: 'WebFetch', tool_response: { result: big }, agent_id: 'a1', agent_type: 'web-fetch' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('the main agent still gets the WebFetch digest', () => {
    const r = run({ tool_name: 'WebFetch', tool_response: { result: big } });
    const out = JSON.parse(r.stdout).hookSpecificOutput.updatedToolOutput;
    assert.match(out.result, /parked in sandbox/);
  });

  test('a subagent that ran Bash still gets the Bash digest', () => {
    const r = run({ tool_name: 'Bash', tool_input: { command: 'make' }, tool_response: { stdout: big, stderr: '' }, agent_id: 'a1' });
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.updatedToolOutput.stdout, /parked in sandbox/);
  });
});
