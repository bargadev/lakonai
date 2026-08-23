# Sprint 4 — Pixel Benchmark

Converts skill file bodies (markdown) to PNG images so Claude reads them via
vision tokens instead of text tokens. Rendering: 512px wide × 8px monospace font
(one tile column), matching caveman's approach.

## Dry-run on real installed skills (2026-08-22)

| Skill | Text tok | Image tok | Saving |
|-------|----------|-----------|--------|
| codex/imagegen/SKILL.md | 3297 | 1615 | **-51%** |
| codex/imagegen/references/prompting.md | 1361 | 765 | **-44%** |
| codex/openai-docs/SKILL.md | 961 | 595 | **-38%** |
| codex/openai-docs/references/prompting-guide.md | 2112 | 1275 | **-40%** |
| codex/openai-docs/references/upgrade-guide.md | 1695 | 935 | **-45%** |
| codex/skill-creator/SKILL.md | 3078 | 1785 | **-42%** |
| **Total (profitable)** | **21867** | **15385** | **-30%** |

Small Claude Code commands (< 255 tok) are correctly skipped — minimum image
cost is 255 tokens (one 512×512 tile).

## Token math

- Vision tiles: `ceil(W/512) × ceil(H/512)` tiles, each = **170 tokens**
- Base cost per image: **85 tokens**
- 512px width → always 1 tile wide → cost scales only with height
- Break-even point: ~255 text tokens (≈ 1 page of a 512×512 PNG)

## Gate

```
if image_tokens >= text_tokens → skip (not profitable)
if no canvas package → skip (install canvas to enable)
```

## CLI

```bash
lakonai pixel --dry-run          # estimate savings, no writes
lakonai pixel                    # convert profitable skills (needs: npm install canvas)
lakonai pixel --agent claude     # only Claude Code commands
lakonai pixel --revert           # byte-identical restore from .orig.md backup
```

## Note

`canvas` (npm) required for actual PNG rendering. Dry-run works without it.
Install with: `npm install canvas` (has prebuilt binaries for macOS/Linux/Win).
