'use strict';

const git = require('./git');
const ls = require('./ls');
const cat = require('./cat');
const grep = require('./grep');
const find = require('./find');
const test = require('./test');
const engine = require('./engine');
const auto = require('./auto');
const learn = require('../learn');
const { countTokensApprox } = require('./utils');

const HANDLERS = {
  git: (args, raw) => git.filter(args[0], raw),
  ls: (_args, raw) => ls.filter(raw),
  tree: (_args, raw) => ls.filter(raw),
  cat: (_args, raw) => cat.filter(raw),
  head: (_args, raw) => cat.filter(raw, { maxLines: 50 }),
  tail: (_args, raw) => cat.filter(raw, { maxLines: 50 }),
  grep: (_args, raw) => grep.filter(raw),
  rg: (_args, raw) => grep.filter(raw),
  ag: (_args, raw) => grep.filter(raw),
  find: (_args, raw) => find.filter(raw),
};

// Commands shipped with a hand-written or declarative filter (excludes the
// auto-learned ones). Used by the learner to skip commands we already cover.
function builtinFirstWords() {
  const set = new Set(Object.keys(HANDLERS));
  for (const w of test.TEST_FIRST_WORDS) set.add(w);
  for (const w of engine.firstWords()) set.add(w);
  return set;
}

function isBuiltinSupported(cmd) {
  return builtinFirstWords().has(cmd);
}

// Every first-word command the hook should intercept: built-ins + auto-learned.
function supportedFirstWords() {
  const set = builtinFirstWords();
  for (const w of learn.learnedCommands()) set.add(w);
  return set;
}

function isSupported(cmd) {
  return supportedFirstWords().has(cmd);
}

// Resolve and run the right filter for a command. Routing order:
//   1. test runner (jest/pytest/go test/cargo test/npm test/…)
//   2. built-in JS handler keyed by first word (git/ls/cat/grep/…)
//   3. declarative engine def matched against the full command line
//   4. auto-learned command -> conservative near-lossless filter
//   5. passthrough
function filterCommand(cmd, args, raw) {
  try {
    if (test.isTestCommand(cmd, args)) return test.filter(raw);
    const handler = HANDLERS[cmd];
    if (handler) return handler(args, raw);
    const def = engine.findFilter([cmd, ...args].join(' '));
    if (def) return engine.applyDef(def, raw);
    if (learn.isLearned(cmd)) return auto.filter(raw);
    return raw;
  } catch {
    return raw;
  }
}

// Whether stderr must be captured and merged with stdout before filtering.
// Test runners (jest/vitest/pytest) emit results to stderr; some engine defs
// opt in via filterStderr.
function needsStderr(cmd, args) {
  if (test.isTestCommand(cmd, args)) return true;
  return engine.filterStderrFor([cmd, ...args].join(' '));
}

module.exports = {
  filterCommand,
  isSupported,
  isBuiltinSupported,
  needsStderr,
  supportedFirstWords,
  builtinFirstWords,
  countTokensApprox,
  HANDLERS,
};
