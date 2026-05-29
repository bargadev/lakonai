'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const auto = require('../src/filters/auto');
const learn = require('../src/learn');
const filters = require('../src/filters');

function freshHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-learn-'));
  process.env.LAKON_HOME = home;
  delete process.env.LAKON_NO_LEARN;
  delete process.env.LAKON_NO_TRACK;
  learn._resetCache();
  return home;
}

// Build a transcript line for one Bash call + its result.
function turn(id, command, outputWords) {
  const assistant = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
  });
  const result = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x '.repeat(outputWords).trim() }] },
  });
  return assistant + '\n' + result;
}

// --- auto filter ----------------------------------------------------------

test('auto.filter collapses blanks, dedups, and truncates with a marker', () => {
  assert.equal(auto.filter('a\na\na\nb'), 'a (×3)\nb');
  assert.equal(auto.filter('x\n\n\n\ny'), 'x\n\ny');
  const big = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
  const out = auto.filter(big, { maxLines: 50 });
  assert.ok(out.split('\n').length <= 51);
  assert.match(out, /more lines/);
});

// --- baseCommand ----------------------------------------------------------

test('baseCommand strips env assignments / sudo / env', () => {
  assert.equal(learn.baseCommand('eslint .'), 'eslint');
  assert.equal(learn.baseCommand('FOO=bar sudo eslint .'), 'eslint');
  assert.equal(learn.baseCommand('env X=1 ruff check'), 'ruff');
  assert.equal(learn.baseCommand('   '), '');
});

// --- extractBashUsage -----------------------------------------------------

test('extractBashUsage pairs Bash tool calls with their output size', () => {
  const transcript = [
    turn('a', 'eslint .', 10),
    '', // blank line is skipped
    JSON.stringify({ message: { content: [{ type: 'tool_use', id: 'b', name: 'Read', input: { command: 'x' } }] } }),
    'not json',
    JSON.stringify({ message: { content: 'not-an-array' } }),
    JSON.stringify({ content: [{ type: 'text', text: 'bare top-level object, no message wrapper' }] }),
    JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: 'num', content: 42 }] } }),
    JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: 'orphan', content: 'lonely' }] } }),
  ].join('\n');
  const usage = learn.extractBashUsage(transcript);
  assert.deepEqual(usage, [{ cmd: 'eslint', tokens: 10 }]);
});

test('extractBashUsage handles array-shaped tool_result content', () => {
  const t = JSON.stringify({
    message: {
      content: [
        { type: 'tool_use', id: 'z', name: 'Bash', input: { command: 'mytool run' } },
        { type: 'tool_result', tool_use_id: 'z', content: [{ type: 'text', text: 'one two' }, 'three', { type: 'image' }] },
      ],
    },
  });
  assert.deepEqual(learn.extractBashUsage(t), [{ cmd: 'mytool', tokens: 3 }]);
});

// --- promote --------------------------------------------------------------

test('promote adds commands over the floor, skips builtin / already-learned / below floor', () => {
  freshHome();
  const isBuiltin = (c) => c === 'git';
  const stats = {
    eslint: { count: 3, tokens: 1500 }, // over floor -> learn
    git: { count: 9, tokens: 9000 }, // builtin -> skip
    ls: { count: 1, tokens: 5000 }, // too few calls -> skip
    echo: { count: 5, tokens: 20 }, // tiny output -> skip
  };
  const learned = learn.promote(stats, isBuiltin);
  assert.ok(learned.includes('eslint'));
  assert.ok(!learned.includes('git'));
  assert.ok(!learned.includes('ls'));
  assert.ok(!learned.includes('echo'));
  // idempotent: second call makes no change
  const again = learn.promote(stats, isBuiltin);
  assert.deepEqual(again.sort(), learned.sort());
});

// --- analyzeTranscript (end to end against a file) ------------------------

test('analyzeTranscript learns a chatty unfiltered command across the session', () => {
  const home = freshHome();
  const tp = path.join(home, 'transcript.jsonl');
  fs.writeFileSync(
    tp,
    [turn('1', 'mytool build', 400), turn('2', 'mytool build', 400), turn('3', 'mytool build', 400), turn('4', 'git status', 400)].join('\n')
  );
  learn.analyzeTranscript(tp, filters.isBuiltinSupported);
  const learned = JSON.parse(fs.readFileSync(path.join(home, 'learned.json'), 'utf8'));
  assert.ok(learned.includes('mytool'));
  assert.ok(!learned.includes('git'));
  // stats persisted and accumulate on a second session
  learn.analyzeTranscript(tp, filters.isBuiltinSupported);
  const stats = JSON.parse(fs.readFileSync(path.join(home, 'learn-stats.json'), 'utf8'));
  assert.equal(stats.mytool.count, 6);
});

test('analyzeTranscript respects opt-out env vars and missing/empty input', () => {
  const home = freshHome();
  const tp = path.join(home, 't.jsonl');
  fs.writeFileSync(tp, turn('1', 'mytool x', 400) + '\n' + turn('2', 'mytool x', 400) + '\n' + turn('3', 'mytool x', 400));

  process.env.LAKON_NO_LEARN = '1';
  learn.analyzeTranscript(tp, () => false);
  assert.ok(!fs.existsSync(path.join(home, 'learned.json')));
  delete process.env.LAKON_NO_LEARN;

  // missing file -> no throw, no write
  learn.analyzeTranscript(path.join(home, 'nope.jsonl'), () => false);
  // a transcript with no Bash usage -> no write
  const empty = path.join(home, 'empty.jsonl');
  fs.writeFileSync(empty, JSON.stringify({ message: { content: [{ type: 'text', text: 'hi' }] } }));
  learn.analyzeTranscript(empty, () => false);
  assert.ok(!fs.existsSync(path.join(home, 'learn-stats.json')));
});

// --- dispatch integration -------------------------------------------------

test('a learned command routes through the conservative auto filter', () => {
  const home = freshHome();
  fs.writeFileSync(path.join(home, 'learned.json'), JSON.stringify(['mytool']));
  learn._resetCache();
  assert.equal(learn.isLearned('mytool'), true);
  assert.equal(filters.isSupported('mytool'), true);
  assert.ok(filters.supportedFirstWords().has('mytool'));
  assert.equal(filters.filterCommand('mytool', ['run'], 'dup\ndup\ndup\nend'), 'dup (×3)\nend');
  learn._resetCache();
});
