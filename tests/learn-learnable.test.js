'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const learn = require('../src/learn');
const report = require('../src/learn-report');

function freshHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-learnable-'));
  process.env.LAKON_HOME = home;
  delete process.env.LAKON_NO_LEARN;
  delete process.env.LAKON_NO_TRACK;
  learn._resetCache();
  return home;
}

describe('isLearnable', () => {
  test('accepts bare executable names', () => {
    for (const c of ['gh', 'sed', 'kubectl', 'v10', 'docker-compose', 'g++']) assert.equal(learn.isLearnable(c), true, c);
  });

  test('rejects paths, flags, fragments, builtins, tools, interpreters and mutators', () => {
    for (const c of [
      'Support/@notetaker/desktop/logs/main.log;', '~/Library/Application\\', './build/bin/x', '-n', 'foo;', '"x',
      'cd', 'echo', 'command', 'lakonai', 'Read', 'Grep', 'node', 'python3', 'bash', 'rm', 'xargs', '', null, 3,
    ]) {
      assert.equal(learn.isLearnable(c), false, String(c));
    }
  });
});

describe('baseCommand', () => {
  test('looks through cd prefixes and env assignments', () => {
    assert.equal(learn.baseCommand('cd /x && sed -n 1,5p f'), 'sed');
    assert.equal(learn.baseCommand('cd a && cd b && gh pr list'), 'gh');
    assert.equal(learn.baseCommand('FOO=1 sudo env kubectl get pods'), 'kubectl');
  });

  test('returns empty for commands that must never be learned', () => {
    assert.equal(learn.baseCommand('lakonai git status'), '');
    assert.equal(learn.baseCommand('node -e 1'), '');
    assert.equal(learn.baseCommand('~/Library/Application\\ Support/x'), '');
    assert.equal(learn.baseCommand(''), '');
  });
});

describe('learned list hygiene (real FS)', () => {
  test('learnedCommands drops entries older versions stored', () => {
    const home = freshHome();
    fs.writeFileSync(path.join(home, 'learned.json'), JSON.stringify(['gh', 'node', 'Read', 'Support/x;', 'echo']));
    assert.deepEqual([...learn.learnedCommands()], ['gh']);
    assert.equal(learn.isLearned('node'), false);
  });

  test('a non-array learned.json is ignored', () => {
    const home = freshHome();
    fs.writeFileSync(path.join(home, 'learned.json'), JSON.stringify({ gh: 1 }));
    assert.deepEqual([...learn.learnedCommands()], []);
  });

  test('promote and analyzeLog never learn a non-learnable command', () => {
    const home = freshHome();
    const stats = { node: { count: 50, tokens: 50000 }, gh: { count: 5, tokens: 5000 } };
    assert.deepEqual(learn.promote(stats, () => false), ['gh']);
    fs.writeFileSync(path.join(home, 'learned.json'), '[]');
    const lines = [];
    for (let i = 0; i < 5; i++) lines.push(JSON.stringify({ cmd: 'python3', raw: 900 }), JSON.stringify({ cmd: 'kubectl', raw: 900 }));
    fs.writeFileSync(path.join(home, 'log.jsonl'), lines.join('\n'));
    learn.analyzeLog(() => false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'learned.json'), 'utf8')), ['kubectl']);
  });

  test('transcript analysis attributes cd-prefixed calls to the real command', () => {
    const home = freshHome();
    const t = [];
    for (let i = 0; i < 4; i++) {
      t.push(JSON.stringify({ message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: 'cd /r && gh run view' } }] } }));
      t.push(JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'w '.repeat(400) }] } }));
    }
    const f = path.join(home, 't.jsonl');
    fs.writeFileSync(f, t.join('\n'));
    learn.analyzeTranscript(f, () => false);
    const stats = JSON.parse(fs.readFileSync(path.join(home, 'learn-stats.json'), 'utf8'));
    assert.deepEqual(Object.keys(stats), ['gh']);
    assert.ok(learn.isLearned('gh') || JSON.parse(fs.readFileSync(path.join(home, 'learned.json'), 'utf8')).includes('gh'));
  });

  test('the sink report hides non-learnable stats entries', () => {
    const home = freshHome();
    fs.writeFileSync(path.join(home, 'learn-stats.json'), JSON.stringify({
      cd: { count: 100, tokens: 100000 },
      'Support/x;': { count: 9, tokens: 9000 },
      gh: { count: 10, tokens: 10000 },
    }));
    const md = report.buildReport(() => false);
    assert.ok(md.includes('**gh**'));
    assert.ok(!md.includes('**cd**'));
    assert.ok(!md.includes('Support/x;'));
  });
});
