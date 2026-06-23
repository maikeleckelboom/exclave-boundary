# ADR-00X: Introduce `@seqlok/compose` for System-Level Composition

**Status**: Draft
**Date**: 2025-11-16
**Owner**: _TBD_

**Related**:

- ADR-001 – Seqlok Core Golden Flow
- ADR-002 – Memory Growth & Swap via Handoff Sequences
- ADR-00Y – MWMR System Architecture via Domains + Observers + Rings
- ADR-00Z – Observer Binding Role in `@seqlok-internal/prototype-core` (`bindObserver`)
- ADR-010 – Ring Primitive in `@seqlok-internal/prototype-core` (SWSR intent queue)

---

## 1. Context

`@seqlok-internal/prototype-core` is intentionally narrow:

```txt
defineSpec
→ planLayout
→ allocateShared
→ buildHandoff
→ receiveHandoff
→ bind{Controller,Processor,Observer}
```

It provides:

- a typed **shared-memory wire** (params + meters),
- a deterministic layout pipeline,
- SWMR domains with seqlock-based coherence.

ADR-00Y describes **system-level MWMR** built from these SWMR domains:

- multiple Seqlok **domains** (deck, reservoir, analyzer, mixer, registry, …),
- **ring primitives** (ADR-010) used as intent buses,
- `bindObserver` for many-reader fan-out,
- growth & swapping via `SwapTicket`-driven handoff sequences.

Right now, that lives as architecture prose and ad-hoc wiring in examples (e.g. Dekzer). There is no first-class place in the ecosystem where you can:

- declaratively describe a **full system topology**, and
- turn that description into concrete backings, handoffs, workers, bindings, and rings.

`@seqlok/compose` fills that gap.

---

## 2. Problem Statement

We need a way to describe and realize **complex systems** that:

1. Use multiple Seqlok **domains** (each SWMR) across multiple runtimes (main, workers, AudioWorklet, agents).

2. Use one or more **intent rings** for many-writer → hub fan-in (built from the core ring primitive, ADR-010).

3. Respect core invariants (ADR-00Y):

- exactly one param writer (controller) per domain,
- exactly one meter writer (processor) per domain,
- any number of read-only observers per domain.

4. Coordinate **growth and swap** operations across domains using `SwapTicket` and handoff sequences.

5. Do all of this **declaratively**, with strong TS inference and minimal boilerplate.

Stuffing this into `@seqlok-internal/prototype-core` would:

- bloat core with topology/orchestration concerns,
- tangle basic bindings with system-specific policies,
- make simple single-domain usage heavier than it needs to be.

We want a **separate layer** that builds on:

- core bindings + layout pipeline, and
- the ring primitive defined in ADR-010,

without contaminating either with product-specific orchestration.

---

## 2.1 Prerequisites

`@seqlok/compose` assumes:

1. **Observer binding in `@seqlok-internal/prototype-core` (ADR-00Z)**
   A third binding role `bindObserver` exists alongside `bindController` and `bindProcessor`, providing:

- read-only snapshots for params and meters,
- `version()` counters aligned with controller / processor versions,
- no write APIs (`set`, `update`, `stage`, `publish`) exposed.

2. **MWMR system model (ADR-00Y)**
   System-level MWMR is defined as:

- many **intent producers** → rings (built from the core ring primitive),
- a single **hub/governor** owning controller bindings,
- many **observers** on each domain via `bindObserver`,
- growth & swap via handoff sequences and `SwapTicket`.

`@seqlok/compose` is required to respect these; it doesn't get to re-invent MWMR semantics.

---

## 3. Decision

We introduce `@seqlok/compose` as a separate package that:

- exposes a declarative DSL to define system topology,

- compiles that topology into:

  - Seqlok plans & backings (`planLayout`, `allocateShared`, `buildHandoff`),
  - runtime wiring (which worker hosts which binding role),
  - **ring wiring** (which runtimes produce/consume which intent buses, built from the core ring primitive),

- validates SWMR/MWMR invariants.

Conceptual example:

```ts
const system = defineComposition((b) => ({
  id: "dekzer-v1",

  domains: {
    deckA: b.domain({ spec: deckSpec }),
    deckB: b.domain({ spec: deckSpec }),
    analyzer: b.domain({ spec: analyzerSpec }),
    registry: b.domain({ spec: registrySpec }),
  },

  rings: {
    transport: b.ring({
      capacity: 1024,
      schema: TransportCommandSchema,
    }),
    engineControl: b.ring({
      capacity: 256,
      schema: EngineCommandSchema,
    }),
  },

  runtimes: {
    main: {
      deckA: "observer",
      deckB: "observer",
      analyzer: "observer",
      registry: "observer",
    },
    deckWorkerA: {
      deckA: "controller+processor",
    },
    deckWorkerB: {
      deckB: "controller+processor",
    },
    analyzerWorker: {
      analyzer: "processor",
      registry: "observer",
    },
  },
}));
```

The exact API will evolve, but the core intent is:

> “Describe the graph once; let `@seqlok/compose` realize it in a principled, type-safe way."

---

## 4. Responsibilities of `@seqlok/compose`

`@seqlok/compose` **owns**:

- **Topology description**

  - domains and their specs,
  - rings and their schemas (logical command shapes),
  - runtimes and their roles per domain (controller / processor / observer).

- **Validation**

  - at most one controller per domain,
  - at most one processor per domain,
  - any number of observers,
  - each ring is **SWSR** on the primitive level (ADR-010), but may be used in **MPSC** patterns via higher-level hubs.

- **Realization**

  - running `planLayout` / `allocateShared` / `buildHandoff` for each domain,
  - allocating SABs / shared Wasm memories according to plans,
  - producing handoffs to ship into workers / AudioWorklets,
  - instantiating ring instances (backings + producer/consumer bindings) with configured capacities / schemas.

`@seqlok/compose` **does not** own:

- product-specific policies (e.g. "quantize swaps on bar boundaries"),
- engine lifecycle (spawn → prime → preWarm → crossFade),
- transport logic,
- UI concerns.

Those belong in product-level drivers (e.g. `@dekzer/runtime`).

---

## 5. Non-Goals

`@seqlok/compose` is **not**:

- a generic DI framework,
- a full workflow engine,
- a magic orchestrator that guesses how your system should behave.

It is intentionally small:

- take a topology description,
- validate it against ADR-00Y rules,
- output:

  - plans + backings,
  - handoffs,
  - ring instances (using the core ring primitive),
  - a wiring manifest for product code.

---

## 6. Layering with Core, Ring Primitive, and Drivers

Intended stacking:

- **`@seqlok-internal/prototype-core`**

  - Enforces SWMR semantics per domain.
  - Provides seqlock-based param/meter primitives and snapshot/publish APIs.
  - Provides the **ring primitive** (ADR-010) as a generic SWSR queue over SAB/Wasm memory.
  - Knows nothing about workers, AudioWorklets, or topology.

- **`@seqlok/compose`** (this ADR)

  - Owns topology, runtime wiring, lifecycle bootstrapping:

    - which domains exist,
    - which runtimes host controller/processor/observer roles,
    - which rings exist, and which runtimes are producers/consumer,
    - how to spawn/bind runtimes and pass handoffs/SABs into them.

  - Does **not** change SWMR invariants; it validates them.

- **Product-level drivers (e.g. `@dekzer/runtime`)**

  - Own orchestration and policy:

    - interpret commands from rings,
    - decide when/how to update params,
    - decide when/how to schedule swaps via `SwapTicket`,
    - implement engine/regime policies,
    - enforce higher-level modes (takeover/edit/passive).

---

## 7. Example: Dekzer Deck System (Sketch)

For a Dekzer-like app:

- **Domains**: `deckA`, `deckB`, `mixer`, `waveform`, `analyzer`, `registry`.
- **Rings**: `transport` (play/seek/rate), `engineControl` (swap tickets), `uiEvents` (HUD).

`@seqlok/compose`:

- validates:

  - each deck has 1 controller + 1 processor,
  - mixer has 1 processor,
  - waveform/analyzer run in dedicated workers,

- allocates SABs and builds handoffs,

- yields a topology manifest and binding plan.

Drivers:

- spawn workers / AudioWorklets,
- feed them handoffs,
- wire rings to UI/MIDI/network,
- implement all timing and swap policy.

---

## 8. Consequences

- System-level MWMR wiring becomes reproducible instead of ad-hoc.

- Large systems get:

  - explicit topology,
  - clear separation of concerns,
  - strong TS inference across domains and runtimes.

- `@seqlok-internal/prototype-core` can stay small and stable.

- The ring primitive (ADR-010) stays focused on intent buses and can be reused outside `@seqlok/compose`.

- Products can build drivers on top of a documented, regular base.

ADR-00X remains **Draft** until the first real topology (e.g. Dekzer v1) is implemented and battle-tested.
