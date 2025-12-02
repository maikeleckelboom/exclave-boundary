# @seqlok/hotswap Implementation Guide

## Overview

This document describes how to implement a conformant driver for the `@seqlok/hotswap` protocol. The protocol is defined
by:

1. **TLA+ Specification** (`HotSwapProtocol.tla`) — formal source of truth
2. **TypeScript Reference** (`src/spec.ts`) — canonical implementation
3. **This Guide** — integration patterns and caller responsibilities

The protocol is intentionally minimal. It tracks *phase* and *counters*. Everything else — engines, buffers, crossfade
curves, memory management — is your responsibility.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [State Machine Reference](#state-machine-reference)
3. [Caller Responsibilities by Phase](#caller-responsibilities-by-phase)
4. [Memory Ordering Contract](#memory-ordering-contract)
5. [Ticket Delivery Pattern](#ticket-delivery-pattern)
6. [Crossfade Curve Implementation](#crossfade-curve-implementation)
7. [Integration with Seqlok Meters](#integration-with-seqlok-meters)
8. [Error Handling and Edge Cases](#error-handling-and-edge-cases)
9. [Testing Strategy](#testing-strategy)
10. [C++ Implementation Notes](#c-implementation-notes)

---

## Core Concepts

### The Slot Abstraction

A "slot" is a logical container that holds:

- Exactly one **current engine** (always present, produces output)
- At most one **next engine** (present only during swap)

The protocol guarantees: **at most two engines are ever instantiated per slot**.

### What the Protocol Does

- Tracks which **phase** the swap is in
- Counts down **prewarm blocks** and **fade frames**
- Tells you **what to do this block** via `SwapStepKind`

### What the Protocol Does NOT Do

- Construct or destroy engines
- Process audio
- Blend signals
- Manage memory
- Enforce timing (the `atFrame` field is informational)

---

## State Machine Reference

```
                          AcceptTicket
    ┌───────┐         (ticket + next engine ready)        ┌───────┐
    │ idle  │ ────────────────────────────────────────────▶ spawn │
    └───────┘                                             └───────┘
        ▲                                                     │
        │                                               stepSwapStateRT
        │                                                     │
        │                                                     ▼
        │                                                ┌───────┐
        │                                                │ prime │
        │                                                └───────┘
        │                                                     │
        │                              ┌──────────────────────┴──────────────────────┐
        │                              │                                             │
        │                              ▼ (preWarmBlocks > 0)                         ▼ (preWarmBlocks = 0)
        │                        ┌─────────┐                                   ┌───────────┐
        │                        │ prewarm │──────────────────────────────────▶│ crossfade │
        │                        └─────────┘                                   └───────────┘
        │                              │ (preWarmBlocksRemaining hits 0)             │
        │                              └─────────────────────────────────────────────┘
        │                                                                            │
        │                                                                            ▼
        │                                                                      ┌─────────┐
        └──────────────────────────────────────────────────────────────────────│ retire  │
                                                                               └─────────┘
```

### Phase Durations

| Phase       | Duration   | Notes                                 |
|-------------|------------|---------------------------------------|
| `idle`      | Indefinite | Waiting for swap request              |
| `spawn`     | 1 block    | Next engine exists, not yet processed |
| `prime`     | 1 block    | Next engine's first `process()` call  |
| `prewarm`   | N blocks   | `N = ticket.preWarmBlocks`            |
| `crossfade` | M blocks   | Until `fadeFramesRemaining <= 0`      |
| `retire`    | 1 block    | Final block before handle swap        |

---

## Caller Responsibilities by Phase

### `idle` → No active swap

```ts
// SwapStepKind: 'idle'
//
// Caller MUST:
//   - Run current engine normally
//   - Poll for incoming tickets (from integration thread)
//
// Caller MAY:
//   - Do nothing special
```

### `spawn` → Next engine just instantiated

```ts
// SwapStepKind: 'runCurrentOnly'
//
// Caller MUST:
//   - Run current engine, use its output
//   - NOT call process() on next engine yet
//
// Caller MAY:
//   - Perform any final initialization on next engine
//
// Duration: exactly 1 block
```

### `prime` → Next engine's first process

```ts
// SwapStepKind: 'runCurrentOnly'
//
// Caller MUST:
//   - Run current engine, use its output
//   - Run next engine's process() once (output discarded)
//
// Why: Lets next engine fill delay lines, initialize filters, etc.
//
// Duration: exactly 1 block
```

### `prewarm` → Warming up next engine

```ts
// SwapStepKind: 'runCurrentAndPrewarmNext'
//
// Caller MUST:
//   - Run current engine, use its output
//   - Run next engine's process() (output discarded)
//
// Why: Time-domain effects (reverb, lookahead) need multiple blocks
//      to reach steady state before their output sounds correct.
//
// Duration: ticket.preWarmBlocks blocks
```

### `crossfade` → Both engines producing output

```ts
// SwapStepKind: 'runBothForCrossfade'
//
// Caller MUST:
//   - Run current engine, capture output (outA)
//   - Run next engine, capture output (outB)
//   - Blend: out = outA * fadeOut + outB * fadeIn
//   - Compute fade weights from state.fadeFramesRemaining / state.totalFadeFrames
//
// Duration: ceil(ticket.fadeFrames / blockFrames) blocks (approximately)
```

### `retire` → Crossfade complete

```ts
// SwapStepKind: 'retireNow'
//
// Caller MUST:
//   - Run current engine ONE FINAL TIME (output used)
//   - After processing: swap handles (next → current)
//   - After processing: signal integration that old engine can be reclaimed
//   - Ensure memory ordering (see below)
//
// Duration: exactly 1 block, then back to idle
```

---

## Memory Ordering Contract

When `retireNow` is returned, the caller must ensure:

1. All writes by the retiring engine are **visible** before signaling reclamation
2. The host thread does not deallocate the engine until the signal is received

### C++ (Native Audio Thread)

```cpp
void onRetireNow() {
    // 1. Final process of current engine
    currentEngine->process(buffer);

    // 2. Memory fence: all prior writes visible
    std::atomic_thread_fence(std::memory_order_release);

    // 3. Swap handles
    Engine* old = currentEngine;
    currentEngine = nextEngine;
    nextEngine = nullptr;

    // 4. Signal host (via atomic flag, lock-free queue, etc.)
    retireQueue.push(old);  // Host thread will delete
}
```

### Web Audio (AudioWorklet)

In the Web Audio context with `SharedArrayBuffer`:

```ts
function onRetireNow() {
  // 1. Final process
  this.currentEngine.process(buffer);

  // 2. Atomics.store provides release semantics
  Atomics.store(this.statusView, STATUS_OFFSET, RETIRED);

  // 3. Swap handles
  const old = this.currentEngine;
  this.currentEngine = this.nextEngine;
  this.nextEngine = null;

  // 4. Signal main thread
  this.port.postMessage({ type: 'retired', handle: old.id });
}
```

**Key Point**: The main thread must not reclaim the old engine until it receives the signal AND observes the store (via
`Atomics.load` or message receipt).

---

## Ticket Delivery Pattern

Tickets are created by the host thread and delivered to the RT thread. The protocol begins when `initSwapStateRT` is
called.

### Recommended: SPSC Ring Buffer

```
┌─────────────────┐                    ┌─────────────────┐
│   Host Thread   │                    │   RT Thread     │
│                 │                    │                 │
│  1. Build full  │                    │                 │
│     ticket      │                    │                 │
│                 │                    │                 │
│  2. Construct   │                    │                 │
│     engine      │                    │                 │
│                 │                    │                 │
│  3. Enqueue     │   ───────────▶     │  4. Dequeue     │
│     command     │   (lock-free)      │     command     │
│                 │                    │                 │
│                 │                    │  5. Copy ticket │
│                 │                    │     to state    │
│                 │                    │                 │
│                 │                    │  6. Call init   │
│                 │                    │     SwapStateRT │
└─────────────────┘                    └─────────────────┘
```

### Command Structure (RT-safe)

```ts
interface InstallSwapCommand<EngineKind extends number> {
  tag: 1;  // Command discriminant
  engineHandle: number;  // Index into pre-allocated engine array
  ticket: SwapTicketRT<EngineKind>;  // Copied by value, no heap
}
```

### Host-Side Ticket

The host can maintain a richer ticket with strings, config objects, etc.:

```ts
interface SwapTicketFull<EngineKind, Config> {
  id: string;                    // Human-readable ID
  numericId: number;             // Maps to ticketId in RT
  engineKind: EngineKind;
  config: Config;                // Engine-specific configuration
  atFrame: number;
  fadeFrames: number;
  preWarmBlocks: number;
}
```

The `numericId` is what goes into `SwapTicketRT.ticketId`.

---

## Crossfade Curve Implementation

The protocol provides `fadeFramesRemaining` and `totalFadeFrames`. You compute the blend.

### Linear Crossfade

```ts
function linearFade(state: SwapStateRT<number>): { fadeIn: number; fadeOut: number } {
  const t = 1 - (state.fadeFramesRemaining / state.totalFadeFrames);
  return { fadeIn: t, fadeOut: 1 - t };
}
```

### Equal-Power Crossfade (Recommended for Audio)

```ts
function equalPowerFade(state: SwapStateRT<number>): { fadeIn: number; fadeOut: number } {
  const t = 1 - (state.fadeFramesRemaining / state.totalFadeFrames);
  return {
    fadeIn: Math.sin(t * Math.PI * 0.5),
    fadeOut: Math.cos(t * Math.PI * 0.5),
  };
}
```

### Per-Sample Fading

For sample-accurate fades within a block:

```ts
function processCrossfadeBlock(
  outA: Float32Array,
  outB: Float32Array,
  dest: Float32Array,
  fadeFramesStart: number,
  totalFadeFrames: number,
  blockFrames: number,
) {
  for (let i = 0; i < blockFrames; i++) {
    const framesRemaining = Math.max(0, fadeFramesStart - i);
    const t = 1 - (framesRemaining / totalFadeFrames);
    const fadeIn = Math.sin(t * Math.PI * 0.5);
    const fadeOut = Math.cos(t * Math.PI * 0.5);
    dest[i] = outA[i] * fadeOut + outB[i] * fadeIn;
  }
}
```

---

## Integration with Seqlok Meters

The `SwapStatusRT` can be published to a Seqlok meter plane for UI consumption.

### Meter Spec

```ts
import { defineSpec } from '@seqlok/core';

const swapMeterSpec = defineSpec({
  meters: {
    phase: { kind: 'u32' },           // Encode SwapPhase as 0-5
    ticketId: { kind: 'u32' },
    progress: { kind: 'f32' },
    activeEngineKind: { kind: 'u32' },
    nextEngineKind: { kind: 'u32' },
  },
});
```

### RT Thread: Write Status

```ts
function publishSwapStatus(
  processor: ProcessorBinding<typeof swapMeterSpec>,
  status: SwapStatusRT<number>,
) {
  processor.meters.phase = phaseToU32(status.phase);
  processor.meters.ticketId = status.ticketId;
  processor.meters.progress = status.progress;
  processor.meters.activeEngineKind = status.activeEngineKind;
  processor.meters.nextEngineKind = status.nextEngineKind;
}
```

### Main Thread: Read Status

```ts
function readSwapStatus(
  observer: ObserverBinding<typeof swapMeterSpec>,
): SwapStatusRT<number> | null {
  const snapshot = observer.snapshotMeters(['phase', 'ticketId', 'progress', 'activeEngineKind', 'nextEngineKind']);
  if (!snapshot) return null;
  return {
    phase: u32ToPhase(snapshot.phase),
    ticketId: snapshot.ticketId,
    progress: snapshot.progress,
    activeEngineKind: snapshot.activeEngineKind,
    nextEngineKind: snapshot.nextEngineKind,
  };
}
```

---

## Error Handling and Edge Cases

### Edge Case: `fadeFrames = 0`

**Not allowed.** The TLA+ spec requires `fade \in 1..MAX_FADE_FRAMES`.

In debug mode, `initSwapStateRT` should assert this. In release mode, behavior is undefined (likely immediate retire
with no blend).

### Edge Case: `preWarmBlocks = 0`

**Allowed.** The protocol skips directly from `prime` to `crossfade`.

Use this when the next engine has no time-domain state (e.g., a pure gain stage).

### Edge Case: Caller Doesn't Call `stepSwapStateRT`

Protocol state doesn't advance. The swap is effectively paused. This is valid but unusual — typically you'd call it
every block.

### Edge Case: Ticket Arrives During Active Swap

**Protocol does not handle this.** The spec assumes one swap at a time per slot.

To queue swaps, implement a pending ticket buffer in the caller:

```ts
if (state.phase !== 'idle') {
  pendingTicket = newTicket;
} else {
  state = initSwapStateRT(newTicket);
}

// In StepRetire handler:
if (pendingTicket) {
  state = initSwapStateRT(pendingTicket);
  pendingTicket = null;
}
```

### Edge Case: Cancellation Mid-Swap

**Not in v0.1.0.** To add cancellation:

1. Define a `cancel()` function that jumps to `retire` phase
2. Ensure the caller handles partial crossfades gracefully
3. Update TLA+ spec with `CancelSwap` action

---

## Testing Strategy

### Unit Tests: State Machine

Test `stepSwapStateRT` in isolation:

```ts
test('spawn advances to prime', () => {
  const state = initSwapStateRT({ ticketId: 1, engineKind: 0, atFrame: 0, fadeFrames: 128, preWarmBlocks: 0 });
  const decision = stepSwapStateRT(state, 128, 0, 1, 255);
  expect(decision.kind).toBe('runCurrentOnly');
  expect(decision.status.phase).toBe('spawn');
  expect(state.phase).toBe('prime');
});
```

### Property Tests: Invariants

Use fast-check / hypothesis to verify TLA+ invariants hold:

```ts
test.prop([fc.integer({ min: 0, max: 10 }), fc.integer({ min: 1, max: 1000 })])(
  'eventually reaches idle',
  (preWarmBlocks, fadeFrames) => {
    const ticket = { ticketId: 1, engineKind: 0, atFrame: 0, fadeFrames, preWarmBlocks };
    const state = initSwapStateRT(ticket);

    let iterations = 0;
    const maxIterations = preWarmBlocks + Math.ceil(fadeFrames / 128) + 10;

    while (state.phase !== 'idle' && iterations < maxIterations) {
      stepSwapStateRT(state, 128, 0, 1, 255);
      iterations++;
    }

    expect(state.phase).toBe('idle');
  }
);
```

### Conformance Tests: Cross-Language

Export test vectors as JSON:

```json
{
  "name": "basic_crossfade_no_prewarm",
  "ticket": {
    "ticketId": 1,
    "engineKind": 0,
    "atFrame": 0,
    "fadeFrames": 256,
    "preWarmBlocks": 0
  },
  "blockFrames": 128,
  "expectedTransitions": [
    {
      "phase": "spawn",
      "kind": "runCurrentOnly"
    },
    {
      "phase": "prime",
      "kind": "runCurrentOnly"
    },
    {
      "phase": "crossfade",
      "kind": "runBothForCrossfade"
    },
    {
      "phase": "crossfade",
      "kind": "runBothForCrossfade"
    },
    {
      "phase": "retire",
      "kind": "retireNow"
    }
  ]
}
```

Both TS and C++ implementations must produce identical sequences.

---

## C++ Implementation Notes

### Header Structure

```cpp
// hotswap/spec.hpp

#pragma once
#include <cstdint>

namespace seqlok::hotswap {

enum class SwapPhase : uint8_t {
    Idle = 0,
    Spawn,
    Prime,
    Prewarm,
    Crossfade,
    Retire,
};

enum class SwapStepKind : uint8_t {
    Idle = 0,
    RunCurrentOnly,
    RunCurrentAndPrewarmNext,
    RunBothForCrossfade,
    RetireNow,
};

template <typename EngineKind>
struct SwapTicketRT {
    uint64_t ticketId;
    EngineKind engineKind;
    int64_t atFrame;
    int64_t fadeFrames;
    int32_t preWarmBlocks;
};

template <typename EngineKind>
struct SwapStatusRT {
    SwapPhase phase;
    uint64_t ticketId;
    float progress;
    EngineKind activeEngineKind;
    EngineKind nextEngineKind;
};

template <typename EngineKind>
struct SwapStateRT {
    SwapPhase phase;
    bool hasTicket;
    SwapTicketRT<EngineKind> ticket;
    int64_t totalFadeFrames;
    int64_t fadeFramesRemaining;
    int32_t preWarmBlocksRemaining;
    int32_t stepIndex;
    int32_t stepTotal;
};

template <typename EngineKind>
struct SwapStepDecisionRT {
    SwapStepKind kind;
    SwapStatusRT<EngineKind> status;
};

template <typename EngineKind>
SwapStateRT<EngineKind> initSwapStateRT(const SwapTicketRT<EngineKind>& ticket);

template <typename EngineKind>
SwapStepDecisionRT<EngineKind> stepSwapStateRT(
    SwapStateRT<EngineKind>& state,
    int32_t blockFrames,
    EngineKind activeKind,
    EngineKind nextKind,
    EngineKind noneKindSentinel
);

} // namespace seqlok::hotswap
```

### Key Differences from TypeScript

| Aspect   | TypeScript                    | C++                              |
|----------|-------------------------------|----------------------------------|
| Generics | `<EngineKind extends number>` | `template <typename EngineKind>` |
| Optional | Sentinel value                | Sentinel value (same)            |
| Math.max | `Math.max(0, x)`              | `std::max(0, x)`                 |
| Mutation | Object reference              | Reference parameter              |

### RT-Safe Constraints

The C++ implementation MUST NOT:

- Allocate (no `new`, `malloc`, `std::vector::push_back`)
- Throw exceptions
- Acquire locks
- Make system calls

All of these are satisfied by the state machine design — it's pure arithmetic and assignment.

---

## Checklist: Before You Ship

- [ ] State machine passes all test vectors
- [ ] Property tests verify TLA+ invariants
- [ ] Memory ordering is correct at retire
- [ ] Crossfade curve is sample-accurate (if required)
- [ ] Meter publishing doesn't allocate
- [ ] Ticket delivery is lock-free
- [ ] Edge cases documented and tested
- [ ] C++ and TS implementations produce identical output for identical input

---

## Version History

| Version | Changes                                             |
|---------|-----------------------------------------------------|
| 0.1.0   | Initial protocol. No cancellation, no queued swaps. |
