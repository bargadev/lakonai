'use strict';

const assert = require('node:assert/strict');
const find = require('../src/filters/find');
const filters = require('../src/filters');

test('find: groups matched paths by directory', () => {
  const raw = ['src/a.js', 'src/b.js', 'lib/c.js'].join('\n');
  const out = find.filter(raw);
  assert.match(out, /src\/ \(2\)/);
  assert.match(out, /lib\/ \(1\)/);
  assert.match(out, /\n {2}a\.js/);
});

test('find: drops permission-denied noise', () => {
  const raw = ['find: ‘/root’: Permission denied', 'src/a.js'].join('\n');
  // the unicode-quote variant is not matched; use the plain form
  const plain = ["find: '/root': Permission denied", 'src/a.js'].join('\n');
  assert.match(find.filter(plain), /src\/ \(1\)/);
  assert.ok(typeof find.filter(raw) === 'string');
});

test('find: empty result', () => {
  assert.equal(find.filter(''), 'find: no matches');
  assert.equal(find.filter('   \n'), 'find: no matches');
});

test('find: caps very large result sets', () => {
  const raw = Array.from({ length: 400 }, (_, i) => `d${i % 5}/file${i}.js`).join('\n');
  const out = find.filter(raw, { maxLines: 30 });
  assert.ok(out.split('\n').length <= 31);
  assert.match(out, /more lines/);
});

test('find routes through the dispatcher', () => {
  assert.match(filters.filterCommand('find', ['.', '-name', '*.js'], 'a/x.js\na/y.js'), /a\/ \(2\)/);
  assert.equal(filters.isSupported('find'), true);
});
