'use strict';

// End-to-end savings harness. Builds a deterministic git repository on disk,
// runs real commands through the real CLI (`node bin/lakonai.js …`) and through
// the real PreToolUse hook + a real shell, and measures what the agent would
// have read with and without lakonai. No mocks, no synthetic strings handed to
// a filter: every number comes from a spawned process.
//
// Used by tests/savings-e2e.test.js (asserts each scenario clears its floor and
// keeps the lines that matter) and scripts/savings-chart.js (renders the
// README chart + table from the same run).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
// Token estimate: ~4 characters per token, the usual rule of thumb for BPE
// tokenizers on code and logs. (`lakonai gain` counts whitespace words, which
// cannot see the savings of folding repeated path prefixes — `find`/`grep`
// output reads as "bigger" in words while it is smaller in real tokens.)
const approxTokens = (s) => Math.ceil(String(s).length / 4);

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'lakonai.js');
const HOOK = path.join(ROOT, 'src', 'hooks', 'bash-rewrite.js');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Dev',
  GIT_AUTHOR_EMAIL: 'dev@example.com',
  GIT_COMMITTER_NAME: 'Dev',
  GIT_COMMITTER_EMAIL: 'dev@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_PAGER: 'cat',
  NO_COLOR: '1',
};

function sourceFile(dir, i, rev) {
  const lines = [`// ${dir}/mod${i}.js`, `'use strict';`, ''];
  for (let f = 0; f < 8; f++) {
    lines.push(`function ${dir}Handler${i}_${f}(input) {`);
    lines.push(`  const value = normalize(input, ${f + rev});`);
    lines.push(`  if (!value) return null;`);
    lines.push(`  return transform(value, '${dir}-${i}-${f}');`);
    lines.push('}', '');
  }
  lines.push(`module.exports = { ${dir}Handler${i}_0 };`);
  return lines.join('\n') + '\n';
}

const DIRS = ['api', 'auth', 'billing', 'core', 'ui', 'utils'];

// Build the fixture. Deterministic: fixed dates, fixed content, no randomness.
function buildFixture(base = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-e2e-'))) {
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const env = { ...process.env, ...GIT_ENV, HOME: base };
  const git = (...args) => {
    const r = spawnSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  git('init', '-q', '-b', 'main');
  for (const d of DIRS) {
    fs.mkdirSync(path.join(repo, 'src', d), { recursive: true });
    for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(repo, 'src', d, `mod${i}.js`), sourceFile(d, i, 0));
  }
  git('add', '.');
  git('commit', '-q', '-m', 'chore: initial import');

  // 30 commits, each touching 3 modules, with a real message body.
  for (let c = 1; c <= 30; c++) {
    for (let k = 0; k < 3; k++) {
      const d = DIRS[(c + k) % DIRS.length];
      const i = (c * 3 + k) % 10;
      fs.writeFileSync(path.join(repo, 'src', d, `mod${i}.js`), sourceFile(d, i, c));
    }
    const date = `2026-10-${String(1 + (c % 28)).padStart(2, '0')}T10:00:00-03:00`;
    spawnSync('git', ['-C', repo, 'add', '.'], { env });
    spawnSync('git', ['-C', repo, 'commit', '-q', '-m', `fix(${DIRS[c % 6]}): handle edge case ${c}`, '-m',
      `The ${DIRS[c % 6]} handler dropped input when the value was empty. This normalizes\nit first and keeps the transform contract. Refs #${100 + c}.`],
    { env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  }

  // Working tree: 12 modified, 25 untracked — a realistic mid-task `git status`.
  for (let i = 0; i < 12; i++) {
    const d = DIRS[i % 6];
    fs.appendFileSync(path.join(repo, 'src', d, `mod${i % 10}.js`), `// wip ${i}\n`);
  }
  fs.mkdirSync(path.join(repo, 'tmp'), { recursive: true });
  for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(repo, 'tmp', `scratch-${i}.log`), 'x\n');

  // A build log: noisy progress lines around one warning that must survive.
  const mk = ['all:'];
  for (const d of DIRS) {
    mk.push(`\t@echo "make[1]: Entering directory '/work/repo/src/${d}'"`);
    for (let i = 0; i < 10; i++) mk.push(`\t@echo "cc -O2 -Wall -c src/${d}/mod${i}.c -o build/${d}/mod${i}.o"`);
    mk.push(`\t@echo "make[1]: Leaving directory '/work/repo/src/${d}'"`);
  }
  mk.push(`\t@echo "src/billing/mod7.c:42:9: warning: unused variable 'total' [-Wunused-variable]"`);
  fs.writeFileSync(path.join(repo, 'Makefile'), mk.join('\n') + '\n');

  return { base, repo, env };
}

// What the agent would read without lakonai.
function runRaw(fx, cmd, args) {
  const r = spawnSync(cmd, args, { cwd: fx.repo, env: fx.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return (r.stdout || '') + (r.stderr || '');
}

// What it reads through the CLI.
function runLakon(fx, cmd, args, lakonHome) {
  const r = spawnSync('node', [CLI, cmd, ...args], {
    cwd: fx.repo,
    env: { ...fx.env, LAKON_HOME: lakonHome, LAKON_NO_LEARN: '1', LAKON_AGENT: 'e2e' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { out: (r.stdout || '') + (r.stderr || ''), status: r.status };
}

// The full agent path: PreToolUse hook rewrites the command, a real shell runs
// whatever the hook returned (or the original, when it declines).
function runThroughHook(fx, command, lakonHome) {
  const env = { ...fx.env, LAKON_HOME: lakonHome, LAKON_NO_LEARN: '1', LAKON_AGENT: 'e2e' };
  const hook = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    env,
    encoding: 'utf8',
  });
  const rewritten = hook.stdout ? JSON.parse(hook.stdout).hookSpecificOutput.updatedInput.command : command;
  // `lakonai` on PATH → this checkout's CLI, so the shell runs the code under test.
  const bin = path.join(fx.base, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const shim = path.join(bin, 'lakonai');
  if (!fs.existsSync(shim)) fs.writeFileSync(shim, `#!/bin/sh\nexec node ${JSON.stringify(CLI)} "$@"\n`, { mode: 0o755 });
  const r = spawnSync('sh', ['-c', rewritten], {
    cwd: fx.base,
    env: { ...env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { out: (r.stdout || '') + (r.stderr || ''), rewritten };
}

// Each scenario: what runs, the minimum saving it must clear, and lines that
// must still be in the filtered output (savings that drop the signal are a bug).
const SCENARIOS = [
  { id: 'git-log', label: 'git log', cmd: 'git', args: ['log'], minSaved: 60, mustKeep: ['handle edge case 30', 'handle edge case 1'] },
  { id: 'git-diff', label: 'git diff HEAD~10', cmd: 'git', args: ['diff', 'HEAD~10'], minSaved: 30, mustKeep: ['normalize(input', '@@'] },
  { id: 'git-c-diff', label: 'git -C <repo> diff HEAD~10', cmd: 'git', args: ['-C', '{repo}', 'diff', 'HEAD~10'], minSaved: 30, mustKeep: ['@@'] },
  { id: 'git-status', label: 'git status', cmd: 'git', args: ['status'], minSaved: 30, mustKeep: ['mod0.js', 'tmp/'] },
  { id: 'find', label: 'find . -type f', cmd: 'find', args: ['.', '-type', 'f', '-not', '-path', './.git/*'], minSaved: 25, mustKeep: ['mod9.js'] },
  { id: 'ls', label: 'ls -la src/api', cmd: 'ls', args: ['-la', 'src/api'], minSaved: 30, mustKeep: ['mod9.js'] },
  { id: 'grep', label: 'grep -rn transform src', cmd: 'grep', args: ['-rn', 'transform', 'src'], minSaved: 50, mustKeep: ['src/ui/mod0.js', 'more matches (tighten the pattern)'] },
  { id: 'make', label: 'make', cmd: 'make', args: ['-s'], minSaved: 10, mustKeep: ["warning: unused variable 'total'"] },
  { id: 'sed-read', label: "sed -n '1,60p' file", cmd: 'sed', args: ['-n', '1,60p', 'src/core/mod3.js'], minSaved: 0, mustKeep: ['coreHandler3_7'] },
  // The agent path: before 1.4 the hook skipped every `cd … &&` command.
  { id: 'cd-hook', label: 'cd <repo> && git log (hook)', hook: 'cd repo && git log', minSaved: 60, mustKeep: ['handle edge case 30'] },
];

function measure(fx, sc, lakonHome) {
  let raw;
  let out;
  let rewritten = null;
  if (sc.hook) {
    raw = runRaw(fx, 'git', ['log']);
    ({ out, rewritten } = runThroughHook(fx, sc.hook, lakonHome));
  } else {
    const args = sc.args.map((a) => (a === '{repo}' ? fx.repo : a));
    raw = runRaw(fx, sc.cmd, args);
    ({ out } = runLakon(fx, sc.cmd, args, lakonHome));
  }
  const rawTok = approxTokens(raw);
  const outTok = approxTokens(out);
  const saved = rawTok ? Math.round((1 - outTok / rawTok) * 1000) / 10 : 0;
  const missing = sc.mustKeep.filter((s) => !out.includes(s));
  return { id: sc.id, label: sc.label, rawTok, outTok, saved, minSaved: sc.minSaved, missing, rewritten };
}

function runAll() {
  const fx = buildFixture();
  const lakonHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-e2e-home-'));
  try {
    return SCENARIOS.map((sc) => measure(fx, sc, lakonHome));
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
    fs.rmSync(lakonHome, { recursive: true, force: true });
  }
}

module.exports = { SCENARIOS, buildFixture, measure, runAll, approxTokens };

if (require.main === module) {
  for (const r of runAll()) {
    console.log(`${r.label.padEnd(30)} ${String(r.rawTok).padStart(7)} → ${String(r.outTok).padStart(6)}  ${r.saved}%${r.missing.length ? '  MISSING ' + r.missing.join(', ') : ''}`);
  }
}
