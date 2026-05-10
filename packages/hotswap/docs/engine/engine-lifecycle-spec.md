# Seqlok Hotswap Lifecycle Specification

> **Status:** Design specification  
> **Scope:** Engine lifecycle semantics for aligned and persistent hot-swaps

## 1. Purpose

This document defines the lifecycle semantics for swapping DSP engine instances without audible discontinuity.

It does **not** own the engine ABI.
It does **not** own the full driver wiring story.
It does **not** redefine swap-policy levels.

Ownership split:

- This document owns **lifecycle semantics**
- [`engine-sdk-guide.md`](./engine-sdk-guide.md) owns the **engine ABI** and engine-author contract
- [`../IMPLEMENTATION_GUIDE.md`](../IMPLEMENTATION_GUIDE.md) owns **runtime/driver orchestration**
- [`../CONTRACT.md`](../CONTRACT.md) owns the shipped protocol contract

---

## 2. Core law

> **No live structural reconfiguration on the active engine.**

If a change would invalidate internal state, require rebuild/reinit, change algorithmic structure, or otherwise risk transients, that change must happen by replacing the active instance through the hotswap lifecycle.

The active engine instance is replaced.
It is not structurally mutated in place.

This remains true for Signalsmith-based stretch engines, varispeed engines, and any future engine family.

---

## 3. Two continuity classes

Seqlok recognizes two different continuity classes for a structural swap:

- **`aligned`**
- **`persistent`**

These are not additional policy levels.
They are an orthogonal continuity axis.

### 3.1 `aligned`

`aligned` continuity means the incoming engine is started using alignment context such as:

- playback position
- recent input history
- engine-defined auxiliary alignment state

This is the current continuity model formalized.

It is strong, but it is **not** a guarantee that full internal DSP state survives the swap.

### 3.2 `persistent`

`persistent` continuity means the incoming engine receives an explicit handoff snapshot from the outgoing engine, installs it, is advanced through catchup/replay as needed, and only then participates in crossfade.

This is the stronger continuity class.

### 3.3 Critical distinction

`prime()` belongs to **aligned** continuity.

`prime()` by itself is **not** a persistent-state transfer guarantee.

If persistent continuity is requested, the lifecycle must include explicit handoff and catchup semantics.
Do not overload `prime()` into pretending it already solves that problem.

---

## 4. Structural vs non-structural change

Not all changes use hotswap.

### Structural changes

Structural changes require instance replacement through the lifecycle in this document.

Typical examples:

- algorithm family
- quality tier
- FFT/window/hop sizing
- sample rate
- channel count
- major transient/formant modes
- any change the engine family considers rebuild-only

### Non-structural changes

Non-structural changes remain live-update territory.

Typical examples:

- `stretchRatio`
- `pitchRatio`
- gain
- small smooth psychoacoustic controls the engine can safely absorb live

That means:

- active stretch or pitch processing may be running during a structural hot-swap
- but ordinary stretch-ratio or pitch-ratio control changes are not themselves normal hotswap triggers

See the SDK guide for the engine-author contract behind this distinction.

---

## 5. Lifecycle overview

There are two lifecycle families.

> **Runtime truth:** The `@seqlok/hotswap` package currently implements **only** the aligned lifecycle in its RT protocol. The persistent lifecycle is documented here as the intended design, but `spec.ts` does not yet expose `capture`, `install`, or `catchup` phases.

### 5.1 Aligned lifecycle

```text
spawn → prime → preWarm → crossFade → retire
```

### 5.2 Persistent lifecycle

```text
spawn → capture → install → catchup → preWarm → crossFade → retire
```

The persistent lifecycle is a strict expansion of the aligned lifecycle.
It is not merely "better prime."

---

## 6. Aligned lifecycle semantics

The aligned lifecycle is the correct model when the engine family supports alignment continuity but not formal persistent handoff.

### 6.1 `spawn`

Create a new engine instance with the requested structural configuration.

Requirements:

- off audio thread
- allocation allowed
- initialization allowed
- resulting engine is not yet in the audio path

### 6.2 `prime`

Provide alignment context so the incoming engine can start meaningfully from the current musical/runtime position.

Typical alignment context includes:

- playback position
- recent input history
- engine-defined auxiliary alignment state

Requirements:

- enough context for a warm aligned start
- no implication that full running state is preserved
- semantics owned by the engine family ABI

### 6.3 `preWarm`

Run the incoming engine on real input while discarding its output.

Purpose:

- fill buffers
- complete lazy warm-up
- stabilize the engine before blend

Requirements:

- output not yet audible
- bounded duration
- engine must process real input

### 6.4 `crossFade`

Run outgoing and incoming engines in parallel on the same input and blend in the driver.

Requirements:

- same input into both engines
- blend owned by the driver, not the engine
- engine must tolerate parallel execution

### 6.5 `retire`

Retire the outgoing engine after crossfade completes.

Requirements:

- old engine stops participating in output
- reclamation may happen later on a non-RT thread
- memory ordering / reclamation legality belongs to the runtime layer

---

## 7. Persistent lifecycle semantics

The persistent lifecycle is required when a caller requests strong state continuity and the engine family honestly supports it.

### 7.1 `spawn`

Create the candidate engine instance.

Same basic requirements as aligned `spawn`.

### 7.2 `capture`

Capture a handoff snapshot from the outgoing engine at a known frame boundary.

Purpose:

- freeze the outgoing engine's exportable running state
- create a lineage-tied snapshot for the accepted swap

Requirements:

- RT-safe
- no allocation
- no blocking
- bounded execution time
- associated with a specific capture frame
- associated with the currently active engine lineage

### 7.3 `install`

Install the captured snapshot into the candidate engine.

Purpose:

- reconstruct or resume the engine's internal running state in the new instance

Requirements:

- explicit success or failure
- incompatible payloads must be rejected explicitly
- config/ABI lineage must be checked
- no silent acceptance of invalid snapshots

### 7.4 `catchup`

Advance the candidate engine from capture frame to intended crossfade start by replaying the relevant input stream.

This phase is critical.

If the outgoing engine was captured at frame `F`, but the swap becomes audible at frame `F + N`, then the incoming engine must be advanced through that interval or the contract is not honestly persistent.

Requirements:

- deterministic replay input window
- correct frame lineage from capture point to crossfade start
- output remains discarded during catchup

### 7.5 `preWarm`

After install and catchup, continue warm-up until the candidate engine is stable for blend.

Purpose:

- stabilize the imported and replayed engine instance before it becomes audible

### 7.6 `crossFade`

Run outgoing and incoming engines in parallel on the same live input and blend in the driver.

Requirements:

- same input
- driver owns blend
- engine remains parallel-safe

### 7.7 `retire`

Retire the outgoing engine only after the persistent continuity obligations for the accepted swap have been satisfied.

Requirements:

- no retire before successful install
- no retire before required catchup is complete
- no silent downgrade if persistent continuity was required and downgrade was disallowed

---

## 8. Failure semantics

Failure handling depends on continuity class.

### 8.1 Aligned lifecycle failures

Possible failure points:

- create/spawn failure
- alignment/prime failure
- prewarm failure
- crossfade-time engine failure
- retire/reclamation failure

Allowed outcomes:

- reject the swap before audio-path impact
- keep old engine active
- degrade to aligned cold-ish startup behavior if the contract allows it
- never drop to silence as the normal recovery path

Aligned continuity may still permit weaker startup behavior if the engine family cannot fully align from available context.
That does **not** constitute persistent continuity.

### 8.2 Persistent lifecycle failures

Possible failure points:

- capture failure
- install failure
- catchup failure
- prewarm failure
- crossfade-time engine failure

Rules:

- if persistent continuity was requested and downgrade is **not** allowed, the swap must abort explicitly
- if downgrade is allowed, the downgrade must be explicit in runtime outcome state
- persistent-required swaps must never silently proceed as merely aligned or cold

### 8.3 No silent downgrade

This is a lifecycle law:

> If `persistent` continuity is required and downgrade is disallowed, the runtime must not proceed into audible swap completion under weaker continuity.

That rule must be reflected in both runtime behavior and formal modeling.

---

## 9. Engine responsibilities during lifecycle

The engine family must support the lifecycle it claims.

### For aligned continuity

The engine must:

- accept alignment context
- warm from that context meaningfully
- process deterministically for a given config and input
- run safely in parallel with another instance during blend

### For persistent continuity

The engine must additionally support:

- explicit handoff capability declaration
- snapshot export/import semantics
- supported-transition judgment
- deterministic replay/catchup semantics as required by the runtime contract

An engine family must not claim `persistent` unless it can support that honestly.

---

## 10. Signalsmith-class implication

This lifecycle exists in part to support structural hot-swaps while audio is already playing through active time-stretch or pitch-processing engines.

That includes Signalsmith-class stretch engines.

The clean rule is:

- active stretch or pitch DSP may be running during a structural hotswap
- persistent continuity is available only when the adapter/engine family can actually export/import or reconstruct enough running state to support it honestly
- otherwise the engine family may support only `aligned`

Do not promise persistent continuity for a stretch engine just because it has `prime()`.

That would be a naming lie.

---

## 11. Relationship to swap policy

Lifecycle semantics and overlap policy are separate concerns.

Examples:

- `single` + `aligned`
- `single` + `persistent`
- `reject-busy` + `aligned`
- `reject-busy` + `persistent`

Supported shipped policy levels remain defined elsewhere.
This document does not redefine those levels.

---

## 12. Formal-model implications

This document does not contain the TLA+ model, but it defines lifecycle obligations that the formal model must reflect.

Persistent continuity requires modeling at least:

- capture state
- install state
- catchup state
- continuity requested vs continuity granted
- downgrade legality
- retire gating

TLA+ should prove lifecycle legality and lineage rules.
It should not be used to prove psychoacoustic transparency or waveform closeness.

See:

- [`../formal/README.md`](../formal/README.md)
- [`../adr/hotswap-continuity-classes-and-persistent-handoff.md`](../adr/hotswap-continuity-classes-and-persistent-handoff.md)

---

## 13. What this document deliberately does not own

This document does not own:

- engine ABI type definitions
- runtime command transport details
- ticket delivery mechanics
- crossfade curve implementation details
- TLA+ execution instructions
- exploratory future overlap policies

Those belong elsewhere by design.

---

## 14. Final summary

The aligned lifecycle is:

```text
spawn → prime → preWarm → crossFade → retire
```

The persistent lifecycle is:

```text
spawn → capture → install → catchup → preWarm → crossFade → retire
```

That distinction is the architectural correction.

`prime()` remains the correct aligned-start mechanism.
Persistent continuity requires more than that.

If a structural swap needs strong running-state continuity, the lifecycle must say so explicitly, the engine must support it honestly, and the runtime must enforce it without silent downgrade.
