# Seqlok Primer

> Internal documentation for contributors and integrators.

Seqlok is a **real-time shared-state substrate** for low-latency, multithreaded engines. It gives you a small set of
lock-free primitives you can compose into higher-level systems (audio engines, GPU sims, video pipelines, etc.) without
ever blocking the real-time thread.

---

## What Seqlok Solves

Seqlok lives at the intersection of two hard constraints:

1. **The real-time thread cannot block.**
   Any mutex acquisition, memory allocation, or unbounded operation risks glitches. In audio contexts, callbacks run
   at ~2.9ms intervals (44.1kHz, 128 samples) with effectively zero tolerance for jitter.

2. **State must flow between threads.**
   Controllers (UI, MIDI, automation) need to update parameters. Processors need to publish metrics. Engines need to be
   swapped on the fly.

Naïve approaches fall apart:

* Mutexes block.
* Message queues tend to allocate or jitter.
* Raw `Atomics` help, but multi-word state coherence is non-trivial; you end up re-implementing seqlock semantics badly.

Seqlok provides **structured, lock-free primitives** that guarantee progress and coherent multi-word reads, and then
layers a small set of higher-level APIs on top.

**What Seqlok does NOT provide:** Seqlok has **no concept** of audio, decks, BPM, tracks, cues, effects, or transport.
Those live in application code. Seqlok is plumbing.

> Audio and DSP are the first clients. The primitives are designed to work equally well for GPU simulations, live video
> pipelines, physics, or any system that needs glitch-free transitions between stateful processors.

### Core Capabilities

| Capability                          | Primitive                   | Use Case                                                                 |
|-------------------------------------|-----------------------------|--------------------------------------------------------------------------|
| **Bidirectional state sync**        | Seqlock (SWMR)              | Parameters (controller → processor) and metrics (processor → controller) |
| **Unidirectional command dispatch** | SWSR ring + command mailbox | Discrete events, timeline commands, swap triggers                        |
| **Live engine replacement**         | Hotswap protocol            | Swap stateful processors without stopping playback                       |

### The SWSR Foundation

At the memory level, Seqlok is built on **SWSR** (Single-Writer Single-Reader) rings and **SWMR** (Single-Writer
Multi-Reader) seqlocks:

* Each **ring** has exactly one writer and one reader. This simplifies the memory model and enables strong lock-free
  guarantees.
* Each **seqlock** has one writer and many readers; readers retry locally and never coordinate with each other.

**Topology scaling** (fans in/out, hubs, buses) is an **application-layer concern**. Seqlok gives you the primitives;
you wire the graph.

---

## Package Layout

High-level stack:

```text
┌─────────────────────────────────────────────────────────────────┐
│                        @seqlok/integration                      │
│         (Optional reference drivers: timeline + hotswap)        │
└─────────────────────────────────────────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│        @seqlok/hotswap      │  │       @seqlok/commands      │
│   (Engine swap protocol)    │  │  (Command mailbox layer)    │
└─────────────────────────────┘  └─────────────────────────────┘
                │                             │
                └──────────────┬──────────────┘
                               ▼
              ┌─────────────────────────────────────┐
              │             @seqlok/core            │
              │   (Param/meter spec, layout, bind)  │
              └─────────────────────────────────────┘
                               │
                               ▼
              ┌─────────────────────────────────────┐
              │          @seqlok/primitives         │
              │  (Seqlock, SWSR ring, memory ops)   │
              └─────────────────────────────────────┘
                               │
                               ▼
              ┌─────────────────────────────────────┐
              │            @seqlok/base             │
              │   (Error domains, numeric codes)    │
              └─────────────────────────────────────┘

              ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
                       (diagnostics sidecar)
              ┌─────────────────────────────────────┐
              │         @seqlok/introspect          │
              │  (Debug tools, never in hot path)   │
              └─────────────────────────────────────┘
```

---

## Package Responsibilities

### `@seqlok/base`

Foundation types shared across all packages. Zero external dependencies.

* `SeqlokError` — structured error type with domain-scoped numeric codes.
* `createInternalError` / `INTERNAL_ERRORS` — the `internal.*` error domain.
* `buildErrorDomain` — builds a domain registry (prefix + domainId + definitions).
* `DOMAIN_IDS` / `DOMAIN_RANGES` — allocation tables for domain IDs and numeric ranges.
* `encodeNumeric` / `decodeNumeric` — pack/unpack numeric error codes.
* Basic branded/phantom types and utility types.

**Error code system:**

Each domain (e.g. `primitives.seqlock`, `commands.mailbox`, `hotswap.*`) gets its own numeric range.
`encodeNumeric(domainId, localOrdinal)` produces a 32-bit `ErrorNumericCode`. A `SeqlokError` always carries:

* a fully-qualified string code (`"hotswap.invalidTicket"`),
* a domain-scoped numeric code,
* a typed `details` payload.

This makes it straightforward to:

* log and inspect errors in TS/JS,
* export a canonical JSON registry from `@seqlok/introspect`,
* generate native error enums (Rust/C++) off the same registry later.

**Key exports (informal):**

```ts
SeqlokError
createInternalError(kind, details ?)
buildErrorDomain(prefix, domainId, defs)

encodeNumeric(domainId, localOrdinal)
decodeNumeric(numericCode)

DOMAIN_IDS
DOMAIN_RANGES
INTERNAL_ERRORS
```

---

### `@seqlok/primitives`

Lock-free memory primitives operating directly on `SharedArrayBuffer`. This is the **hot-path foundation**.

#### Seqlock

Single-writer / multi-reader seqlock for multi-word state.

* Writer increments a sequence number before and after writing.
* Readers load the sequence, copy data, then re-check.
* If the sequence changed under their feet, they retry within bounded budgets.

**Key exports (seqlock):**

```ts
// Layout + pair
export interface SeqPair {
  readonly u32: Uint32Array;
  readonly lockIndex: number;
  readonly seqIndex: number;
}

export interface TryReadOptions {
  readonly spinBudget?: number;
  readonly retryBudget?: number;
}

export interface TryReadStatus {
  readonly spins: number;
  readonly retries: number;
}

export type TryReadResult<T> =
  | { readonly ok: true; readonly value: T; readonly status: TryReadStatus }
  | { readonly ok: false; readonly status: TryReadStatus };

export function createSeqPair(
  sab: SharedArrayBuffer,
  lockIndex: number,
  seqIndex: number,
): SeqPair;

export function tryRead<T>(
  pair: SeqPair,
  reader: () => T,
  options?: TryReadOptions,
): TryReadResult<T>;
```

Internally there are helpers (`readWithin`, `publish`, etc.) used by `@seqlok/core` to implement higher-level policies:

* **Controller snapshot** is allowed to *degrade* (stale read) when budgets are exhausted.
* **Processor within()** treats exhausted budgets as a hard failure (throws `primitives.seqlockTimeout`); this should
  never happen in healthy RT usage and is treated as a bug.

#### SWSR ring

Single-writer / single-reader bounded queue with fixed-size slots.

**Key exports (ring):**

```ts
export interface SwsrRingLayout {
  readonly capacity: number;     // number of slots
  readonly wordsPerSlot: number; // 32-bit words per slot
}

export interface SwsrRingBacking {
  readonly sab: SharedArrayBuffer;
  readonly header: Int32Array;
  readonly data: Int32Array;
  readonly capacity: number;
  readonly wordsPerSlot: number;
}

export interface SwsrCodec<T> {
  readonly wordsPerSlot: number;

  encode(value: T, dst: Int32Array, wordOffset: number): void;

  decode(src: Int32Array, wordOffset: number): T;
}

export function allocateSwsrRing(
  layout: SwsrRingLayout,
): SwsrRingBacking;

export function bindSwsrRingProducer<T>(
  backing: SwsrRingBacking,
  codec: SwsrCodec<T>,
): SwsrRingProducer<T>;

export function bindSwsrRingConsumer<T>(
  backing: SwsrRingBacking,
  codec: SwsrCodec<T>,
): SwsrRingConsumer<T>;
```

Header fields (used for telemetry and debugging):

```ts
// Header constants
SWSR_HEADER_WRITE_INDEX
SWSR_HEADER_READ_INDEX
SWSR_HEADER_WRITE_SEQ
SWSR_HEADER_DROPPED
```

**Invariant:** All primitive operations are **zero-allocation** in the hot path. No `new`, no growing arrays, no closure
capture.

---

### `@seqlok/core`

Typed parameter & meter synchronization built on top of the primitives.

Responsibilities:

* **Spec system** — `defineSpec()` with *range-only* numeric params.
* **Layout planner** — `planLayout()` computes memory footprint & offsets.
* **Backing allocation** — `allocateShared(...)` and friends allocate SABs.
* **Thread bindings** — `bindController`, `bindProcessor`, `bindObserver`.

#### Spec DSL (range-only)

The DSL describes *shape and bounds*, nothing more. There is no `default`, `step`, or `origin` in the DSL; those are
UI / host concerns.

```ts
const spec = defineSpec(({param, meter}) => ({
  volume: param.f32({min: 0, max: 1}),
  pan: param.f32({min: -1, max: 1}),
  peakL: meter.f32(),
  peakR: meter.f32(),
}));
```

#### Controller binding

Controller bindings live on host threads (UI, automation, etc.).

```ts
const plan = planLayout(spec);
const backing = allocateShared(plan);
const controller = bindController(spec, plan, backing);

// Write individual param
controller.params.set("volume", 0.9);

// Write multiple params atomically
controller.params.update({volume: 0.9, pan: 0.2});

// Stage array params atomically
controller.params.stage("coefficients", (view) => {
  for (let i = 0; i < view.length; i++) {
    view[i] = computeCoefficient(i);
  }
});

// Bulk hydrate scalars + arrays in one go
controller.params.hydrate({
  volume: 0.9,
  coefficients: new Float32Array([...]),
});

// Read params (allocates & copies)
const allParams = controller.params.snapshot();
const someParams = controller.params.snapshot(["volume", "pan"]);

// Read meters (allocates & copies)
const allMeters = controller.meters.snapshot();
const someMeters = controller.meters.snapshot(["peakL", "peakR"]);

// Version counters (for diffing / incremental UIs)
const paramVersion = controller.params.version();
const meterVersion = controller.meters.version();

// Cleanup
controller.dispose();
```

#### Processor binding

Processor bindings live on the RT thread (e.g. `AudioWorkletProcessor.process`):

```ts
const processor = bindProcessor(receivedHandoff);

// Coherent param read (no allocation)
processor.params.within((view) => {
  const volume = view.volume;        // number
  const pan = view.pan;           // number
  const coefficients = view.coefficients;  // ephemeral Float32Array

  // Use values here; view is invalid after this callback returns.
});

// Meter write (no allocation)
processor.meters.publish((writer) => {
  // Scalar meters
  writer.peakL(leftPeak);
  writer.peakR(rightPeak);

  // Or via set helper
  writer.set("peakL", leftPeak);

  // Array meters
  writer.stage("spectrum", (dst) => {
    for (let i = 0; i < dst.length; i++) {
      dst[i] = computeFFTBin(i);
    }
  });
});

// Version counters
const paramVersion = processor.params.version();
const meterVersion = processor.meters.version();

// Cleanup
processor.dispose();
```

**Important:** Processor bindings intentionally do **not** expose `snapshot()`; you always go through `within()` /
`publish()` to keep reads & writes bounded to the callback and avoid hidden allocations.

#### Observer binding

Observer bindings are for non-RT readers: analyzers, monitors, dev tools.

```ts
const observer = bindObserver(receivedHandoff);

// Snapshot params (allocating)
const allParams = observer.params.snapshot();
const someParams = observer.params.snapshot(["volume", "pan"]);

// Zero-copy read (same semantics as processor)
observer.params.within((view) => {
  console.log(view.volume, view.pan);
});

// Snapshot meters (allocating)
const allMeters = observer.meters.snapshot();
const someMeters = observer.meters.snapshot(["peakL", "peakR"]);

// Version counters
const paramVersion = observer.params.version();
const meterVersion = observer.meters.version();

// Cleanup
observer.dispose();
```

#### Binding surface summary

| Role       | Params                                                     | Meters                |
|------------|------------------------------------------------------------|-----------------------|
| Controller | `set`, `update`, `stage`, `hydrate`, `snapshot`, `version` | `snapshot`, `version` |
| Processor  | `within`, `version`                                        | `publish`, `version`  |
| Observer   | `snapshot`, `within`, `version`                            | `snapshot`, `version` |

**Coherence guarantee:**

At the logical level, param reads are coherent: you never see `volume` from frame N and `pan` from frame N+1 in a single
`within()` or `snapshot()` call. Seqlock + binding policies enforce that.

---

### `@seqlok/commands`

Command dispatch layer built on SWSR rings. This is where “one-shot” events live: transport, seeking, swaps, etc.

Main concepts:

* **CommandCodec** — encodes/decodes a discriminated union into fixed-size ring slots.
* **CommandMailbox (SWSR)** — single producer / single consumer backed by a primitive ring.
* **CommandProducer** — `push(cmd)` with structured result.
* **CommandConsumer** — `drain(hooks)` with decode error hooks.

**Key pattern:**

```ts
// Mailbox creation (host side)
const mailbox = createCommandMailbox<MyCommand>({
  mailboxId: "deck-1",
  codec,
  layout: {capacity: 256, wordsPerSlot: codec.wordsPerSlot},
});

// Producer (controller / host thread)
const result = mailbox.producer.push({
  kind: "seek",
  targetFrame: 44100 * 150, // 2:30
});

if (!result.ok) {
  // result.reason === "mailboxClosed" | "ringOverflow"
  // Map to commands.* error or log, but never block.
}

// Consumer (processor / RT thread)
mailbox.consumer.drain({
  onCommand(cmd) {
    // Schedule into timeline, apply immediately, etc.
  },
  onUnknownCommand(error) {
    // Optionally map to commands.unknownCommand and log
  },
  onInvalidPayload(error) {
    // Optionally map to commands.invalidPayload and log
  },
});
```

**Design notes:**

* Commands are **fire-and-forget** from the producer’s perspective.
* If the ring is full, `push` returns `{ ok: false, reason: "ringOverflow", ... }`.
* Command overflow is treated as **“late == lost”**; we drop and log, never block.

---

### `@seqlok/hotswap`

Protocol for replacing **stateful processors** without stopping playback.

The protocol is deliberately engine-agnostic. It only knows about **phases**, **tickets**, and what each block should
do. It does *not* know how to create or mix engines.

Key pieces:

* `SwapPhase` — lifecycle: `idle → spawn → prime → prewarm → crossfade → retire`.
* `SwapStepKind` — instructions for the current block (`runCurrentOnly`, `runCurrentAndPrewarmNext`,
  `runBothForCrossfade`, `retireNow`, etc.).
* `SwapTicketRT` — small struct describing a swap in RT-safe form.
* `initSwapStateRT` / `stepSwapStateRT` — pure state machine functions.

**Core types (simplified):**

```ts
export type SwapPhase =
  | "idle"
  | "spawn"
  | "prime"
  | "prewarm"
  | "crossfade"
  | "retire";

export type SwapStepKind =
  | "idle"
  | "runCurrentOnly"
  | "runCurrentAndPrewarmNext"
  | "runBothForCrossfade"
  | "retireNow";

export interface SwapTicketRT<EngineKind extends number> {
  readonly ticketId: TicketId;
  readonly engineKind: EngineKind;
  readonly atFrame: number;
  readonly fadeFrames: number;
  readonly preWarmBlocks: number;
}

export function initSwapStateRT<EngineKind extends number>(
  ticket: SwapTicketRT<EngineKind>,
): SwapStateRT<EngineKind>;

export function stepSwapStateRT<EngineKind extends number>(
  state: SwapStateRT<EngineKind>,
  blockFrames: number,
  activeKind: EngineKind,
  nextKind: EngineKind,
  noneKindSentinel: EngineKind,
): SwapStepDecisionRT<EngineKind>;
```

**Separation of concerns:**

* `@seqlok/hotswap` defines **when** to run current/next engines and when to retire.
* Application code decides **what** those engines are and **how** to crossfade/mix them.
* Host-level invariants (e.g. “never call live `configure()`; always spawn+prime+preWarm+crossFade+retire”) are enforced
  above, often via `@seqlok/integration`.

---

### `@seqlok/integration`

Reference glue for using Seqlok in a host application. It stays neutral:

* No notion of decks, BPM, or specific audio graphs.
* All domain-specific concepts live in the *host*, not here.

Today it provides:

* **Hotswap slot driver** — `HotswapSlotDriver<EngineKind>` wraps `initSwapStateRT` + `stepSwapStateRT` into a small RT
  helper; integration code works with `acceptTicket` and per-block `step` instead of raw `SwapStateRT`.
* **Command → hotswap bridge** — `scheduleSwap(...)` validates a `SwapTicketRT` off the audio thread and enqueues a
  product-defined `"installSwap"` command into a mailbox. It maps failures to `hotswap.*` and `commands.*` errors.
* **Timeline driver + slicer** — `TimelineDriver`, `timeline-slicer`, and `processTimelineBlock` provide sample-accurate
  scheduling of high-level timeline commands (`play`, `stop`, `seek`, `installSwap`, `cancelSwap`) against a
  monotonically increasing frame counter.

This package is a **reference integration**, not “the engine”. A DJ deck, video pipeline, or physics sim would live in
application code, using:

* `@seqlok/core`
* `@seqlok/primitives`
* `@seqlok/commands`
* `@seqlok/hotswap`
* `@seqlok/integration`

as implementation detail.

---

### `@seqlok/introspect` (Sidecar)

Diagnostics, observability, tooling. **Never** imported by hot-path code.

* Aggregates domain registries into a single JSON-exportable view.
* Tracks budgets and counters for retries, timeouts, drops, etc.
* Offers helpers for inspecting layouts, seqlocks, rings, timelines in tests and playgrounds.

Rule of thumb:

> If you import `@seqlok/introspect` in your audio callback or tight render loop, something is wrong.

Keep it for dev tools, CLIs, and playgrounds.

---

## Canonical Flow 1: Param / Metric Sync

Continuous bidirectional state between:

* **Controller thread** (UI, automation, ~60 Hz), and
* **Processor thread** (RT callback, ~344 Hz for 44.1kHz / 128-sample blocks).

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         CONTROLLER THREAD                               │
│   (Main thread: UI events, MIDI, automation, requestAnimationFrame)    │
└─────────────────────────────────────────────────────────────────────────┘
         │                                                   ▲
         │ params.set() / update() / hydrate()               │ meters.snapshot()
         ▼                                                   │
    ┌─────────┐                                        ┌─────────┐
    │  Param  │   SharedArrayBuffer (seqlock-backed)   │ Metric  │
    │  State  │◄──────────────────────────────────────►│  State  │
    └─────────┘                                        └─────────┘
         │                                                   ▲
         │ params.within()                                   │ meters.publish()
         ▼                                                   │
┌─────────────────────────────────────────────────────────────────────────┐
│                         PROCESSOR THREAD                                │
│      (Real-time callback, e.g. AudioWorkletProcessor.process())        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Seqlock read protocol (conceptual)

The `tryRead` helper in `@seqlok/primitives` enforces coherent reads with budgets:

1. Spin while the sequence is **odd** (writer in progress) up to `spinBudget`.
2. When sequence is even, run the `reader()` to copy the multi-word payload.
3. Re-check the sequence:

* If unchanged, return `{ ok: true, value, status }`.
* If changed, bump `retries` and try again.

4. If we never see a stable window and `retryBudget` is exhausted, the implementation escalates:

* some paths **degrade** (controller snapshot falls back to a best-effort read),
* some paths treat it as a bug and throw `primitives.seqlockTimeout`.

The important bit for integrators:

* Controller / observer snapshot reads are **biasing toward liveness**.
* Processor within/publish calls are **biasing toward safety**; timeouts are treated as exceptional.

### Timing characteristics

Rough budget at 44.1kHz / 128-sample blocks:

| Direction                        | Writer rate         | Reader rate | Typical latency |
|----------------------------------|---------------------|-------------|-----------------|
| Params (controller → processor)  | ~60 Hz or on demand | ~344 Hz     | 0–3 ms          |
| Metrics (processor → controller) | ~344 Hz             | ~60 Hz      | 0–16 ms         |

Params are pulled every callback to keep interpolation smooth. Metrics update at display rate; humans won’t notice more.

---

## Canonical Flow 2: Command Dispatch

Commands are discrete, ordered events. They marry the mailbox layer (`@seqlok/commands`) with timeline scheduling (
`@seqlok/integration`).

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                           HOST / CONTROLLER                             │
│   "seek to 2:30", "swap engine", "trigger cue", ...                     │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ producer.push(cmd)
                                   ▼
                          ┌───────────────────┐
                          │   Command Ring    │
                          │    (SWSR queue)   │
                          │ [cmd][cmd][cmd]   │
                          └───────────────────┘
                                   │
                                   │ consumer.drain(hooks)
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                               PROCESSOR                                 │
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────────┐   │
│   │                             TIMELINE                             │   │
│   │  Commands scheduled by absolute frame, executed sample-accurate  │   │
│   │                                                                  │   │
│   │ Frame 0 ──────────────── … ──────────────── Frame N              │   │
│   │    │                │                      │                     │   │
│   │    ▼                ▼                      ▼                     │   │
│   │  [seek]          [trigger]             [installSwap]             │   │
│   └──────────────────────────────────────────────────────────────────┘   │
│                                   │                                      │
│                                   ▼                                      │
│                          Application processor                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Command lifecycle

1. **Enqueue (controller)**

```ts
const result = mailbox.producer.push({
  kind: "seek",
  targetFrame: 44100 * 150,
});

if (!result.ok) {
  // Convert to commands.* error, log, or surface to host
}
```

2. **Drain (processor)**

```ts
mailbox.consumer.drain({
  onCommand(cmd) {
    // Typically: schedule into timeline
    timeline.enqueue(cmd);
  },
  onUnknownCommand(err) {
    // Map to commands.unknownCommand or log
  },
  onInvalidPayload(err) {
    // Map to commands.invalidPayload or log
  },
});
```

3. **Execute (timeline, sample-accurate)**

```ts
processTimelineBlock(timeline, blockFrames, drainedCommands, {
  renderSegment(frames) {
    // Render `frames` samples under current state
  },
  applyCommandSideEffects(cmd) {
    // Optional: UI hooks, debug logs, etc.
  },
});
```

---

## Hotswap State Machine

Hotswap sits on top of the command/timeline layer:

* A command installs a `SwapTicketRT`.
* The timeline wires it into a `HotswapSlotDriver`.
* Every block, the slot driver calls `stepSwapStateRT` and tells the engine layer what to do.

High-level lifecycle:

```text
idle
  │  (ticket accepted)
  ▼
spawn  ──► prime ──► prewarm ──► crossfade ──► retire ──► idle
```

During **crossfade**, both engines run. The engine layer is responsible for mixing according to the chosen gain curve:

* Current engine gain: goes from 1 → 0.
* Next engine gain:   goes from 0 → 1.
* Curves (linear, equal-power, custom) are chosen at the application level.

`@seqlok/integration`’s `HotswapSlotDriver` is a thin wrapper: it holds the current `SwapStateRT`, applies
`stepSwapStateRT` per block, and returns fine-grained instructions to the engine layer.

---

## Where HotSwap Lab Fits

The **HotSwap Lab** in `packages/playground` is a visualization of the hotswap protocol in isolation. It uses the **real
** `@seqlok/hotswap` state machine and runs in a simulated timebase (driven by `requestAnimationFrame`).

### Current features

1. **Config panel**

* Block size
* Fade duration
* Pre-warm blocks
* Playback speed (simulated)
* Crossfade curve selection

2. **SVG timeline viewport**

* Phase bands (`idle`, `spawn`, `prime`, `prewarm`, `crossfade`, `retire`)
* Block ticks and major ticks
* Gain curves for *current*, *next*, and *sum*

3. **Inspector**

* Raw `SwapStateRT` fields at the cursor
* Last `SwapStepDecisionRT`
* Ticket details and frame counters

### Educational value

The lab is for intuition, not just pretty charts:

* **State machine visibility** — watch how phases transition as you tweak timings.
* **Crossfade behavior** — see how different curves affect the sum gain.
* **Timing intuition** — connect “frames”, “blocks”, and “wall-clock” time visually.
* **Edge case exploration** — double-swap, swap-while-crossfading, invalid tickets (via guards in the real state
  machine).

### Planned: Command Ring Lab

A second playground tab is planned:

* Visualize SWSR ring state (write/read indices, queue depth).
* Show producer/consumer rates and overflow behavior.
* Map UI interactions directly to `@seqlok/commands` APIs.

### Relationship to production code

```text
┌──────────────────────────────────────────────────────────────┐
│                      @seqlok/* packages                     │
│      (substrate: primitives, core, commands, hotswap)       │
└──────────────────────────────────────────────────────────────┘
                              │
                              │ imported directly
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    packages/playground                       │
│                                                              │
│  HotSwap Lab: hotswap protocol visualization (current)       │
│  Command Ring Lab: SWSR visualization (planned)              │
│                                                              │
│  Uses: real @seqlok/* code; no mocks                         │
│  Timing: simulated via rAF, not audio callbacks              │
└──────────────────────────────────────────────────────────────┘
```

The playground is allowed to import `@seqlok/introspect` and other tooling helpers. Production audio / GPU paths are
not.

---

## Quick Reference

### When to use which piece

| Need                                     | Primitive / API                                                                                      | Package(s)                           |
|------------------------------------------|------------------------------------------------------------------------------------------------------|--------------------------------------|
| Continuous shared state (params/metrics) | `defineSpec` → `planLayout` → `allocateShared` → `bindController` / `bindProcessor` / `bindObserver` | `@seqlok/core`                       |
| Discrete events across threads           | `allocateSwsrRing` + `bindSwsrRingProducer` / `bindSwsrRingConsumer`                                 | `@seqlok/primitives`                 |
| Typed command transport                  | `CommandCodec` + `createCommandMailbox`                                                              | `@seqlok/commands`                   |
| Engine hot-swap                          | `SwapTicketRT`, `initSwapStateRT`, `stepSwapStateRT`                                                 | `@seqlok/hotswap`                    |
| Sample-accurate command scheduling       | `TimelineDriver`, `timeline-slicer`, `processTimelineBlock`                                          | `@seqlok/integration`                |
| Error registry / numeric codes           | `buildErrorDomain`, `DOMAIN_IDS`, JSON export                                                        | `@seqlok/base`, `@seqlok/introspect` |

### RT / thread-safety invariants

| Operation                                 | Blocks? | Allocates? | Notes                                                 |
|-------------------------------------------|---------|------------|-------------------------------------------------------|
| Seqlock write (`publish` / writer path)   | No      | No         | Single writer per pair                                |
| Seqlock read (`tryRead` + bindings)       | No      | No*        | Snapshot may copy; processor `within()` is zero-alloc |
| Ring enqueue (`SwsrRingProducer.enqueue`) | No      | No         | Single writer                                         |
| Ring dequeue (`SwsrRingConsumer.dequeue`) | No      | No         | Single reader                                         |
| Command push (`producer.push`)            | No      | No         | Structured failure (`mailboxClosed` / `ringOverflow`) |
| Hotswap step (`stepSwapStateRT`)          | No      | No         | Pure function driven per block                        |

### Error handling philosophy

* **Normal hot path:** no dynamic allocations, no “expected” exceptions.
* **Exceptional conditions:** use typed `SeqlokError`s with domain + numeric code.

  * Transport failures: `commands.mailboxClosed`, `commands.ringOverflow`.
  * Protocol violations: `hotswap.invalidTicket`.
  * Pathological seqlock behavior: `primitives.seqlockTimeout`.
* **Overflow:** never blocks; commands are dropped and surfaced via structured error or hooks.
* **Torn reads:** binding policies decide:

  * controller/observer snapshot may **degrade** gracefully,
  * processor `within()` treats timeouts as bugs.

---

## Further Reading

Some of this is still in-flight / planned, but the mental model is:

* Real-time constraints and budgets (audio, GPU, general RT).
* Topology patterns: hubs, buses, MWMR via composition.
* Cross-language error registry export and native bindings.

For exact details, the source of truth is:

* Package source code in `packages/*`
* Public API surfaces (`index.ts` in each package)
* Error registry export tooling in `@seqlok/introspect`
