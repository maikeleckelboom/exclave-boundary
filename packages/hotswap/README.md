# @seqlok/hotswap

Minimal, RT-safe **hot-swap protocol** for swapping between two engines in a
single logical slot without audio glitches.

- Formally specified in TLA+ (`HotSwapProtocol.tla`)
- Implemented in TypeScript and mirrored in C++
- Tested with **canonical flows** and **property-based invariants**

This package does **not** know what audio is. It only knows about:

- a **ticket** (what swap to do),
- a **state**,
- a **phase**,
- and a **step** function.

You plug in your own engines, buffers, and crossfade curve.

---

## Concepts

A single logical slot always has:

- a **current engine** (producing output),
- an optional **next engine** (being prepared),
- a **swap state** tracking where we are in the protocol.

The protocol runs through these phases:

- `spawn` → `prime` → `prewarm` → `crossfade` → `retire` → `idle`

With at most **two engines live** for the slot at any time.

---

## Install

From your workspace root:

```bash
pnpm add @seqlok/hotswap
```

(Or just consume it via your existing monorepo setup.)

---

## API Overview

### Types

```ts
import {
  type TicketId,
  createTicketId,
  type SwapPhase,
  type SwapStepKind,
  type SwapTicketRT,
  type SwapStatusRT,
  type SwapStateRT,
  type SwapStepDecisionRT,
} from "@seqlok/hotswap";
```

Core types:

- `TicketId` – branded ticket identifier (0 is reserved for “no ticket”).
- `SwapPhase` – `"idle" | "spawn" | "prime" | "prewarm" | "crossfade" | "retire"`.
- `SwapStepKind` – `"idle" | "runCurrentOnly" | "runCurrentAndPrewarmNext" | "runBothForCrossfade" | "retireNow"`.

```ts
export interface SwapTicketRT<EngineKind extends number> {
  readonly ticketId: TicketId;
  readonly engineKind: EngineKind;
  readonly atFrame: number;
  readonly fadeFrames: number; // >= 1
  readonly preWarmBlocks: number; // >= 0
}

export interface SwapStatusRT<EngineKind extends number> {
  readonly phase: SwapPhase;
  readonly ticketId: number; // 0 = none
  readonly progress: number; // 0..1 over lifecycle
  readonly activeEngineKind: EngineKind;
  readonly nextEngineKind: EngineKind; // sentinel for "none"
}

export interface SwapStateRT<EngineKind extends number> {
  phase: SwapPhase;
  hasTicket: boolean;
  ticket: SwapTicketRT<EngineKind>;
  totalFadeFrames: number;
  fadeFramesRemaining: number;
  preWarmBlocksRemaining: number;
  stepIndex: number;
  stepTotal: number;
}
```

### Functions

```ts
import {
  createTicketId,
  initSwapStateRT,
  stepSwapStateRT,
} from "@seqlok/hotswap";
```

- `createTicketId(id: number): TicketId`

  - Enforces `id !== 0` and finite.

- `initSwapStateRT(ticket): SwapStateRT`

  - Initialize protocol state when the audio thread accepts a ticket.

- `stepSwapStateRT(state, blockFrames, activeKind, nextKind, noneKindSentinel)`

  - One RT step per audio block:

    - mutates `state` in-place,
    - returns `{ kind, status }` describing what to do this block.

From `generator.ts`:

```ts
import {
  equalPowerFade,
  linearFade,
  createSwapGenerator,
  type SwapGeneratorInput,
} from "@seqlok/hotswap";
```

- `linearFade(state)` / `equalPowerFade(state)`

  - Compute `(fadeIn, fadeOut)` coefficients for current vs next engine during `crossfade`.

- `createSwapGenerator(input)`

  - JS generator for simulations / visualisation (not for RT audio).

---

## Typical usage in an audio driver

Example for a single deck/slot in a worklet or native engine:

```ts
import {
  createTicketId,
  initSwapStateRT,
  stepSwapStateRT,
  type SwapTicketRT,
  type SwapStateRT,
  equalPowerFade,
} from "@seqlok/hotswap";

enum EngineKind {
  None = 0,
  Varispeed = 1,
  Stretch = 2,
}

interface EngineHandle {
  // your engine type
}

interface EngineSlot {
  currentKind: EngineKind;
  current: EngineHandle | null;
  nextKind: EngineKind;
  next: EngineHandle | null;
  swapState: SwapStateRT<EngineKind> | null;
}

const slot: EngineSlot = {
  currentKind: EngineKind.Varispeed,
  current: createVarispeedEngine(),
  nextKind: EngineKind.None,
  next: null,
  swapState: null,
};

// Called on the audio thread when integration has staged a new engine:
function beginSwap(
  engineKind: EngineKind,
  newEngine: EngineHandle,
  atFrame: number,
  fadeFrames: number,
  preWarmBlocks: number,
): void {
  const ticket: SwapTicketRT<EngineKind> = {
    ticketId: createTicketId(Date.now()),
    engineKind,
    atFrame,
    fadeFrames,
    preWarmBlocks,
  };

  slot.nextKind = engineKind;
  slot.next = newEngine;
  slot.swapState = initSwapStateRT(ticket);
}

// Inside the audio callback, once per block:
function processBlock(output: Float32Array[], blockFrames: number): void {
  const { current, next, swapState } = slot;

  if (!current || !swapState) {
    // No swap pending: just run current engine normally.
    processEngine(current, output, blockFrames);
    return;
  }

  const decision = stepSwapStateRT(
    swapState,
    blockFrames,
    slot.currentKind,
    slot.nextKind,
    EngineKind.None,
  );

  switch (decision.kind) {
    case "idle":
    case "runCurrentOnly": {
      processEngine(current, output, blockFrames);
      break;
    }

    case "runCurrentAndPrewarmNext": {
      // Run current for output, next into a scratch buffer and discard
      processEngine(current, output, blockFrames);
      if (next) {
        preWarmEngine(next, blockFrames);
      }
      break;
    }

    case "runBothForCrossfade": {
      if (!next) {
        // Should not happen if integration respected the contract.
        processEngine(current, output, blockFrames);
        break;
      }

      const scratch: Float32Array[] = createScratchBuffers(
        output.length,
        blockFrames,
      );
      processEngine(current, output, blockFrames);
      processEngine(next, scratch, blockFrames);

      const { fadeIn, fadeOut } = equalPowerFade(swapState);

      for (let ch = 0; ch < output.length; ch += 1) {
        const out = output[ch];
        const tmp = scratch[ch];
        for (let i = 0; i < blockFrames; i += 1) {
          out[i] = out[i] * fadeOut + tmp[i] * fadeIn;
        }
      }
      break;
    }

    case "retireNow": {
      // Last block with current engine. After this block, we move `next`
      // into `current` and arrange for `current` to be destroyed on a
      // non-RT thread.
      processEngine(current, output, blockFrames);

      if (next) {
        const old = slot.current;
        slot.current = next;
        slot.currentKind = slot.nextKind;
        slot.next = null;
        slot.nextKind = EngineKind.None;
        slot.swapState = null;

        // Schedule `old` for destruction on a non-RT thread with a proper
        // memory fence in native implementations.
        retireEngineLater(old);
      }
      break;
    }
  }
}
```

This is exactly the layering intent:

- `@seqlok/hotswap` owns the **protocol**.
- The engine host owns:

  - engine construction / pooling,
  - buffer routing,
  - crossfade curve choice,
  - memory reclamation.

---

## Invariants and tests

The implementation is guarded by:

- **Conformance vectors** (`tests/hotswap.conformance.test.ts`)

  - Canonical flows for specific `(fadeFrames, preWarmBlocks)` combos.

- **Property-based tests** (`tests/hotswap.properties.test.ts`)

  - For arbitrary valid tickets:

    - the protocol **eventually reaches `idle`**,
    - `progress` is **monotonic** across steps.

- **Type-level guards**

  - `TicketId` branding: cannot accidentally construct a ticket with `ticketId = 0`.
  - Exhaustive switch on `SwapPhase` with a `never`-typed default.

Plus a TLA+ spec that proves the protocol's structural invariants for bounded parameters.
