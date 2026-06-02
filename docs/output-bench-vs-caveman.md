# Por que o bench de output deu ~-5% se o caveman dá ~65%?

Resultado real do nosso `bench --output` (via `claude --print`):
`623 → 652 tokens (~-5%)` - ou seja, **a regra terse não cortou nada** ali.
O caveman reporta **~65-75%**. Não é bug - é **metodologia diferente**. Três causas,
da mais forte pra mais fraca:

## 1. Baseline já é terso (causa principal)

Medimos via **`claude --print`** - a CLI do **Claude Code**, que é um agente de
código com **system prompt próprio que já manda responder conciso**. Então nosso
"baseline" (sem a regra lakonai) **já vem enxuto**. Não sobra gordura pra cortar →
delta ~0.

O caveman mede contra a **API crua** (`benchmarks/run.py`, Claude API direto, sem
system prompt de agente). Lá o baseline é **verboso** ("Sure! I'd be happy to…") →
a regra corta muito → ~65%.

> Resumo: comparamos contra um modelo **que já é terso**; o caveman compara contra
> um **que é tagarela**. Mesma regra, baselines opostos.

## 2. Regra no user-message, não como system prompt

Nós prependamos a regra **dentro do prompt do usuário** (`${rule}\n\n---\n\n${p}`).
O modelo trata isso meio como *conteúdo pra comentar*, não como *comportamento a
adotar*. O caveman injeta como **system prompt** (`claude -p --system-prompt …` nos
evals) - instrução de comportamento, efeito muito mais forte.

## 3. Amostra minúscula + variância

4 prompts, single-shot. Saída de LLM varia entre runs; com n pequeno, o ruído
**vira o sinal** (um prompt que respondeu 30 tokens a mais já joga pra negativo). O
caveman roda um conjunto maior e reporta média/faixa (22-87%).

## 4. (caveman) skill-vs-terse, não skill-vs-baseline

O caveman é até mais rigoroso: o delta honesto deles é **skill vs "Answer
concisely."**, não skill vs baseline - pra não contar como mérito da skill a
concisão genérica. Detalhe do `evals/` deles.

## O que isso significa pra nós

Medir output savings **através de uma CLI de agente** (claude/gemini/codex) vai dar
número **modesto e ruidoso**, porque essas CLIs já são tersas. É um teto honesto da
abordagem "sem API key, IA local".

Opções, da melhor pra pior:

1. **Injetar a regra como system prompt** por CLI (`claude --append-system-prompt`,
   equivalentes em gemini/codex) em vez de no user-message. Melhora o sinal, mas o
   baseline-já-terso continua limitando.
2. **Baseline sintético verboso:** medir contra um prompt-base que NÃO herda a
   concisão do agente (difícil via `--print`, que sempre carrega o system do Claude
   Code). Seria o mais "caveman-like", mas foge do "use a IA local que você tem".
3. **Aceitar o número honesto e rotular bem:** "ganho de output **sobre um agente
   que já é conciso**" - pequeno, mas verdadeiro. Não inflar.

## Recomendação

Trocar a injeção pra **system prompt** (opção 1) - é a correção de maior impacto e
ainda cabe no "sem key, CLI local". E **rotular** o número no `gain` como *delta
sobre o baseline do seu próprio agente*, não como "−65% absoluto" - senão a gente
cairia na desonestidade que a própria regra do projeto proíbe (número que não
condiz com a realidade). O caveman pode mostrar 65% porque mede contra API crua;
nós, medindo contra a CLI local, mostramos o ganho marginal real - menor, porém
honesto.

Ver também: [[benchmark-ai]] · [[compressao]].
