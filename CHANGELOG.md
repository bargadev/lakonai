# Changelog

All notable changes to **lakonai** are recorded here. The version log lives in
this file (no git tags). Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); this project uses semver.

## [0.8.0] - 2026-05-29

### Added
- **Declarative filter engine** (`src/filters/engine.js` + `src/filters/defs.js`)
  — a 9-stage pipeline driven by data; adding a simple command filter is now one
  entry in `defs.js`.
- **Test-runner filtering** wired into the dispatch with stderr capture: jest,
  vitest, mocha, pytest, ava, `npm/pnpm/yarn/bun test`, `go test`, `cargo test` —
  collapse passes, keep failures + the summary.
- **Lint / build / cloud filters** via the engine: `tsc`, `eslint`, `ruff`,
  `cargo clippy`, `make`, `diff`, `docker`, `kubectl`, `aws`, package installs.
- **`find` filter** that groups matched paths by directory.
- **Auto-learning** (`src/learn.js` + `src/filters/auto.js`): reads the session
  transcript at session end, accumulates per-command output stats across sessions,
  and automatically enables a conservative, near-lossless filter for chatty
  unfiltered commands once they cross a floor. Opt out with `LAKON_NO_LEARN=1`.
- `dedupConsecutive` and `groupByDir` primitives in `utils`.
- `.claude/agents/lakonai-spec.md` — full-codebase knowledge agent.
- npm publish GitHub Action on merge to main (version-guarded) + branch
  protection (PRs only).

### Changed
- Coverage expanded from 4 commands to ~30.
- Migrated the test suite from `node:test` + c8 to **Jest**; suite at **270
  tests, 100% coverage**.
- Renamed the package/repo references from `lakonai-lib` to **lakonai**.

### Removed
- The legacy `lakon` and `lak` command aliases — use `lakonai`.

## [0.7.x] - earlier

Pre-changelog baseline: terse-output rule + filtered CLI output for `git`, `ls`,
`cat`, `grep`, plus the Read/Grep guards, session tracking, and the installer.
