'use strict';

const assert = require('node:assert/strict');
const { shrink, shrinkMessage, transformLine, fields } = require('../src/shrink');

test('shrink drops filler/articles/lead, keeps code/URLs/identifiers', () => {
  const out = shrink('This tool is used to please read the `config.json` file at https://x.io/docs');
  assert.match(out, /`config\.json`/);
  assert.match(out, /https:\/\/x\.io\/docs/);
  assert.doesNotMatch(out, /\bplease\b/i);
  assert.doesNotMatch(out, /this tool is used to/i);
});

test('shrink preserves identifiers (camelCase, snake_case, dotted, paths)', () => {
  const out = shrink('Calls getUserById and reads src/app/main.ts and the user_id field');
  assert.match(out, /getUserById/);
  assert.match(out, /src\/app\/main\.ts/);
  assert.match(out, /user_id/);
});

test('shrink is a no-op on non-strings and empty', () => {
  assert.equal(shrink(''), '');
  assert.equal(shrink(undefined), undefined);
  assert.equal(shrink(42), 42);
});

test('shrinkMessage rewrites description across tools/prompts/resources, leaves names', () => {
  const msg = {
    result: {
      tools: [{ name: 'read', description: 'Use this tool to read a file.' }],
      prompts: [{ name: 'p', description: 'This is a really long prompt description.' }],
      resources: [{ uri: 'x', description: 'Just a resource.', other: 5 }],
    },
  };
  const out = shrinkMessage(msg, ['description']);
  assert.doesNotMatch(out.result.tools[0].description, /use this tool to/i);
  assert.doesNotMatch(out.result.prompts[0].description, /\breally\b/i);
  assert.doesNotMatch(out.result.resources[0].description, /\bjust\b/i);
  assert.equal(out.result.tools[0].name, 'read');
  assert.equal(out.result.resources[0].other, 5);
});

test('shrinkMessage ignores non-list results, bad items, and non-objects', () => {
  const callResult = { result: { content: [{ type: 'text', text: 'the actual output' }] } };
  assert.deepEqual(shrinkMessage(callResult, ['description']), callResult);
  assert.deepEqual(shrinkMessage({ id: 1 }, ['description']), { id: 1 });
  assert.equal(shrinkMessage(null, ['description']), null);
  // array with a null item + an item missing the field
  const m = { result: { tools: [null, { name: 'x' }] } };
  assert.deepEqual(shrinkMessage(m, ['description']), m);
});

test('transformLine passes through blank/malformed, shrinks valid lines', () => {
  assert.equal(transformLine('not json', ['description']), 'not json');
  assert.equal(transformLine('   ', ['description']), '   ');
  const line = JSON.stringify({ result: { tools: [{ name: 't', description: 'Please do the thing.' }] } });
  const out = JSON.parse(transformLine(line, ['description']));
  assert.doesNotMatch(out.result.tools[0].description, /\bplease\b/i);
});

test('fields: default description, overridable via env', () => {
  const prev = process.env.LAKONAI_SHRINK_FIELDS;
  delete process.env.LAKONAI_SHRINK_FIELDS;
  assert.deepEqual(fields(), ['description']);
  process.env.LAKONAI_SHRINK_FIELDS = 'description, title ,';
  assert.deepEqual(fields(), ['description', 'title']);
  if (prev !== undefined) process.env.LAKONAI_SHRINK_FIELDS = prev;
  else delete process.env.LAKONAI_SHRINK_FIELDS;
});
