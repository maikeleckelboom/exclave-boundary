# ADR-00Z: Observer Binding Role in `@seqlok-internal/prototype-core`

**Status**: Proposed
**Date**: 2025-11-18
**Owner**: _TBD_

**Related**:

- ADR-001 – Seqlok Core Golden Flow
- ADR-00Y – MWMR System Architecture via Domains + Observers + Rings
- ADR-00X – `@seqlok/compose` System Composition
- ADR-00C – Meter Writes & Snapshot `into` (Controller side)

---

## 1. Context

Seqlok core models each domain as **SWMR**:

- one param writer (`ControllerBinding`)
- one meter writer (`ProcessorBinding`)
- any number of **readers**

Existing bindings:

- `bindController` – owns and writes **params**
- `bindProcessor` – consumes a `Handoff` and writes **meters**

Real systems also need:

- HUDs & devtools panels
- WebGPU / OffscreenCanvas visualizers
- telemetry / hardware bridges
- analyzer workers & diagnostics dashboards
- AI agents / automation layers

All of these must **observe** state without any ability to mutate it.

We want a first-class **observer** role with:

- a minimal surface
- clear snapshot semantics
- a well-defined place inside the MWMR architecture (ADR-00Y)

---

## 2. Decision

We add `bindObserver` to `@seqlok-internal/prototype-core` as the standard read-only binding.

### 2.1 API surface (conceptual)

```ts
export function bindObserver<S extends SpecInput>(
  received: ReceivedHandoff<S>,
  options?: ObserverOptions,
): ObserverBinding<S>;

export interface ObserverBinding<S extends SpecInput> {
  readonly params: ObserverParams<S>;
  readonly meters: ObserverMeters<S>;

  dispose(): void;
}

export interface ObserverParams<S extends SpecInput> {
  snapshot(): ParamsSnapshot<S>;

  snapshot<const K extends readonly ParamKeys<S>[]>(
    keys: K,
  ): SnapshotParamsObject<S, K>;

  version(): PUSeq;
}

export interface ObserverMeters<S extends SpecInput> {
  snapshot(): MetersSnapshot<S>;

  snapshot<const K extends readonly MeterKeys<S>[]>(
    keys: K,
  ): SnapshotMetersObject<S, K>;

  version(): MUSeq;
}

export interface ObserverOptions {
  // Reserved for future tuning (max retries, diagnostics hooks, etc.).
}
```

Notes:

- `bindObserver` is **consumer-side** and always starts from a `ReceivedHandoff<S>`.
- It shares the same layout / plan as controller & processor.
- It never has any ability to write into planes.

---

## 3. Snapshot Semantics

We deliberately distinguish **controller-side** vs **observer-side** snapshots:

| Role       | API                                     | Semantics                       | Typical Use                                    |
| ---------- | --------------------------------------- | ------------------------------- | ---------------------------------------------- |
| Controller | `controller.meters.snapshot(..., into)` | logical copy (can be persisted) | presets, save/restore, off-line processing     |
| Observer   | `observer.meters.snapshot(...)`         | _ephemeral_ SAB-backed views    | GPU uploads, UDP packets, telemetry, analyzers |

More precisely:

- Both controller and observer use **seqlock retry** to guarantee a coherent view at the instant of `snapshot()`.

- Controller-side snapshots are treated as **logical copies**:

  - even if implementation reuses scratch buffers, the calling code treats the result as "detached from SAB" state (
    suitable for persistence / hydrate).

- Observer-side snapshots return **live SAB views**:

  - TypedArrays are views into the underlying `SharedArrayBuffer`,
  - they are **ephemeral**: valid within the current tick, not for long-term storage,
  - coherence is only guaranteed at the moment `snapshot` returns; subsequent writer activity may mutate underlying
    bytes.

This gives a clean split:

- “I want a copy to save/restore” → controller snapshot APIs (ADR-00C / ADR-00F).
- “I want raw bytes to stream into GPU or network” → observer snapshot APIs (this ADR).

---

## 4. Role within SWMR / MWMR

For any Seqlok domain `D` (see ADR-00Y):

- **Exactly one param writer**: `ControllerBinding<S>`
- **Exactly one meter writer**: `ProcessorBinding<S>`
- **Zero or more observers**: `ObserverBinding<S>`

The allowed operations:

- Controller:

  - `params.set(...)`
  - `params.update(...)`
  - `params.stage('arrayKey', cb)`
  - `params.hydrate(...)`
  - `meters.snapshot(...)` (for local reads / debugging)

- Processor:

  - `meters.publish(cb)`
  - `meters.stage('arrayKey', cb)`
  - `params.within(cb)` (coherent reads)

- Observer:

  - `params.snapshot(...)`
  - `params.version()`
  - `meters.snapshot(...)`
  - `meters.version()`

There are **no write APIs** on `ObserverBinding<S>`:
no set, update, stage, or publish. Observers cannot influence the domain.

> Any conceptual "many controllers" live as many **intent producers** feeding
> **rings** (ADR-010), not as multiple `ControllerBinding<S>` instances.

MWMR at the system level is achieved by:

- many producers writing intents into **rings**
- a single driver / governor consuming and applying them to controller bindings
- many observers consuming snapshots for visualization / analysis

`bindObserver` is the "1 → MR" side of that story.

---

## 5. Consequences

- All read-only consumers (UI, telemetry, GPU, analyzers, agents) have **one blessed API**:

  - `bindObserver` + `snapshot` + `version`.

- SWMR is preserved per domain:

  - single param writer, single meter writer.

- MWMR is constructed at the **system** level:

  - many writers → ring(s) → one controller/processor pair,
  - one domain → many observers.

Higher-level packages:

- `@seqlok/compose`
- product drivers like `@dekzer/device-*`

can depend on `bindObserver` as the only way to attach additional readers to a domain.

Any design that "needs more writers" must be expressed via:

- **rings** (intent fan-in), and
- product-level drivers that own controller/processor bindings.

Together with ADR-00Y and ADR-010, this ADR locks in:

- SWMR at the primitive level,
- MWMR at the system level,
- clean separation of responsibilities.
