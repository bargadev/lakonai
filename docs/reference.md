# lakonai - reference

Full detail behind the README. Most users never need this - `lakonai install` is
automatic. Here when you want the specifics.

## What the agent does after install

From the next session forward, on Claude Code:

1. **Responds tersely** - no preamble, restating, or recap (rule in `CLAUDE.md`).
2. **Bash auto-rewritten** - a `PreToolUse` hook prefixes `git`/`ls`/`grep`/… with `lakonai`.
3. **Read guarded** - denies `node_modules/`, lockfiles, build artifacts; caps files >800 lines.
4. **Grep capped** - auto-sets `head_limit` to 30 with a once-per-session hint.
5. **"Think in code"** - pushes count/filter/parse work into a one-shot `node -e`/`awk` script.
6. **Per-turn token usage logged** - a `Stop` hook records input/output/cache tokens.
7. **Update notice** - a `SessionStart` hook checks npm once/day.
8. **MCP catalogs auto-compressed** - see below.

Elsewhere (Codex/Cursor/Windsurf/Cline/Gemini) hooks don't exist, so the rule asks
the model to grep-before-Read and prefix `lakonai` itself; run `lakonai shim` to
make shell filtering automatic there too.

## Universal shim (`lakonai shim`)

Drops executable wrappers for `ls`/`grep`/`rg`/`ag`/`find`/`cat`/`tree`/`head` into
`~/.lakon/shim/` and prepends that dir to your shell rc PATH, so **any** agent that
runs them through a shell gets filtered output - no hook API, no model cooperation.
`git`/`tail` are excluded (editors/streaming). The shim's `cat`/`head` also refuse
junk reads (lockfiles, `node_modules/…`) - the Read-guard on the shell path.
Opt-in (edits your shell rc); only reaches agents that inherit your shell's PATH.
`lakonai shim --off` removes it.

## Compress a memory file (`lakonai compress-memory <file>`)

Rewrites `CLAUDE.md`/notes tersely using a **local AI CLI you already have** - no
API key. Measured ~59% on a verbose file, ~2% on an already-terse one; headings,
tables, code, paths and URLs preserved byte-for-byte. Always manual/opt-in: writes
a `<name>.original.md` backup first, validates (aborts untouched if any code/path/URL
would be lost, one auto-fix pass), and refuses sensitive filenames (`.env`, `*api-key*`).
`lakonai revert-memory <file>` restores from the backup.

Auto-detects, in order: `claude` (`claude --print`), `gemini` (`gemini -p`),
`codex` (`codex exec -`), `cursor-agent` (`cursor-agent -p`). Windsurf/Cline have
no headless CLI - use whichever of the above you also have. Force one with
`LAKONAI_MEM_CLI`; pick a model with `LAKONAI_MEM_MODEL`.

## Supported filters

| Command              | What it does                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `git log`            | One line per commit (`<hash> <subject>`), capped at 50                                                                     |
| `git status`         | Drops hint paragraphs, separates changed vs untracked                                                                      |
| `git diff` / `show`  | Only `+`/`-`/`@@` lines, drops `index`/`---`/`+++`, cap 120 lines                                                          |
| `ls -la` / `tree`    | `<size>\t<name>` (drops perms / dates / link targets), cap 60                                                              |
| `cat`                | Collapses blank-line runs, cap 200 lines                                                                                   |
| `head` / `tail`      | Cap 50 lines                                                                                                               |
| `grep` / `rg` / `ag` | Cap 15 matches with "tighten the pattern" hint                                                                             |
| `find`               | Groups matched paths by directory, drops permission-denied noise                                                           |
| test runners         | jest/vitest/mocha/pytest/ava, `npm/pnpm/yarn/bun test`, `go test`, `cargo test` - collapse passes, keep failures + summary |
| lint / build         | `tsc`, `eslint`, `ruff`, `cargo clippy`, `make` - strip noise, "ok" when clean                                             |
| pkg / cloud          | `npm/pnpm/yarn/bun install`, `diff`, `docker`, `kubectl`, `aws` - strip progress/noise, cap                                |

The last three groups use a declarative engine (`src/filters/defs.js`); adding a
command is usually one data entry. Unsupported commands pass through unchanged
(tracked at 0% savings).

## Auto-learning

lakonai learns from `~/.lakon/log.jsonl` (every `lakonai` call on any agent) and,
on Claude Code, the session transcript. When an unfiltered command keeps showing up
with heavy output, it enables a conservative, near-lossless filter for it
automatically (collapses repeated/blank lines, truncates with an announced marker -
never hides an error). Disable with `LAKON_NO_LEARN=1`.

## Read / Grep guards (Claude Code hooks)

**Read** denies paths under `node_modules/`, `vendor/`, `dist/`, `build/`,
`target/`, `.next/`, `.nuxt/`, `.turbo/`, `.svelte-kit/`, `.parcel-cache/`,
`.vercel/`, `coverage/`, `__pycache__/`, `.venv/`, `.git/objects/`, `__snapshots__/`,
`.ipynb_checkpoints/`, `.mypy_cache/`, `.pytest_cache/`, `.ruff_cache/`, `.tox/`,
`cypress/screenshots/`, `cypress/videos/`, `playwright-report/`, `test-results/`,
`.idea/`, `.vscode/`, `tmp/`; lockfiles (`package-lock.json`, `pnpm-lock.yaml`,
`yarn.lock`, `Cargo.lock`, `go.sum`, `*.lock`); and build artifacts (`*.min.js`,
`*.map`, `*.tsbuildinfo`, `*.pyc`, `*.so`, `*.exe`, `*.class`, `*.wasm`, …). Files
over 800 lines are capped at 800. Each deny returns a one-line reason so the model
greps instead.

**Grep** auto-sets `head_limit` to 30 when the agent didn't; first call per 4-hour
window hints `output_mode:"count"` for tallies.

## Capability matrix (per agent)

| Agent       | Terse rule | Shell filter         | Read/Grep guard       | Auto-learning   |
| ----------- | :--------: | -------------------- | --------------------- | --------------- |
| Claude Code |     ✅     | ✅ automatic (hook)  | ✅ tool + shell        | ✅ transcript+log |
| Codex CLI   |     ✅     | ✅ automatic (shim)  | ✅ shell reads (shim)  | ✅ from log      |
| Cursor      |     ✅     | ✅ automatic (shim)  | ✅ shell reads (shim)  | ✅ from log      |
| Windsurf    |     ✅     | ✅ automatic (shim)  | ✅ shell reads (shim)  | ✅ from log      |
| Cline       |     ✅     | ✅ automatic (shim)  | ✅ shell reads (shim)  | ✅ from log      |
| Gemini CLI  |     ✅     | ✅ automatic (shim)  | ✅ shell reads (shim)  | ✅ from log      |

The shim makes shell-mediated work automatic everywhere. The only thing not
automatic off Claude Code is guarding the agent's **own non-shell Read tool** -
that needs a call-rewriting hook, which today only Claude Code exposes (Codex
[can't yet rewrite a tool call](https://github.com/openai/codex/issues/18491);
Cursor can deny but not cap; Gemini's `BeforeTool` could - installer pending). Run
`lakonai doctor` to see what's active on your machine.

"Claude Code" covers every frontend (terminal CLI, VS Code, JetBrains, desktop) -
all read the same `~/.claude/`. Project-scoped tools (Cursor/Windsurf/Cline) only
read the current dir, so `lakonai install` skips them unless you pass `--here`.

## Update notifications

A `SessionStart` hook checks `registry.npmjs.org/lakonai/latest` at most once per
24h (cached at `~/.lakon/version.json`); a newer version surfaces inside the session
as `lakonai X.Y.Z available … Update: lakonai upgrade`. `lakonai gain`/`version`
print the same on stderr; at a TTY they offer `Update now? [Y/n]`. Opt out
`LAKON_NO_UPDATE_CHECK=1` (or `LAKON_NO_AUTOUPDATE=1` for just the prompt).

## Multi-profile Claude Code

For wrapper aliases (one profile per account/org), set `CLAUDE_CONFIG_DIR` when
installing so hooks + rule land in the right dir:

```bash
CLAUDE_CONFIG_DIR=$HOME/.claude-my      lakonai install
CLAUDE_CONFIG_DIR=$HOME/.claude-company lakonai install
```

Each profile installs independently; `uninstall`/`revert` respect the same var.

## Backup & revert

Before first writing a config file, lakonai copies it to
`~/.lakon/backups/<platform>/<file>.<timestamp>.bak`. `lakonai uninstall` strips
just the lakonai block (keeps your edits); `lakonai revert` restores the file
byte-for-byte from that backup.

## How tracking works (privacy)

Every filtered command appends a JSON line to `~/.lakon/log.jsonl`; the `Stop` hook
appends one line per model turn with token counts. The log stores only timestamps,
command names, first few args, and token counts - **no file contents, no full
arguments, no transcript content. Nothing leaves your machine** except the daily
HEAD request to `registry.npmjs.org` for the update check. Override location with
`LAKON_HOME`; disable logging with `LAKON_NO_TRACK=1`.

## Configuration

| Env var                 | Effect                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| `LAKON_HOME`            | Log + backups + cache dir (default `~/.lakon`)                              |
| `LAKON_NO_TRACK`        | Disable per-command logging                                                  |
| `LAKON_NO_LEARN`        | Disable auto-learning of new filters                                         |
| `LAKON_NO_MCP`          | Skip MCP catalog compression on install                                     |
| `LAKON_NO_UPDATE_CHECK` | Disable the npm update check + notice                                       |
| `LAKON_NO_AUTOUPDATE`   | Keep the notice but never prompt to update                                  |
| `LAKON_NO_OUTPUT_BENCH` | Skip the output-savings measurement in `gain`                              |
| `LAKONAI_MEM_CLI`       | Force the CLI `compress-memory` uses (`claude`/`gemini`/`codex`/`cursor-agent`) |
| `LAKONAI_MEM_MODEL`     | Model for `compress-memory`                                                  |
| `LAKON_COLOR` / `NO_COLOR` | Force / disable ANSI colors in `lakonai gain`                            |
| `CLAUDE_CONFIG_DIR`     | Install into a non-default Claude config dir (multi-profile)                |
| `LAKON_PM`              | Force the package manager `lakonai upgrade` uses                            |

Env vars and the data dir keep the historical `LAKON_*` / `~/.lakon/` names so
existing installs keep their logs and backups.

## Development

```bash
git clone https://github.com/bargadev/lakonai && cd lakonai
npm install        # devDeps only (jest); zero runtime deps
npm test
npm run test:coverage:check
```

Zero runtime dependencies. Node ≥ 18. Releases publish via CI on merge to `main`.

## Output-savings methodology

The `gain` output figure measures the same prompt with and without the rule via
your local CLI. Why the number depends on the baseline (~70% vs a verbose model,
~10% vs an already-concise agent), and why the no-key flow can't get a perfectly
clean baseline, is written up in
[output-bench-vs-caveman.md](./output-bench-vs-caveman.md) and
[benchmark-ai.md](./benchmark-ai.md).
