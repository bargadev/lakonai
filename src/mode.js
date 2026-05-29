'use strict';

// Terse intensity mode (caveman-style levels), persisted at ~/.lakon/mode.
//   lite  — no filler/hedging, keep full sentences
//   full  — drop articles/filler/preamble, fragments OK (default)
//   ultra — maximum terseness: abbreviate, arrows for causality, drop conjunctions
// Resolution order: $LAKON_MODE (if valid) -> ~/.lakon/mode -> 'full'.

const fs = require('fs');
const path = require('path');
const os = require('os');

const MODES = ['lite', 'full', 'ultra'];
const DEFAULT_MODE = 'full';

/* istanbul ignore next */
function lakonHome() {
  return process.env.LAKON_HOME || path.join(os.homedir(), '.lakon');
}
const modePath = () => path.join(lakonHome(), 'mode');

function getMode() {
  const env = process.env.LAKON_MODE;
  if (env && MODES.includes(env)) return env;
  try {
    const m = fs.readFileSync(modePath(), 'utf8').trim();
    if (MODES.includes(m)) return m;
  } catch {
    // no mode file -> default
  }
  return DEFAULT_MODE;
}

function setMode(mode) {
  if (!MODES.includes(mode)) return null;
  try {
    fs.mkdirSync(lakonHome(), { recursive: true });
    fs.writeFileSync(modePath(), mode);
    return mode;
    /* istanbul ignore next */
  } catch {
    /* istanbul ignore next */
    return null;
  }
}

module.exports = { getMode, setMode, MODES, DEFAULT_MODE, modePath };
