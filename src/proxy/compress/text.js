'use strict';

// Generic text compressor: keep headings, first/last context, strip blank runs.

const HEADING_RE = /^(#{1,6}\s|\*{2}[^*]+\*{2}|={3,}|-{3,}|\d+\.\s)/;
const BLANK_RE = /^\s*$/;

const HEAD_LINES = 8;
const TAIL_LINES = 8;
const MAX_LINES = 100;
const MAX_BLANK_RUN = 1;

function compress(text) {
  const lines = text.split('\n');

  // Collapse runs of blank lines first
  const deduped = collapseBlankRuns(lines);

  if (deduped.length <= MAX_LINES) return deduped.join('\n');

  const head = deduped.slice(0, HEAD_LINES);
  const tail = deduped.slice(-TAIL_LINES);
  const middle = deduped.slice(HEAD_LINES, -TAIL_LINES);

  const headings = middle.filter((l) => HEADING_RE.test(l));
  const elided = middle.length - headings.length;

  return [
    ...head,
    ...(elided > 0 ? [`… ${elided} lines elided`] : []),
    ...headings,
    ...tail,
  ].join('\n');
}

function collapseBlankRuns(lines) {
  const out = [];
  let blanks = 0;
  for (const l of lines) {
    if (BLANK_RE.test(l)) {
      blanks++;
      if (blanks <= MAX_BLANK_RUN) out.push(l);
    } else {
      blanks = 0;
      out.push(l);
    }
  }
  return out;
}

module.exports = { compress };
