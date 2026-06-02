# Benchmark de output - Gemini, baseline LIMPO vs regra

A pergunta era: por que só 10%? Resposta provada aqui. No `claude --print` o
baseline já é terso (Claude Code é conciso por design) → margem pequena. No
**Gemini**, cujo baseline default é **verboso** (mais parecido com API crua), a
MESMA regra lakonai corta muito mais.

Método (seguro, sem mexer no seu Claude): baseline = `~/.gemini/GEMINI.md` movido
de lado (sem regra) → restaurado na hora; terse = GEMINI.md presente (regra
carregada). Auth do gemini é separada → mover é seguro. 1 prompt.

## Prompt
> Explain the difference between a process and a thread.

## Resultado
| arm | tokens (aprox) | bytes |
|---|---:|---:|
| baseline (SEM regra, Gemini default) | 361 | 2339 |
| terse (COM regra lakonai) | 107 | 839 |
| **redução** | **~70%** | |

## Conclusão
**~70%** - perto dos ~70% do caveman. Prova que a regra lakonai **é eficaz**;
o ~10% do claude era ilusão do baseline já-terso do Claude Code, não fraqueza da
regra. Mesma regra, baseline verboso → corte grande.

→ Para o `gain`: o número honesto depende de CONTRA QUEM você mede.
- vs agente já-conciso (Claude Code): ~10%.
- vs baseline verboso (Gemini default / API crua): ~70%.
Ambos reais. Vender "~70%" só é honesto se rotular "vs baseline verboso".

---

### Saída baseline (Gemini sem regra)
```
In operating systems, **processes** and **threads** are both units of execution, but they differ significantly in how they manage resources and isolation.

### Process
A **process** is an independent program in execution. When you start an application, the OS creates a process for it.
- **Memory:** Each process has its own dedicated address space (stack, heap, code). One process cannot access another process's memory without OS intervention.
- **Isolation:** Processes are highly isolated. If one process crashes, it typically doesn't affect others.
- **Overhead:** Creating and switching between processes (context switching) is "heavy" and slow because it involves loading/saving large amounts of state and memory maps.
- **Communication:** Processes communicate via Inter-Process Communication (IPC) like pipes, sockets, or shared memory.

### Thread
A **thread** (often called a "lightweight process") is a path of execution within a process. A single process can contain multiple threads.
- **Memory:** All threads within the same process share the process's address space (heap, global variables, code) but have their own individual stack and registers.
- **Isolation:** Threads are poorly isolated. If one thread crashes or corrupts memory, it can crash the entire process.
- **Overhead:** Creating and switching between threads is "light" and fast because they share most of the process state.
- **Communication:** Threads communicate easily by reading and writing to shared memory within the same process.

### Key Differences Summary

| Feature | Process | Thread |
| :--- | :--- | :--- |
| **Memory** | Dedicated address space | Shared with other threads in process |
| **Overhead** | High (Heavyweight) | Low (Lightweight) |
| **Isolation** | High (Independent) | Low (Interdependent) |
| **Communication** | Difficult (IPC) | Easy (Shared Memory) |
| **Crash Impact** | Isolated | Can take down the whole process |

**Analogy:** Think of a **Process** as a **factory**. It has its own building, resources, and management. A **Thread** is a **worker** inside that factory. Workers share the same tools and space (memory), making it easy to collaborate, but if one worker starts a fire, the whole factory is at risk. Different factories (processes) are separated by walls and require special permits (IPC) to exchange goods.
```

### Saída terse (Gemini com regra)
```
### Process vs. Thread

*   **Process**: Independent program instance with private memory space (heap/stack).
    *   **Isolation**: High. One process crashing doesn't affect others.
    *   **Resources**: Owns its own memory, file handles, and security context.
    *   **Overhead**: High (creation/context switching involves OS kernel).
    *   **IPC**: Requires explicit Inter-Process Communication (pipes, sockets, shared memory).

*   **Thread**: Unit of execution *within* a process.
    *   **Isolation**: Low. Shares memory with sibling threads; one can crash the whole process.
    *   **Resources**: Shares the parent process's memory and state, but has its own stack and registers.
    *   **Overhead**: Low (faster creation/context switching).
    *   **IPC**: Easy. Threads communicate directly via shared variables in memory.
```
