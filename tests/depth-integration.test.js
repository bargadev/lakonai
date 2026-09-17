'use strict';

// Integration level: the answer budget wired to real I/O — a real depth.json on
// disk, a real transcript file, a real HTTP proxy in front of a real upstream,
// and the real command installer. No mocks on I/O boundaries.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const depth = require('../src/depth');
const brevity = require('../src/proxy/brevity');
const promptDepth = require('../src/hooks/prompt-depth');
const stopHook = require('../src/hooks/stop-hook');
const tracking = require('../src/tracking');
const { createServer } = require('../src/proxy/server');
const { installCommands, uninstallCommands, commandsDir } = require('../src/install/claude-commands');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-depth-int-'));
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

// ─── depth state on a real filesystem ───────────────────────────────────────

describe('integration — depth state round-trips through the filesystem', () => {
  test('a grant is written to depth.json and read back by a separate call', async () => {
    await inHome(() => {
      depth.grantDepth('sess-A', 1);

      const raw = JSON.parse(fs.readFileSync(depth.statePath(), 'utf8'));
      assert.ok(raw.sessions['sess-A'], 'the session key is persisted');
      assert.equal(raw.sessions['sess-A'].turns, 1);
      assert.equal(typeof raw.sessions['sess-A'].t, 'number');

      assert.equal(depth.depthActive('sess-A'), true);
      assert.equal(depth.consumeDepth('sess-A'), true);

      const after = JSON.parse(fs.readFileSync(depth.statePath(), 'utf8'));
      assert.equal(after.sessions['sess-A'], undefined, 'a spent grant is removed from disk');
    });
  });

  test('sessions do not leak into each other', async () => {
    await inHome(() => {
      depth.grantDepth('sess-A', 1);
      assert.equal(depth.depthActive('sess-B'), false, 'B must not see A grant');
      assert.equal(depth.consumeDepth('sess-B'), false);
      assert.equal(depth.depthActive('sess-A'), true, 'B must not spend A grant');
    });
  });

  test('expired grants are pruned from the file on the next write', async () => {
    await inHome(() => {
      depth.writeState({
        sessions: {
          stale: { turns: 1, t: Date.now() - depth.TTL_MS - 1000 },
          live: { turns: 1, t: Date.now() },
        },
      });
      depth.grantDepth('fresh', 1);
      const raw = JSON.parse(fs.readFileSync(depth.statePath(), 'utf8'));
      assert.deepEqual(Object.keys(raw.sessions).sort(), ['fresh', 'live']);
    });
  });

  test('the state directory is created when it does not exist yet', async () => {
    const home = path.join(freshHome(), 'nested', 'not-yet');
    await withEnv({ LAKON_HOME: home, LAKON_NO_BRIEF: undefined }, () => {
      assert.equal(fs.existsSync(home), false);
      depth.grantDepth('s', 1);
      assert.equal(fs.existsSync(depth.statePath()), true);
    });
  });
});

// ─── the hook driving that state across turns ───────────────────────────────

describe('integration — prompt-depth across a sequence of turns', () => {
  test('brief → depth on request → brief again, all persisted', async () => {
    await inHome(() => {
      const turn = (prompt) => promptDepth.decide({ sessionId: 'seq', prompt });

      assert.equal(turn('o que é isso?').mode, 'brief');
      assert.equal(turn('e isso aqui?').mode, 'brief');
      assert.equal(turn('detalha melhor').mode, 'depth');
      assert.equal(turn('ok, e agora?').mode, 'brief');

      // Nothing is left behind on disk once the grant is spent.
      const raw = JSON.parse(fs.readFileSync(depth.statePath(), 'utf8'));
      assert.deepEqual(raw.sessions, {});
    });
  });

  test('the injected context is a valid UserPromptSubmit payload', async () => {
    await inHome(() => {
      const decision = promptDepth.decide({ sessionId: 'seq', prompt: 'qual o erro?' });
      const payload = promptDepth.buildResponse(decision);
      // Must survive the JSON round-trip the hook protocol performs.
      const parsed = JSON.parse(JSON.stringify(payload));
      assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
      assert.ok(parsed.hookSpecificOutput.additionalContext.includes('brief mode'));
    });
  });

  test('a CLI-issued global grant is honoured by a hook turn', async () => {
    await inHome(() => {
      // What `lakonai depth on` writes: the global key, no session id.
      depth.grantDepth(null, 1);
      assert.equal(promptDepth.decide({ sessionId: 'unknown-session', prompt: 'vai' }).mode, 'depth');
      assert.equal(promptDepth.decide({ sessionId: 'unknown-session', prompt: 'vai' }).mode, 'brief');
    });
  });
});

// ─── the real proxy, end to end over HTTP ───────────────────────────────────

describe('integration — proxy injects the contract over real HTTP', () => {
  let upstream;
  let upstreamPort;
  let received;

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try { received = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { received = null; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    upstreamPort = upstream.address().port;
  });

  afterAll(async () => {
    await new Promise((r) => upstream.close(r));
  });

  // Drive a request through the real proxy server and return what upstream saw.
  async function throughProxy(body, env = {}) {
    return withEnv({ LAKON_HOME: freshHome(), LAKON_NO_BRIEF: undefined, ...env }, async () => {
      const proxy = createServer(0, { host: '127.0.0.1', port: upstreamPort, protocol: 'http' });
      const port = await new Promise((r) => proxy.listen(0, '127.0.0.1', () => r(proxy.address().port)));
      received = null;
      try {
        await new Promise((resolve, reject) => {
          const payload = JSON.stringify(body);
          const req = http.request(
            {
              hostname: '127.0.0.1', port, path: '/v1/messages', method: 'POST',
              headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
            },
            (res) => { res.resume(); res.on('end', resolve); }
          );
          req.on('error', reject);
          req.write(payload);
          req.end();
        });
      } finally {
        await new Promise((r) => proxy.close(r));
      }
      return received;
    });
  }

  test('the contract reaches upstream as a trailing system block', async () => {
    const seen = await throughProxy({
      model: 'claude-opus-5',
      system: [{ type: 'text', text: 'You are a helpful assistant.' }],
      messages: [{ role: 'user', content: 'oi' }],
    });
    assert.ok(seen, 'upstream received a parseable body');
    assert.equal(seen.system.length, 2);
    assert.equal(seen.system[0].text, 'You are a helpful assistant.', 'original block untouched');
    assert.ok(seen.system[1].text.includes(brevity.MARKER));
  });

  test('a string system prompt is appended to, not replaced', async () => {
    const seen = await throughProxy({
      model: 'claude-opus-5',
      system: 'original instructions',
      messages: [{ role: 'user', content: 'oi' }],
    });
    assert.ok(seen.system.startsWith('original instructions'));
    assert.ok(seen.system.includes(brevity.MARKER));
  });

  test('the kill switch stops the proxy from injecting', async () => {
    const seen = await throughProxy({
      model: 'claude-opus-5',
      system: [{ type: 'text', text: 'base' }],
      messages: [{ role: 'user', content: 'oi' }],
    }, { LAKON_NO_BRIEF: '1' });
    assert.equal(seen.system.length, 1);
    assert.equal(brevity.hasContract(seen.system), false);
  });

  test('non-messages traffic passes through untouched', async () => {
    await withEnv({ LAKON_HOME: freshHome(), LAKON_NO_BRIEF: undefined }, async () => {
      const proxy = createServer(0, { host: '127.0.0.1', port: upstreamPort, protocol: 'http' });
      const port = await new Promise((r) => proxy.listen(0, '127.0.0.1', () => r(proxy.address().port)));
      received = null;
      try {
        const payload = JSON.stringify({ system: 'x', messages: [] });
        await new Promise((resolve, reject) => {
          const req = http.request(
            {
              hostname: '127.0.0.1', port, path: '/v1/complete', method: 'POST',
              headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
            },
            (res) => { res.resume(); res.on('end', resolve); }
          );
          req.on('error', reject);
          req.write(payload);
          req.end();
        });
      } finally {
        await new Promise((r) => proxy.close(r));
      }
      assert.equal(received.system, 'x', '/v1/complete must not be rewritten');
    });
  });
});

// ─── measurement wired to a real transcript + real log ──────────────────────

describe('integration — response measurement through the real log', () => {
  test('a transcript on disk becomes an out_lines figure in gain', async () => {
    await inHome(() => {
      const transcript = path.join(path.dirname(depth.statePath()), 'transcript.jsonl');
      fs.mkdirSync(path.dirname(transcript), { recursive: true });
      const answer = [
        'Fixed. `src/auth.ts:42` — `<` → `<=`.',
        '',
        '```diff',
        '-if (exp < now)',
        '+if (exp <= now)',
        '```',
        'Run `npm test`.',
      ].join('\n');
      fs.writeFileSync(transcript, [
        JSON.stringify({ message: { role: 'user', content: 'fix it' } }),
        JSON.stringify({
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: answer }],
            usage: { input_tokens: 100, output_tokens: 40 },
          },
        }),
      ].join('\n') + '\n');

      const shape = stopHook.responseShape(transcript);
      assert.equal(shape.out_lines, 2, 'the diff block is exempt from the budget');

      const usage = stopHook.extractUsage(transcript);
      stopHook.trackSession({ session_id: 'meas', ...usage, ...shape });

      const entries = tracking.readEntries();
      const session = entries.find((e) => e.cmd === 'session');
      assert.equal(session.out_lines, 2);
      assert.equal(session.out_tokens, 40);

      const stats = tracking.responseStats(entries);
      assert.equal(stats.turns, 1);
      assert.equal(stats.avgLines, 2);
      assert.equal(stats.overBudget, 0);
    });
  });

  test('gain reports the answer line and leaves command savings intact', async () => {
    await withEnv({ LAKON_HOME: freshHome(), LAKON_COLOR: '0', LAKON_NO_TRACK: undefined }, () => {
      tracking.record({ cmd: 'git', args: ['status'], rawTokens: 1200, filteredTokens: 300 });
      stopHook.trackSession({ session_id: 's', in_tokens: 10, out_tokens: 420, out_lines: 6, out_chars: 300 });
      stopHook.trackSession({ session_id: 's', in_tokens: 10, out_tokens: 2100, out_lines: 34, out_chars: 1800 });

      const out = tracking.report();
      assert.match(out, /saved 900 tok/);
      assert.match(out, /answers\s+20 lines avg across 2 turns/);
      assert.match(out, /1 over budget, 50%/);
    });
  });

  test('a log with no instrumented turns reports no answer line', async () => {
    await withEnv({ LAKON_HOME: freshHome(), LAKON_COLOR: '0', LAKON_NO_TRACK: undefined }, () => {
      tracking.record({ cmd: 'ls', args: [], rawTokens: 100, filteredTokens: 40 });
      const out = tracking.report();
      assert.match(out, /saved 60 tok/);
      assert.equal(/answers/.test(out), false);
    });
  });
});

// ─── the installer actually writes the slash commands ───────────────────────

describe('integration — depth slash commands are installed', () => {
  test('deep and brief land on disk with valid frontmatter, then uninstall', async () => {
    const home = freshHome();
    await withEnv({ CLAUDE_CONFIG_DIR: undefined }, () => {
      const written = installCommands(home);
      assert.ok(written.includes('/lakonai:deep'));
      assert.ok(written.includes('/lakonai:brief'));

      const dir = commandsDir(home);
      for (const name of ['deep', 'brief']) {
        const body = fs.readFileSync(path.join(dir, `${name}.md`), 'utf8');
        assert.ok(body.startsWith('---\n'), `${name}.md opens with frontmatter`);
        assert.match(body, /^description: .+$/m);
        assert.match(body, /allowed-tools: Bash\(lakonai depth:\*\)/);
        assert.match(body, /lakonai depth (on|off)/);
      }

      const removed = uninstallCommands(home);
      assert.equal(removed.filter((p) => p.endsWith('deep.md')).length, 1);
      assert.equal(removed.filter((p) => p.endsWith('brief.md')).length, 1);
      assert.equal(fs.existsSync(path.join(dir, 'deep.md')), false);
    });
  });
});

// ─── the installer registers the hook on the right event ────────────────────

describe('integration — prompt-depth hook registration', () => {
  test('installHook wires it to UserPromptSubmit and uninstall removes it', async () => {
    const home = freshHome();
    await withEnv({ CLAUDE_CONFIG_DIR: undefined, LAKON_HOME: freshHome() }, () => {
      const { installHook, uninstallHook } = require('../src/install/claude-hook');
      installHook(home);

      const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
      const entries = settings.hooks.UserPromptSubmit;
      assert.ok(Array.isArray(entries), 'UserPromptSubmit key exists');
      const commands = entries.flatMap((e) => e.hooks.map((h) => h.command)).join(' ');
      assert.match(commands, /lakon-prompt-depth\.js/);

      // The generated launcher must load the packaged source so `../depth` resolves.
      const launcher = fs.readFileSync(path.join(home, '.claude', 'hooks', 'lakon-prompt-depth.js'), 'utf8');
      assert.match(launcher, /hooks[/\\]prompt-depth\.js/);

      uninstallHook(home);
      const after = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
      const left = JSON.stringify(after.hooks || {});
      assert.equal(left.includes('lakon-prompt-depth'), false);
    });
  });
});
