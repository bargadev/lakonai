# `lakonai gain` deveria ter um benchmark gerado por IA?

Pergunta: o `gain` mostra números medidos do lado shell (determinísticos). Não
deveria também ter um benchmark **gerado por IA**?

Resposta curta: **para o lado INPUT (shell), não - perderia o que o torna bom.
Para o lado OUTPUT (regra terse), aí sim faz sentido - mas como opt-in, porque
exige LLM.** São duas coisas diferentes.

## O que o `gain` mede hoje

```
lakonai - saved 194.4k tok (47% smaller) across 1848 commands
  today      2.2k tok saved  (23%)
  this week  122.1k tok saved  (59%)
  top: tail 55.1k · grep 54.2k · Read 34.3k · git 23.2k · cat 15.2k
```

- **Dados reais seus** (do `~/.lakon/log.jsonl`), não estimativa.
- Quando ainda não há uso, mostra um **sample benchmark**: os filtros rodando em
  fixtures fixas (`npm run bench`). Determinístico, offline, sem variância.

## Lado INPUT (shell): benchmark por IA = ruim aqui

O sample atual é **regex em fixtures fixas**. Trocar por IA pioraria:

| | determinístico (hoje) | gerado por IA |
|---|---|---|
| Reprodutível | sim (mesmo input → mesmo número) | **não** (varia por run) |
| Offline / sem key | sim | **não** (rede + token + custo) |
| Honesto | mede o que o filtro faz, exato | estimativa que flutua |

→ Para "veja o que os filtros fazem", IA seria **menos** confiável. Mantém regex.

## Lado OUTPUT (regra terse): agora o `gain` TAMBÉM mede

O `gain` media só **INPUT** (saída de comando encolhida). Agora mede **também o
OUTPUT** - quanto o modelo fala menos por causa da regra terse. Isso **só dá com
um LLM** (rodar o mesmo prompt com/sem a regra e contar tokens), então usamos **a
CLI de IA local que você já tem** (`claude`/`gemini`/`codex`/`cursor-agent`),
**sem API key** - mesmo truque do `compress-memory`.

Antes deixávamos isso de fora "por ser offline/zero-dep". Tiramos esse limite da
identidade: o `deps-0` continua verdadeiro (a CLI de IA é externa, não é
dependência npm), e o ganho de output é medido sob demanda pela IA que você já
roda. O número de input (`gain`) segue determinístico; o de output é uma estimativa
(LLM varia), rotulada como tal.

## Como funciona hoje

- `lakonai gain` mostra as duas linhas: input (medido, determinístico) **e** output
  (estimado pela CLI local).
- A medição de output roda **dentro do `gain`**, no máximo **1×/semana** e **só em
  TTY** (nunca trava um `gain` em pipe/script), via `src/output-bench.js`.
- A regra é injetada como **system prompt** (`claude --append-system-prompt`),
  não como conteúdo do usuário - efeito comportamental real (ver
  [[output-bench-vs-caveman]] pro porquê do número ser modesto).
- Opt-out: `LAKON_NO_OUTPUT_BENCH=1`.

> **Honestidade:** medindo através de uma CLI de agente (já tersa), o número é
> modesto (~ poucos %), não os ~65% do caveman - que mede contra API crua verbosa.
> Mostramos o ganho **marginal real sobre o seu próprio agente**, sem inflar.

Ver também: [[compressao]] (mesmo princípio de dois motores - regex para o
caminho quente/determinístico, LLM só onde ele genuinamente agrega, e opt-in).
