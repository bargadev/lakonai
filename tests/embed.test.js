'use strict';

const assert = require('node:assert/strict');

const { tryXenova, hasXenova, dot, nodeText, scoreByEmbedding } = require('../src/graph/embed');

// ── Pure functions — no optional dep needed ───────────────────────────────────

describe('embed: dot product', () => {
  test('orthogonal vectors → 0', () => {
    assert.equal(dot([1, 0], [0, 1]), 0);
  });

  test('identical unit vectors → 1', () => {
    assert.equal(dot([1, 0], [1, 0]), 1);
  });

  test('partial similarity', () => {
    const result = dot([0.6, 0.8], [0.6, 0.8]);
    assert.ok(Math.abs(result - 1) < 1e-9); // normalized vectors
  });

  test('empty vectors → 0', () => {
    assert.equal(dot([], []), 0);
  });
});

describe('embed: nodeText', () => {
  test('returns label + kind + file', () => {
    const node = { id: 'x', label: 'parseFile', kind: 'function', file: 'src/parser.js', line: 1 };
    const text = nodeText(node);
    assert.ok(text.includes('parseFile'));
    assert.ok(text.includes('function'));
    assert.ok(text.includes('src/parser.js'));
  });
});

describe('embed: scoreByEmbedding', () => {
  const nodes = [
    { id: 'a', label: 'alpha', kind: 'function', file: 'a.js', line: 1 },
    { id: 'b', label: 'beta',  kind: 'file',     file: 'b.js', line: 0 },
    { id: 'c', label: 'gamma', kind: 'function', file: 'c.js', line: 2 },
  ];

  test('returns nodes above cosine threshold 0.2, sorted desc', () => {
    const embeddingMap = new Map([
      ['a', [1, 0]],
      ['b', [0, 1]],
      ['c', [0.8, 0.6]], // cos ≈ 0.8 against [1,0]
    ]);
    const queryVec = [1, 0];
    const result = scoreByEmbedding(nodes, embeddingMap, queryVec, 10);
    // 'a' score=1, 'c' score=0.8 — both above 0.2
    // 'b' score=0 — filtered out
    assert.equal(result.length, 2);
    assert.equal(result[0].node.id, 'a');
    assert.equal(result[1].node.id, 'c');
  });

  test('topK limits results', () => {
    const embeddingMap = new Map([
      ['a', [1, 0]],
      ['b', [0.9, 0.44]],
      ['c', [0.85, 0.53]],
    ]);
    const queryVec = [1, 0];
    const result = scoreByEmbedding(nodes, embeddingMap, queryVec, 2);
    assert.equal(result.length, 2);
  });

  test('node missing from embeddingMap scores 0 and is filtered', () => {
    const embeddingMap = new Map([['a', [1, 0]]]); // b and c missing
    const queryVec = [1, 0];
    const result = scoreByEmbedding(nodes, embeddingMap, queryVec, 10);
    assert.equal(result.length, 1);
    assert.equal(result[0].node.id, 'a');
  });

  test('all below threshold returns empty array', () => {
    const embeddingMap = new Map([
      ['a', [0, 1]], // cos=0 against [1,0]
      ['b', [0, 1]],
      ['c', [0, 1]],
    ]);
    const queryVec = [1, 0];
    const result = scoreByEmbedding(nodes, embeddingMap, queryVec, 10);
    assert.equal(result.length, 0);
  });
});

// ── hasXenova / tryXenova — availability check ────────────────────────────────

describe('embed: hasXenova', () => {
  test('returns boolean', () => {
    assert.equal(typeof hasXenova(), 'boolean');
  });
});

describe('embed: tryXenova', () => {
  test('returns module or null (never throws)', async () => {
    const result = await tryXenova();
    assert.ok(result === null || typeof result === 'object');
  });
});
