# `@seqlok-internal/prototype-core` – Documentation Index

This folder is the **design brain** of Seqlok core.

It explains why the API looks the way it does, how coherence works, and how to plug Seqlok into serious multi-threaded systems (workers, visualizers, telemetry, etc.).

Docs are grouped into:

- **Architecture** – big-picture concepts and rationale.
- **ADRs & DESIGN** – decisions that are locked in, plus larger design patterns.
- **Guides** – focused, task- and pattern-oriented deep dives.
- **Internals & Appendix** – invariants and “attic” notes for maintainers.
- **Performance** – generated benchmark results.

---

## 1. High-level navigation

Use these as entry points; each has its own `INDEX.md`.

- **[architecture/](./architecture/INDEX.md)**
  “Book chapters” that explain Seqlok’s concepts, concurrency model, DSL, and golden flow.

- **[adr/](./adr/INDEX.md)**
  Architecture Decision Records and design docs. This is the canonical "why did we pick this?" archive.

- **[guides/](./guides/INDEX.md)**
  Deep-dive guides and patterns built on top of the core API (mindset, MWMR story, enum helpers, etc.).

- **[internals/](./internals/INDEX.md)**
  Coherence and diagnostics invariants that must stay in sync with the implementation.

- **[appendix/](./appendix/INDEX.md)**
  Shelved helpers and visual notes that aren't part of the public API but are useful background.

- **[performance/](./performance/INDEX.md)**
  Generated benchmark summaries for hot-path operations.

---

## 2. What to read first

Pick the path that matches your current job.

### 2.1 "I just want to _use_ Seqlok"

1. **Repo root `README.md`** – learn the golden flow:

   > `defineSpec → planLayout → allocateShared/allocateWasmShared → buildHandoff → receiveHandoff → bindController / bindProcessor`

2. Then skim these:

- **Goals and boundaries**
  [architecture/01-seqlok-goals-and-non-goals.md](./architecture/01-seqlok-goals-and-non-goals.md)
  What Seqlok is for, and where it deliberately stops.

- **End-to-end visual**
  [architecture/16-seqlok-e2e-flow-visual-guide.md](./architecture/16-seqlok-e2e-flow-visual-guide.md)
  The whole pipeline in pictures: spec → plan → backing → handoff → bindings.

3. For UI + params/meters ergonomics:

- **Enum helpers**
  [guides/enum-helpers.md](./guides/enum-helpers.md)
  How to keep UI controls and DSL enum definitions in lockstep.

That's enough to integrate Seqlok without absorbing every internal detail.

---

### 2.2 "I want to understand the architecture"

Follow the **Architecture series** in roughly this order:

1. [architecture/00-seqlok-origin-and-design-history.md](./architecture/00-seqlok-origin-and-design-history.md)
2. [architecture/01-seqlok-goals-and-non-goals.md](./architecture/01-seqlok-goals-and-non-goals.md)
3. [architecture/02-seqlok-intellectual-heritage.md](./architecture/02-seqlok-intellectual-heritage.md)
4. [architecture/03-seqlok-concurrency-model-and-roles.md](./architecture/03-seqlok-concurrency-model-and-roles.md)
5. [architecture/04-seqlok-dsl-overview-and-rationale.md](./architecture/04-seqlok-dsl-overview-and-rationale.md)
6. [architecture/05-enum-arrays-runtime-behavior.md](./architecture/05-enum-arrays-runtime-behavior.md)
7. [architecture/06-object-model-rationale.md](./architecture/06-object-model-rationale.md)
8. [architecture/07-seqlok-api-shape-rationale.md](./architecture/07-seqlok-api-shape-rationale.md)
9. [architecture/08-seqlok-api-and-naming-rationale.md](./architecture/08-seqlok-api-and-naming-rationale.md)
10. [architecture/09-seqlok-api-reference.md](./architecture/09-seqlok-api-reference.md)
11. [architecture/10-seqlok-primitives-and-seqlock.md](./architecture/10-seqlok-primitives-and-seqlock.md)
12. [architecture/11-seqlok-backing-and-plane-layout.md](./architecture/11-seqlok-backing-and-plane-layout.md)
13. [architecture/12-coherent-reads-and-planes.md](./architecture/12-coherent-reads-and-planes.md)
14. [architecture/14-seqlok-aba-wraparound-not-a-bug.md](./architecture/14-seqlok-aba-wraparound-not-a-bug.md)
15. [architecture/15-seqlok-error-system-and-fail-fast-philosophy.md](./architecture/15-seqlok-error-system-and-fail-fast-philosophy.md)
16. [architecture/17-hot-vs-cold-path-design-philosophy.md](./architecture/17-hot-vs-cold-path-design-philosophy.md)

Think of `architecture/` as the conceptual book; everything else hangs off it.

---

### 2.3 "I care about MWMR, rings, hubs, observers, topology"

Use this cluster:

- **Story / motivation:**

  - [guides/architecture-from-pipe-to-hub-onboarding.md](./guides/architecture-from-pipe-to-hub-onboarding.md)
    The whiteboard / noisy room / mailbox story of how we got to MWMR at the system level.
  - [guides/onboarding-seqlok-mindset-and-hot-path.md](./guides/onboarding-seqlok-mindset-and-hot-path.md)
    Event-loop vs polling, zero-GC rule, and hot vs cold path thinking.

- **Technical architecture:**

  - [guides/understanding-seqlok-mwmr-from-pipe-to-hub.md](./guides/understanding-seqlok-mwmr-from-pipe-to-hub.md)
    From SWSR domains to system-level MWMR using rings, a hub controller, and observers.
  - [architecture/17-hot-vs-cold-path-design-philosophy.md](./architecture/17-hot-vs-cold-path-design-philosophy.md)

- **Decisions:**

  - [adr/ADR-00Y-mwmr-architecture.md](./adr/ADR-00Y-mwmr-architecture.md)
  - [adr/ADR-00Z-observer-binding-role.md](./adr/ADR-00Z-observer-binding-role.md)
  - [adr/ADR-010-ring-primitive-in-seqlok-core.md](./adr/ADR-010-ring-primitive-in-seqlok-core.md)
  - [adr/ADR-011-mwmr-ground-truth.md](./adr/ADR-011-mwmr-ground-truth.md)

Together, these explain how Seqlok stays strictly SWMR at the primitive level while allowing MWMR at the system topology level.

---

### 2.4 "I'm hacking internals / bindings / diagnostics"

You want the **Internals** and **Appendix**:

- [internals/coherence-implementation-checklist.md](./internals/coherence-implementation-checklist.md)
- [internals/coherence-semantics-policy.md](./internals/coherence-semantics-policy.md)
- [internals/diagnostics-seqlock-budgets-binding-level-contract.md](./internals/diagnostics-seqlock-budgets-binding-level-contract.md)

Plus, for historical helpers and visual notes:

- [appendix/primitives-shelf-removed-helpers-v1.md](appendix/primitives-shelf-removed-helpers-v0.1.md)
- [appendix/seqlok-visual-architecture-notes-v1.md](./appendix/seqlok-visual-architecture-notes-v1.md)

Use these when you're changing primitives, binding internals, or diagnostics behavior.

---

### 2.5 "I care about performance numbers"

See:

- [performance/INDEX.md](./performance/INDEX.md)

for the current benchmark summary and where to find generated results.

---

## 3. Folder map (quick reference)

- **[architecture/](./architecture/INDEX.md)** – system concepts, rationale, and reference-style chapters.
- **[adr/](./adr/INDEX.md)** – Architecture Decision Records and DESIGN docs.
- **[guides/](./guides/INDEX.md)** – focused guides (mindset, MWMR story, enum helpers, etc.).
- **[internals/](./internals/INDEX.md)** – implementation invariants for maintainers.
- **[appendix/](./appendix/INDEX.md)** – non-API reference material and archived helpers.
- **[performance/](./performance/INDEX.md)** – benchmark artifacts.

---

## 4. Keeping your bearings

When in doubt:

- Start from **this** index to choose a path.
- Treat `architecture/` as the narrative map of the system.
- Treat `adr/` as the source of truth for **decisions**:

  - If there's an ADR, it wins.
  - If there isn't, you might be about to write one.

The goal is that you can refactor internals freely as long as:

- the **golden flow** remains recognizable,
- SWMR semantics remain intact,
- and these docs stay roughly aligned with reality instead of drifting into fiction.
