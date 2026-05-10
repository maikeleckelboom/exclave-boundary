# @seqlok/hotswap Implementation Guide

## Overview

This document describes how to implement a conformant driver for the `@seqlok/hotswap` protocol. The protocol is defined
by:

1. **TLA+ Specifications** (`HotSwapSingle.tla`, `HotSwapRejectBusy.tla`) — formal sources of truth
2. **TypeScript Reference** (TypeScript implementation under `src/`) — canonical implementation
3. **This Guide** — integration patterns and caller responsibilities

The protocol is intentionally minimal. It tracks _phase_ and _counters_. Everything else — engines, buffers, crossfade
curves, memory management — is the caller's responsibility.

This guide owns **host/runtime wiring and operational integration**.
It does not own the engine ABI; see [`engine/engine-sdk-guide.md`](./engine/engine-sdk-guide.md).
It does not own lifecycle semantics; see [`engine/engine-lifecycle-spec.md`](./engine/engine-lifecycle-spec.md).

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Continuity Classes](#continuity-classes)
3. [Aligned Lifecycle Orchestration](#aligned-lifecycle-orchestration)
4. [Persistent Lifecycle Orchestration](#persistent-lifecycle-orchestration)
5. [Memory Ordering Contract](#memory-ordering-contract)
6. [Buffer and Snapshot Ownership](#buffer-and-snapshot-ownership)
7. [Ticket Delivery Pattern](#ticket-delivery-pattern)
8. [Crossfade Curve Implementation](#crossfade-curve-implementation)
9. [Integration with Seqlok Meters](#integration-with-seqlok-meters)
10. [Error Handling and Edge Cases](#error-handling-and-edge-cases)
11. [Downgrade and Abort Rules](#downgrade-and-abort-rules)
12. [Testing Strategy](#testing-strategy)
13. [C++ Implementation Notes](#c-implementation-notes)

---

## Core Concepts

### The Slot Abstraction

A slot is a logical container that holds:

- Exactly one **current engine** (always present, produces output)
- At most one **next engine** (present only during swap)

The protocol guarantees: **at most two engines are ever instantiated per slot**.

### What the Protocol Does

- Tracks which **phase** a swap is in.
- Counts down **prewarm blocks** and **fade frames**.
- Emits a small enum (`SwapStepKind`) describing what work to do for the current block.

### What the Protocol Does _Not_ Do

- Construct or destroy engines.
- Process audio samples.
- Blend signals or define crossfade curves.
- Manage memory or engine pooling.
- Enforce musical timing (`atFrame` is informational).

All of those are delegated to the host/integration layer.

---

## Continuity Classes

Seqlok hotswap has two orthogonal axes:

1. **Swap policy** — `single` or `reject-busy` (Levels 1–2).
2. **Continuity class** — `aligned` or `persistent`.

This guide covers the runtime orchestration for both continuity classes.
The engine ABI and capability discovery are defined in [`engine/engine-sdk-guide.md`](./engine/engine-sdk-guide.md).

- **`aligned`** — the incoming engine is primed with alignment context and prewarmed.
- **`persistent`** — the incoming engine receives a handoff snapshot, installs it, and is advanced through catchup before prewarm and crossfade.

Do not treat `persistent` as merely "better `prime()`".
It is a separate lifecycle with explicit obligations.

---

## Aligned Lifecycle Orchestration

The aligned lifecycle is the default when persistent continuity is not requested or not supported.

```text
spawn → prime → preWarm → crossFade → retire
```

### Phase Durations

| Phase       | Duration   | Notes                                 |
| ----------- | ---------- | ------------------------------------- |
| `idle`      | Indefinite | Waiting for swap request              |
| `spawn`     | 1 block    | Next engine exists, not yet processed |
| `prime`     | 1 block    | Next engine's first `process()` call  |
| `prewarm`   | N blocks   | `N = ticket.preWarmBlocks`            |
| `crossfade` | M blocks   | Until `fadeFramesRemaining <= 0`      |
| `retire`    | 1 block    | Final block before handle swap        |

### Caller Responsibilities by Phase

Each block, the driver calls a function like:

```ts
const decision = stepSwapStateRT(
  state,
  blockFrames,
  activeKind,
  nextKind,
  noneKindSentinel,
);
```

The `decision.kind` tells the caller what to do.

#### `idle` → No active swap

```ts
// SwapStepKind: 'idle'
//
// Caller MUST:
//   - Run current engine normally.
//   - Poll for incoming tickets (from integration thread).
//
// Caller MAY:
//   - Do nothing special beyond normal audio processing.
```

#### `spawn` → Next engine just instantiated

```ts
// SwapStepKind: 'runCurrentOnly'
//
// Caller MUST:
//   - Run current engine, use its output.
//   - NOT call process() on next engine yet.
//
// Caller MAY:
//   - Perform any final initialization on next engine.
//
// Duration: exactly 1 block.
```

#### `prime` → Next engine's first process

```ts
// SwapStepKind: 'runCurrentOnly'
//
// Caller MUST:
//   - Run current engine, use its output.
//   - Run next engine's process() once (output discarded).
//
// Rationale: allows next engine to fill delay lines, initialize filters, etc.
//
// Duration: exactly 1 block.
```

#### `prewarm` → Warming up next engine

```ts
// SwapStepKind: 'runCurrentAndPrewarmNext'
//
// Caller MUST:
//   - Run current engine, use its output.
//   - Run next engine's process() (output discarded).
//
// Rationale: time-domains effects (reverb, lookahead, FIR filters) need multiple
// blocks to reach a stable state before their output sounds correct.
//
// Duration: ticket.preWarmBlocks blocks.
```

#### `crossfade` → Both engines producing output

```ts
// SwapStepKind: 'runBothForCrossfade'
//
// Caller MUST:
//   - Run current engine, capture output (outA).
//   - Run next engine, capture output (outB).
//   - Blend: out = outA * fadeOut + outB * fadeIn.
//   - Compute fade weights from fadeFramesRemaining / totalFadeFrames.
//
// Duration: approximately ceil(ticket.fadeFrames / blockFrames) blocks.
```

#### `retire` → Crossfade complete

```ts
// SwapStepKind: 'retireNow'
//
// Caller MUST:
//   - Run current engine ONE FINAL TIME (output used).
//   - After processing this block: swap engine handles (next -> current).
//   - After processing this block: arrange for the retiring engine to be
//     reclaimed on a non-RT thread, with a suitable memory barrier.
//
// Duration: exactly 1 block, then back to idle.
```

---

## Persistent Lifecycle Orchestration

> **Runtime truth:** The `@seqlok/hotswap` package (as of the current version) implements **only** the aligned lifecycle in its RT protocol (`spec.ts`). Persistent continuity is documented here as doctrine and formal model, but the runtime surfaces (`SwapPhase`, `stepSwapStateRT`, etc.) do **not** yet include `capture`, `install`, or `catchup` phases. Do not assume the code already supports what this section describes.

The persistent lifecycle is required when a caller requests `persistent` continuity and the engine family supports it.

```text
spawn → capture → install → catchup → preWarm → crossFade → retire
```

### Additional phases

#### `capture`

Export a handoff snapshot from the outgoing engine at a known frame boundary.

Requirements:

- RT-safe, no allocation, no blocking
- Bounded execution time
- Tied to a specific capture frame and engine lineage
- Snapshot buffer must be preallocated by the runtime

#### `install`

Install the captured snapshot into the candidate engine.

Requirements:

- Explicit success or failure
- Incompatible payloads rejected explicitly
- Config/ABI lineage checked

#### `catchup`

Advance the candidate engine from capture frame to intended crossfade start by replaying the relevant input stream.

Requirements:

- Deterministic replay input window
- Correct frame lineage from capture point to crossfade start
- Output remains discarded during catchup

If the outgoing engine was captured at frame `F`, but the swap becomes audible at frame `F + N`, the incoming engine must be advanced through that interval.

### Runtime sequencing rules

1. **Capability check before capture**  
   Query `getHandoffCapability()` to confirm the transition supports persistent continuity. If not, proceed to [downgrade/abort handling](#downgrade-and-abort-rules).

2. **Capture before install**  
   The snapshot must be captured from the currently active engine before it is retired.

3. **Install before catchup**  
   The snapshot must be successfully installed before catchup begins.

4. **Catchup before prewarm**  
   Catchup must complete (or be skipped because capture frame equals crossfade start) before the candidate engine enters prewarm.

5. **Retire gating**  
   The outgoing engine must not be retired until:
   - install succeeded, and
   - required catchup is complete, and
   - crossfade has finished.

---

## Memory Ordering Contract

When `retireNow` is returned, the driver must ensure:

1. All writes performed by the retiring engine become visible before reclamation.
2. The host thread does not destroy or recycle the engine until that visibility is guaranteed.

### Native (C++)

```cpp
void onRetireNow() {
    // 1. Final block from current engine
    currentEngine->process(buffer);

    // 2. Publish all writes before handing engine to another thread
    std::atomic_thread_fence(std::memory_order_release);

    // 3. Swap handles
    Engine* old = currentEngine;
    currentEngine = nextEngine;
    nextEngine = nullptr;

    // 4. Signal reclamation on a non-RT thread
    retireQueue.push(old);
}
```

### Web Audio (AudioWorklet)

```ts
function onRetireNow() {
  // 1. Final process
  this.currentEngine.process(buffer);

  // 2. Release-style store to shared status
  Atomics.store(this.statusView, STATUS_OFFSET, RETIRED);

  // 3. Swap handles
  const old = this.currentEngine;
  this.currentEngine = this.nextEngine;
  this.nextEngine = null;

  // 4. Notify main thread
  this.port.postMessage({ type: "retired", handle: old.id });
}
```

Implementations must avoid allocations, locks, and syscalls on the RT path.

---

## Buffer and Snapshot Ownership

The runtime owns all buffers involved in persistent handoff.

### Snapshot buffer

- Preallocated before capture
- Sized to `maxSnapshotBytes` reported by the engine family
- Reclaimed after retire, on a non-RT thread

### Replay/catchup buffer

- The runtime must retain enough input history to replay from any capture frame to the crossfade start
- Minimum retention window: `maxLatency + maxCatchupFrames`
- Owned by the host audio path, not the engine

### Crossfade output buffers

- Preallocated per slot
- Must accommodate two engine outputs plus blend destination

No allocation may occur on the audio thread for handoff capture, install, or catchup.

---

## Ticket Delivery Pattern

Tickets are built on a host/integration thread and delivered to the RT thread via a lock-free channel (e.g. SPSC ring).

Conceptual flow:

```text
Host thread                                   RT thread
-----------                                   ---------
1. Build ticket + engine instance       -->   4. Dequeue command
2. Enqueue command (lock-free)          -->   5. Copy ticket into RT state
                                              6. Call initSwapStateRT
```

### Command shape (RT-safe)

```ts
interface InstallSwapCommand<EngineKind extends number> {
  readonly tag: 1; // discriminant
  readonly engineHandle: number; // index into preallocated engine table
  readonly ticket: SwapTicketRT<EngineKind>; // POD, copied by value
}
```

The host can maintain a richer ticket type; only the RT subset (`SwapTicketRT`) crosses into the RT domain.

---

## Crossfade Curve Implementation

The protocol exposes `fadeFramesRemaining` and `totalFadeFrames`. The curve itself is policy.

### Linear crossfade

```ts
function linearFade(state: SwapStateRT<number>): {
  fadeIn: number;
  fadeOut: number;
} {
  const t = 1 - state.fadeFramesRemaining / state.totalFadeFrames;
  return { fadeIn: t, fadeOut: 1 - t };
}
```

### Equal-power crossfade (recommended for audio)

```ts
function equalPowerFade(state: SwapStateRT<number>): {
  fadeIn: number;
  fadeOut: number;
} {
  const t = 1 - state.fadeFramesRemaining / state.totalFadeFrames;
  return {
    fadeIn: Math.sin(t * Math.PI * 0.5),
    fadeOut: Math.cos(t * Math.PI * 0.5),
  };
}
```

### Per-sample fading within a block

```ts
function processCrossfadeBlock(
  outA: Float32Array,
  outB: Float32Array,
  dest: Float32Array,
  fadeFramesStart: number,
  totalFadeFrames: number,
  blockFrames: number,
): void {
  for (let i = 0; i < blockFrames; i++) {
    const framesRemaining = Math.max(0, fadeFramesStart - i);
    const t = 1 - framesRemaining / totalFadeFrames;
    const fadeIn = Math.sin(t * Math.PI * 0.5);
    const fadeOut = Math.cos(t * Math.PI * 0.5);
    dest[i] = outA[i] * fadeOut + outB[i] * fadeIn;
  }
}
```

---

## Integration with Seqlok Meters

The swap state can be exposed to the UI via Seqlok meters.

Example spec:

```ts
const swapMeterSpec = defineSpec({
  meters: {
    phase: { kind: "u32" }, // encoded SwapPhase
    ticketId: { kind: "u32" },
    progress: { kind: "f32" },
    activeEngineKind: { kind: "u32" },
    nextEngineKind: { kind: "u32" },
  },
});
```

RT side:

```ts
processor.meters.phase = phaseToU32(status.phase);
processor.meters.ticketId = status.ticketId;
processor.meters.progress = status.progress;
processor.meters.activeEngineKind = status.activeEngineKind;
processor.meters.nextEngineKind = status.nextEngineKind;
```

Host/UI side reads snapshots for display.

---

## Error Handling and Edge Cases

- `fadeFrames = 0`
  Not allowed by the spec; treated as invalid input. Implementations should assert or reject such tickets.

- `preWarmBlocks = 0`
  Legal; the protocol goes `prime → crossfade` immediately.

- Ticket arrives during active swap
  Base protocol is Level 1 (`single`): one in-flight swap per slot. Overlap
  handling is a host-side policy choice. Supported Level 2 behavior is
  `reject-busy` (reject while busy). Advanced overlap-handling behavior is
  Level 3+ (experimental/future) and must be treated as out of scope for the
  shipped contract.

- Cancellation mid-swap
  Not part of the base contract. Adding cancellation requires extending both implementation and TLA⁺ specs.

---

## Downgrade and Abort Rules

When persistent continuity is requested, the runtime must handle failure explicitly.

### Persistent required, downgrade disallowed

If `continuityRequirement = "persistent"` and `allowContinuityDowngrade = false`:

- The swap must abort if persistent continuity cannot be established.
- The old engine remains active.
- The caller receives an explicit failure result.
- The runtime must not proceed into audible swap completion under weaker continuity.

### Persistent required, downgrade allowed

If `continuityRequirement = "persistent"` and `allowContinuityDowngrade = true`:

- The runtime may attempt the swap under `aligned` or `cold` continuity.
- The granted continuity class must be explicit in the outcome state.
- No silent downgrade.

### Aligned required

If `continuityRequirement = "aligned"` (or omitted):

- The runtime uses the aligned lifecycle.
- Persistent capability is irrelevant.
- Failure to align is handled as an ordinary swap failure.

### Failure points specific to persistent continuity

| Failure          | Aligned fallback? | Action             |
| ---------------- | ----------------- | ------------------ |
| capture failed   | yes (if allowed)  | abort or downgrade |
| install rejected | yes (if allowed)  | abort or downgrade |
| catchup failed   | yes (if allowed)  | abort or downgrade |
| engine declined  | yes (if allowed)  | abort or downgrade |

---

## Testing Strategy

- Unit tests for `stepSwapStateRT` across all phases.
- Property tests mirroring TLA⁺ invariants (e.g. "eventually idle", "at most two engines").
- Cross-language conformance tests with JSON test vectors shared between TypeScript and C++ implementations.
- Persistent-handoff integration tests:
  - snapshot export/import round-trip
  - catchup determinism
  - explicit downgrade behavior
  - no retire before install/catchup complete

---

## C++ Implementation Notes

The C++ API mirrors the TS contracts with templates instead of generics and sentinel values instead of `undefined`. The
same restrictions apply: no allocation, no locks, deterministic control flow.

---

## Version History

| Version | Changes                                                                                                                 |
| ------: | ----------------------------------------------------------------------------------------------------------------------- |
|   0.1.0 | Initial protocol. No cancellation. Single-swap only.                                                                    |
|   0.2.0 | Documented continuity-class orchestration and persistent-handoff doctrine. Runtime implementation remains aligned-only. |
