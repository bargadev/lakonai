# Changelog

All notable changes to **lakonai** are recorded here. The version log lives in
this file (no git tags). Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); this project uses semver.

## [Unreleased]

## [0.16.5] - 2026-06-09

### Fixed
- **`lakonai gain` no longer hangs forever on the output benchmark.** The
  benchmark fires several `claude --print` calls back-to-back, but `callAgent`
  ran `spawnSync` with no timeout — a single stalled CLI (auth prompt, network
  stall) blocked `gain` (and memory compression) indefinitely. Calls now carry a
  default 120s wall-clock cap (`SIGKILL` on expiry), so a hung agent aborts the
  bench instead of freezing the command. Override with `LAKONAI_LLM_TIMEOUT_MS`
  (set `0` to disable). On timeout the bench is skipped silently and `gain`
  finishes normally.

## [0.16.4] - 2026-06-02

### Fixed
- **`lakonai upgrade` no longer reinstalls the old version from a stale npm cache.**
  The npm path now passes `--prefer-online`, forcing npm to revalidate cached
  registry metadata before resolving `lakonai@latest`. Without it, a cached
  packument could keep `latest` pinned to a previous version (npm served `latest →
  0.16.2` even after 0.16.3 shipped), so `upgrade` silently no-op'd. No full
  `npm cache clean` — that wipes every package's cache and is discouraged;
  `--prefer-online` is the surgical fix.

## [0.16.3] - 2026-06-02

### Changed
- **`homepage` now points to the marketing site** (`https://bargadev.github.io/lakonai-site`)
  instead of the GitHub repo, so the npm page links to the landing page. The
  repository and bug-tracker links still point to GitHub.

## [0.16.2] - 2026-06-02

### Changed
- **README output-savings section now matches what `lakonai gain` actually shows.**
  After 0.16.1 fixed the bench, `gain` reports the rule's effect against a rule-free
  Claude baseline (~52% on prose prompts), not the old "~10% marginal vs an
  already-concise agent" framing. The section is rewritten honestly: the ~52% is
  labelled a best-case on prose turns, with the real workload landing between the
  deterministic input savings (~46%) and that ceiling. Example block refreshed to
  the current output format.

## [0.16.1] - 2026-06-02

### Fixed
- **Output benchmark in `lakonai gain` now actually measures (was stuck on "not
  measured yet").** The bench isolated the baseline arm from the installed terse
  rule by pointing `CLAUDE_CONFIG_DIR` at an empty dir — but on macOS that switches
  the Claude CLI to file-based auth, leaving it "Not logged in" (the credential
  lives in the Keychain, keyed to the default config dir). The CLI exited 1, the
  error was swallowed, and the figure never appeared. We now isolate the rule via
  the CLI's own flag instead (`--setting-sources project`, dropping the `user`
  source) plus an empty `cwd`, keeping Keychain auth intact. `callAgent` gains
  `ruleFree`/`cwd` options; the `cleanConfigDir`/`cleanEnvVar` path is removed.

## [0.16.0] - 2026-06-02

### Added
- **`compress-memory` takes a freeform instruction + validation levels.**
  `lakonai compress-memory <file> "focus on marketing"` steers the rewrite. Three
  safety levels: default (protect code+inline+URL - lossless), `--prune` (protect
  fenced code only - may drop sentences/spans), `--rewrite` (no validation, free
  restructure - backup only). Lets the LLM restructure/cut, not just shorten prose.
- **Smarter shim offer.** `lakonai install` now offers the universal shim **only
  when a hook-less agent is detected** (Codex/Cursor/Windsurf/Cline/Gemini) -
  Claude Code's hooks already cover shell filtering, so the shim is pointless
  there. Consensual prompt (TTY only), never silent.

- **`lakonai gain` now shows OUTPUT savings too**, not just input. Measures how
  much terser the model writes with the rule, via your local AI CLI (no API key),
  the rule injected as a system prompt (`claude --append-system-prompt`), at most
  weekly, TTY-only (never blocks a piped gain), cached in
  `~/.lakon/output-bench.json` (`src/output-bench.js`). No separate command: `gain`
  shows everything. Opt-out `LAKON_NO_OUTPUT_BENCH=1`. The figure is modest (single
  digits) because agent CLIs are already concise; shown honestly, not inflated
  (`docs/output-bench-vs-caveman.md`). Drops the old "offline / never measures
  output" stance; `deps-0` still holds (the AI CLI is external).
- **`lakonai upgrade`** updates via the detected package manager (npm/pnpm/yarn/
  bun) + refreshes the rule block (distinct "upgraded" output). oh-my-zsh-style: at
  a TTY, `gain`/`version` offer `Update now? [Y/n]` (`src/upgrade.js`,
  `src/update-prompt.js`; opt-out `LAKON_NO_AUTOUPDATE=1`).

### Changed
- README rewritten lean: 442 to ~170 lines (smaller than caveman's), deep
  reference moved to `docs/reference.md`. Removed em dashes project-wide.

### Removed
- `lakonai backups` command (low value; `revert` is what matters; the
  `backupsReport` helper stays internal).

## [0.15.1] - 2026-05-30

### Changed
- README: promoted the slogan **"Speak less. Ship more."** from a footer `<sub>`
  to a hero `<h3>` (a footer line nobody scrolls to isn't a slogan), and trimmed
  the redundant tagline.

## [0.15.0] - 2026-05-30

### Added
- **Platform-agnostic auto-learning.** Beyond the Claude-transcript learner,
  lakonai now also learns from `~/.lakon/log.jsonl` - appended to by every
  `lakonai` call (shim wrappers + rule-prefixed commands) on ANY agent. A heavy,
  frequent non-builtin command gets promoted to the filtered set automatically,
  everywhere, throttled hourly (`learn.analyzeLog` / `maybeLearnFromLog`, called
  from `runAndFilter`). Disable with `LAKON_NO_LEARN=1`. With the shim, all four
  input-side features now run automatically on every agent for shell-mediated
  work; only guarding the agent's own non-shell Read tool stays Claude-only.

### Changed
- Trimmed the Claude Code install line: shows `+ N slash commands` instead of
  listing every command.

### Notes
- Releases now publish **only via CI** on merge to `main` (no manual `npm
  publish`) - documented in CLAUDE.md.

## [0.14.0] - 2026-05-30

### Added
- **Universal Read-guard on the shell path** (`src/shim-guard.js`). `lakonai cat`
  /`head`/`tail`/`less`/`more`/`bat` now refuse junk reads (lockfiles,
  `node_modules/…`, build artifacts) using the **same deny rules as the Claude
  Read hook**. Combined with the shim, junk-read protection is now automatic on
  **every agent** for shell-mediated reads (`cat pnpm-lock.yaml` → skipped with a
  one-line reason), not just Claude Code's Read tool. An agent's own non-shell
  Read tool still needs a hook (Claude only); auto-learning stays Claude-only (it
  needs the agent's command stream) and is largely moot elsewhere since the shim
  already filters the standard heavy commands.

## [0.13.0] - 2026-05-30

### Added
- **Universal PATH shim** - `lakonai shim` (and `lakonai shim --off`). Makes
  shell-output filtering **automatic on every agent**, not just Claude Code:
  it drops executable wrappers for `ls`/`grep`/`rg`/`ag`/`find`/`cat`/`tree`/`head`
  into `~/.lakon/shim/` and prepends that dir to PATH in your shell rc, so any
  agent (Codex, Cursor, Windsurf, Cline, Gemini CLI) that runs those commands
  through a shell gets them routed through lakonai - no hook API, no model
  cooperation. `git`/`tail` are excluded (editors / streaming); recursion is
  prevented by stripping the shim dir from PATH when lakonai spawns the real
  binary (`pathWithoutShim`). Opt-in (it edits your shell rc); only reaches
  agents that inherit your shell's PATH. (`src/install/shim.js`.)
- The honest capability matrix now shows shell filtering as automatic on all six
  agents via the shim. Read/Grep guards + auto-learning remain Claude-Code-only
  (they act on the agent's own tool calls, which needs a call-rewriting hook -
  today only Claude Code's; Codex is blocked upstream, see openai/codex#18491).

## [0.12.1] - 2026-05-30

### Changed
- **README - sellable marketing pass.** Reframed the pitch as **four fronts** of
  token waste (model output · shell input · file reads · context catalogs+memory)
  and surfaced the two newest, most differentiating capabilities high up:
  automatic MCP catalog compression and `compress-memory` (no API key). No feature
  or number was invented; dropped a stale test-count/coverage claim.
- **CLAUDE.md** - added a rule to keep the npm package page ("About") in sync:
  npm only re-renders the README on publish, so a user-facing README change isn't
  done until it ships in a published version.

## [0.12.0] - 2026-05-30

### Added
- **Memory-file compression** - `lakonai compress-memory <file>` (+ `revert-memory`).
  Manual, opt-in compression of *user-authored* memory (`CLAUDE.md`, notes) using a
  local AI CLI you already have: `claude` / `gemini` / `codex` / `cursor-agent`,
  auto-detected on PATH (override `LAKONAI_MEM_CLI`; model via `LAKONAI_MEM_MODEL`).
  **No API key.** A `<name>.original.md` backup is written first; the output is
  **validated** so every fenced/inline code span and URL survives byte-for-byte -
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
- **Benchmark preview in `lakonai gain`** - when there's no usage logged yet,
  `gain` prints a reproducible, offline filter-savings benchmark so you see the
  value immediately (no separate command).

### Removed (simplification - back to one command set)
- `lakonai mode`, `compress`, `shrink`, `shell-init`/`shell-uninit`, `inspect`,
  `reset`, `list` commands and the `UserPromptSubmit` per-turn reinforcement hook
  and the terse subagents. These were caveman-parity experiments that diluted the
  "`install` → automatic savings" identity. Core surface is now `install`,
  `uninstall`, `revert`, `backups`, `gain`, `doctor`, `version` (+ the internal
  `lakonai <cmd>` filter engine). Filtering, Read/Grep guards and auto-learning
  are unchanged.

## [0.11.0] - 2026-05-30

### Added
- **`lakonai shrink <mcp-server-cmd>`** - a stdio MCP proxy that compresses tool/
  prompt/resource `description` fields before they enter context (offline, regex;
  `src/shrink.js`). Requests and tool-call results pass through untouched; code,
  URLs, paths and identifiers preserved exactly.

### Changed
- The MCP shrinker is now **bundled into lakonai** as a subcommand instead of a
  separate `lakonai-shrink` package - one install, one version, reuses the terse
  compressor. Fixed a description-compression bug (identifier over-matching +
  placeholder restore) found while folding it in.

## [0.10.0] - 2026-05-30

### Added
- **`lakonai doctor`** - per-platform health check: CLI on PATH, rule installed,
  hooks registered (`src/doctor.js`).
- **Honest capability matrix** in the README: exactly what each of the 6 agents
  gets (hooks are Claude-Code-only; elsewhere it's the rule + `lakonai` prefix).
- **`lakonai shell-init` / `shell-uninit`** - opt-in shell wrapper that
  auto-filters read-only commands when `LAKON_SHELL=1`, for platforms without a
  hook API (`src/shell.js`).
- **Terse subagents** (cavecrew-style) installed on Claude Code:
  `lakonai-investigator` / `lakonai-builder` / `lakonai-reviewer`, with compact
  output contracts (`src/install/claude-agents.js`).
- **OUTPUT benchmark harness** - `scripts/bench-output.js` measures how much less
  the model writes under the rule via your own `claude` CLI (3 arms: baseline /
  concise / lakonai; honest delta = vs concise), and `scripts/bench-measure.js`
  aggregates a committed snapshot offline (CI-safe). `npm run bench` /
  `bench:output` / `bench:measure`.

### Related (separate package)
- **`lakonai-shrink`** - a standalone, zero-dep stdio MCP proxy that compresses
  tool/prompt/resource `description` fields (offline). Ships independently.

## [0.9.0] - 2026-05-29

### Added (caveman-inspired, output/memory side)
- **Per-turn reinforcement** - a `UserPromptSubmit` hook (`src/hooks/prompt-reinforce.js`)
  re-injects the terse rule each turn so the model doesn't drift back to verbose
  prose mid-session. Opt out with `LAKON_NO_REINFORCE=1`.
- **Intensity levels** - `lakonai mode <lite|full|ultra>` (`src/mode.js`,
  persisted at `~/.lakon/mode`, override with `$LAKON_MODE`). The reinforcement
  reminder reflects the active level.
- **Formalized auto-clarity carve-outs** in the terse rule (security/irreversible
  confirmations, order-sensitive sequences, ambiguity, confusion).
- **`lakonai compress <file>`** (`src/compress.js`) - shrink memory files
  (CLAUDE.md/notes). Default is near-lossless and offline (blank/whitespace
  collapse, code/inline-code preserved). `--llm` rewrites prose tersely via the
  user's existing `claude` CLI (`claude --print`, no separate API key, no new
  dep); `--dry-run` previews savings without writing. Backs up to `<file>.bak`.
- **Terse workflow commands** `/lakonai:commit` and `/lakonai:review`.
- **Benchmark harness** (`scripts/bench.js` + `tests/fixtures/bench/`) - runs a
  fixed corpus through the filters and reports savings; `tests/bench.test.js`
  fails CI if a filter regresses below its threshold.

### Fixed
- **Installed hooks were broken** when they required the shared module graph
  (`bash-rewrite`→`../filters`, `stop-hook`→`../learn`). Installed hooks are now
  launchers that run the packaged hook in place, so relative requires resolve.

## [0.8.0] - 2026-05-29

### Added
- **Declarative filter engine** (`src/filters/engine.js` + `src/filters/defs.js`)
  - a 9-stage pipeline driven by data; adding a simple command filter is now one
  entry in `defs.js`.
- **Test-runner filtering** wired into the dispatch with stderr capture: jest,
  vitest, mocha, pytest, ava, `npm/pnpm/yarn/bun test`, `go test`, `cargo test` -
  collapse passes, keep failures + the summary.
- **Lint / build / cloud filters** via the engine: `tsc`, `eslint`, `ruff`,
  `cargo clippy`, `make`, `diff`, `docker`, `kubectl`, `aws`, package installs.
- **`find` filter** that groups matched paths by directory.
- **Auto-learning** (`src/learn.js` + `src/filters/auto.js`): reads the session
  transcript at session end, accumulates per-command output stats across sessions,
  and automatically enables a conservative, near-lossless filter for chatty
  unfiltered commands once they cross a floor. Opt out with `LAKON_NO_LEARN=1`.
- `dedupConsecutive` and `groupByDir` primitives in `utils`.
- `.claude/agents/lakonai-spec.md` - full-codebase knowledge agent.
- npm publish GitHub Action on merge to main (version-guarded) + branch
  protection (PRs only).

### Changed
- Coverage expanded from 4 commands to ~30.
- Migrated the test suite from `node:test` + c8 to **Jest**; suite at **270
  tests, 100% coverage**.
- Renamed the package/repo references from `lakonai-lib` to **lakonai**.

### Removed
- The legacy `lakon` and `lak` command aliases - use `lakonai`.

## [0.7.x] - earlier

Pre-changelog baseline: terse-output rule + filtered CLI output for `git`, `ls`,
`cat`, `grep`, plus the Read/Grep guards, session tracking, and the installer.
