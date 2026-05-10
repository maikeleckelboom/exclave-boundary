# ADR-00Y: MWMR System Architecture via Seqlok Domains + Observers + Rings

**Status**: Proposed
**Date**: 2025-11-16
**Owner**: _TBD_

**Related**:

- ADR-001 – Seqlok Core Canonical Flow
- ADR-002 – Memory Growth & Swap via Handoff Sequences
- ADR-00Z – Observer Binding Role in `@seqlok/core`
- ADR-00X – `@seqlok/compose` for System-Level Composition
- ADR-010 – Ring Primitive in `@seqlok/core` (SWSR queue)

---

## 1. Context

Seqlok core provides rock-solid **SWMR** primitives with seqlock-based coherence. The canonical flow is frozen:

```txt
defineSpec
→ planLayout
→ allocateShared
→ buildHandoff
→ acceptHandoff
→ bind{Controller,Processor}
```

Real-world systems like Dekzer need **system-level MWMR** without compromising the per-domain SWMR guarantees. The goal is:

- MWMR as an **emergent property** of composition,
- not as "many writers per plane" primitives.

---

## 2. Problem Statement

Complex real-time systems require:

1. Multiple logical writers across different domains.
2. Multiple concurrent readers with coherent views.
3. Real-time guarantees (predictable latency, no allocations in hot paths).
4. Clear authority boundaries (who owns what, in which runtime).

Naively extending Seqlok primitives to allow many writers per plane would:

- break SWMR invariants,
- complicate seqlock semantics,
- make correctness reasoning painful.

We want MWMR from:

- many **intent producers** (UI, MIDI, network, AI, IPC),
- a **hub/governor** that owns controller bindings,
- many **observers** on each domain via `bindObserver`,
- **rings** as the "intent bus", built from the SWSR ring primitive defined in ADR-010.

---

## 3. Decision

### 3.1 Core Architecture: Domains as Islands

Conceptually:

```ts
type Domain<S extends SpecInput> = {
  readonly spec: Spec<S>;
  readonly backing: Backing;
  readonly controller: ControllerBinding<S> | null; // one param writer
  readonly processor: ProcessorBinding<S> | null; // one meter writer
  readonly observers: Set<ObserverBinding<S>>; // many readers
};

type SystemDomain = Domain<SpecInput>;

type CommandRing = unknown; // logical type, realized via ring primitive (ADR-010)

type System = {
  readonly domains: Map<DomainId, SystemDomain>;
  readonly commandRing: CommandRing;
  readonly registry: Domain<RegistrySpec>;
};
```

Each `Domain<S>` is strictly SWMR:

- at most one controller,
- at most one processor,
- zero or more observers (read-only).

The **system** is a graph of such domains wired with:

- `bindObserver` for **fan-out** (many readers),
- one or more **rings** for **fan-in** (many writers → hub/governor),
- an optional registry domain for discovery/co-ordination.

`@seqlok/core` knows only about **domains** and the ring primitive itself. MWMR lives above it (compose + drivers).

### 3.2 New Binding Role: `bindObserver` (delegated to ADR-00Z)

`bindObserver` is the third binding role alongside `bindController` and `bindProcessor`. It provides coherent, **read-only** access to params and meters.

Public surface (conceptual):

```ts
export function bindObserver<S extends SpecInput>(
  accepted: AcceptedHandoff<S>,
  options?: ObserverOptions,
): ObserverBinding<S>;
```

- `bindController(spec, backing, ...)` is **owner-side**.
- `bindProcessor(accepted, ...)` and `bindObserver(accepted, ...)` are **consumer-side** and always start from an `AcceptedHandoff<S>`.

The exact semantics and invariants of `ObserverBinding` are specified in ADR-00Z.

### 3.3 Rings as Intent Buses

System-level MWMR uses **intent buses** built from the SWSR ring primitive (ADR-010):

- Many producers (UI, MIDI, automation, network, AI agents, IPC bridges, …) enqueue **commands**.
- A single consumer per ring (hub/governor driver) dequeues and:

  - calls controller APIs (`params.update`, `params.stage`, `hydrate`),
  - drives engine lifecycle & swaps with `SwapTicket`.

The ring primitive:

- lives in `@seqlok/core` as a generic, semantic-free SWSR queue,
- operates over `SharedArrayBuffer` / shared Wasm memory with a fixed ABI,
- is composed into MPSC patterns by higher layers (e.g. `@seqlok/compose` and drivers).

Rings **do not** expose Seqlok planes directly. They transport **intents**, not shared state.

---

## 4. Binding Roles and Authority Model (Locked)

This ADR formally locks per-domain SWMR invariants.

### 4.1 Per-domain SWMR invariants

For any Seqlok domain `Domain<S>`:

1. There is at most one `ControllerBinding<S>` instance allowed to write params.
2. There is at most one `ProcessorBinding<S>` instance allowed to write meters.
3. There may be zero or more `ObserverBinding<S>` instances, all read-only.

Concretely:

- Only the controller binding may call:

  - `params.set(...)`
  - `params.update(...)`
  - `params.stage('arrayKey', cb)`
  - `params.hydrate(...)`

- Only the processor binding may call:

  - `meters.publish(cb)`
  - `meters.stage('arrayKey', cb)`

- Observers may only call:

  - `params.snapshot(...)`
  - `params.version()`
  - `meters.snapshot(...)`
  - `meters.version()`

There are no APIs on `ObserverBinding<S>` that can mutate planes (no set, update, stage, publish).

> Any conceptual "many controllers" are many **logical** controllers feeding commands into rings, not multiple `ControllerBinding<S>` instances for a domain.

### 4.2 Observer scope and non-goals

`bindObserver` exists to provide **safe, coherent read access** for:

- HUDs and debug panels,
- WebGPU / OffscreenCanvas visualizers,
- analyzer workers,
- diagnostics/health dashboards,
- hardware / telemetry bridges,
- third-party tools.

Constraints:

- No write APIs of any kind.
- No leases, capabilities, or writer tickets.
- No dynamic key access ("scratch-" + id, arbitrary strings).
- No orchestration / scheduling responsibilities.

`bindObserver` is **not** where you implement:

- time travel,
- multi-writer aggregation,
- engine swaps,
- transport control,
- any "business logic" policy.

Those belong in drivers / orchestrators that own the controller bindings.

---

## 5. System-level MWMR via Rings and Observers

This ADR reaffirms:

1. **Per-domain**: SWMR enforced via binding roles.
2. **System-level MWMR**: emerges from:

- many producers writing commands into **rings** (core ring primitive, ADR-010),
- a single consumer per ring (hub/governor) owning controller bindings,
- many observers per domain via `bindObserver`.

Patterns:

- **Fan-in (MW → 1)**

  - UI, MIDI, automation, network, AI agents, IPC, etc. produce commands.
  - All feed one or more logical `CommandRing`s built from ring primitives.
  - A single driver / governor consumes and translates them into:

    - `controller.params.*` calls, and/or
    - engine configuration / swap decisions.

- **Fan-out (1 → MR)**

  - Controller + processor define the canonical state of a domain.
  - Any number of observers attach via `bindObserver`.
  - Observers only ever call `snapshot` / `version`.

No code outside controller/processor bindings writes into Seqlok planes, regardless of how many agents you have.

---

## 6. Orchestration Responsibilities

This ADR clarifies that **orchestration is not** a concern of `@seqlok/core` or `bindObserver`:

- The "driver" (TimelineDriver / DomainOrchestrator / SystemManager) is responsible for:

  - consuming rings,
  - translating intents into param updates and swap tickets,
  - owning engine lifecycle (spawn → configure → prime → preWarm → swap via `SwapTicket`),
  - respecting higher-level mode semantics (takeover/edit/passive).

`@seqlok/compose` (ADR-00X) is the topology tool; drivers embed the actual run-time policy.

---

## 7. Benefits of This Architecture

1. **Principled Composition** – MWMR emerges from SWMR building blocks.
2. **Clear Authority** – Each domain has exactly one param writer and one meter writer.
3. **Scalable Observation** – Unlimited read-only observers per domain via `bindObserver`.
4. **Real-Time Safe** – No allocations in hot paths, predictable latency, frame-accurate swaps.
5. **Growth Without Tears** – New handoffs, not in-place mutations; swaps at frame boundaries.
6. **Type Safety** – Full TS inference preserved across domain boundaries.
7. **Future-Proof for Agents/AI** – Same pattern works for agent runtimes:

- observe via `bindObserver`,
- emit intents via rings,
- hub/governor applies changes.

---

## 8. Summary

We achieve system-level MWMR by:

- composing multiple SWMR Seqlok domains,
- adding `bindObserver` for many-reader fan-out,
- using rings (via the core ring primitive) for many-writer fan-in,
- orchestrating growth via handoff sequences and `SwapTicket`s,
- maintaining frame-accurate swap semantics for real-time contexts.

Seqlok's primitives stay simple and strict, while complex real-time apps (Dekzer, agent swarms, etc.) get a solid MWMR architecture on top.
