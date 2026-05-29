# CLAUDE.md — lakonai-lib

Guidance for AI agents working in this repository.

## Testing policy — tests before commit (only at commit time)

This project uses **Jest** with a coverage gate. The rule:

- **When the user asks you to commit** new feature work, FIRST make sure the
  feature is covered by tests, then commit. Do not commit a new feature without
  accompanying tests.
- **Only at the end, at commit time.** Do not stop to write tests during
  incremental/iterative work — build the feature first, iterate freely. Tests
  are a precondition of the *commit*, not of every intermediate step.
- This applies to **new features**. Pure refactors, docs, and config tweaks that
  don't add behavior don't require new tests (but must not break existing ones).

Concretely, before running `git commit` for a feature:

1. Add/extend Jest tests covering the new behavior (happy path + edge cases).
2. Run `npm test` — it must exit green.
3. Run `npm run test:coverage` — global coverage must stay **≥ 80%**
   (lines / branches / functions / statements). Aim for 100%.
4. Then commit.

## Test commands

```bash
npm test                 # run the Jest suite
npm run test:coverage     # suite + coverage table (text + HTML in ./coverage)
npm run test:coverage:check  # same; the 80% threshold makes it fail if below
```

Coverage thresholds live in `jest.config.js` (`coverageThreshold.global`, 80%).
The HTML report is written to `coverage/index.html`.

## Testing conventions

- Tests live in `tests/**/*.test.js`. Jest provides `test`/`describe` as globals;
  assertions use `node:assert/strict`.
- **Prefer in-process unit tests over spawning subprocesses.** Coverage
  instrumentation does not track child processes — a hook tested only via
  `spawnSync('node', [hook])` shows 0% coverage even when it passes. Export the
  pure logic from a module and call it directly in the test.
- Hook entry points guard their runtime with `if (require.main === module)` so the
  module can be `require()`d in tests without executing `main()`. Wrap the I/O
  shell (`main`, `readStdin`) and best-effort tracking with `/* istanbul ignore
  next */` rather than asserting on `process.exit` side effects.
- Resolve the home directory via `homedir()` from `src/install/paths.js`
  (`process.env.HOME || os.homedir()`), not bare `os.homedir()` — the latter
  ignores a test-set `process.env.HOME` under Jest's sandbox and breaks home
  isolation.

## Layout

- `bin/lakonai.js` — CLI entry (run + filter, install, gain, inspect).
- `src/filters/` — per-command output filters (`git`, `ls`, `cat`, `grep`,
  `test`, shared `utils`).
- `src/hooks/` — Claude Code hooks (bash-rewrite, read-guard, grep-guard,
  session-start, stop-hook, throttle).
- `src/install/` — installer for platform rules + hooks.
