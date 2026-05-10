# Lane Hot-Swap Integration (Canonical Flow)

This documents the end-to-end path a typical "lane" uses to install and run an engine hot-swap. The integration test
at [`tests/lane.timeline.integration.test.ts`](../tests/lane.timeline.integration.test.ts) serves as the executable
specification for this flow.

## Overview

```

scheduleSwap → mailbox (SWSR ring) → RT drain → TimelineCommand → processTimelineBlock → HotswapSlotDriver.stepBlock → decisions

```

## 1. Host Side (Non-RT)

### Construct a swap ticket

```ts
import { createTicketId, type SwapTicketRT } from "@seqlok/hotswap";

const ticket: SwapTicketRT<EngineKind> = {
  ticketId: createTicketId(1), // Unique, non-zero ticket identifier
  engineKind: EngineKind.B, // Target engine to swap to
  atFrame: 256, // Absolute frame on the lane's timeline
  fadeFrames: 256, // Crossfade duration in frames
  preWarmBlocks: 2, // Blocks to run both engines before crossfade
};
```

### Configure and call scheduleSwap

```ts
import { createCommandMailbox } from "@seqlok/commands";
import {
  createHotswapCommandCodec,
  HOTSWAP_COMMAND_TAG_INSTALL,
  HOTSWAP_COMMAND_WORDS_PER_SLOT,
  type HotswapCommand,
  scheduleSwap,
  type HotswapSchedulerConfig,
  type SwapResult,
} from "@seqlok/hotswap";

const codec = createHotswapCommandCodec<EngineKind>();
const mailbox = createCommandMailbox<HotswapCommand<EngineKind>>({
  mailboxId: "lane-0",
  codec,
  layout: {
    capacity: 16,
    wordsPerSlot: HOTSWAP_COMMAND_WORDS_PER_SLOT,
  },
});

// Product-specific lane status surface.
// In a real system this would come from lane runtime state / introspection.
declare function isLaneBusy(mailboxId: string): boolean;

const schedulerConfig: HotswapSchedulerConfig<
  EngineKind,
  HotswapCommand<EngineKind>
> = {
  mailboxId: "lane-0",
  producer: mailbox.producer,
  encodeInstallSwap(ticket) {
    return { tag: HOTSWAP_COMMAND_TAG_INSTALL, ticket };
  },
  isLaneBusy() {
    return isLaneBusy("lane-0");
  },
};

// Level 2.5 semantics:
//  - Validate ticket using the RT protocol
//  - Consult isLaneBusy for Reject-While-Busy
//  - Enqueue on success, or return a structured SwapResult on rejection
const result: SwapResult = scheduleSwap(schedulerConfig, ticket);

if (!result.accepted) {
  switch (result.reason) {
    case "lane-busy":
      // Lane already has an in-flight ticket: caller can back off, queue, or
      // coalesce at a higher layer.
      break;
    case "invalid-ticket":
      // Protocol preconditions violated (e.g. fadeFrames < 1); caller should
      // fix the ticket instead of retrying.
      break;
    case "out-of-range":
    case "internal-error":
    default:
      // Reserved for future differentiation / diagnostics.
      break;
  }
}
```

`scheduleSwap` validates the ticket according to the RT protocol and, if the lane is not busy, enqueues a
`HotswapCommand` into the lane's `CommandMailbox`. It returns a `SwapResult` describing whether the ticket was accepted
and why:

- Valid ticket + lane not busy → `{accepted: true, reason: undefined, ticketId}`.
- Invalid ticket → `{accepted: false, reason: "invalid-ticket", ticketId}` (no mailbox write).
- Overlapping ticket while the lane is busy → `{accepted: false, reason: "lane-busy", ticketId}` (no mailbox write).

Any commands that still reach the slot (e.g. tests that omit `isLaneBusy`) are additionally guarded by the slot
driver's "at most one active ticket" rule; see **Multi-Swap Behavior** below.

Command transport failures (mailbox closed / ring overflow) remain typed `commands.*` exceptions and are not encoded in
`SwapResult`.

## 2. RT Side (Per Audio Block)

### Lane state

Each lane owns:

```ts
import {
  createHotswapSlotDriver,
  createSlicerState,
  type TimelineCommand,
  type TimelineDriver,
} from "@seqlok/integration";

const hotswapSlot = createHotswapSlotDriver<EngineKind>();
const timeline: TimelineDriver<EngineKind> = {
  frame: 0,
  isPlaying: true,
  slicer: createSlicerState<TimelineCommand<EngineKind>>(),
  hotswapSlot,
};

// Pending RT commands queue.
// Normally fed only by mailbox.consumer.drain (installSwap), but other
// command types may be pushed directly.
const pendingRTCommands: TimelineCommand<EngineKind>[] = [];

let activeEngineKind: EngineKind = EngineKind.A;
```

### Per-block processing

```ts
import {
  processTimelineBlock,
  type TimelineProcessCallbacks,
} from "@seqlok/integration";

function processAudioBlock(blockFrames: number): void {
  // 1. Drain mailbox and project HotswapCommand → TimelineCommand
  mailbox.consumer.drain({
    onCommand(command: HotswapCommand<EngineKind>) {
      const { ticket } = command;
      pendingRTCommands.push({
        atFrame: ticket.atFrame,
        priority: 0,
        payload: {
          kind: "installSwap",
          ticket,
        },
      });
    },
  });

  // 2. Collect commands that fire this block
  const blockStart = timeline.frame;
  const blockEnd = blockStart + blockFrames;
  const drainedCommands: TimelineCommand<EngineKind>[] = [];

  for (let i = pendingRTCommands.length - 1; i >= 0; i -= 1) {
    const cmd = pendingRTCommands[i];
    if (cmd !== undefined && cmd.atFrame < blockEnd) {
      drainedCommands.push(cmd);
      pendingRTCommands.splice(i, 1);
    }
  }

  drainedCommands.sort((a, b) => {
    if (a.atFrame !== b.atFrame) return a.atFrame - b.atFrame;
    return a.priority - b.priority;
  });

  // 3. Process block with callbacks
  const callbacks: TimelineProcessCallbacks<EngineKind> = {
    renderSegment(frames) {
      const nextKind: EngineKind = hotswapSlot.hasState
        ? (hotswapSlot.state?.ticket.engineKind ?? EngineKind.None)
        : EngineKind.None;

      const decision = hotswapSlot.stepBlock(
        frames,
        activeEngineKind,
        nextKind,
        EngineKind.None,
      );

      // Apply decision to engine bank (see below)
      applyDecisionToEngines(decision, frames);

      if (decision.kind === "retireNow") {
        activeEngineKind = nextKind;
      }
    },
    applyCommandSideEffects(cmd) {
      // Called at exact segment boundaries when a TimelineCommand applies.
      // For "installSwap" this installs the ticket into hotswapSlot.
      //
      // Level 2.5 "Reject While Busy" is primarily enforced by scheduleSwap
      // on the host side via cfg.isLaneBusy (see section 1). The slot driver
      // still enforces "at most one active ticket" and ignores overlapping
      // installs as a defense-in-depth guard rail.
    },
  };

  processTimelineBlock(timeline, blockFrames, drainedCommands, callbacks);
}
```

## 3. Engine Application

The integration test only records `SwapStepDecisionRT<EngineKind>` values. A real lane replaces that recording with
calls into its engine bank:

```ts
interface EngineInstance {
  render(dst: Float32Array, frames: number): void;
}

interface EngineBank<EngineKind extends number> {
  get(kind: EngineKind): EngineInstance | null;
}

function applyDecisionToEngines(
  decision: SwapStepDecisionRT<EngineKind>,
  frames: number,
): void {
  const current = bank.get(decision.status.activeEngineKind);
  const next = bank.get(decision.status.nextEngineKind);

  switch (decision.kind) {
    case "idle":
    case "runCurrentOnly":
      // Render only current engine at full gain
      current?.render(outputBuffer, frames);
      break;

    case "runCurrentAndPrewarmNext":
      // Render current at full gain, prewarm next (discard output)
      current?.render(outputBuffer, frames);
      next?.render(scratchBuffer, frames);
      break;

    case "runBothForCrossfade":
      // Render both and mix using decision.status.currentGain / nextGain
      current?.render(currentBuffer, frames);
      next?.render(nextBuffer, frames);
      mixBuffers(
        outputBuffer,
        currentBuffer,
        nextBuffer,
        decision.status.currentGain,
        decision.status.nextGain,
        frames,
      );
      break;

    case "retireNow":
      // Final crossfade block, then switch active engine
      current?.render(currentBuffer, frames);
      next?.render(nextBuffer, frames);
      mixBuffers(
        outputBuffer,
        currentBuffer,
        nextBuffer,
        decision.status.currentGain,
        decision.status.nextGain,
        frames,
      );
      // After this, activeEngineKind switches to next
      break;
  }
}
```

## 4. Multi-Swap Behavior (Sequential + Overlapping)

For detailed multi-swap requirements and test specifications, see
[`hotswap-multi-swap-requirements.md`](/packages/hotswap/docs/adr/hotswap-multi-swap-requirements.md).

### 4.1 Sequential swaps (A→B→C)

Sequential swaps on a single lane are supported and tested via the engine-bank harness:

- First swap A→B runs through `prewarm → crossfade → retire → idle`.
- Once the lane has idled on B, a second swap B→C is scheduled at `atFrame = timeline.frame`.
- The engine-bank integration asserts:

  - There is an idle plateau with `activeEngineKind === B`, then an idle plateau with `activeEngineKind === C`.
  - Idle engine identity is monotone: once you have idled on B, you never idle on A again.

This pattern generalizes: as long as each swap is scheduled after the previous one has completed, the lane behaves as a
simple A→B→C→… progression.

### 4.2 Overlapping swaps (Reject While Busy)

For Level 2.5, the lane hot-swap integration uses the **Reject While Busy** policy for overlapping swaps on the **same
lane**:

- While a ticket is in-flight (the lane is considered **swap-busy**), additional swap tickets for that lane must not
  take effect.

- At the host / scheduling layer, this is implemented via `schedulerConfig.isLaneBusy`:

  - If `isLaneBusy()` returns `true`, `scheduleSwap` returns a `SwapResult` with
    `{accepted: false, reason: "lane-busy", ticketId}` and **does not enqueue** any command into the mailbox.
  - This keeps multi-swap policy off the audio thread and O(1) in time and allocations.

- As a defense-in-depth guard rail, the slot driver still maintains at most one active ticket:

  - If overlapping `installSwap` commands for the same lane do reach the RT side (e.g. tests that omit `isLaneBusy`),
    the slot simply ignores them while a ticket is active.

The integration tests enforce:

- During an A→B swap, a second ticket B→C scheduled while A→B is in progress:

  - Never appears as `activeEngineKind === C`.
  - Never appears as `nextEngineKind === C`.

- The final idle state is indistinguishable from a single A→B swap:

  - Final idle engine is B.
  - Engine-bank output for the idle plateau is ≈ 2.0 (for the constant-engine harness).

From a controller’s perspective:

- **Sequential intent** (A→B then, once settled, B→C) is fully supported.
- **Overlapping intent** (spamming swaps while a fade is in progress) yields structured rejections at the host boundary
  (`reason: "lane-busy"`). Any commands that slip through are ignored by the slot, so C never leaks into the audio
  path.

Higher-level schedulers (e.g. Ghost DJ planners) can implement richer policies (queueing, coalescing, “last-writer
wins”) on top by controlling when they call `scheduleSwap` and how they respond to `SwapResult`.

## 5. Protocol Guarantees

The underlying hot-swap protocol (formally verified via TLA+ at the slot/timeline level) guarantees:

- **At most 2 engines active** per slot (current + next).
- **Eventual idle**: Any accepted ticket eventually reaches `phase: "idle"` once the host stops injecting new tickets.
- **No audio gap**: During crossfade, both engines render every block.
- **Monotonic progress**: `progress` never decreases during a swap.
- **Timeline-level replacement capability:** At the raw timeline-command level, it is possible to project replacement
  commands that supersede older ones before they apply.

  - The Level 2.5 lane integration, as exercised here via `scheduleSwap`, chooses the **Reject While Busy** policy
    instead of exposing mid-flight cancel-by-replacement directly.

In other words:

- Slot/timeline core: small, two-engine, monotone state machine with replacement _capability_.
- Lane integration: conservative “one ticket at a time per lane”; overlapping requests are rejected at the host
  scheduling layer (`scheduleSwap` + `SwapResult`) and ignored defensively by the slot, to keep the audio semantics
  predictable.

## 6. Test Coverage

The integration test suite covers:

- **Happy path:** Full swap lifecycle (spawn → prime → prewarm → crossfade → retire → idle).

- **Immediate swap:** `atFrame = 0` with no prewarm.

- **Multi-block crossfade:** `fadeFrames` spanning multiple blocks.

- **Back-to-back swaps:**

  - Sequential swaps at distinct `atFrame` values.
  - Overlapping swap attempts under the Reject-While-Busy policy:

    - Overlapping ticket does not perturb the in-flight swap.
    - Protocol still converges to idle with the original ticket’s engine.

- **Invalid tickets:** Defense-in-depth validation (e.g. `fadeFrames = 0`, negative `preWarmBlocks`, `ticketId = 0`).

- **Edge cases:** Late commands, zero-frame segments, very short fades, same-engine swaps, command priority ordering.

See [`tests/lane.timeline.integration.test.ts`](../tests/lane.timeline.integration.test.ts) and
[`tests/lane.engine-bank.integration.test.ts`](../tests/lane.engine-bank.integration.test.ts) for the executable
specification of the lane-level integration and engine semantics.
