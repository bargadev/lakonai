'use strict';

// Strips comments, shrinks code/log/JSON/diff blocks, and reduces LLM context token usage.

const { detect } = require('../detect');
const log = require('./log');
const diff = require('./diff');
const code = require('./code');
const json = require('./json');
const text = require('./text');
const { countTokensApprox } = require('../../filters/utils');

const COMPRESSORS = { log, diff, code, json, text };

// Compress a single text block. Returns { compressed, type, rawTokens, outTokens }.
function compressBlock(input) {
  if (!input || typeof input !== 'string') return { compressed: input, type: 'skip', rawTokens: 0, outTokens: 0 };

  const type = detect(input);
  if (type === 'short') return { compressed: input, type, rawTokens: countTokensApprox(input), outTokens: countTokensApprox(input) };

  const compressor = COMPRESSORS[type] || text;
  const compressed = compressor.compress(input);

  const rawTokens = Math.ceil(input.length / 4);
  const outTokens = Math.ceil(compressed.length / 4);

  // Never return something larger than the input (use char length — more accurate than word count for compact JSON)
  if (compressed.length >= input.length) return { compressed: input, type, rawTokens, outTokens: rawTokens };

  return { compressed, type, rawTokens, outTokens };
}

// Extract text content from a message content item (handles string and array forms).
function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item.type === 'text') return item.text || '';
        if (item.type === 'tool_result') {
          const c = item.content;
          if (typeof c === 'string') return c;
          if (Array.isArray(c)) return c.map((x) => x.text || '').join('\n');
        }
        return '';
      })
      .join('\n');
  }
  return '';
}

// Compress a full API request body (parsed JSON object).
// Returns { body, stats } where stats = { rawTokens, outTokens, byType }.
function compressRequest(body) {
  const stats = { rawTokens: 0, outTokens: 0, byType: {} };

  const result = JSON.parse(JSON.stringify(body)); // deep clone

  // Compress system prompt
  if (typeof result.system === 'string' && result.system.length > 200) {
    const r = compressBlock(result.system);
    result.system = r.compressed;
    accumulate(stats, r);
  }

  // Compress message contents
  if (Array.isArray(result.messages)) {
    result.messages = result.messages.map((msg) => {
      if (typeof msg.content === 'string') {
        const r = compressBlock(msg.content);
        accumulate(stats, r);
        return { ...msg, content: r.compressed };
      }
      if (Array.isArray(msg.content)) {
        const items = msg.content.map((item) => {
          // Compress tool_result content (the most impactful target)
          if (item.type === 'tool_result') {
            const raw = extractText(item.content);
            const r = compressBlock(raw);
            accumulate(stats, r);
            return { ...item, content: r.compressed };
          }
          // Compress plain text blocks
          if (item.type === 'text' && item.text) {
            const r = compressBlock(item.text);
            accumulate(stats, r);
            return { ...item, text: r.compressed };
          }
          return item;
        });
        return { ...msg, content: items };
      }
      return msg;
    });
  }

  return { body: result, stats };
}

function accumulate(stats, r) {
  stats.rawTokens += r.rawTokens;
  stats.outTokens += r.outTokens;
  const t = r.type || 'skip';
  stats.byType[t] = stats.byType[t] || { raw: 0, out: 0, count: 0 };
  stats.byType[t].raw += r.rawTokens;
  stats.byType[t].out += r.outTokens;
  stats.byType[t].count++;
}

module.exports = { compressRequest, compressBlock, extractText };
