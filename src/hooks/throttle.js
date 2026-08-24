'use strict';

// Rate-limits hook events by tracking timestamps in marker files — prevents request floods.

const fs = require('fs');
const path = require('path');
const os = require('os');

/* istanbul ignore next */
const MARKER_DIR = path.join(os.tmpdir(), `lakon-${process.env.USER || 'session'}`);
const TTL_MS = 4 * 60 * 60 * 1000;

function shouldEmit(category) {
  if (process.env.LAKON_NO_THROTTLE === '1') return true;
  try {
    fs.mkdirSync(MARKER_DIR, { recursive: true });
    const marker = path.join(MARKER_DIR, `${category}.marker`);
    try {
      const st = fs.statSync(marker);
      if (Date.now() - st.mtimeMs < TTL_MS) return false;
    } catch {
      /* not yet emitted */
    }
    const fd = fs.openSync(marker, fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_TRUNC);
    fs.closeSync(fd);
    return true;
  } catch {
    /* istanbul ignore next */
    return true;
  }
}

module.exports = { shouldEmit };
