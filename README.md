<p align="center">
  <img src="./assets/logo.svg" width="140" alt="lakonai" />
</p>

<h1 align="center">lakonai</h1>

<h3 align="center">Speak less. Ship more.</h3>

<p align="center">
  <strong>Cut LLM tokens by up to 94% - without losing a single identifier.</strong>
</p>

<p align="center"><em>Spartan replies for AI agents.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/lakonai"><img src="https://img.shields.io/npm/v/lakonai?color=0F0F0F&label=npm" alt="npm" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0F0F0F" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-0F0F0F" alt="node ≥18" />
  <img src="https://img.shields.io/badge/deps-0-0F0F0F" alt="zero dependencies" />
  <img src="https://img.shields.io/badge/agents-6-0F0F0F" alt="6 AI agents" />
</p>

<p align="center">
  One install. <strong>Four fronts</strong> of token waste, closed at once:<br/>
  <strong>what the model writes</strong> · <strong>what your shell dumps in</strong> · <strong>what it reads</strong> · <strong>the catalogs &amp; memory loaded every session</strong>.<br/>
  Works across <strong>Claude Code, Codex, Cursor, Windsurf, Cline, Gemini CLI</strong> - no API key.
</p>

---

## Savings, measured

| Command               | Raw tokens |    Filtered |    Saved |
| --------------------- | ---------: | ----------: | -------: |
| `git log -p -10`      |     10,497 |          78 | **-94%** |
| `ls -laR` (deep dir)  |     23,624 |         117 | **-94%** |
| `npm test` (passing)  |      4,451 |         358 | **-92%** |
| `git diff HEAD~5`     |     13,230 |         798 | **-89%** |
| `Read pnpm-lock.yaml` |    ~56,000 | **blocked** | **-95%** |

Conservative - peaks go higher. `lakonai gain` shows your own.

---

## What it does - four fronts

| Front                       | Wasted tokens look like…                            | lakonai fixes it by…                                                                |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Output** (the model)      | _"Great question! Let me explain…"_                 | A terse-response rule - no preamble, no recap.                                      |
| **Input** (your shell)      | `git log` dumping 1.8k tokens of metadata           | Filtering **30 commands** (git/ls/grep/tests/lint/docker…) before they hit context. |
| **Reads** (files)           | `Read pnpm-lock.yaml` → 80k of nothing              | A hook that blocks lockfiles/`node_modules`, caps huge files, and caps `Grep`.      |
| **Context** (every session) | MCP catalogs + your `CLAUDE.md`, re-paid every turn | Auto-compressing MCP catalogs; opt-in `compress-memory`.                            |

Most tools stop at one front. lakonai works all four - and **gets better the more
you use it**: it auto-learns new heavy commands and turns on a safe filter for them,
no config. ([full reference →](docs/reference.md))

---

## Quick start

```bash
npm install -g lakonai
lakonai install              # global agents (Claude Code / Codex / Gemini)
lakonai install --here       # + per-project rules (Cursor / Windsurf / Cline)
```

That's it - from the next session your agent is terse, its shell output filtered,
junk reads blocked, and MCP catalogs compressed. Watch it in `lakonai gain`.

Two extras worth knowing:

- **`lakonai shim`** - makes shell filtering automatic on **every** agent (not just
  Claude Code) by routing `ls`/`grep`/`find`/… through lakonai at the PATH level.
- **`lakonai compress-memory CLAUDE.md`** - shrinks your memory file with a **local
  AI CLI you already have, no API key** (backed up, validated byte-for-byte).

---

## Output savings: improvements on top of improvements

How much does the rule cut the model's output? We measured the **same rule, same
prompt** against two baselines:

| The model lakonai is layered on…            | …and the rule cuts |                                                |
| ------------------------------------------- | :----------------: | ---------------------------------------------- |
| a **raw, verbose** model (Gemini default)   |      **~70%**      | as strong as any terse-prompt tool             |
| **Claude Code** - already concise by design |   **~10% more**    | the hard case: trimming what's already trimmed |

_361 → 107 tokens on the verbose baseline; 240 → 216 on Claude Code. Same rule -
the only variable is how much fat the model started with._

Anyone can cut the obvious fat (~70% off a rambling API). lakonai's edge is the
**hard** case: point it at an agent that's _already_ optimized for brevity and it
**still finds another ~10%** - stacked on top of filtered shell output, blocked
reads, and compressed catalogs. **Improvements on top of improvements.**

> `lakonai gain` shows the honest **~10% marginal** number - what you actually save
> on _your_ already-concise agent, not an inflated raw-baseline headline.

---

## See your savings

```
lakonai - saved 161.8k tok (67% smaller) across 2104 commands

  today      6.7k tok saved  (68%)
  this week  36.4k tok saved  (67%)

  top: git 124.3k · ls 18.2k · grep 12.0k

  output (terse rule): ~10% fewer tokens vs your agent's baseline
```

Input is measured & deterministic; output is measured by your local AI CLI (no key,
weekly, at a TTY only). Both sides, one number.

---

## Commands

| Command                                                   | What it does                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `lakonai install [--here]`                                | Install rule + hooks (globals; `--here` adds per-project)      |
| `lakonai upgrade`                                         | Update to the latest version + refresh the rule block          |
| `lakonai uninstall` / `revert`                            | Strip the lakonai block / restore from backup                  |
| `lakonai shim [--off]`                                    | Universal PATH shim - automatic shell filtering on every agent |
| `lakonai compress-memory <file>` / `revert-memory <file>` | Shrink a memory file via your local AI CLI / undo              |
| `lakonai gain`                                            | Token savings - input (measured) and output (estimated)        |
| `lakonai doctor`                                          | Per-platform health: CLI on PATH, rule, hooks                  |

Full flags, filters, env vars and internals: **[docs/reference.md](docs/reference.md)**.

---

## Agents - what each one gets

| Agent                     | Installs                                             | Shell filter | Read/Grep guard | Auto-learn |
| ------------------------- | ---------------------------------------------------- | :----------: | :-------------: | :--------: |
| Claude Code               | `~/.claude/CLAUDE.md` + 5 hooks + MCP compress       |   ✅ hook    | ✅ tool + shell |     ✅     |
| Codex / Gemini            | rule in `~/.codex/AGENTS.md` · `~/.gemini/GEMINI.md` |   ✅ shim    | ✅ shell reads  |     ✅     |
| Cursor / Windsurf / Cline | per-project rule (`--here`)                          |   ✅ shim    | ✅ shell reads  |     ✅     |

Hooks are Claude-Code-only (the only platform with a call-rewriting hook API);
everywhere else `lakonai shim` makes the shell-mediated features automatic. The one
thing not universal is guarding an agent's **own non-shell Read tool** - see the
[honest matrix](docs/reference.md#capability-matrix-per-agent). Every install is
idempotent and reversible (`uninstall`/`revert`, backups first).

---

## Why "lakonai"

In 346 BC, Philip II of Macedon warned Sparta: _"If I invade Lakonía, I will raze
your cities."_ The Spartans replied with one word: _"If."_ Their region, **Lakonía**,
gave English the word **laconic** - using as few words as possible.

Your AI agent isn't laconic. It opens with _"Sure! I'd be happy to help…"_, repeats
your question, and reads `git log` in full. lakonai trims both sides.

---

## Credits

Built on ideas from [**caveman**](https://github.com/juliusbrussee/caveman) (terse
rule + auto-clarity) and [**rtk**](https://github.com/rtk-ai/rtk) (CLI output
filtering) - condensed into one zero-dependency package with automatic backups and
savings tracking.

MIT - see [LICENSE](LICENSE).
