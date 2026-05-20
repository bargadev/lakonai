<p align="center">
  <img src="./assets/logo.svg" width="140" alt="lakonai" />
</p>

<h1 align="center">lakonai</h1>

<p align="center">
  <strong>Cut LLM tokens by up to 94% — without losing a single identifier.</strong>
</p>

<p align="center">
  <em>Spartan replies for AI agents. Less words. Win wars.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lakonai"><img src="https://img.shields.io/npm/v/lakonai?color=0F0F0F&label=npm" alt="npm" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0F0F0F" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-0F0F0F" alt="node ≥18" />
  <img src="https://img.shields.io/badge/deps-0-0F0F0F" alt="zero dependencies" />
  <img src="https://img.shields.io/badge/agents-6-0F0F0F" alt="6 AI agents" />
</p>

<p align="center">
  One command. <strong>Three fronts</strong>: terse model output · filtered shell output · blocked junk reads.<br/>
  Plus session-level token tracking and one-day update notifications.<br/>
  Works across <strong>Claude Code, Codex, Cursor, Windsurf, Cline, Gemini CLI</strong>.
</p>

---

## At a glance — measured savings

| Command                          | Raw tokens | Filtered | Saved   |
|----------------------------------|-----------:|---------:|--------:|
| `git log -p -10`                 |     10,497 |       78 | **-94%** |
| `ls -laR` (deep directory)       |     23,624 |      117 | **-94%** |
| `git diff HEAD~5`                |     13,230 |      798 | **-89%** |
| `git log --stat -50`             |      4,845 |      439 | **-86%** |
| `git status`                     |         17 |        1 | **-89%** |
| `Read pnpm-lock.yaml`            |    ~56,000 | **blocked** | **-95%** |
| `Grep` (auto `head_limit`)       |  unbounded | 30 matches | **capped** |

Conservative numbers — peaks go higher in practice. Run `lakonai inspect <cmd>` on your own commands to measure.

---

## The story behind the name

In 346 BC, Philip II of Macedon — father of Alexander the Great — sent the Spartans a message:

> *"If I invade Lakonía, I will raze your cities to the ground."*

The Spartans replied with a single word:

> *"If."*

That region was **Lakonía**. Its people gave the English language the word **laconic** — using as few words as possible. They didn't waste breath, didn't waste arrows, didn't waste anything.

Your AI coding agent does. It opens with *"Sure! I'd be happy to help…"*, repeats your question back, and explains what the diff already shows. It reads `git log` in full when one line per commit would do. Every wasted token is a soldier you didn't need to send.

**lakonai trims both sides.**

---

## Three fronts. One install.

| Front                          | Wasted tokens look like…                              | lakonai fixes it by…                                                                |
|--------------------------------|-------------------------------------------------------|-------------------------------------------------------------------------------------|
| **Output** (the model)         | *"Great question! Let me explain…"*                   | Installing a terse-response rule. No preamble, no recap, no restating.              |
| **Input** (your shell tools)   | `git log` dumping 1.8 k tokens of author metadata     | Wrapping `git`/`ls`/`grep`/`cat`/`tree`/`head`/`tail` and compressing before context. |
| **Reads** (file ingestion)     | Agent runs `Read` on `pnpm-lock.yaml` → 80 k of nothing | A `PreToolUse` hook on `Read` blocks lockfiles & `node_modules`, caps files >800 lines. |
| **Search** (Grep tool)         | `Grep` returns 800 matches and you re-read every one  | A `PreToolUse` hook on `Grep` auto-caps `head_limit` at 30 with a one-shot hint.        |
| **Analysis** (the rule)        | `Read` 5k of logs to count errors in your head        | "Think in code" — write `node -e '…filter…count'`, consume only the answer.            |

Other tools stop at one front. lakonai does all three transparently — your agent doesn't have to remember anything.

---

## Quick start

```bash
npm install -g lakonai
lakonai install
```

That's it. `lakonai install` configures your **global** agents — Claude Code, Codex, Gemini CLI — by writing rule blocks under `~/` only. It never touches your current directory by default.

Working inside a repo and want **per-project** rules (Cursor, Windsurf, Cline)? Add `--here`:

```bash
cd path/to/your/repo
lakonai install --here       # globals + per-project rules in this dir
```

From the next session forward your agent:

1. **Responds tersely** — no preamble, no restating, no recap. (rule in `CLAUDE.md` / equivalent)
2. **Has its `Bash` calls auto-rewritten** — `PreToolUse` hook intercepts `git`/`ls`/`cat`/`grep`/etc and prefixes them with `lakonai` transparently.
3. **Has its `Read` calls guarded** — a second hook denies `node_modules/`, lockfiles, and build artifacts (with a hint to `grep` instead), and auto-caps reads over 800 lines.
4. **Has its `Grep` calls capped** — a third hook auto-sets `head_limit` to 30 if you didn't, with a once-per-session hint to use `output_mode:"count"` for tallies.
5. **Is told to "think in code"** — for any count/filter/parse task, the rule pushes the agent toward a one-shot `node -e` (or `awk`) script that consumes the data so the agent consumes only the answer.
6. **Logs per-turn LLM token usage** — a `Stop` hook records `input_tokens` / `output_tokens` / `cache_read` after each model turn so `lakonai gain` shows model-side savings alongside shell-side savings.
7. **Tells you about new versions** — a `SessionStart` hook checks npm once per day and surfaces a `lakonai X.Y.Z available` notice inside the session (opt-out: `LAKON_NO_UPDATE_CHECK=1`).

You'll see savings stack up immediately in `lakonai gain`.

> Hooks are currently Claude Code-only (the only platform with documented hook APIs). For Codex/Cursor/Windsurf/Cline/Gemini, the rule asks the model to grep-before-Read and use the `lakonai` prefix itself.

> **Worried?** Every install backs up the target file first. `lakonai revert` puts it back byte-for-byte.

> **Upgrading from `lakon`?** The package was renamed to **lakonai** in 0.7.0. The `lakon` and `lak` commands still work as aliases, your `~/.lakon/` log + backups carry over untouched, and `lakonai install` rewrites your existing config block to the new brand. No migration needed.

---

## Use the filter directly

The CLI works as a standalone tool too. Run any shell command through `lakonai` (or the short alias `lak`) to filter its output:

```bash
lakonai git status        # compressed git status
lakonai git log -50       # one line per commit (hash + subject)
lakonai git diff          # only +/- lines, no noise
lakonai ls -la            # size + name only
lakonai grep -r foo src/  # truncates at 40 matches
```

Unsupported commands run unchanged.

---

## See your savings

```bash
lakonai gain
```

```
lakonai  — savings this week:  36.4k tok saved across 512 shell calls (67%)

shell + read/grep guards  (tokens filtered before context)
  win    calls       before          after          saved       %
  1h       12      1.2k tok       380 tok        820 tok   68%
  24h      87      9.8k tok      3.1k tok       6.7k tok   68%
  7d      512     54.2k tok     17.8k tok      36.4k tok   67%
  30d    2104    241.0k tok     79.2k tok     161.8k tok   67%
  all    2104    241.0k tok     79.2k tok     161.8k tok   67%

llm output  (model tokens — terse style trims this side)
  win    turns       input         output          cache-read
  1h        4       2.1k tok       320 tok      48.7k tok
  24h      38      18.4k tok      2.6k tok     412.2k tok
  7d      210     102.5k tok     14.1k tok     2.3M tok

top commands  (all time)
  git       812x   saved 124.3k tok  72%
  ls        541x   saved  18.2k tok  58%
  grep      339x   saved  12.0k tok  65%
```

The top block measures **input savings** (what filtered shell + guards prevented from entering context). The `llm output` block measures **model-side activity** so you can see verbosity dropping over time (and cache hits climbing). Set `LAKON_COLOR=1`/`0` (or `NO_COLOR=1`) to force/disable ANSI colors when piping.

### Inspect a single command

```bash
lakonai inspect git log
```

```
cmd:      git log
raw:      1234 tokens (8127 bytes)
filtered: 187 tokens (1240 bytes)
saved:    85%
```

---

## Commands

| Command                              | What it does                                                          |
|--------------------------------------|-----------------------------------------------------------------------|
| `lakonai install`                    | Install rule for detected GLOBAL agents only (no CWD writes)          |
| `lakonai install --here`             | Globals + per-project rules (Cursor/Windsurf/Cline) in current dir    |
| `lakonai install --only <p>`         | Install just one platform by id (any scope)                           |
| `lakonai uninstall`                  | Strip the lakonai block from each config (keeps your other content)   |
| `lakonai revert [--only <p>]`        | Restore each config to its pre-install state from backup              |
| `lakonai backups`                    | Show backup history per platform                                      |
| `lakonai list`                       | Show supported platforms and which are detected                       |
| `lakonai <cmd> [args]`               | Run a command, filter its output, track savings                       |
| `lakonai gain`                       | Show savings by hour / day / week / month / all-time + session totals |
| `lakonai inspect <cmd>`              | Run once and show raw-vs-filtered (no tracking)                       |
| `lakonai reset`                      | Wipe the savings log                                                  |
| `lakonai version` / `--version` / `-v` | Print the installed lakonai version                                 |

`lak` is the short alias for `lakonai`. `lakon` is kept as a legacy alias so existing setups keep working.

---

## Supported filters

| Command                | What it does                                                      |
|------------------------|-------------------------------------------------------------------|
| `git log`              | One line per commit (`<hash> <subject>`), capped at 50            |
| `git status`           | Drops hint paragraphs, separates changed vs untracked             |
| `git diff` / `show`    | Only `+`/`-`/`@@` lines, drops `index`/`---`/`+++`, cap 120 lines |
| `ls -la` / `tree`      | `<size>\t<name>` (drops perms / dates / link targets), cap 60     |
| `cat`                  | Collapses blank-line runs, cap 200 lines                          |
| `head` / `tail`        | Cap 50 lines                                                      |
| `grep` / `rg` / `ag`   | Cap 15 matches with "tighten the pattern" hint                    |

Unsupported commands run unchanged (passthrough), still tracked at 0 % savings.

### Read tool guard (Claude Code)

The `Read` hook automatically:

- **Denies** paths under `node_modules/`, `vendor/`, `dist/`, `build/`, `target/`, `.next/`, `.nuxt/`, `.turbo/`, `.svelte-kit/`, `.parcel-cache/`, `.vercel/`, `coverage/`, `__pycache__/`, `.venv/`, `.git/objects/`, `__snapshots__/`, `.ipynb_checkpoints/`, `.mypy_cache/`, `.pytest_cache/`, `.ruff_cache/`, `.tox/`, `cypress/screenshots/`, `cypress/videos/`, `playwright-report/`, `test-results/`, `.idea/`, `.vscode/`, `tmp/`
- **Denies** lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `go.sum`, `*.lock`)
- **Denies** build artifacts (`*.min.js`, `*.min.css`, `*.min.mjs`, `*.tsbuildinfo`, `*.map`, `*.log`, `*.pyc`, `*.pyo`, `*.so`, `*.o`, `*.a`, `*.dylib`, `*.dll`, `*.exe`, `*.class`, `*.wasm`)
- **Caps** files over 800 lines at 800 (with hint to `Read` again with `offset` for more, or `grep -n` for the symbol you need)

Each deny returns a one-line reason the model reads, so it knows to `grep -n` the symbol instead.

### Grep tool guard (Claude Code)

The `Grep` hook auto-sets `head_limit` to **30** when the agent didn't pass one. First call per 4-hour window includes a one-line hint suggesting `output_mode:"count"` for tallies; subsequent calls cap silently.

### Session output tracking (Claude Code)

A `Stop` hook fires at the end of every model turn, reads the latest `usage` block from the transcript, and appends a `cmd: "session"` entry to the log with `input_tokens`, `output_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens`.

`lakonai gain` renders these in a separate **session output** block (see example above) — so you can watch model-side verbosity drop and cache-hit ratios climb over time. Top commands list excludes session entries; they're not shell calls.

### Update notifications (Claude Code)

A `SessionStart` hook checks `registry.npmjs.org/lakonai/latest` at most once per 24 hours (cached at `~/.lakon/version.json`) and, if a newer version exists, emits a `hookSpecificOutput.additionalContext` that surfaces inside the Claude session:

```
lakonai 0.8.0 available (you have 0.7.0). Update: npm i -g lakonai@latest
```

Outside Claude, `lakonai gain` and `lakonai version` print the same notice on stderr (yellow when TTY).

**Opt out:** `LAKON_NO_UPDATE_CHECK=1`.
**Test endpoint:** `LAKON_REGISTRY_URL=http://localhost:8080/` (overrides the npm URL for local testing).

### Multi-profile Claude Code

If you use wrapper aliases like `claude-my=CLAUDE_CONFIG_DIR=$HOME/.claude-my claude` (e.g. one profile per Anthropic account or org), set the same env var when running `lakonai install` so hooks and the rule file land in the right config dir:

```bash
CLAUDE_CONFIG_DIR=$HOME/.claude-my   lakonai install
CLAUDE_CONFIG_DIR=$HOME/.claude-arco lakonai install
```

Each profile gets its own independent install. `lakonai uninstall` / `lakonai revert` respect the same env var.

---

## Supported AI agents

| Agent           | Scope    | What `lakonai install` writes                                                                          |
|-----------------|----------|--------------------------------------------------------------------------------------------------------|
| Claude Code¹    | global   | Rule block in `~/.claude/CLAUDE.md` + **five** hooks in `~/.claude/settings.json` (`PreToolUse`: Bash rewrite + Read guard + Grep guard; `Stop`: session-usage log; `SessionStart`: update notify) + `/lakonai:gain` `/lakonai:reset` `/lakonai:inspect` slash commands |
| Codex CLI       | global   | Rule block in `~/.codex/AGENTS.md`                                                                     |
| Gemini CLI      | global   | Rule block in `~/.gemini/GEMINI.md`                                                                    |
| Cursor          | project² | `.cursor/rules/lakonai.mdc` in the current dir                                                         |
| Windsurf        | project² | `.windsurf/rules/lakonai.md` in the current dir                                                        |
| Cline           | project² | `.clinerules/lakonai.md` in the current dir                                                            |

¹ "Claude Code" covers **every** Claude Code frontend — terminal CLI, VS Code extension, JetBrains plugin, desktop app. All read the same `~/.claude/CLAUDE.md` + `~/.claude/settings.json`, so one install lights up all of them.

² Project-scoped tools only read rules from the current directory, so `lakonai install` skips them by default to avoid scattering files across your repos. Add `--here` (or use `--project`) when you actually want them in the current dir.

Each install is **idempotent** (rerunning replaces the existing block) and **reversible** (`uninstall` strips it, `revert` restores from backup).

---

## Backup & revert

Before writing to your config file for the first time, `lakonai` copies it into `~/.lakon/backups/<platform>/<filename>.<timestamp>.bak`. Every install thereafter appends another snapshot to that file's manifest.

```bash
lakonai uninstall   # strips just the lakonai block; keeps your other CLAUDE.md content
lakonai revert      # restores the file to its pre-install state, byte for byte
lakonai backups     # shows every snapshot, per platform, with timestamps
```

Use `uninstall` to remove lakonai while keeping your other edits. Use `revert` when you want a clean rollback to exactly the file you had before.

---

## How tracking works

Every filtered command appends a JSON line to `~/.lakon/log.jsonl`. The `Stop` hook appends one line per model turn with token counts (`cmd: "session"`). `lakonai gain` reads that log and renders both sides separately.

The log stores: timestamp, command name, first few args, raw/filtered token counts (shell entries); timestamp, session id, `input_tokens` / `output_tokens` / `cache_read` / `cache_create` (session entries). **No file contents. No full arguments. No transcript content. No data ever leaves your machine** — except the one daily HEAD request to `registry.npmjs.org` for the update check (opt-out: `LAKON_NO_UPDATE_CHECK=1`).

Override the location with `LAKON_HOME=/path`. Disable per-command logging with `LAKON_NO_TRACK=1`.

> Note: env vars and the data dir keep the historical `LAKON_*` / `~/.lakon/` names so existing installs keep their logs and backups intact. New installs land there too.

---

## Configuration

| Env var                 | Effect                                                                       |
|-------------------------|------------------------------------------------------------------------------|
| `LAKON_HOME`            | Where to keep the log + backups + version cache (default `~/.lakon`)         |
| `LAKON_NO_TRACK`        | Set to `1` to disable per-command logging                                    |
| `LAKON_NO_UPDATE_CHECK` | Set to `1` to disable the `SessionStart` npm check + terminal hint           |
| `LAKON_REGISTRY_URL`    | Override the npm registry URL used by the update check (testing)             |
| `LAKON_COLOR`           | `1` forces ANSI colors in `lakonai gain`; `0` disables; unset = TTY auto-detect |
| `NO_COLOR`              | Standard. Disables ANSI colors when set to any non-empty value.              |
| `CLAUDE_CONFIG_DIR`     | When set during `lakonai install` / `uninstall`, hooks + rule land in that dir instead of `~/.claude/`. Used for multi-profile setups. |

---

## Philosophy

> *"Brevity is the soul of wit."* — Shakespeare, *Hamlet*
> *"Vēnī, vīdī, vīcī."* — Julius Caesar, three words to describe winning a war.
> *"If."* — Spartans, refusing to be intimidated by a single conditional.

Every token your agent emits or reads is paid for — in latency, in money, in context budget. The fastest way to think clearly is to speak briefly. lakonai doesn't make your agent dumber; it makes it Spartan.

---

## Development

```bash
git clone https://github.com/bargadev/lakonai-lib
cd lakonai-lib
npm install                       # only devDeps (c8 for coverage); zero runtime deps
node --test tests/                # run the suite
npm run test:coverage             # text + HTML coverage report (coverage/index.html)
npm run test:coverage:check       # fail if any metric drops below 100%
node bin/lakonai.js --help
```

Suite: **187 tests**. Coverage gate: **100% lines / 100% branches / 100% functions / 100% statements**. Zero runtime dependencies. Node ≥ 18.

---

## Credits

Built on ideas from two excellent projects:

- [**caveman**](https://github.com/juliusbrussee/caveman) — terse-prose rule + auto-clarity carve-outs.
- [**rtk**](https://github.com/rtk-ai/rtk) — CLI output filtering as a force multiplier for LLM agents.

lakonai condenses both into one zero-dependency npm package with a single install command, automatic backups, and time-windowed savings tracking.

---

## License

MIT. See [LICENSE](LICENSE).

---

<p align="center">
  <sub>Speak less. Ship more.</sub>
</p>
