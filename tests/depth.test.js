'use strict';

// Unit level: pure logic of the output-side answer budget. No subprocesses.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const depth = require('../src/depth');
const brevity = require('../src/proxy/brevity');
const promptDepth = require('../src/hooks/prompt-depth');
const stopHook = require('../src/hooks/stop-hook');
const tracking = require('../src/tracking');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-depth-'));
}

async function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) {
    prev[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

const inHome = (fn) => withEnv({ LAKON_HOME: freshHome(), LAKON_NO_BRIEF: undefined }, fn);

describe('depth — budgets', () => {
  test('known shapes have ascending budgets', () => {
    assert.ok(depth.BUDGETS.factual < depth.BUDGETS.explanation);
    assert.ok(depth.BUDGETS.explanation < depth.BUDGETS.plan);
  });

  test('budgetFor resolves known kinds and falls back for unknown', () => {
    assert.equal(depth.budgetFor('factual'), depth.BUDGETS.factual);
    assert.equal(depth.budgetFor('plan'), depth.BUDGETS.plan);
    assert.equal(depth.budgetFor('nonsense'), depth.DEFAULT_BUDGET);
    assert.equal(depth.budgetFor(undefined), depth.DEFAULT_BUDGET);
  });
});

describe('depth — trigger detection', () => {
  const deepPrompts = [
    'detalha isso', 'me detalhe', 'aprofunda um pouco', 'explica melhor',
    'quero mais detalhes', 'me conta por extenso', 'sem resumir por favor',
    'be verbose', 'explain in full', 'deep dive please', 'walk me through it',
    'give me more details', 'explain fully', "don't summarize",
  ];
  for (const p of deepPrompts) {
    test(`wantsDepth("${p}")`, () => assert.equal(depth.wantsDepth(p), true));
  }

  const briefPrompts = [
    'resume isso', 'mais curto', 'seja objetivo', 'sê objetiva',
    'briefly please', 'shorter', 'tldr', 'tl;dr',
  ];
  for (const p of briefPrompts) {
    test(`wantsBrief("${p}")`, () => assert.equal(depth.wantsBrief(p), true));
  }

  test('a plain question triggers neither', () => {
    assert.equal(depth.wantsDepth('como isso funciona?'), false);
    assert.equal(depth.wantsBrief('como isso funciona?'), false);
  });

  test('non-string input is safe', () => {
    for (const v of [undefined, null, 42, {}, []]) {
      assert.equal(depth.wantsDepth(v), false);
      assert.equal(depth.wantsBrief(v), false);
    }
  });
});

describe('depth — state file', () => {
  test('readState returns an empty shape when the file is missing', async () => {
    await inHome(() => {
      assert.deepEqual(depth.readState(), { sessions: {} });
    });
  });

  test('readState survives malformed and unexpected contents', async () => {
    await inHome(() => {
      fs.mkdirSync(path.dirname(depth.statePath()), { recursive: true });
      for (const bad of ['not json{', 'null', '[]', '{"other":1}', '"str"']) {
        fs.writeFileSync(depth.statePath(), bad);
        assert.deepEqual(depth.readState(), { sessions: {} });
      }
    });
  });

  test('writeState round-trips', async () => {
    await inHome(() => {
      assert.equal(depth.writeState({ sessions: { a: { turns: 1, t: Date.now() } } }), true);
      assert.equal(Object.keys(depth.readState().sessions).length, 1);
    });
  });

  test('writeState reports failure instead of throwing when the path is unusable', async () => {
    // A regular file standing where the data directory should be: mkdirSync
    // raises ENOTDIR. Losing a brevity flag must never break the hook.
    const blocker = path.join(freshHome(), 'not-a-dir');
    fs.writeFileSync(blocker, 'x');
    await withEnv({ LAKON_HOME: path.join(blocker, 'inside') }, () => {
      assert.equal(depth.writeState({ sessions: {} }), false);
    });
  });

  test('grant and revoke stay quiet when the state file cannot be written', async () => {
    const blocker = path.join(freshHome(), 'not-a-dir');
    fs.writeFileSync(blocker, 'x');
    await withEnv({ LAKON_HOME: path.join(blocker, 'inside') }, () => {
      assert.doesNotThrow(() => depth.grantDepth('s1'));
      assert.equal(depth.depthActive('s1'), false, 'an unwritable grant simply never takes effect');
      assert.doesNotThrow(() => depth.revokeDepth('s1'));
    });
  });

  test('prune drops expired and malformed entries, keeps fresh ones', () => {
    const now = Date.now();
    const state = {
      sessions: {
        fresh: { turns: 1, t: now },
        old: { turns: 1, t: now - depth.TTL_MS - 1 },
        noTime: { turns: 1 },
        falsy: null,
      },
    };
    const pruned = depth.prune(state, now);
    assert.deepEqual(Object.keys(pruned.sessions), ['fresh']);
  });
});

describe('depth — grant lifecycle', () => {
  test('a grant is active then consumed exactly once', async () => {
    await inHome(() => {
      assert.equal(depth.depthActive('s1'), false);
      depth.grantDepth('s1');
      assert.equal(depth.depthActive('s1'), true);
      assert.equal(depth.consumeDepth('s1'), true);
      assert.equal(depth.depthActive('s1'), false);
      assert.equal(depth.consumeDepth('s1'), false);
    });
  });

  test('a multi-turn grant survives the first consume', async () => {
    await inHome(() => {
      depth.grantDepth('s1', 2);
      assert.equal(depth.consumeDepth('s1'), true);
      assert.equal(depth.depthActive('s1'), true);
      assert.equal(depth.consumeDepth('s1'), true);
      assert.equal(depth.depthActive('s1'), false);
    });
  });

  test('turns is clamped to at least one', async () => {
    await inHome(() => {
      depth.grantDepth('s1', 0);
      assert.equal(depth.depthActive('s1'), true);
      depth.revokeDepth('s1');
      depth.grantDepth('s1', -5);
      assert.equal(depth.depthActive('s1'), true);
    });
  });

  test('a global grant is honoured by any session and consumable there', async () => {
    await inHome(() => {
      depth.grantDepth(null);
      assert.equal(depth.depthActive('whatever'), true);
      assert.equal(depth.consumeDepth('whatever'), true);
      assert.equal(depth.depthActive('whatever'), false);
    });
  });

  test('revoke clears both the session grant and the global one', async () => {
    await inHome(() => {
      assert.equal(depth.revokeDepth('s1'), false);
      depth.grantDepth('s1');
      depth.grantDepth(null);
      assert.equal(depth.revokeDepth('s1'), true);
      assert.equal(depth.depthActive('s1'), false);
      assert.equal(depth.depthActive(null), false);
    });
  });

  test('an expired grant is not active and cannot be consumed', async () => {
    await inHome(() => {
      depth.writeState({ sessions: { s1: { turns: 1, t: Date.now() - depth.TTL_MS - 1 } } });
      assert.equal(depth.depthActive('s1'), false);
      assert.equal(depth.consumeDepth('s1'), false);
    });
  });

  test('a zero-turn or timeless entry is not active', async () => {
    await inHome(() => {
      depth.writeState({ sessions: { s1: { turns: 0, t: Date.now() } } });
      assert.equal(depth.depthActive('s1'), false);
      depth.writeState({ sessions: { s1: { turns: 1 } } });
      assert.equal(depth.depthActive('s1'), false);
    });
  });

  test('an entry with no turn count is unconsumable', async () => {
    await inHome(() => {
      // Survives prune (its timestamp is valid) but carries no turns to spend.
      depth.writeState({ sessions: { s1: { t: Date.now() } } });
      assert.equal(depth.consumeDepth('s1'), false);
      assert.equal(depth.depthActive('s1'), false);
    });
  });

  test('candidateKeys pairs the session with the global key', () => {
    assert.deepEqual(depth.candidateKeys('abc'), ['abc', depth.GLOBAL_KEY]);
    assert.deepEqual(depth.candidateKeys(null), [depth.GLOBAL_KEY]);
    assert.deepEqual(depth.candidateKeys(depth.GLOBAL_KEY), [depth.GLOBAL_KEY]);
  });
});

describe('depth — injected text', () => {
  test('the brief reminder names every budget and stays small', () => {
    const r = depth.briefReminder();
    assert.match(r, /lakonai brief mode/);
    assert.ok(r.includes(String(depth.BUDGETS.factual)));
    assert.ok(r.includes(String(depth.BUDGETS.explanation)));
    assert.ok(r.includes(String(depth.BUDGETS.plan)));
    // It is paid on every turn — a bloated reminder would defeat its own point.
    assert.ok(r.split('\n').length <= 8, 'reminder must stay under 8 lines');
    assert.ok(r.length < 500, 'reminder must stay under 500 chars');
  });

  test('the depth notice says the grant is single-use', () => {
    assert.match(depth.depthNotice(), /depth mode/);
    assert.match(depth.depthNotice(), /next turn/);
  });
});

describe('brevity — system prompt injection', () => {
  test('contract carries the marker used for idempotency', () => {
    assert.ok(brevity.contract().includes(brevity.MARKER));
  });

  test('appends a trailing block to an array system prompt', () => {
    const body = { system: [{ type: 'text', text: 'You are Claude.' }], messages: [] };
    const { body: out, injected } = brevity.injectBrevity(body);
    assert.equal(injected, true);
    assert.equal(out.system.length, 2);
    // The original block must be untouched — it holds the cache breakpoint.
    assert.deepEqual(out.system[0], { type: 'text', text: 'You are Claude.' });
    assert.equal(out.system[1].type, 'text');
    assert.ok(out.system[1].text.includes(brevity.MARKER));
  });

  test('appends to a string system prompt without losing the original', () => {
    const { body: out, injected } = brevity.injectBrevity({ system: 'base prompt' });
    assert.equal(injected, true);
    assert.ok(out.system.startsWith('base prompt'));
    assert.ok(out.system.includes(brevity.MARKER));
  });

  test('sets the system prompt when there is none', () => {
    for (const body of [{ messages: [] }, { system: null, messages: [] }]) {
      const { body: out, injected } = brevity.injectBrevity(body);
      assert.equal(injected, true);
      assert.equal(out.system, brevity.contract());
    }
  });

  test('is idempotent across both shapes', () => {
    const once = brevity.injectBrevity({ system: [{ type: 'text', text: 'x' }] }).body;
    assert.equal(brevity.injectBrevity(once).injected, false);
    const str = brevity.injectBrevity({ system: 'x' }).body;
    assert.equal(brevity.injectBrevity(str).injected, false);
  });

  test('detects the marker in a plain-string array block', () => {
    assert.equal(brevity.hasContract([`prefix ${brevity.MARKER} suffix`]), true);
    assert.equal(brevity.hasContract(['nothing here']), false);
    assert.equal(brevity.hasContract([{ type: 'text' }]), false);
    assert.equal(brevity.hasContract(42), false);
  });

  test('leaves an unknown system shape alone', () => {
    const body = { system: 42 };
    const { body: out, injected } = brevity.injectBrevity(body);
    assert.equal(injected, false);
    assert.equal(out, body);
  });

  test('does nothing when inactive or handed a non-object', () => {
    const body = { system: 'x' };
    assert.equal(brevity.injectBrevity(body, { active: false }).body, body);
    assert.equal(brevity.injectBrevity(null).injected, false);
    assert.equal(brevity.injectBrevity('str').injected, false);
  });

  test('shouldInject respects the kill switch and a pending grant', async () => {
    await inHome(() => {
      assert.equal(brevity.shouldInject(), true);
      depth.grantDepth(null);
      assert.equal(brevity.shouldInject(), false, 'a depth grant suppresses injection');
      depth.revokeDepth(null);
      assert.equal(brevity.shouldInject(), true);
    });
    await withEnv({ LAKON_HOME: freshHome(), LAKON_NO_BRIEF: '1' }, () => {
      assert.equal(brevity.shouldInject(), false);
    });
  });
});

describe('prompt-depth hook — decide()', () => {
  test('a plain prompt runs in brief mode with the reminder attached', async () => {
    await inHome(() => {
      const d = promptDepth.decide({ sessionId: 's1', prompt: 'como isso funciona?' });
      assert.equal(d.mode, 'brief');
      assert.equal(d.context, depth.briefReminder());
    });
  });

  test('a depth request grants and immediately spends one turn', async () => {
    await inHome(() => {
      assert.equal(promptDepth.decide({ sessionId: 's1', prompt: 'detalha isso' }).mode, 'depth');
      assert.equal(promptDepth.decide({ sessionId: 's1', prompt: 'e agora?' }).mode, 'brief');
    });
  });

  test('a standing grant is honoured on the next turn', async () => {
    await inHome(() => {
      depth.grantDepth('s1', 1);
      assert.equal(promptDepth.decide({ sessionId: 's1', prompt: 'ok' }).mode, 'depth');
      assert.equal(promptDepth.decide({ sessionId: 's1', prompt: 'ok' }).mode, 'brief');
    });
  });

  test('a brief request cancels a pending grant', async () => {
    await inHome(() => {
      depth.grantDepth('s1', 3);
      const d = promptDepth.decide({ sessionId: 's1', prompt: 'na verdade resume' });
      assert.equal(d.mode, 'brief');
      assert.equal(depth.depthActive('s1'), false);
    });
  });

  test('a missing session id still works via the global key', async () => {
    await inHome(() => {
      assert.equal(promptDepth.decide({ prompt: 'aprofunda' }).mode, 'depth');
    });
  });

  test('the kill switch turns the hook into a no-op', async () => {
    await withEnv({ LAKON_HOME: freshHome(), LAKON_NO_BRIEF: '1' }, () => {
      const d = promptDepth.decide({ sessionId: 's1', prompt: 'detalha' });
      assert.equal(d.mode, 'off');
      assert.equal(d.context, null);
    });
  });
});

describe('prompt-depth hook — buildResponse()', () => {
  test('wraps context in the UserPromptSubmit envelope', () => {
    const r = promptDepth.buildResponse({ mode: 'brief', context: 'hello' });
    assert.equal(r.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.equal(r.hookSpecificOutput.additionalContext, 'hello');
  });

  test('returns null when there is nothing to inject', () => {
    assert.equal(promptDepth.buildResponse({ mode: 'off', context: null }), null);
  });
});

describe('stop-hook — response shape', () => {
  test('proseLines ignores fenced code, tables and blank lines', () => {
    const text = [
      'first line',
      '',
      '```js',
      'const a = 1;',
      'const b = 2;',
      '```',
      '| col |',
      '| --- |',
      'second line',
      '~~~',
      'tilde fence content',
      '~~~',
      'third line',
    ].join('\n');
    assert.equal(stopHook.proseLines(text), 3);
  });

  test('proseLines is safe on empty and non-string input', () => {
    for (const v of ['', undefined, null, 42, {}]) assert.equal(stopHook.proseLines(v), 0);
  });

  test('extractLastAssistantText finds the newest assistant text block', () => {
    const p = path.join(freshHome(), 't.jsonl');
    fs.writeFileSync(p, [
      JSON.stringify({ message: { role: 'user', content: 'hi' } }),
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'older' }] } }),
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'newer' }] } }),
    ].join('\n') + '\n');
    assert.equal(stopHook.extractLastAssistantText(p), 'newer');
  });

  test('extractLastAssistantText handles string content, tool-only turns and junk lines', () => {
    const p = path.join(freshHome(), 't.jsonl');
    fs.writeFileSync(p, [
      JSON.stringify({ message: { role: 'assistant', content: 'plain string' } }),
      'not json at all',
      JSON.stringify({ noMessage: true }),
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x' }] } }),
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: '   ' }] } }),
    ].join('\n') + '\n');
    assert.equal(stopHook.extractLastAssistantText(p), 'plain string');
  });

  test('extractLastAssistantText skips an assistant turn with an unusable content shape', () => {
    const p = path.join(freshHome(), 't.jsonl');
    fs.writeFileSync(p, [
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'older but real' }] } }),
      JSON.stringify({ message: { role: 'assistant', content: { unexpected: true } } }),
      JSON.stringify({ message: { role: 'assistant' } }),
    ].join('\n') + '\n');
    assert.equal(stopHook.extractLastAssistantText(p), 'older but real');
  });

  test('extractLastAssistantText returns null for a missing file or no assistant turn', () => {
    assert.equal(stopHook.extractLastAssistantText('/definitely/not/here.jsonl'), null);
    const p = path.join(freshHome(), 'u.jsonl');
    fs.writeFileSync(p, JSON.stringify({ message: { role: 'user', content: 'hi' } }) + '\n');
    assert.equal(stopHook.extractLastAssistantText(p), null);
  });

  test('responseShape counts prose lines and raw chars', () => {
    const p = path.join(freshHome(), 't.jsonl');
    const text = 'a\nb\n```\nx\n```';
    fs.writeFileSync(p, JSON.stringify({
      message: { role: 'assistant', content: [{ type: 'text', text }] },
    }) + '\n');
    assert.deepEqual(stopHook.responseShape(p), { out_lines: 2, out_chars: text.length });
  });

  test('responseShape returns null when there is no assistant text', () => {
    assert.equal(stopHook.responseShape('/definitely/not/here.jsonl'), null);
  });
});

describe('tracking — responseStats', () => {
  test('aggregates session turns and flags the over-budget ones', () => {
    const s = tracking.responseStats([
      { cmd: 'session', out_lines: 4, out_tokens: 100 },
      { cmd: 'session', out_lines: 30, out_tokens: 900 },
      { cmd: 'git', raw: 10, out: 5, saved: 5 },
    ]);
    assert.equal(s.turns, 2);
    assert.equal(s.lines, 34);
    assert.equal(s.tokens, 1000);
    assert.equal(s.avgLines, 17);
    assert.equal(s.overBudget, 1);
  });

  test('missing out_tokens counts as zero', () => {
    const s = tracking.responseStats([{ cmd: 'session', out_lines: 2 }]);
    assert.equal(s.tokens, 0);
    assert.equal(s.overBudget, 0);
  });

  test('returns null without instrumented session entries', () => {
    assert.equal(tracking.responseStats([]), null);
    assert.equal(tracking.responseStats([{ cmd: 'git', raw: 1 }]), null);
    assert.equal(tracking.responseStats([{ cmd: 'session', out_tokens: 5 }]), null);
  });
});
