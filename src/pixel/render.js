'use strict';

const fs = require('fs');
const path = require('path');

// Try to load the canvas package (optional dependency).
// Returns the canvas module or null if unavailable.
function tryCanvas() {
  try { return require('canvas'); } catch { return null; }
}

// Strip markdown syntax to produce clean, readable plain text for rendering.
function stripMarkdown(md) {
  return md
    .replace(/^#{1,6}\s+/gm, '')           // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')       // bold
    .replace(/\*(.+?)\*/g, '$1')           // italic
    .replace(/`{3}[\s\S]*?`{3}/g, '')      // fenced code blocks
    .replace(/`(.+?)`/g, '$1')             // inline code
    .replace(/!\[.*?\]\(.*?\)/g, '')       // images
    .replace(/\[(.+?)\]\(.*?\)/g, '$1')   // links
    .replace(/^[-*+]\s+/gm, '• ')         // unordered lists
    .replace(/^\d+\.\s+/gm, (m) => m)     // ordered lists (keep number)
    .replace(/^>\s*/gm, '  ')             // blockquotes
    .replace(/---+/g, '─'.repeat(40))     // horizontal rules
    .trim();
}

// Word-wrap a line to fit within maxChars.
function wrapLine(line, maxChars) {
  if (line.length <= maxChars) return [line];
  const words = line.split(' ');
  const wrapped = [];
  let current = '';
  for (const word of words) {
    if (!current) { current = word; continue; }
    if ((current + ' ' + word).length <= maxChars) {
      current += ' ' + word;
    } else {
      wrapped.push(current);
      current = word;
    }
  }
  if (current) wrapped.push(current);
  return wrapped.length ? wrapped : [line.slice(0, maxChars)];
}

const WIDTH = 800;
const FONT_SIZE = 13;
const LINE_HEIGHT = 20;
const PAD_X = 20;
const PAD_Y = 16;
const CHARS_PER_LINE = Math.floor((WIDTH - PAD_X * 2) / (FONT_SIZE * 0.6));
const BG = '#1e1e2e';
const FG = '#cdd6f4';
const HEADING_COLOR = '#89b4fa';
const CODE_COLOR = '#a6e3a1';

/* istanbul ignore next -- canvas is an optionalDependency; entire rendering path requires native binary, unavailable in CI */
function renderToPng(markdownBody) {
  const canvas = tryCanvas();
  if (!canvas) {
    throw new Error(
      'canvas package not installed — needed for pixel rendering.\n' +
      'Install it: npm install canvas\n' +
      '  (or: npm install @napi-rs/canvas  for M-series Macs)'
    );
  }
  const { createCanvas } = canvas;
  const stripped = stripMarkdown(markdownBody);
  const rawLines = stripped.split('\n');
  const renderedLines = [];
  for (const line of rawLines) {
    const wrapped = wrapLine(line, CHARS_PER_LINE);
    for (const wl of wrapped) renderedLines.push(wl);
  }
  const height = PAD_Y * 2 + renderedLines.length * LINE_HEIGHT;
  const cv = createCanvas(WIDTH, height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.font = `${FONT_SIZE}px monospace`;
  let y = PAD_Y + FONT_SIZE;
  for (const line of renderedLines) {
    ctx.fillStyle = line.startsWith('    ') || line.startsWith('\t') ? CODE_COLOR : FG;
    ctx.fillText(line, PAD_X, y);
    y += LINE_HEIGHT;
  }
  return cv.toBuffer('image/png');
}

/* istanbul ignore next -- canvas is an optionalDependency; entire rendering path requires native binary, unavailable in CI */
function renderSkillToPng(body, skillFilePath) {
  const buffer = renderToPng(body);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const dir = path.dirname(skillFilePath);
  const base = path.basename(skillFilePath, '.md');
  const pngPath = path.join(dir, base + '-body.png');
  fs.writeFileSync(pngPath, buffer);
  return { pngPath, width, height, buffer };
}

module.exports = { renderToPng, renderSkillToPng, stripMarkdown, wrapLine, tryCanvas };
