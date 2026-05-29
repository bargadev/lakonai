'use strict';

const { stripAnsi, truncateLines, countTokensApprox } = require('../src/filters/utils');

test('stripAnsi removes escape codes, leaves plain text', () => {
  expect(stripAnsi('\x1b[32mok\x1b[0m')).toBe('ok');
  expect(stripAnsi('plain')).toBe('plain');
});

test('truncateLines caps lines and appends a drop marker', () => {
  const text = ['a', 'b', 'c', 'd'].join('\n');
  const out = truncateLines(text, 2);
  expect(out).toBe('a\nb\n… +2 more lines');
  expect(truncateLines('a\nb', 5)).toBe('a\nb');
});

test('countTokensApprox counts whitespace-separated tokens', () => {
  expect(countTokensApprox('one two three')).toBe(3);
  expect(countTokensApprox('   ')).toBe(0);
});
