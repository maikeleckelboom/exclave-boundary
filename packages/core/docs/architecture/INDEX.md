# Architecture Docs

Narrative system docs for `@seqlok/core`.

These explain the concepts, roles, and flows behind the API. If you want to understand **why** the primitives and bindings look the way they do, this is the place.

---

## Recommended reading order

1. [00-seqlok-origin-and-design-history.md](./00-seqlok-origin-and-design-history.md)
   Where Seqlok came from, which problem it set out to solve, and which early bets stayed durable.

2. [01-seqlok-goals-and-non-goals.md](./01-seqlok-goals-and-non-goals.md)
   What Seqlok is for, what it owns, and what it explicitly refuses to become.

3. [02-seqlok-intellectual-heritage.md](./02-seqlok-intellectual-heritage.md)
   Prior art, lineage, and the systems ideas Seqlok adapts to SAB, Atomics, workers, and Wasm.

4. [03-seqlok-concurrency-model-and-roles.md](./03-seqlok-concurrency-model-and-roles.md)
   The runtime ownership model: controller, processor, observer, and one writer per domain.

5. [04-seqlok-dsl-overview-and-rationale.md](./04-seqlok-dsl-overview-and-rationale.md)
   The authored-contract model, authoring surfaces, and canonical runtime identity.

6. [05-enum-arrays-runtime-behavior.md](./05-enum-arrays-runtime-behavior.md)
   How enum arrays map from schema to runtime data and why they live as indices in shared memory.

7. [06-object-model-rationale.md](./06-object-model-rationale.md)
   Why the kernel stays function-centric and explicit instead of becoming a stateful OO context.

8. [07-seqlok-api-shape-rationale.md](./07-seqlok-api-shape-rationale.md)
   Why the kernel surface is explicit about `spec → plan → backing → handoff → binding`.

9. [08-seqlok-api-and-naming-rationale.md](./08-seqlok-api-and-naming-rationale.md)
   Why the public verbs and role names are what they are, and which naming temptations are rejected.

10. [09-seqlok-api-reference.md](./09-seqlok-api-reference.md)
    Human-oriented API reference for the current public surface.

11. [10-seqlok-primitives-and-seqlock.md](./10-seqlok-primitives-and-seqlock.md)
    The primitive seqlock model, counters, helpers, and low-level plane vocabulary.

12. [11-seqlok-backing-and-plane-layout.md](./11-seqlok-backing-and-plane-layout.md)
    How plans become backing memory, typed views, and deterministic plane layout.

13. [12-coherent-reads-and-planes.md](./12-coherent-reads-and-planes.md)
    How coherent reads work, which roles get which guarantees, and how planes relate to those guarantees.

14. [13-implementation-notes-kernel.md](./13-implementation-notes-kernel.md)
    Internal implementation notes for contributors working on planning, allocation, and binding internals.

15. [14-seqlok-aba-wraparound-not-a-bug.md](./14-seqlok-aba-wraparound-not-a-bug.md)
    Why ABA-style wraparound is not a practical correctness problem in Seqlok's intended operating context.

16. [15-seqlok-error-system-and-fail-fast-philosophy.md](./15-seqlok-error-system-and-fail-fast-philosophy.md)
    Error domains, structured failures, and why Seqlok fails fast at the coordination boundary.

17. [16-seqlok-e2e-flow-visual-guide.md](./16-seqlok-e2e-flow-visual-guide.md)
    End-to-end diagrams of the canonical flow from authored contract to live runtime bindings.

18. [17-hot-vs-cold-path-design-philosophy.md](./17-hot-vs-cold-path-design-philosophy.md)
    The temperature doctrine: what belongs in hot loops, what belongs in setup, and why the API should admit that.

19. [18-command-ring-swsr.md](./18-command-ring-swsr.md)
    Draft design for a bounded single-writer single-reader command ring for discrete events over shared memory.

Use this folder as the narrative map when you want to reason about the system as a whole.
