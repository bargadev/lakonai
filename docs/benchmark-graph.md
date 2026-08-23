# Sprint 3 — Graph Benchmark

AST knowledge graph built from lakonai's own codebase (102 JS files).
Zero LLM cost: pure regex-based extraction, runs in < 100ms.

## Build results (2026-08-22)

| Metric | Value |
|--------|-------|
| Files parsed | 102 |
| Nodes | 512 (102 file, 409 function, 1 class) |
| Edges | 573 |
| Communities detected | 6 |
| Build time | < 0.1s |

## Token savings vs reading source files

| Approach | Tokens |
|----------|--------|
| `Read` all 102 source files | ~117k tok |
| Query `graph.json` | ~45k tok |
| **Saving** | **-61%** |

The graph query substitutes `Read <file>` with a compact subgraph
summary — same information at a fraction of the cost.

## Output files

```
lakonai-graph/
├── graph.json        512 nodes, 573 edges — queryable without reading source
├── GRAPH_REPORT.md   highlights: communities, key nodes, suggested questions
└── graph.html        force-directed interactive viz, community-colored nodes
```

## CLI

```bash
lakonai graph build [path]       # parse codebase → graph.json (< 0.1s on this repo)
lakonai graph explain <nodeId>   # node + all edges
lakonai graph path <A> <B>       # shortest path between concepts
lakonai graph query "<question>" # BM25 → relevant subgraph (zero LLM)
lakonai graph html               # open interactive viz in browser
lakonai graph watch              # rebuild on file changes
```

## Architecture notes

- Language support: JS/TS (import/require/class/function/arrow), Python (def/class/import), Go (func/struct), Rust (fn/struct/impl)
- Community detection: label propagation (Leiden-approximation), pure JS, deterministic
- NL query: BM25 on node labels + file paths — zero LLM, zero cost
- read-guard hook: intercepts `Read <file>` when graph.json exists, returns subgraph instead of raw file
- Escape hatch: `LAKON_GRAPH_CAT=0` disables the intercept
