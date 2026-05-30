#!/usr/bin/env node
'use strict';

// OUTPUT benchmark: how much less the model writes under the lakonai rule.
// Uses the user's own `claude` CLI (no API key, no dep). Three arms per prompt:
//   baseline  — no system prompt
//   concise   — "Answer concisely."  (generic terseness)
//   lakonai   — "Answer concisely." + the shipped rule  (honest delta = vs concise)
// Real numbers come from `claude -p --output-format json` -> usage.output_tokens.
// Non-deterministic, costs tokens -> run manually; snapshot is committed and
// bench-measure.js re-aggregates it offline (CI-safe).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RULE_PATH = path.join(__dirname, '..', 'src', 'rules', 'lakonai.md');
const PROMPTS_PATH = path.join(__dirname, 'bench-prompts.txt');
const SNAPSHOT_PATH = path.join(__dirname, 'bench-snapshots', 'output.json');

function arms() {
  const rule = fs.readFileSync(RULE_PATH, 'utf8').trim();
  return [
    { name: 'baseline', system: null },
    { name: 'concise', system: 'Answer concisely.' },
    { name: 'lakonai', system: `Answer concisely.\n\n${rule}` },
  ];
}

function readPrompts() {
  return fs
    .readFileSync(PROMPTS_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function buildArgs(prompt, system, model) {
  const args = ['-p', '--output-format', 'json'];
  if (model) args.push('--model', model);
  if (system) args.push('--system-prompt', system);
  args.push(prompt);
  return args;
}

// Parse `usage.output_tokens` out of the JSON `claude -p` prints.
function parseUsage(stdout) {
  try {
    const obj = JSON.parse(stdout);
    const usage = obj.usage || (obj.result && obj.result.usage) || {};
    const out = usage.output_tokens;
    return typeof out === 'number' ? out : null;
  } catch {
    return null;
  }
}

/* istanbul ignore next -- real subprocess to the user's claude CLI, costs tokens */
function runArm(prompt, system, model) {
  const res = spawnSync('claude', buildArgs(prompt, system, model), { encoding: 'utf8' });
  if (res.status !== 0 || !res.stdout) return null;
  return parseUsage(res.stdout);
}

/* istanbul ignore next -- orchestration that hits the model */
function main() {
  const model = process.argv.includes('--model')
    ? process.argv[process.argv.indexOf('--model') + 1]
    : 'sonnet';
  const prompts = readPrompts();
  const a = arms();
  process.stderr.write(`Running ${prompts.length} prompts × ${a.length} arms via your claude CLI (real tokens)…\n`);
  const results = [];
  for (const prompt of prompts) {
    for (const arm of a) {
      const outputTokens = runArm(prompt, arm.system, model);
      results.push({ prompt, arm: arm.name, outputTokens });
    }
  }
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({ model, results }, null, 2));
  process.stderr.write(`Wrote ${SNAPSHOT_PATH}. Run \`npm run bench:measure\` to aggregate.\n`);
}

/* istanbul ignore next */
if (require.main === module) main();

module.exports = { arms, readPrompts, buildArgs, parseUsage, RULE_PATH, SNAPSHOT_PATH };
