'use strict';

// Integration tests: full pipeline stop-hook → learn-report → session-start.
// Spawns real subprocesses to verify hook wire-up with real filesystem I/O.
// Companion unit tests in learn-report.test.js cover the same logic for coverage.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const STOP_HOOK = path.join(__dirname, '..', 'src', 'hooks', 'stop-hook.js');
const SESSION_START = path.join(__dirname, '..', 'src', 'hooks', 'session-start.js');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-int-'));
}

function runStop(transcriptPath, home) {
  return spawnSync('node', [STOP_HOOK], {
    input: JSON.stringify({ transcript_path: transcriptPath, session_id: 'integration-test' }),
    encoding: 'utf8',
    env: { ...process.env, LAKON_HOME: home, LAKON_NO_UPDATE_CHECK: '1', LAKON_NO_AUTO_GRAPH: '1' },
  });
}

function runSessionStart(home) {
  return spawnSync('node', [SESSION_START], {
    input: JSON.stringify({}),
    encoding: 'utf8',
    env: { ...process.env, LAKON_HOME: home, LAKON_NO_UPDATE_CHECK: '1', LAKON_NO_AUTO_GRAPH: '1' },
  });
}

function writeTranscript(home, { bashCalls = [], usage = null } = {}) {
  const msgs = [];

  // Bash tool_use + tool_result pairs
  for (const { id, cmd, output } of bashCalls) {
    msgs.push({ message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: cmd } }] } });
    msgs.push({ message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] } });
  }

  // Final assistant message with usage
  if (usage) {
    msgs.push({ message: { role: 'assistant', usage } });
  }

  const p = path.join(home, 'transcript.jsonl');
  fs.writeFileSync(p, msgs.map((m) => JSON.stringify(m)).join('\n') + '\n');
  return p;
}

// ── Full pipeline: stop-hook triggers report, session-start surfaces it ───────

test('Integration: stop-hook writes learn-report.md after session with unfiltered heavy commands', () => {
  const home = freshHome();

  // Simulate existing transcript-derived stats (heavy unfiltered commands)
  fs.writeFileSync(
    path.join(home, 'learn-stats.json'),
    JSON.stringify({
      terraform: { count: 5, tokens: 30000 },
      prisma: { count: 4, tokens: 8000 },
    })
  );

  // Transcript with usage (needed for stop-hook to proceed past early exit)
  const transcript = writeTranscript(home, {
    usage: { input_tokens: 500, output_tokens: 100 },
  });

  // Force the daily TTL to "never run" so it fires this time
  // (no stamp file = first run)
  const res = runStop(transcript, home);
  assert.equal(res.status, 0, `stop-hook failed: ${res.stderr}`);

  const reportPath = path.join(home, 'learn-report.md');
  assert.ok(fs.existsSync(reportPath), 'learn-report.md should be written by stop-hook');

  const report = fs.readFileSync(reportPath, 'utf8');
  assert.ok(report.includes('terraform'), 'report should mention terraform');
  assert.ok(report.includes('Unfiltered sinks'), 'report should have unfiltered sinks section');
});

test('Integration: session-start surfaces unseen report as additionalContext', () => {
  const home = freshHome();

  // Pre-write a report + mark as unseen
  const reportPath = path.join(home, 'learn-report.md');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(reportPath, '# lakonai — token sink report\n\n**Score: 72/100** — 80.0k tok saved\n\n## Unfiltered sinks\n\n- **terraform** — 30.0k tok total\n\n_Generated: 2026-01-01T00:00:00.000Z_\n');
  fs.writeFileSync(path.join(home, 'report-seen'), '0');

  const res = runSessionStart(home);
  assert.equal(res.status, 0, `session-start failed: ${res.stderr}`);
  assert.ok(res.stdout.trim(), 'should have JSON output');

  const out = JSON.parse(res.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes('Score: 72/100'), `additionalContext should include score, got: ${ctx}`);
  assert.ok(ctx.includes('lakonai learn:'), 'should be prefixed with "lakonai learn:"');
});

test('Integration: session-start is silent after report already seen', () => {
  const home = freshHome();

  const reportPath = path.join(home, 'learn-report.md');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(reportPath, '# lakonai — token sink report\n\n**Score: 72/100**\n');
  fs.writeFileSync(path.join(home, 'report-seen'), '1'); // already seen

  const res = runSessionStart(home);
  assert.equal(res.status, 0);
  // No JSON output = no additionalContext (hook exits silently)
  assert.equal(res.stdout.trim(), '', 'should be silent when report already seen');
});

test('Integration: stop-hook respects daily TTL — does not re-write report within 24h', () => {
  const home = freshHome();

  // Write a stamp with "just now" timestamp
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'last-report-ts'), JSON.stringify({ t: Date.now() }));

  const transcript = writeTranscript(home, {
    usage: { input_tokens: 100, output_tokens: 20 },
  });

  runStop(transcript, home);

  const reportPath = path.join(home, 'learn-report.md');
  assert.ok(!fs.existsSync(reportPath), 'report should NOT be re-written within TTL');
});

test('Integration: full pipeline — stop-hook → report → session-start → seen on second start', () => {
  const home = freshHome();

  fs.writeFileSync(
    path.join(home, 'learn-stats.json'),
    JSON.stringify({ terraform: { count: 6, tokens: 12000 } })
  );

  const transcript = writeTranscript(home, {
    usage: { input_tokens: 800, output_tokens: 150 },
  });

  // 1. Session ends → stop-hook runs
  const stopRes = runStop(transcript, home);
  assert.equal(stopRes.status, 0);
  assert.ok(fs.existsSync(path.join(home, 'learn-report.md')), 'report written');

  // 2. Next session starts → summary surfaced
  const start1 = runSessionStart(home);
  assert.equal(start1.status, 0);
  const out1 = JSON.parse(start1.stdout);
  assert.ok(out1.hookSpecificOutput.additionalContext.includes('lakonai learn:'));

  // 3. Same session starts again → silent
  const start2 = runSessionStart(home);
  assert.equal(start2.status, 0);
  assert.equal(start2.stdout.trim(), '', 'second session-start should be silent');
});

test('Integration: stop-hook with bash calls updates learn-stats and can trigger report', () => {
  const home = freshHome();

  // Transcript with a heavy unfiltered command (terraform, not a builtin)
  const heavyOutput = 'resource "aws_instance" "main" {\n'.repeat(200); // ~200 lines
  const transcript = writeTranscript(home, {
    bashCalls: [
      { id: 'tu1', cmd: 'terraform plan', output: heavyOutput },
      { id: 'tu2', cmd: 'terraform apply', output: heavyOutput },
    ],
    usage: { input_tokens: 1000, output_tokens: 200 },
  });

  const stopRes = runStop(transcript, home);
  assert.equal(stopRes.status, 0);

  // learn-stats should have terraform recorded
  const stats = JSON.parse(fs.readFileSync(path.join(home, 'learn-stats.json'), 'utf8'));
  assert.ok(stats.terraform, 'terraform should be tracked in learn-stats');
  assert.equal(stats.terraform.count, 2);
});
