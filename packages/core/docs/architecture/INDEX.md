# Architecture Docs

Narrative system docs for `@seqlok/core`.

These explain the concepts, roles, and flows behind the API. If you want to understand **why** the primitives and
bindings look the way they do, this is the place.

---

## Recommended reading order

1. [00-seqlok-origin-and-design-history.md](./00-seqlok-origin-and-design-history.md)
   Where Seqlok came from and what problems it is reacting to.

2. [01-seqlok-goals-and-non-goals.md](./01-seqlok-goals-and-non-goals.md)
   Goals, non-goals, and the boundaries of what Seqlok is meant to solve.

3. [02-seqlok-intellectual-heritage.md](./02-seqlok-intellectual-heritage.md)
   Prior art and how Seqlok ended up as "seqlock + SharedArrayBuffer" instead of message passing only.

4. [03-seqlok-concurrency-model-and-roles.md](./03-seqlok-concurrency-model-and-roles.md)
   Controller vs Processor vs Observer and the SWMR model per domain.

5. [04-seqlok-dsl-overview-and-rationale.md](./04-seqlok-dsl-overview-and-rationale.md)
   The Spec DSL: params, meters, arrays, and why the DSL is range-only.

6. [05-enum-arrays-runtime-behavior.md](./05-enum-arrays-runtime-behavior.md)
   How enum arrays behave at runtime and how they map onto typed planes.

7. [06-object-model-rationale.md](./06-object-model-rationale.md)
   Why bindings expose a small object API instead of low-level buffer plumbing.

8. [07-seqlok-api-shape-rationale.md](./07-seqlok-api-shape-rationale.md)
   The high-level API surface and how it reflects the underlying concurrency model.

9. [08-seqlok-api-and-naming-rationale.md](./08-seqlok-api-and-naming-rationale.md)
   Naming conventions (`planLayout`, `bindController`, etc.) and how they reinforce invariants.

10. [09-seqlok-api-reference.md](./09-seqlok-api-reference.md)
    Human-oriented API reference tying together the canonical flow and bindings.

11. [10-seqlok-primitives-and-seqlock.md](./10-seqlok-primitives-and-seqlock.md)
    The primitive seqlock model, counters, and how bounded reads work.

12. [11-seqlok-backing-and-plane-layout.md](./11-seqlok-backing-and-plane-layout.md)
    How backings are planned, how planes are laid out, and why the layout is deterministic.

13. [12-coherent-reads-and-planes.md](./12-coherent-reads-and-planes.md)
    Coherent reads, seqlock windows, and how bindings use them to present stable views.

14. [13-implementation-notes-kernel.md](./13-implementation-notes-kernel.md)
    Kernel-level notes for the implementation of planning, allocation, and bindings.

15. [14-seqlok-aba-wraparound-not-a-bug.md](./14-seqlok-aba-wraparound-not-a-bug.md)
    Why ABA-style wraparound in seqlock counters is acceptable in this design.

16. [15-seqlok-error-system-and-fail-fast-philosophy.md](./15-seqlok-error-system-and-fail-fast-philosophy.md)
    Error domains, registry-based messages, and fail-fast strategy.

17. [16-seqlok-e2e-flow-visual-guide.md](./16-seqlok-e2e-flow-visual-guide.md)
    End-to-end diagrams: from spec definition to live bindings in a running system.

Use this folder as the narrative map when you want to reason about the system as a whole.

---
