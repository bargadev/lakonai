# Changelog

All notable changes to **lakonai** are recorded here. The version log lives in
this file (no git tags). Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); this project uses semver.

## [Unreleased]

## [0.12.1] - 2026-05-30

### Changed
- **README — sellable marketing pass.** Reframed the pitch as **four fronts** of
  token waste (model output · shell input · file reads · context catalogs+memory)
  and surfaced the two newest, most differentiating capabilities high up:
  automatic MCP catalog compression and `compress-memory` (no API key). No feature
  or number was invented; dropped a stale test-count/coverage claim.
- **CLAUDE.md** — added a rule to keep the npm package page ("About") in sync:
  npm only re-renders the README on publish, so a user-facing README change isn't
  done until it ships in a published version.

## [0.12.0] - 2026-05-30

### Added
- **Memory-file compression** — `lakonai compress-memory <file>` (+ `revert-memory`).
  Manual, opt-in compression of *user-authored* memory (`CLAUDE.md`, notes) using a
  local AI CLI you already have: `claude` / `gemini` / `codex` / `cursor-agent`,
  auto-detected on PATH (override `LAKONAI_MEM_CLI`; model via `LAKONAI_MEM_MODEL`).
  **No API key.** A `<name>.original.md` backup is written first; the output is
  **validated** so every fenced/inline code span and URL survives byte-for-byte —
  on a miss it runs one fix pass, else aborts untouched. Sensitive-looking
  filenames (`.env`, `*api-key*`, …) are refused. `install` offers a one-time
  opt-in prompt to compress a detected `CLAUDE.md`. Unlike the MCP catalog shrink,
  this rewrites authored prose with an LLM, so it is **never automatic**
  (`src/mem-llm.js` + `src/mem-compress.js`). Measured: ~59% on a verbose file,
  ~2% on an already-terse one.
- **Automatic MCP catalog compression.** On Claude Code install, lakonai finds
  the MCP servers in `~/.claude.json` and transparently wraps each stdio server
  (`lakonai __mcp <cmd>`) so its tool/prompt/resource **descriptions** are
  compressed before they reach context (offline, regex; `src/mcp-shrink.js` +
  `src/install/mcp.js`). Backed up, reversible on `uninstall`, opt-out
  `LAKON_NO_MCP=1`. Requests and tool-call results are never altered. (Caveman's
  MCP shrinker is manual config; this is automatic.)
- **Benchmark preview in `lakonai gain`** — when there's no usage logged yet,
  `gain` prints a reproducible, offline filter-savings benchmark so you see the
  value immediately (no separate command).

### Removed (simplification — back to one command set)
- `lakonai mode`, `compress`, `shrink`, `shell-init`/`shell-uninit`, `inspect`,
  `reset`, `list` commands and the `UserPromptSubmit` per-turn reinforcement hook
  and the terse subagents. These were caveman-parity experiments that diluted the
  "`install` → automatic savings" identity. Core surface is now `install`,
  `uninstall`, `revert`, `backups`, `gain`, `doctor`, `version` (+ the internal
  `lakonai <cmd>` filter engine). Filtering, Read/Grep guards and auto-learning
  are unchanged.

## [0.11.0] - 2026-05-30

### Added
- **`lakonai shrink <mcp-server-cmd>`** — a stdio MCP proxy that compresses tool/
  prompt/resource `description` fields before they enter context (offline, regex;
  `src/shrink.js`). Requests and tool-call results pass through untouched; code,
  URLs, paths and identifiers preserved exactly.

### Changed
- The MCP shrinker is now **bundled into lakonai** as a subcommand instead of a
  separate `lakonai-shrink` package — one install, one version, reuses the terse
  compressor. Fixed a description-compression bug (identifier over-matching +
  placeholder restore) found while folding it in.

## [0.10.0] - 2026-05-30

### Added
- **`lakonai doctor`** — per-platform health check: CLI on PATH, rule installed,
  hooks registered (`src/doctor.js`).
- **Honest capability matrix** in the README: exactly what each of the 6 agents
  gets (hooks are Claude-Code-only; elsewhere it's the rule + `lakonai` prefix).
- **`lakonai shell-init` / `shell-uninit`** — opt-in shell wrapper that
  auto-filters read-only commands when `LAKON_SHELL=1`, for platforms without a
  hook API (`src/shell.js`).
- **Terse subagents** (cavecrew-style) installed on Claude Code:
  `lakonai-investigator` / `lakonai-builder` / `lakonai-reviewer`, with compact
  output contracts (`src/install/claude-agents.js`).
- **OUTPUT benchmark harness** — `scripts/bench-output.js` measures how much less
  the model writes under the rule via your own `claude` CLI (3 arms: baseline /
  concise / lakonai; honest delta = vs concise), and `scripts/bench-measure.js`
  aggregates a committed snapshot offline (CI-safe). `npm run bench` /
  `bench:output` / `bench:measure`.

### Related (separate package)
- **`lakonai-shrink`** — a standalone, zero-dep stdio MCP proxy that compresses
  tool/prompt/resource `description` fields (offline). Ships independently.

## [0.9.0] - 2026-05-29

### Added (caveman-inspired, output/memory side)
- **Per-turn reinforcement** — a `UserPromptSubmit` hook (`src/hooks/prompt-reinforce.js`)
  re-injects the terse rule each turn so the model doesn't drift back to verbose
  prose mid-session. Opt out with `LAKON_NO_REINFORCE=1`.
- **Intensity levels** — `lakonai mode <lite|full|ultra>` (`src/mode.js`,
  persisted at `~/.lakon/mode`, override with `$LAKON_MODE`). The reinforcement
  reminder reflects the active level.
- **Formalized auto-clarity carve-outs** in the terse rule (security/irreversible
  confirmations, order-sensitive sequences, ambiguity, confusion).
- **`lakonai compress <file>`** (`src/compress.js`) — shrink memory files
  (CLAUDE.md/notes). Default is near-lossless and offline (blank/whitespace
  collapse, code/inline-code preserved). `--llm` rewrites prose tersely via the
  user's existing `claude` CLI (`claude --print`, no separate API key, no new
  dep); `--dry-run` previews savings without writing. Backs up to `<file>.bak`.
- **Terse workflow commands** `/lakonai:commit` and `/lakonai:review`.
- **Benchmark harness** (`scripts/bench.js` + `tests/fixtures/bench/`) — runs a
  fixed corpus through the filters and reports savings; `tests/bench.test.js`
  fails CI if a filter regresses below its threshold.

### Fixed
- **Installed hooks were broken** when they required the shared module graph
  (`bash-rewrite`→`../filters`, `stop-hook`→`../learn`). Installed hooks are now
  launchers that run the packaged hook in place, so relative requires resolve.

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
