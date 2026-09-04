# Diagnóstico de distribuição — lakonai

O produto é genuinamente bom — os números são reais, a cobertura de testes é séria, a documentação está completa. O problema **não é o produto, é a distribuição**. Aqui está o diagnóstico honesto:

---

## O que está faltando

### 1. Zero presença fora do GitHub
O repo tem 1 star, 0 forks, 0 watchers. Ninguém sabe que existe. README excelente não serve para nada se ninguém chega até ele. O fluxo de descoberta de ferramentas CLI dev é: Twitter/X → Reddit → HN → GitHub. Você saltou direto pro GitHub sem passar pelos outros.

### ✅ 2. Nenhum GIF ou vídeo — *resolvido (v1.2.2, PR #38)*
SVG antes/depois embutido no topo do README (`docs/assets/before-after.svg`).

### ✅ 3. A "hero sentence" está errada — *resolvido (v1.2.2, PR #38)*
Hero trocada de `"up to 94%"` para o número real **−99,8%**.

### ✅ 4. Sem link pro GitHub no npm — *resolvido (v1.2.2, PR #38)*
Link explícito pro GitHub na primeira dobra do README. Publicado no npm em 1.2.2, então a página "About" já mostra.

### ✅ 5. Credits podem estar te prejudicando — *resolvido (v1.2.2, PR #38)*
Credits caveman/graphify/rtk reavaliados.

---

## Próximo passo

**→ Post no Reddit r/ClaudeAI**

Título:
> "Construí uma ferramenta que reduziu meu consumo de tokens em 97% no Claude Code — open source, zero config"

Não vende, não pede star. Só mostra os números e o link. Escrever o corpo do post antes de publicar.

---

## Sequência depois do Reddit

1. Thread no X/Twitter com os números reais da tabela.
2. Submissão no Hacker News como "Show HN".

---

O produto tem pernas. O problema é que ele está esperando as pessoas chegarem até ele, e no ecossistema de ferramentas dev isso não acontece sozinho.
