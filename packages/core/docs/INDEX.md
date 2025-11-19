# `@seqlok/core` – Documentation Index

This folder is the **design brain** of Seqlok core.
It explains why the API looks the way it does, how coherence works, and how to plug it into serious systems (Dekzer, WebGPU twins, Electron, etc.).

The docs are split into:

- **Architecture** – big-picture concepts and rationale.
- **ADR & Design** – decisions that are locked in, plus applied patterns.
- **Guides** – focused, task-oriented deep dives.
- **Internals & Appendix** – invariants and “attic” notes.
- **Performance** – generated benchmark results.

---

## 1. What to read first

Pick the path that matches your brain state.

### 1.1 "I just want to _use_ Seqlok"

1. Skim the repo root `README.md` for the golden flow.
2. Then read:

   - [architecture/01-seqlok-goals-and-non-goals.md](architecture/01-seqlok-goals-and-non-goals.md)
     _What problem Seqlok solves and where it stops._
   - [architecture/16-seqlok-e2e-flow-visual-guide.md](architecture/16-seqlok-e2e-flow-visual-guide.md)
     _The whole pipeline in pictures: spec → plan → backing → handoff → bindings._

3. When touching UI or engines:

   - [guides/00-enum-helpers.md](guides/enum-helpers.md)
     _Enum helpers and how to keep UI/DSL in lockstep without hand-maintained enums._

You can ignore the rest until you hit questions like "why is it SWMR?" or "how do I do MWMR without breaking RT audio?".

---

### 1.2 "I want to understand the architecture"

Follow the **Architecture series** roughly in this order:

1. [architecture/00-seqlok-origin-and-design-history.md](architecture/00-seqlok-origin-and-design-history.md)
   _Where Seqlok came from and what problems it's reacting to._
2. [architecture/01-seqlok-goals-and-non-goals.md](architecture/01-seqlok-goals-and-non-goals.md)
   _Goals, non-goals, and where Seqlok sits in the stack._
3. [architecture/02-seqlok-intellectual-heritage.md](architecture/02-seqlok-intellectual-heritage.md)
   _Prior art and why it ended up as "seqlock + SAB" instead of e.g. just postMessage._
4. [architecture/03-seqlok-concurrency-model-and-roles.md](architecture/03-seqlok-concurrency-model-and-roles.md)
   _Controller vs Processor vs Observer; SWMR per domain._
5. [architecture/04-seqlok-dsl-overview-and-rationale.md](architecture/04-seqlok-dsl-overview-and-rationale.md)
   _The DSL: params/meters, arrays, enums, and type inference._
6. [architecture/05-enum-arrays-runtime-behavior.md](architecture/05-enum-arrays-runtime-behavior.md)
   _How enum arrays behave at runtime and why they exist._
7. [architecture/06-object-model-rationale.md](architecture/06-object-model-rationale.md)
   _Why the API stayed function/handle-based instead of full OO._
8. [architecture/07-seqlok-api-shape-rationale.md](architecture/07-seqlok-api-shape-rationale.md)
   _Why the public API looks like `planLayout → allocateShared → buildHandoff → bind*`._
9. [architecture/08-seqlok-api-and-naming-rationale.md](architecture/08-seqlok-api-and-naming-rationale.md)
   _Naming decisions and what the verbs are allowed to mean._
10. [architecture/09-seqlok-api-reference.md](architecture/09-seqlok-api-reference.md)
    _A more reference-like walkthrough of the core surface._
11. [architecture/10-seqlok-primitives-and-seqlock.md](architecture/10-seqlok-primitives-and-seqlock.md)
    _What the seqlock primitive actually does and what “coherence” means here._
12. [architecture/11-seqlok-backing-and-plane-layout.md](architecture/11-seqlok-backing-and-plane-layout.md)
    _Layout planning, planes, alignment, and how the SAB is carved up._
13. [architecture/12-coherent-reads-and-planes.md](architecture/12-coherent-reads-and-planes.md)
    _How coherent reads are implemented and why the read API looks the way it does._
14. [architecture/13-implementation-notes-kernel.md](architecture/13-implementation-notes-kernel.md)
    _Implementation notes for core kernel pieces (for future-you hacking internals)._
15. [architecture/14-seqlok-aba-wraparound-not-a-bug.md](architecture/14-seqlok-aba-wraparound-not-a-bug.md)
    _Why ABA-style wraparound in seqlock counters is not a correctness bug._
16. [architecture/15-seqlok-error-system-and-fail-fast-philosophy.md](architecture/15-seqlok-error-system-and-fail-fast-philosophy.md)
    _Error registry, fail-fast philosophy, and how diagnostics are structured._
17. [architecture/16-seqlok-e2e-flow-visual-guide.md](architecture/16-seqlok-e2e-flow-visual-guide.md)
    _The full flow, visually, after you’ve absorbed the concepts._

---

### 1.3 "I care about system-level composition (MWMR, Dekzer, agents)"

Once the core story is clear, read this cluster:

- [adr/ADR-00Y-mwmr-architecture.md](adr/ADR-00Y-mwmr-architecture.md)
  _How to get MWMR at the **system** level while keeping **SWMR** per domain._
- [adr/ADR-00Z-observer-binding-role.md](adr/ADR-00Z-observer-binding-role.md)
  _Observer binding, snapshot semantics, plus the "Observer vs Controller" snapshot table._
- [adr/ADR-00X-introduce-seqlok-compose-for-system-level-composition.md](adr/ADR-00X-introduce-seqlok-compose-for-system-level-composition.md)
  _`@seqlok/compose` as the topology layer: domains, rings, runtimes, validation._
- [adr/ADR-00E-electron-multi-process-runtimes.md](adr/ADR-00E-electron-multi-process-runtimes.md)
  _Electron as "many processes with per-process Seqlok islands"._
- [adr/DESIGN-002-webgpu-digital-twin-pattern.md](adr/DESIGN-002-webgpu-digital-twin-pattern.md)
  _Meters → observer → GPU buffer → WGSL: the WebGPU digital-twin pattern._
- [adr/DESIGN-003-telemetry-bridge-pattern.md](adr/DESIGN-003-telemetry-bridge-pattern.md)
  _How to mirror Seqlok state into external telemetry / hardware without breaking SWMR._

This is the "Seqlok in a real product / runtime zoo" bundle.

---

### 1.4 "I'm hacking internals / writing new bindings"

Key pieces:

- [internals/coherence-implementation-checklist.md](internals/coherence-implementation-checklist.md)
  _Checklist for touching seqlock primitives, snapshot policies, or diagnostics._
- [internals/coherence-semantics-policy.md](internals/coherence-semantics-policy.md)
  _Policy-level description of what coherence must mean across bindings._
- [internals/diagnostics-seqlock-budgets-binding-level-contract.md](internals/diagnostics-seqlock-budgets-binding-level-contract.md)
  _How diagnostics counters and budgets relate to binding behavior._

Plus the appendix for "past lives" of primitives:

- [appendix/primitives-shelf-removed-helpers-v1.md](appendix/primitives-shelf-removed-helpers-v1.md)
  _Safe shelf of removed/internal helpers to crib from without re-exporting._
- [appendix/seqlok-visual-architecture-notes-v1.md](appendix/seqlok-visual-architecture-notes-v1.md)
  _Notes for visual/diagram architecture; useful when updating diagrams or blog posts._

---

## 2. Folder map (with links)

### 2.1 `architecture/`

Narrative docs that explain the design:

- [00-seqlok-origin-and-design-history.md](architecture/00-seqlok-origin-and-design-history.md)
- [01-seqlok-goals-and-non-goals.md](architecture/01-seqlok-goals-and-non-goals.md)
- [02-seqlok-intellectual-heritage.md](architecture/02-seqlok-intellectual-heritage.md)
- [03-seqlok-concurrency-model-and-roles.md](architecture/03-seqlok-concurrency-model-and-roles.md)
- [04-seqlok-dsl-overview-and-rationale.md](architecture/04-seqlok-dsl-overview-and-rationale.md)
- [05-enum-arrays-runtime-behavior.md](architecture/05-enum-arrays-runtime-behavior.md)
- [06-object-model-rationale.md](architecture/06-object-model-rationale.md)
- [07-seqlok-api-shape-rationale.md](architecture/07-seqlok-api-shape-rationale.md)
- [08-seqlok-api-and-naming-rationale.md](architecture/08-seqlok-api-and-naming-rationale.md)
- [09-seqlok-api-reference.md](architecture/09-seqlok-api-reference.md)
- [10-seqlok-primitives-and-seqlock.md](architecture/10-seqlok-primitives-and-seqlock.md)
- [11-seqlok-backing-and-plane-layout.md](architecture/11-seqlok-backing-and-plane-layout.md)
- [12-coherent-reads-and-planes.md](architecture/12-coherent-reads-and-planes.md)
- [13-implementation-notes-kernel.md](architecture/13-implementation-notes-kernel.md)
- [14-seqlok-aba-wraparound-not-a-bug.md](architecture/14-seqlok-aba-wraparound-not-a-bug.md)
- [15-seqlok-error-system-and-fail-fast-philosophy.md](architecture/15-seqlok-error-system-and-fail-fast-philosophy.md)
- [16-seqlok-e2e-flow-visual-guide.md](architecture/16-seqlok-e2e-flow-visual-guide.md)

If you want "one place that explains everything conceptually", this folder is it.

---

### 2.2 `adr/` (Architecture Decision Records & patterns)

Stable decisions and patterns:

- [ADR-00C-meter-writes-and-snapshot-into.md](adr/ADR-00C-meter-writes-and-snapshot-into.md)
- [ADR-00D-primitives-internal-and-pruned.md](adr/ADR-00D-primitives-internal-and-pruned.md)
- [ADR-00E-electron-multi-process-runtimes.md](adr/ADR-00E-electron-multi-process-runtimes.md)
- [ADR-00F-controller-params-hydrate.md](adr/ADR-00F-controller-params-hydrate.md)
- [ADR-00X-introduce-seqlok-compose-for-system-level-composition.md](adr/ADR-00X-introduce-seqlok-compose-for-system-level-composition.md)
- [ADR-00Y-mwmr-architecture.md](adr/ADR-00Y-mwmr-architecture.md)
- [ADR-00Z-observer-binding-role.md](adr/ADR-00Z-observer-binding-role.md)
- [DESIGN-002-webgpu-digital-twin-pattern.md](adr/DESIGN-002-webgpu-digital-twin-pattern.md)
- [DESIGN-003-telemetry-bridge-pattern.md](adr/DESIGN-003-telemetry-bridge-pattern.md)

If you're asking "is X allowed?" or "why do we do it this way?", this is the API for decisions.

---

### 2.3 `guides/`

Task-oriented deep dives:

- [README.md](guides/README.md) – short intro + guide list.
- [00-enum-helpers.md](guides/enum-helpers.md) – enum helpers wired to the DSL.

More focused guides can land here over time without touching the ADR/architecture stack.

---

### 2.4 `internals/`

Implementation notes that must stay in sync with code:

- [coherence-implementation-checklist.md](internals/coherence-implementation-checklist.md)
- [coherence-semantics-policy.md](internals/coherence-semantics-policy.md)
- [diagnostics-seqlock-budgets-binding-level-contract.md](internals/diagnostics-seqlock-budgets-binding-level-contract.md)

If you change seqlock internals, snapshot logic, or diagnostics, you should read + update these.

---

### 2.5 `appendix/`

Reference material that is **not** part of the public API:

- [primitives-shelf-removed-helpers-v1.md](appendix/primitives-shelf-removed-helpers-v1.md)
- [seqlok-visual-architecture-notes-v1.md](appendix/seqlok-visual-architecture-notes-v1.md)

Think of this as the attic: useful, but not something public APIs should rely on.

---

### 2.6 `performance/`

Generated benchmarking output:

- [bench-results.generated.md](performance/bench-results.generated.md)
- [`bench-results.json`](performance/bench-results.json)

These describe what's currently measured and how fast the hot paths are, but they live as generated artifacts rather than hand-written docs.

---

## 3. How to keep your bearings

When in doubt:

- Start here (`INDEX.md`) to choose a path.
- Use the `architecture/` series as the **narrative map**.
- Use ADR filenames as the **source of truth** for decisions:
  - If there's an ADR for it, that's the canonical answer.
  - If there isn't, you're probably about to write one.

The whole stack is designed so future-you can refactor internals freely, as long as:

- the **golden flow** stays recognizable,
- SWMR semantics stay intact,
- and these docs stay loosely aligned with reality instead of drifting into fan fiction.
