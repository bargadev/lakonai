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
  One install. <strong>Four fronts</strong> of token waste, closed at once:<br/>
  <strong>what the model writes</strong> · <strong>what your shell dumps in</strong> · <strong>what files it reads</strong> · <strong>the catalogs &amp; memory loaded every session</strong>.<br/>
  Filters <strong>30 commands</strong>, guards <code>Read</code>/<code>Grep</code>, compresses your <strong>MCP tool catalogs automatically</strong>,<br/>
  and shrinks your <strong>CLAUDE.md</strong> with a local AI CLI — <strong>no API key</strong>. Learns new filters the more you use it.<br/>
  Works across <strong>Claude Code, Codex, Cursor, Windsurf, Cline, Gemini CLI</strong>.
</p>

---

## At a glance — measured savings

| Command                    | Raw tokens |    Filtered |      Saved |
| -------------------------- | ---------: | ----------: | ---------: |
| `git log -p -10`           |     10,497 |          78 |   **-94%** |
| `ls -laR` (deep directory) |     23,624 |         117 |   **-94%** |
| `git diff HEAD~5`          |     13,230 |         798 |   **-89%** |
| `git log --stat -50`       |      4,845 |         439 |   **-86%** |
| `git status`               |         17 |           1 |   **-89%** |
| `npm test` (passing suite) |      4,451 |         358 |   **-92%** |
| `Read pnpm-lock.yaml`      |    ~56,000 | **blocked** |   **-95%** |
| `Grep` (auto `head_limit`) |  unbounded |  30 matches | **capped** |

Conservative numbers — peaks go higher in practice. Run `lakonai gain` to see your own savings stack up.

---

## The story behind the name

In 346 BC, Philip II of Macedon — father of Alexander the Great — sent the Spartans a message:

> _"If I invade Lakonía, I will raze your cities to the ground."_

The Spartans replied with a single word:

> _"If."_

That region was **Lakonía**. Its people gave the English language the word **laconic** — using as few words as possible. They didn't waste breath, didn't waste arrows, didn't waste anything.

Your AI coding agent does. It opens with _"Sure! I'd be happy to help…"_, repeats your question back, and explains what the diff already shows. It reads `git log` in full when one line per commit would do. Every wasted token is a soldier you didn't need to send.

**lakonai trims both sides.**

---

## Four fronts. One install.

| Front                        | Wasted tokens look like…                                           | lakonai fixes it by…                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Output** (the model)       | _"Great question! Let me explain…"_                                | Installing a terse-response rule. No preamble, no recap, no restating.                                                                                                                              |
| **Input** (your shell tools) | `git log` dumping 1.8 k tokens of author metadata                  | Wrapping **30 commands** — `git`/`ls`/`grep`/`cat`/`find`, **test runners** (jest/pytest/go/cargo), **lint/build** (tsc/eslint/ruff/make), **docker/kubectl/aws** — and compressing before context. |
| **Reads** (file ingestion)   | Agent runs `Read` on `pnpm-lock.yaml` → 80 k of nothing            | A `PreToolUse` hook on `Read` blocks lockfiles & `node_modules`, caps files >800 lines.                                                                                                             |
| **Search** (Grep tool)       | `Grep` returns 800 matches and you re-read every one               | A `PreToolUse` hook on `Grep` auto-caps `head_limit` at 30 with a one-shot hint.                                                                                                                    |
| **Context** (every session)  | MCP tool catalogs + your `CLAUDE.md`, re-paid every single session | **Auto-compressing MCP catalogs** on install; **opt-in `compress-memory`** for your memory files.                                                                                                   |
| **Analysis** (the rule)      | `Read` 5k of logs to count errors in your head                     | "Think in code" — write `node -e '…filter…count'`, consume only the answer.                                                                                                                         |

Most tools stop at one front. lakonai works all four transparently — your agent doesn't have to remember anything.

> **Two that are easy to miss:**
>
> - **MCP catalogs, compressed automatically.** Connect MCP servers and their tool/prompt/resource _descriptions_ load into context every session. On install, lakonai wraps each stdio server and shrinks those descriptions offline — no manual config (caveman's equivalent is hand-wired). Reversible; opt-out `LAKON_NO_MCP=1`.
> - **Your `CLAUDE.md`, compressed on command — no API key.** `lakonai compress-memory CLAUDE.md` rewrites your memory file using **a local AI CLI you already have** (`claude`/`gemini`/`codex`/`cursor-agent`). Backs up first, validates every code span / path / URL survives byte-for-byte. _(new in 0.12.0)_

> **★ It gets better the more you use it.** lakonai watches your session history and, when an unfiltered command keeps showing up with heavy output, it **turns on a safe filter for that command automatically** — no config, no manual rules. Similar tools only _report_ what you're missing; lakonai just fixes it. (Near-lossless: it collapses repetition and truncates with a marker, never silently dropping a line that could be an error. Opt out with `LAKON_NO_LEARN=1`.)

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
8. **Auto-compresses MCP tool catalogs** — if you have MCP servers in `~/.claude.json`, install transparently wraps each stdio server so its tool/prompt/resource **descriptions** are compressed before they hit context (offline; backed up; reverted on `uninstall`; opt-out `LAKON_NO_MCP=1`). Requests and tool-call results are never touched.

You'll see savings stack up immediately in `lakonai gain`.

### Make shell filtering automatic on _every_ agent (`lakonai shim`)

The hooks above are Claude-Code-only — they're the only platform whose hook API
can transparently rewrite a tool call. To get **automatic** shell-output
filtering on Codex, Cursor, Windsurf, Cline and Gemini CLI too, run:

```bash
lakonai shim          # prepend ~/.lakon/shim to PATH; lakonai shim --off to undo
```

This drops tiny executable wrappers for `ls`/`grep`/`rg`/`ag`/`find`/`cat`/`tree`/`head`
into `~/.lakon/shim/` and prepends that dir to your shell's PATH. Now **any** agent
that runs one of those commands through a shell gets its output filtered through
lakonai — no hook API, no model cooperation. `git` is deliberately excluded (its
subcommands open editors / stream), and the wrappers only shadow read-only,
single-shot commands so they can never break an interactive invocation.

It's **opt-in** because it edits your shell rc (`.zshrc`/`.bashrc`) and shadows
system commands on PATH. Caveat: it only reaches agents that inherit your shell's
PATH (terminal-launched CLIs do; some GUI apps with their own environment may not).

### Compress a memory file (opt-in)

Your `CLAUDE.md` (and other memory/notes) costs tokens **every session**. `lakonai compress-memory <file>` rewrites it tersely in place using **a local AI CLI you already have** — no API key to set up. A model rephrases and merges the prose (far higher savings than a regex pass — measured **~59%** on a verbose file, **~2%** on an already-terse one), while headings, tables, fenced code, inline code, paths and URLs are preserved byte-for-byte.

It auto-detects, in order, whichever agent CLI is on your PATH:

| CLI binary     | Platform    | Headless call     |
| -------------- | ----------- | ----------------- |
| `claude`       | Claude Code | `claude --print`  |
| `gemini`       | Gemini CLI  | `gemini -p`       |
| `codex`        | Codex       | `codex exec -`    |
| `cursor-agent` | Cursor      | `cursor-agent -p` |

(Windsurf and Cline ship no headless one-shot CLI, so on those you just use whichever of the above you also have. Force a specific one with `LAKONAI_MEM_CLI=gemini`; pick a model with `LAKONAI_MEM_MODEL`.)

```bash
lakonai compress-memory CLAUDE.md   # uses your local agent CLI; backup to CLAUDE.original.md
lakonai revert-memory   CLAUDE.md   # restore from the backup
```

Unlike the MCP catalog above, this is **always manual and opt-in** — it edits text you authored, so a `CLAUDE.original.md` backup is written first, the result is **validated** (aborts untouched if any code/path/URL would be lost; one auto-fix pass first), and nothing happens unless you ask. Sensitive-looking filenames (`.env`, `*api-key*`, …) are refused since their bytes cross the model boundary. `lakonai install` offers a one-time prompt to compress a detected `CLAUDE.md`; declining leaves it alone.

> Hooks are currently Claude Code-only (the only platform with documented hook APIs). For Codex/Cursor/Windsurf/Cline/Gemini, the rule asks the model to grep-before-Read and use the `lakonai` prefix itself.

> **Worried?** Every install backs up the target file first. `lakonai revert` puts it back byte-for-byte.

> **Upgrading from `lakon`?** The package was renamed to **lakonai** in 0.7.0; the legacy `lakon` / `lak` command aliases were since removed — use `lakonai`. Your `~/.lakon/` log + backups carry over untouched, and `lakonai install` rewrites your existing config block to the new brand.

---

## Use the filter directly

The CLI works as a standalone tool too. Run any shell command through `lakonai` to filter its output:

```bash
lakonai git status        # compressed git status
lakonai git log -50       # one line per commit (hash + subject)
lakonai git diff          # only +/- lines, no noise
lakonai ls -la            # size + name only
lakonai grep -r foo src/  # truncates at 15 matches
lakonai npm test          # passing suite collapses to its summary line
lakonai find . -name '*.ts'  # groups matches by directory
```

Unsupported commands run unchanged.

---

## See your savings

```bash
lakonai gain
```

```
lakonai — saved 161.8k tok (67% smaller) across 2104 commands

  today      6.7k tok saved  (68%)
  this week  36.4k tok saved  (67%)

  top: git 124.3k tok · ls 18.2k tok · grep 12.0k tok
```

Simple and objective: one headline number, today/this-week, and your top commands.
Before you have any data, `gain` shows a sample benchmark so you see what the
filters do. Set `LAKON_COLOR=1`/`0` (or `NO_COLOR=1`) to force/disable ANSI colors.

---

## Commands

After `lakonai install`, everything is automatic — you rarely need anything but
`gain` (to see the savings) and `doctor` (to check it's active).

| Command                                 | What it does                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `lakonai install [--here] [--only <p>]` | Install rule + hooks (globals by default; `--here` adds per-project)                |
| `lakonai uninstall`                     | Strip the lakonai block from each config (keeps your other content)                 |
| `lakonai revert [--only <p>]`           | Restore each config to its pre-install state from backup                            |
| `lakonai backups`                       | Show backup history per platform                                                    |
| `lakonai shim [--off]`                  | Enable/disable the universal PATH shim — automatic shell filtering on _every_ agent |
| `lakonai compress-memory <file>`        | Shrink an authored memory file with your local agent CLI (opt-in, backed up, validated) |
| `lakonai revert-memory <file>`          | Restore a memory file from its `.original.md` backup                                |
| `lakonai gain`                          | Show savings by window + top commands (and a sample benchmark before you have data) |
| `lakonai doctor`                        | Per-platform health: CLI on PATH, rule installed, hooks registered                  |
| `lakonai <cmd> [args]`                  | (internal) Run a command, filter its output, track savings                          |
| `lakonai version` / `--version` / `-v`  | Print the installed lakonai version                                                 |

---

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
| test runners         | jest/vitest/mocha/pytest/ava, `npm/pnpm/yarn/bun test`, `go test`, `cargo test` — collapse passes, keep failures + summary |
| lint / build         | `tsc`, `eslint`, `ruff`, `cargo clippy`, `make` — strip noise, "ok" when clean                                             |
| pkg / cloud          | `npm/pnpm/yarn/bun install`, `diff`, `docker`, `kubectl`, `aws` — strip progress/noise, cap                                |

The last three groups are powered by a declarative engine (`src/filters/defs.js`)
plus a couple of structured filters; adding a new command is usually one data entry.

Unsupported commands run unchanged (passthrough), still tracked at 0 % savings.

### Gets better the more you use it (auto-learning)

lakonai watches your session history (the Claude Code transcript) and, when an
**unfiltered** command keeps showing up with heavy output, it **enables a
conservative filter for it automatically** — no config, no manual rules. The
auto-filter is near-lossless (collapses repeated/blank lines, truncates only
with an announced marker) so it never hides a real error. Disable with
`LAKON_NO_LEARN=1`.

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
CLAUDE_CONFIG_DIR=$HOME/.claude-company lakonai install
```

Each profile gets its own independent install. `lakonai uninstall` / `lakonai revert` respect the same env var.

---

## Supported AI agents

| Agent        | Scope    | What `lakonai install` writes                                                                                                                                                                                                                      |
| ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code¹ | global   | Rule block in `~/.claude/CLAUDE.md` + **five** hooks in `~/.claude/settings.json` (`PreToolUse`: Bash rewrite + Read guard + Grep guard; `Stop`: session-usage log + auto-learning; `SessionStart`: update notify) + `/lakonai:gain` slash command |
| Codex CLI    | global   | Rule block in `~/.codex/AGENTS.md`                                                                                                                                                                                                                 |
| Gemini CLI   | global   | Rule block in `~/.gemini/GEMINI.md`                                                                                                                                                                                                                |
| Cursor       | project² | `.cursor/rules/lakonai.mdc` in the current dir                                                                                                                                                                                                     |
| Windsurf     | project² | `.windsurf/rules/lakonai.md` in the current dir                                                                                                                                                                                                    |
| Cline        | project² | `.clinerules/lakonai.md` in the current dir                                                                                                                                                                                                        |

### What each agent actually gets (honest capability matrix)

Shell-output **filtering is automatic on every agent** once you run `lakonai
shim` (see below) — it routes commands through lakonai at the PATH level, so no
hook API and no model cooperation is needed. The other input-side features
(Read/Grep guards, auto-learning) act on the agent's *own* tool calls, so they
still require a tool-interception hook — which today only Claude Code exposes
with the ability to rewrite a call. Honest matrix:

| Agent       | Terse rule | Shell filter            | Read/Grep guard | Auto-learning |
| ----------- | :--------: | ----------------------- | :-------------: | :-----------: |
| Claude Code |     ✅     | ✅ automatic (hook)     |       ✅        |      ✅       |
| Codex CLI   |     ✅     | ✅ automatic (shim¹)    |   ❌ (upstream²) |      ❌       |
| Cursor      |     ✅     | ✅ automatic (shim¹)    |   ⚠️ block-only³ |      ❌       |
| Windsurf    |     ✅     | ✅ automatic (shim¹)    |       ❌        |      ❌       |
| Cline       |     ✅     | ✅ automatic (shim¹)    |       ❌        |      ❌       |
| Gemini CLI  |     ✅     | ✅ automatic (shim¹)    |   ❌ (buildable⁴)|      ❌       |

Run `lakonai doctor` to see, per platform, what's actually active on your machine.

¹ `lakonai shim` prepends `~/.lakon/shim` to PATH so `ls`/`grep`/`rg`/`ag`/`find`/`cat`/`tree`/`head` filter automatically for any agent that runs them through a shell (opt-in — it edits your shell rc; `git` is excluded for safety). Without it, those commands filter only when the model prefixes `lakonai` itself.
² Codex's hook can block a tool call but [can't yet rewrite its input](https://github.com/openai/codex/issues/18491), so the Read/Grep guard can't be made automatic there yet.
³ Cursor's `beforeReadFile` hook can deny a read but not filter/cap its contents.
⁴ Gemini's `BeforeTool` hook *can* rewrite/cap a tool call; a Gemini guard installer is planned but not shipped (needs validation against the real CLI schema).

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

Every filtered command appends a JSON line to `~/.lakon/log.jsonl`. The `Stop` hook appends one line per model turn with token counts (`cmd: "session"`). `lakonai gain` reads that log and shows a simple headline + per-window + top-commands summary.

The log stores: timestamp, command name, first few args, raw/filtered token counts (shell entries); timestamp, session id, `input_tokens` / `output_tokens` / `cache_read` / `cache_create` (session entries). **No file contents. No full arguments. No transcript content. No data ever leaves your machine** — except the one daily HEAD request to `registry.npmjs.org` for the update check (opt-out: `LAKON_NO_UPDATE_CHECK=1`).

Override the location with `LAKON_HOME=/path`. Disable per-command logging with `LAKON_NO_TRACK=1`.

> Note: env vars and the data dir keep the historical `LAKON_*` / `~/.lakon/` names so existing installs keep their logs and backups intact. New installs land there too.

---

## Configuration

| Env var                 | Effect                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `LAKON_HOME`            | Where to keep the log + backups + version cache (default `~/.lakon`)                                                                   |
| `LAKON_NO_TRACK`        | Set to `1` to disable per-command logging                                                                                              |
| `LAKON_NO_UPDATE_CHECK` | Set to `1` to disable the `SessionStart` npm check + terminal hint                                                                     |
| `LAKON_REGISTRY_URL`    | Override the npm registry URL used by the update check (testing)                                                                       |
| `LAKON_COLOR`           | `1` forces ANSI colors in `lakonai gain`; `0` disables; unset = TTY auto-detect                                                        |
| `NO_COLOR`              | Standard. Disables ANSI colors when set to any non-empty value.                                                                        |
| `CLAUDE_CONFIG_DIR`     | When set during `lakonai install` / `uninstall`, hooks + rule land in that dir instead of `~/.claude/`. Used for multi-profile setups. |

---

## Philosophy

> _"Brevity is the soul of wit."_ — Shakespeare, _Hamlet_
> _"Vēnī, vīdī, vīcī."_ — Julius Caesar, three words to describe winning a war.
> _"If."_ — Spartans, refusing to be intimidated by a single conditional.

Every token your agent emits or reads is paid for — in latency, in money, in context budget. The fastest way to think clearly is to speak briefly. lakonai doesn't make your agent dumber; it makes it Spartan.

---

## Development

```bash
git clone https://github.com/bargadev/lakonai
cd lakonai
npm install                       # only devDeps (jest for tests/coverage); zero runtime deps
npm test                          # run the Jest suite
npm run test:coverage             # text + HTML coverage report (coverage/index.html)
npm run test:coverage:check       # enforce the coverage threshold
node bin/lakonai.js --help
```

Zero runtime dependencies. Node ≥ 18.

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
