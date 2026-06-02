# Experimento: comprimir a README com `lakonai compress-memory`

Testamos se o próprio `lakonai` consegue enxugar a README antiga (442 linhas) -
e adicionamos **instrução livre** (`compress-memory <file> "instrução…"`) +
níveis de agressividade.

## Resultado

| versão | linhas | palavras |
|---|---:|---:|
| antiga verbosa | 442 | 3854 |
| `compress-memory` (default) | 442 | **abortou** |
| `compress-memory --prune` | 442 | **abortou** |
| **`compress-memory --rewrite "…marketing…"`** | **207** | **1382** |
| manual (humano) | 171 | 1099 |

## Por que default e --prune abortaram

A rede de segurança valida que **spans protegidos sobrevivem byte-a-byte**:
- **default:** protege code blocks + inline-code + URLs. Cortar qualquer seção
  dropa spans (`` `lakonai install` ``) → aborta.
- **--prune:** protege só code blocks. Mas seções cortadas contêm ```` ```bash ````
  → aborta também.

Lição: `compress-memory` é **"encurtar prosa sem perder conteúdo"**, não
"reestruturar/cortar". Por design ele NÃO remove seções.

## O 3º nível: `--rewrite`

Sem validação (só o backup protege). Aí o LLM reestrutura livre: **442 → 207
linhas (-53%), 3854 → 1382 palavras (-64%)** numa chamada. Manteve voz espartana,
badges, tabela de savings, hooks de marketing (7), e colapsou a referência num
link pra `docs/reference.md`. Amostra: `docs/README.rewrite-sample.md`.

## Veredito

- O `--rewrite` chega a **~85% do corte manual** automaticamente (207 vs 171).
- O gap restante é **juízo editorial**: o humano matou seções inteiras (Philosophy,
  Story separada, "Use the filter directly") que o LLM preferiu manter.
- A **instrução livre** funciona e dirige bem o foco (marketing, voz, link-out).

## Ladder de segurança (design final)

| modo | protege | uso |
|---|---|---|
| default | code + inline + URL | CLAUDE.md, instrução - lossless |
| `--prune` | só code blocks | notas - pode dropar frases |
| `--rewrite` | nada (só backup) | README/marketing - reestrutura livre |

Todos com backup `<nome>.original.md` + reversível (`revert-memory`).
