# Benchmark de output - 1 request real (baseline LIMPO)

Medição honesta: **1 prompt**, rodado 2× no `claude --print` local (sem API key).
Para o baseline, o `~/.claude/CLAUDE.md` (a regra lakonai) foi **movido
temporariamente** - então é baseline **de verdade sem a regra**, não regra-vs-regra.

## Prompt
> Why is my React component re-rendering on every state change?

## Resultado
| arm | tokens (aprox) | bytes |
|---|---:|---:|
| baseline (SEM regra) | 240 | 1588 |
| terse (COM regra) | 216 | 1449 |
| **redução** | **~10%** | |

## Leitura honesta
~10% - modesto, e **não** os ~65% do caveman. Motivo confirmado: o
`claude --print` é o **Claude Code**, que já responde conciso por design. Mesmo
com baseline limpo (regra removida de verdade), a margem é pequena porque o piso
já é terso. O caveman mede contra a **API crua verbosa** → corte enorme. Baselines
diferentes, os dois honestos no seu contexto.

Nota: a contaminação (baseline carregando a regra) que discutimos rendia ~8% - o
baseline limpo deu ~10%. Quase igual → a contaminação NÃO era o fator
dominante; o fator dominante é o Claude Code já ser conciso.

---

### Saída baseline (sem regra)
```
Common causes, most → least likely:

**1. Creating new object/array/function references in render**
Passing `{}`, `[]`, or `() => {}` inline gives children a new reference every render, so `React.memo`/`useMemo`/`useEffect` deps always see "changed."
```jsx
<Child style={{color: 'red'}} onClick={() => x()} />  // new refs each render
```
Fix: hoist constants, `useMemo` the object, `useCallback` the handler.

**2. This is normal - re-render ≠ re-paint**
A component re-running on its own state change is expected React behavior. It's only a problem if it's *slow* or re-rendering *unrelated* siblings. Don't optimize unless you've measured a real cost.

**3. State lifted too high**
State in a parent re-renders the whole subtree. Push state down to the smallest component that needs it, or split context.

**4. Context value identity**
A context `value={{...}}` rebuilt each render re-renders every consumer. Memoize the value.

**5. Parent re-renders → all children re-render**
By default children re-render when the parent does, regardless of prop changes. Wrap pure children in `React.memo` (only helps if their props are referentially stable - see #1).

To diagnose:
- React DevTools → **Profiler** → record an interaction; it shows what rendered and *why*.
- Enable "Highlight updates when components render" to see the cascade visually.
- `why-did-you-render` library pinpoints which prop changed.

If you paste the component (state, props, what it renders), I'll point at the specific cause.

What's the symptom - is it actually slow, or just rendering more than you expected?
```

### Saída terse (com regra)
```
Re-render on every state change is **expected** - that's React's model: `setState` → component re-renders. The real question is usually "why is it re-rendering *too much*" or "why do children re-render when they shouldn't." Likely causes:

**1. Parent re-renders → all children re-render**
Default behavior. A child re-renders when its parent does, even if its props didn't change. Fix: wrap child in `React.memo`.

**2. New reference every render**
Inline objects/arrays/functions create a fresh reference each render, defeating `memo` and triggering effects:
```jsx
<Child style={{ color: 'red' }} onClick={() => f()} />  // new ref every time
```
Fix: `useMemo` for objects/arrays, `useCallback` for functions.

**3. State lives too high**
A state change at the top re-renders the whole tree. Move state down to the smallest component that needs it, or split components.

**4. Context value is a new object**
```jsx
<Ctx.Provider value={{ user, setUser }}>  // new object = all consumers re-render
```
Fix: `useMemo` the value.

**5. Effect writing state on every render**
`useEffect` with a missing/wrong dependency array calling `setState` → render loop.

Quick diagnosis:
- React DevTools → **Profiler** → "Highlight updates when components render" shows exactly what re-renders.
- Add `console.log` in the suspect component; check if props actually changed (`Object.is` comparison).

Paste the component and I'll point at the specific cause.
```
