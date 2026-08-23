# lakonai Full Benchmark — 2026-08-22

All three layers measured independently. Token count: `ceil(chars / 4)`.

## Layer 1 — CLI Filters

Filters strip noise from CLI command output before it reaches the model.

```
case                         raw tok   lakonai   saved
------------------------------------------------------
git log -p                       188        32     83%
npm test (passing)               181        11     94%
make                             112        48     57%
grep (60 matches)                300        82     73%
git log (real)                   610       610      0%
git diff (real)                 3841      1396     64%
git status (real)                342       260     24%
ls -la (real)                    354        72     80%
find src/ (real)                 321       227     29%
------------------------------------------------------
TOTAL                           6249      2738     56%
```

## Layer 2 — Graph Read-Guard

Intercepts file reads: serves compact subgraph summary instead of raw file content.

Graph: 512 nodes, 573 edges, 102 files.

```
case                                       raw tok   lakonai   saved
--------------------------------------------------------------------
bin/lakonai.js                                4994       276     94%
src/bench.js                                   745       151     80%
src/doctor.js                                  526       130     75%
src/filters/cat.js                             116        75     35%
src/filters/engine.js                          935       182     81%
src/filters/git.js                            1064       122     89%
src/filters/index.js                           701       185     74%
src/filters/ls.js                              230        72     69%
src/filters/test.js                            881       125     86%
src/filters/utils.js                           559       182     67%
src/graph/html.js                             2154       207     90%
src/graph/index.js                            1337        73     95%
src/graph/leiden.js                            817        79     90%
src/graph/parser.js                           2835       273     90%
src/graph/query.js                            1227       221     82%
src/graph/store.js                             413       170     59%
src/hooks/bash-rewrite.js                      371       110     70%
src/hooks/grep-guard.js                        577       132     77%
src/hooks/output-spill.js                      852       165     81%
src/hooks/read-guard.js                       2803       300     89%
--------------------------------------------------------------------
TOTAL                                        24137      3230     87%
```

0 file(s) skipped — not in graph or no subgraph available.

## Layer 3 — Proxy Compression

Compresses LLM request/response bodies (build logs, JSON, code, diffs).

```
case                         raw tok   lakonai   saved
------------------------------------------------------
build log (30 lines) [log]       727         8     99%
minified JSON (50 users) [log]    1475      1475      0%
JS code (15 fns) [code]          794       794      0%
system prompt (npm test) [text]     112       111      1%
------------------------------------------------------
TOTAL                           3108      2388     23%
```

## Layer 4 — Pixel (Skill PNG Conversion)

Converts verbose skill markdown to PNG images (vision tokens < text tokens).

_No installed skills found (run `lakonai install` first)._
## Combined Summary

```
case                             raw tok     lakonai   saved
------------------------------------------------------------
CLI filters                         6249        2738     56%
Graph read-guard (sampled)         24137        3230     87%
Proxy compression                   3108        2388     23%
------------------------------------------------------------
TOTAL                              33494        8356     75%
```

> Layers are independent — each operates on a different surface.
> Combined savings are additive across separate contexts, not compounded.
