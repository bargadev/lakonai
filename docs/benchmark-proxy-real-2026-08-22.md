# lakonai Benchmark — Proxy Compression — 2026-08-22

Números reais: mesmos compressores que o proxy usa em produção.
Token count: `ceil(chars / 4)` — mesma fórmula do proxy.

## Por tipo de conteúdo

```
caso                            sem lakonai  com lakonai  economia    tipo
--------------------------------------------------------------------------
npm test (652 tests)               5168 tok       85 tok       98%    text
build log (80 linhas)              1298 tok        8 tok       99%     log
JSON API (120 users)               2386 tok      104 tok       96%    json
git diff (3 commits)              19367 tok    18687 tok        4%    diff
file read (parser.js)              2835 tok     2835 tok        0%    code
file read (read-guard.js)          2803 tok     2803 tok        0%    code
--------------------------------------------------------------------------
TOTAL                             33857 tok    24522 tok       28%
```

## Dados reais desta sessão (proxy-stats.json)

O proxy interceptou todas as chamadas desta sessão de Claude Code.

| métrica | valor |
|---------|-------|
| requests interceptados | 49 |
| sem lakonai | 48,918 tok |
| com lakonai | 2,871 tok |
| economia | **94%** |
| tokens poupados | 46,047 |

## Conclusão por tipo

| tipo | economia | quando ocorre |
|------|----------|---------------|
| log / build output | ~99% | npm test, docker build, CI logs |
| json | ~96% | respostas de API, banco de dados |
| text / test runner | ~98% | jest, pytest, mocha passando |
| diff | ~4% | diffs grandes (compressor conservador) |
| code | 0% | leitura de arquivo puro |

> Código (0% via proxy) é coberto pelo **graph read-guard**: subgrafo compacto
> substitui a leitura do arquivo inteiro (-87% medido no benchmark de grafo).
