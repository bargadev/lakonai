# CLAUDE.md — lakonai

Guidance for AI agents working in this repository.

## Keep the lakonai-spec agent current (always)

`.claude/agents/lakonai-spec.md` is the canonical knowledge base for this
codebase. **Whenever you change how lakonai works, update that agent in the same
change** — its file map, dispatch order, filter layers, learning thresholds, and
conventions must always match the code. Triggers to update it:

- adding/removing a filter, engine def, or supported command;
- changing the dispatch order, hook behavior, or the auto-learning thresholds/flow;
- moving files or renaming exported symbols.

Treat a stale agent as a bug. If you touch internals and don't update the agent,
the change is incomplete.

## Keep the README current (always)

`README.md` is the public face — it must never claim something the code doesn't
do. **Whenever you change user-facing behavior, update the README in the same
change.** Specifically keep these in sync with reality:

- the supported-command list, counts ("30 commands"), and the savings tables;
- feature claims (auto-learning, hooks, aliases) — never advertise a removed or
  unbuilt feature;
- numbers that drift: test count, coverage, version, default caps/thresholds;
- install/usage commands and flags.

A README that overstates or lies about a feature is worse than no README — it
burns trust. Verify the number before writing it (run the suite, grep the
constant). Treat a stale or inaccurate README as a release-blocking bug.

## Releasing (merge + CHANGELOG, no tags)

The version log lives in **`CHANGELOG.md`** — there are no git tags. To cut a
release:

1. On a branch, bump the version: `npm version <patch|minor|major> --no-git-tag-version`.
2. Add a matching `CHANGELOG.md` entry under a new `## [x.y.z] - YYYY-MM-DD` heading.
3. Open a PR and merge it (main is protected — PRs only).

On merge, the **Publish to npm** action publishes when `package.json` carries a
new version, no-ops when the version is unchanged, and **fails** if the version
was bumped to one that already exists on npm. Never bump the version without a
CHANGELOG entry in the same PR.

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
