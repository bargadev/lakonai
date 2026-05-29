# Roadmap: lakonai → paridade com rtk

Objetivo: cobrir o gap funcional com o rtk sem reescrever em Rust. Estratégia em
3 alavancas, ordenadas por ROI.

## Diagnóstico

| | lakonai (hoje) | rtk |
|---|---|---|
| Filtros | 4 JS bespoke | 59 TOML declarativos + ~30 parsers Rust |
| Engine declarativo | **não tem** | `core/toml_filter.rs` (pipeline 8 estágios) |
| Primitivas de compressão | filtro + truncamento | + dedup + grouping + replace + match_output |
| Auto-descoberta / learning | não | `discover/` + `learn/` |

Causa raiz do gap de cobertura: sem engine declarativo, cada comando novo é
código JS na mão → não escala. rtk adiciona comando = 1 arquivo de dados.

## Alavanca 1 — Engine declarativo (desbloqueia tudo)

Replicar o pipeline do rtk em JS, dirigido por config (JSON/YAML, não TOML, p/
não adicionar dep — usar JSON nativo). Pipeline em ordem:

1. `stripAnsi`
2. `replace[]` — substituições regex linha a linha, encadeáveis
3. `matchOutput[]` — short-circuit: blob casa pattern → retorna message (c/ `unless`)
4. `keepLines[]` / `stripLines[]` — filtro por regex
5. `truncateLineAt` — corta cada linha em N chars
6. `headLines` / `tailLines`
7. `maxLines` — teto absoluto
8. `onEmpty` — mensagem se resultado vazio

Cada filtro declara `matchCommand` (regex no comando) + os campos acima + testes
inline. Loader compila regex 1x e despacha por `matchCommand`.

Entregáveis:
- `src/filters/engine.js` — executor do pipeline
- `src/filters/defs/*.json` — um arquivo por comando
- Test runner que lê os casos inline de cada def (espelha o de rtk)
- Integrar no `HANDLERS` de `filters/index.js`: se nenhum handler bespoke casar,
  tentar match declarativo antes de devolver raw.

## Alavanca 2 — Primitivas faltantes (dedup + grouping)

Adicionar em `src/filters/utils.js`, reusáveis por engine e handlers:

- `dedupConsecutive(text)` — colapsa linhas repetidas → `linha (×N)`
- `groupBy(lines, keyFn)` — agrupa (arquivos por dir, erros por tipo) com contagem
- Expor ambos como estágios opcionais do pipeline (`dedup: true`, `groupBy: ...`)

São as 2 técnicas que o rtk tem a mais. Baratas e dão ganho imediato em saída
ruidosa (builds, lint, testes).

## Alavanca 3 — Cobertura de comandos (onde mora o token)

Prioridade por densidade de token, não por contagem de comandos.

### Tier A — parsers estruturados (alto valor, código bespoke em JS)
Onde dedup/grouping rendem mais. Espelham `rtk/src/cmds/`:
- Test runners: jest/vitest, pytest, `go test`, `cargo test`
  - manter resumo + só falhas; colapsar PASS
- Lint/typecheck: tsc, eslint, ruff, clippy
  - agrupar por arquivo, dedup de regra repetida

### Tier B — filtros declarativos (Alavanca 1, baratos)
1 JSON cada, strip de ruído + truncamento:
- `find`, `diff`, `make`, package managers (npm/pnpm/yarn install)
- docker/kubectl, aws (saída tabular/verbosa)

## Sequenciamento

| Fase | Entrega | Por quê primeiro |
|---|---|---|
| 1 | Engine declarativo + loader + test harness | Desbloqueia Tier B inteiro |
| 2 | dedup + grouping em utils, plugáveis no pipeline | Pré-req dos parsers |
| 3 | Tier A: 1 test runner (jest/vitest) ponta a ponta | Prova de valor, maior ganho de token |
| 4 | Tier A restantes + Tier B em lote | Escala sobre a base pronta |
| 5 | (opcional) `discover`/`learn` — auto-detectar cmds caros | Paridade total |

## Fora de escopo (decisão consciente)
- Reescrita em Rust / binário único: ganho é latência (<10ms), não função.
  Node já entrega o core. Pular salvo se latência virar problema medido.
- Plugin system do rtk: só faz sentido depois do engine declarativo existir.
