'use strict';

const { countTokensApprox } = require('../filters/utils');

// Claude vision token cost: tiles of 512×512, each tile = 170 tokens + 85 base.
// https://docs.anthropic.com/en/docs/build-with-claude/vision#image-costs
function imageTokens(width, height) {
  const tilesW = Math.ceil(width / 512);
  const tilesH = Math.ceil(height / 512);
  return tilesW * tilesH * 170 + 85;
}

// Rendering constants — tuned to match caveman's ~512px width, small font.
// 512px wide = 1 tile wide (one column of 512×512 tiles), minimises horizontal cost.
const RENDER_WIDTH = 512;
const RENDER_FONT_PX = 8;
const RENDER_LINE_H = 10;
const RENDER_PAD_V = 8;
const RENDER_CHARS_PER_LINE = Math.floor(RENDER_WIDTH / (RENDER_FONT_PX * 0.6)); // ≈107

// Estimate rendered dimensions for N lines of text at a given font size.
function estimateDimensions(lineCount, { fontSize = RENDER_FONT_PX, charsPerLine = RENDER_CHARS_PER_LINE } = {}) {
  const width = RENDER_WIDTH;
  const lineHeight = RENDER_LINE_H;
  const paddingV = RENDER_PAD_V;
  const height = lineCount * lineHeight + paddingV;
  return { width, height };
}

// Count lines in a markdown body (after splitting to fit charsPerLine).
function countWrappedLines(text, charsPerLine = RENDER_CHARS_PER_LINE) {
  const rawLines = text.split('\n');
  let total = 0;
  for (const line of rawLines) {
    total += Math.max(1, Math.ceil(line.length / charsPerLine));
  }
  return total;
}

// Estimate image token cost for a markdown body string.
function estimateImageTokens(body) {
  const lines = countWrappedLines(body);
  const { width, height } = estimateDimensions(lines);
  return imageTokens(width, height);
}

// Full savings estimate for a skill body.
// Returns { textTokens, imgTokens, saved, savePct, profitable }.
function estimateSavings(body) {
  const textTokens = countTokensApprox(body);
  const imgTokens = estimateImageTokens(body);
  const saved = textTokens - imgTokens;
  const savePct = textTokens > 0 ? Math.round((saved / textTokens) * 100) : 0;
  return { textTokens, imgTokens, saved, savePct, profitable: saved > 0 };
}

module.exports = { imageTokens, estimateDimensions, countWrappedLines, estimateImageTokens, estimateSavings };
