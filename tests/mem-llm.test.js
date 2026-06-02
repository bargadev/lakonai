'use strict';

const assert = require('node:assert/strict');
const llm = require('../src/mem-llm');

const claude = llm.PROVIDERS.find((p) => p.id === 'claude'); // stdin: true
const gemini = llm.PROVIDERS.find((p) => p.id === 'gemini'); // stdin: false

// --- onPath ---------------------------------------------------------------

test('onPath finds a binary in a PATH dir', () => {
  const env = { PATH: '/usr/bin:/opt/bin' };
  const statSync = (p) => {
    if (p === '/opt/bin/claude') return { isFile: () => true };
    throw new Error('ENOENT');
  };
  assert.equal(llm.onPath('claude', env, statSync), true);
  assert.equal(llm.onPath('gemini', env, statSync), false);
});

// --- pickProvider ---------------------------------------------------------

test('pickProvider returns the first detected provider in order', () => {
  const exists = (bin) => bin === 'gemini' || bin === 'codex';
  assert.equal(llm.pickProvider({ env: {}, exists }).id, 'gemini');
});

test('pickProvider honors LAKONAI_MEM_CLI when on PATH', () => {
  const exists = () => true;
  assert.equal(llm.pickProvider({ env: { LAKONAI_MEM_CLI: 'codex' }, exists }).id, 'codex');
});

test('pickProvider rejects an unknown LAKONAI_MEM_CLI', () => {
  assert.throws(() => llm.pickProvider({ env: { LAKONAI_MEM_CLI: 'bogus' }, exists: () => true }), /not a known agent CLI/);
});

test('pickProvider errors when the forced CLI is not on PATH', () => {
  assert.throws(() => llm.pickProvider({ env: { LAKONAI_MEM_CLI: 'claude' }, exists: () => false }), /not on PATH/);
});

test('pickProvider errors when no CLI is found', () => {
  assert.throws(() => llm.pickProvider({ env: {}, exists: () => false }), /no local AI CLI found/);
});

// --- stripWrapper ---------------------------------------------------------

test('stripWrapper removes an outer ```markdown fence, keeps inner fences', () => {
  assert.equal(llm.stripWrapper('```markdown\n# Hi\nbody\n```'), '# Hi\nbody');
  const inner = '# Hi\n```js\ncode\n```\nmore';
  assert.equal(llm.stripWrapper(inner), inner);
});

// --- prompts --------------------------------------------------------------

test('buildCompressPrompt embeds the file and the preservation rules', () => {
  const p = llm.buildCompressPrompt('# Title\nbody');
  assert.match(p, /# Title\nbody/);
  assert.match(p, /code blocks/i);
  assert.match(p, /negation/i);
  assert.match(p, /Return ONLY/i);
});

test('buildFixPrompt lists missing spans and both versions', () => {
  const p = llm.buildFixPrompt('orig text', 'comp text', ['`a.ts`', 'https://x.io']);
  assert.match(p, /- `a\.ts`/);
  assert.match(p, /- https:\/\/x\.io/);
  assert.match(p, /orig text/);
  assert.match(p, /comp text/);
});

// --- callAgent (injected run + provider) ----------------------------------

function fakeRun(out, { status = 0, error = null } = {}) {
  const fn = (cmd, args, opts) => {
    fn.lastCall = { cmd, args, opts };
    return { status, stdout: out, stderr: status ? out : '', error };
  };
  return fn;
}

test('callAgent pipes the prompt on stdin for stdin providers (claude)', () => {
  const run = fakeRun('```\ndone\n```');
  assert.equal(llm.callAgent('the prompt', { run, provider: claude }), 'done');
  assert.equal(run.lastCall.cmd, 'claude');
  assert.deepEqual(run.lastCall.args, ['--print']);
  assert.equal(run.lastCall.opts.input, 'the prompt');
});

test('callAgent passes the prompt as an arg for non-stdin providers (gemini)', () => {
  const run = fakeRun('small');
  llm.callAgent('the prompt', { run, provider: gemini });
  assert.deepEqual(run.lastCall.args, ['-p', 'the prompt']);
  assert.equal(run.lastCall.opts.input, undefined);
});

test('callAgent appends the model flag when a model is set', () => {
  const run = fakeRun('x');
  llm.callAgent('p', { run, provider: claude, model: 'claude-haiku-4-5' });
  assert.deepEqual(run.lastCall.args, ['--print', '--model', 'claude-haiku-4-5']);
});

test('callAgent throws when the CLI is missing', () => {
  const run = fakeRun('', { error: Object.assign(new Error('nope'), { code: 'ENOENT' }) });
  assert.throws(() => llm.callAgent('p', { run, provider: claude }), /`claude` \(Claude Code\) not found/);
});

test('callAgent surfaces other spawn errors', () => {
  const run = fakeRun('', { error: new Error('boom') });
  assert.throws(() => llm.callAgent('p', { run, provider: claude }), /claude failed: boom/);
});

test('callAgent throws on non-zero exit', () => {
  const run = fakeRun('bad', { status: 2 });
  assert.throws(() => llm.callAgent('p', { run, provider: claude }), /claude exited 2: bad/);
});

test('callAgent appends ruleFreeArgs and sets cwd when ruleFree is set', () => {
  const run = fakeRun('x');
  llm.callAgent('p', { run, provider: claude, ruleFree: true, cwd: '/tmp/empty' });
  assert.deepEqual(run.lastCall.args, ['--print', '--setting-sources', 'project']);
  assert.equal(run.lastCall.opts.cwd, '/tmp/empty');
});

test('callAgent omits ruleFreeArgs for providers without them, and cwd when unset', () => {
  const run = fakeRun('x');
  llm.callAgent('p', { run, provider: gemini, ruleFree: true });
  assert.deepEqual(run.lastCall.args, ['-p', 'p']); // gemini has no ruleFreeArgs
  assert.equal(run.lastCall.opts.cwd, undefined);
});

// --- compressWith / fixWith ----------------------------------------------

test('compressWith sends the compress prompt and strips the result', () => {
  const run = fakeRun('```\nsmall\n```');
  assert.equal(llm.compressWith('# big\nbody', { run, provider: claude }), 'small');
  assert.match(run.lastCall.opts.input, /# big\nbody/);
});

test('fixWith sends the fix prompt', () => {
  const run = fakeRun('fixed');
  assert.equal(llm.fixWith('o', 'c', ['`x`'], { run, provider: gemini }), 'fixed');
  // gemini is non-stdin → prompt is the last arg
  assert.match(run.lastCall.args[1], /- `x`/);
});

test('buildCompressPrompt injects a freeform instruction when given', () => {
  const p = llm.buildCompressPrompt('# Hi\nbody', 'focus on marketing');
  assert.match(p, /ADDITIONAL INSTRUCTION/);
  assert.match(p, /focus on marketing/);
  // none when absent
  assert.doesNotMatch(llm.buildCompressPrompt('# Hi'), /ADDITIONAL INSTRUCTION/);
});
