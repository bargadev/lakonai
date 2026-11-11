'use strict';

const assert = require('node:assert/strict');
const { topLevelOps, isSingleWord, splitCdPrefix } = require('../src/shell');

const ops = (s) => (topLevelOps(s) || []).map((o) => o.op);

describe('topLevelOps', () => {
  test('finds separators, pipes and substitutions at the top level', () => {
    assert.deepEqual(ops('a && b || c; d & e | f'), ['&&', '||', ';', '&', '|']);
    assert.deepEqual(ops('a\nb'), ['\n']);
    assert.deepEqual(ops('ls $(pwd) `date`'), ['$(', '`', '`']);
  });

  test('ignores operators inside single quotes and escapes', () => {
    assert.deepEqual(ops("grep 'a|b && c' f"), []);
    assert.deepEqual(ops('echo a\\;b'), []);
    assert.deepEqual(ops("sed -n '1,20p;30p' f"), []);
  });

  test('double quotes hide separators but not substitutions', () => {
    assert.deepEqual(ops('grep "a|b" f'), []);
    assert.deepEqual(ops('echo "x \\" y"'), []);
    assert.deepEqual(ops('echo "$(rm -rf x)"'), ['$(']);
    assert.deepEqual(ops('echo "`id`"'), ['`', '`']);
  });

  test('classifies redirections', () => {
    assert.deepEqual(ops('npm test 2>&1'), ['dup']);
    assert.deepEqual(ops('git status 2>/dev/null'), ['null']);
    assert.deepEqual(ops('git status > /dev/null'), ['null']);
    assert.deepEqual(ops('git diff > p.diff'), ['>']);
    assert.deepEqual(ops('git diff >> p.diff'), ['>', '>']);
    assert.deepEqual(ops('cmd >&2'), ['>', '&']);
    assert.deepEqual(ops('wc < f'), ['<']);
    assert.deepEqual(ops('>&2 x'), ['>', '&']);
  });

  test('returns null for an unbalanced quote', () => {
    assert.equal(topLevelOps("echo 'oops"), null);
    assert.equal(topLevelOps('echo "oops'), null);
  });

  test('reports positions', () => {
    assert.deepEqual(topLevelOps('ab | c'), [{ op: '|', i: 3 }]);
  });
});

describe('isSingleWord', () => {
  test('accepts one word, quoted or escaped', () => {
    assert.equal(isSingleWord('/x/y'), true);
    assert.equal(isSingleWord('"/a b"'), true);
    assert.equal(isSingleWord("'/a b'"), true);
    assert.equal(isSingleWord('/a\\ b'), true);
    assert.equal(isSingleWord('"a\\"b"'), true);
  });

  test('rejects empty, several words and unbalanced quotes', () => {
    assert.equal(isSingleWord(''), false);
    assert.equal(isSingleWord('a b'), false);
    assert.equal(isSingleWord('"a b'), false);
  });
});

describe('splitCdPrefix', () => {
  test('splits cd <dir> && rest and cd <dir>; rest', () => {
    assert.deepEqual(splitCdPrefix('cd /repo && git status'), { dir: '/repo', op: '&&', rest: 'git status' });
    assert.deepEqual(splitCdPrefix('  cd "/a b" ;  ls -la '), { dir: '"/a b"', op: ';', rest: 'ls -la' });
  });

  test('keeps everything after the first separator in rest', () => {
    assert.equal(splitCdPrefix('cd a && cd b && ls').rest, 'cd b && ls');
  });

  test('returns null for anything that is not exactly the prefix shape', () => {
    assert.equal(splitCdPrefix('git status'), null);
    assert.equal(splitCdPrefix('cd /repo'), null); // no separator
    assert.equal(splitCdPrefix('cd /repo &&'), null); // empty rest
    assert.equal(splitCdPrefix('cd a b && ls'), null); // two words
    assert.equal(splitCdPrefix('cd $(mktemp -d) && ls'), null); // substitution first
    assert.equal(splitCdPrefix('cd x || ls'), null);
    assert.equal(splitCdPrefix("cd 'x && ls"), null); // unbalanced
    assert.equal(splitCdPrefix('cdx && ls'), null);
  });
});
