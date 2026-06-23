# ADR-010: Ring Primitive in `@seqlok-internal/prototype-core`

**Status**: Accepted
**Date**: 2025-11-19
**Owner**: _TBD_

**Related**:

- ADR-001 – Seqlok Core Golden Flow
- ADR-002 – Memory Growth & Swap via Handoff Sequences
- ADR-00Y – MWMR System Architecture via Domains + Observers + Rings
- ADR-00X – `@seqlok/compose` for System-Level Composition
- ADR-00Z – Observer Binding Role in `@seqlok-internal/prototype-core`

---

## 1. Context

`@seqlok-internal/prototype-core` currently exposes:

- seqlock-based **params/meters** primitives (snapshot/publish),
- a deterministic layout pipeline: `spec → plan → backing → handoff → bindings`,
- SWMR domains via `bindController` / `bindProcessor` / `bindObserver`.

These primitives are about **state**:

- bidirectional,
- snapshot-oriented,
- read-many, write-one.

Real-time systems like Dekzer also need a way to express **control flow**:

- enqueue **commands** (play/pause/seek, rate ramps, engine swaps),
- drain and execute them at predictable points (e.g. per audio block),
- keep the hot path allocation-free and GC-friendly,
- share the same memory across JS / Wasm / C++ runtimes.

ADR-00Y and ADR-00X assume a **command ring / intent bus** but originally treated it as a separate package (
`@seqlok/command-ring`).

This ADR decides that the underlying **ring primitive** is fundamental enough to live directly in `@seqlok-internal/prototype-core`
alongside `seqlock`.

---

## 2. Decision

We introduce a **generic, single-writer / single-reader (SWSR) ring primitive** in `@seqlok-internal/prototype-core/src/primitives` with
these properties:

- lives next to `seqlock` and other low-level primitives,
- operates over `SharedArrayBuffer` or shared `WebAssembly.Memory`,
- uses a fixed, ABI-stable layout,
- is **semantic-free**:
  - no knowledge of opcodes, timelines, or products,
  - sees only `T` payloads via encode/decode functions,
- is strictly **SWSR** at the primitive level:
  - exactly one producer binding,
  - exactly one consumer binding.

Higher-level MPSC / MPMC patterns (MWMR intent buses) are built on top of this primitive by `@seqlok/compose` and
product drivers.

The primitive is part of `@seqlok-internal/prototype-core` **only as a mechanism**. All command semantics remain outside core.

---

## 3. Layout & ABI

The layout is:

- **Header**: 64-byte, cache-line-aligned `Uint32Array` of length 16
- **Slots region**: contiguous `Uint32Array` of length `capacity * wordsPerSlot`

Header fields (conceptual):

```txt
u32[0]  writeIndex     // next slot index for producer
u32[1]  readIndex      // next slot index for consumer
u32[2]  writeSeq       // monotonic sequence for producer-side metrics/diagnostics
u32[3]  dropped        // cumulative count of dropped entries (overflow)
u32[4..15] reserved    // future-proofing / padding
```

Slots:

- each slot is `wordsPerSlot` 32-bit words (u32),
- producer encodes a payload `T` into `wordsPerSlot` words,
- consumer decodes from `wordsPerSlot` words back into `T`.

Policy:

- ring is **drop-newest-on-full** by default:

  - if the producer detects that advancing `writeIndex` would collide with `readIndex`, it:

    - increments `dropped`,
    - overwrites the oldest slot,
    - moves `readIndex` forward in lockstep (wrap-around).

This policy keeps the consumer always seeing the **most recent** commands while preserving bounded memory and O(1)
operations.

The layout is deliberately trivial to mirror in C++ and other languages.

---

## 4. Type-Level API (conceptual)

At the primitive level we expose:

```ts
export interface RingLayout {
  readonly capacity: number; // number of slots
  readonly wordsPerSlot: number; // 32-bit words per slot
}

export interface RingBacking {
  readonly header: Uint32Array; // length 16
  readonly slots: Uint32Array; // length = capacity * wordsPerSlot
}

export interface RingProducer<T> {
  /** Enqueue a value if possible; returns true if accepted. */
  push(value: T): boolean;
}

export interface RingConsumer<T> {
  /**
   * Drain all currently available values.
   * Implementations may batch to reduce overhead.
   */
  drain(fn: (value: T) => void): void;
}

/**
 * Allocate a ring backing inside a SharedArrayBuffer or shared WebAssembly.Memory.
 * Ownership of the underlying memory is external (plan/backing layer).
 */
export function allocateRing(layout: RingLayout): RingBacking;

/**
 * Bind a **single producer** to the backing using encode/decode functions.
 */
export function bindRingProducer<T>(
  backing: RingBacking,
  encode: (value: T, dst: Uint32Array, offset: number) => void,
): RingProducer<T>;

/**
 * Bind a **single consumer** to the backing.
 */
export function bindRingConsumer<T>(
  backing: RingBacking,
  decode: (src: Uint32Array, offset: number) => T,
): RingConsumer<T>;
```

Notes:

- This is **conceptual** API; actual naming/placement may differ slightly,
  but the ABI (header + slots) must remain stable.
- Encode/decode are responsible for mapping `T` into fixed-width `wordsPerSlot`.
- The primitive is oblivious to product semantics (opcodes, timestamps, swap tickets, etc.).

---

## 5. Usage Patterns

### 5.1 Command rings (intent buses)

Typical usage in a deck driver:

```ts
type DeckCommand = {
  readonly opcode: number; // e.g. play, pause, seek, rate ramp, swap
  readonly atFrameLo: number;
  readonly atFrameHi: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
};

const layout = { capacity: 64, wordsPerSlot: 8 };
const backing = allocateRing(layout);

const producer = bindRingProducer<DeckCommand>(backing, encodeDeckCommand);
const consumer = bindRingConsumer<DeckCommand>(backing, decodeDeckCommand);

// Producer side (UI, MIDI, automation, agents...)
producer.push({
  opcode: OPCODE_SEEK,
  atFrameLo,
  atFrameHi,
  a: targetFrameLo,
  b: targetFrameHi,
  c: 0,
  d: 0,
});

// Consumer side (AudioWorklet / processor tick)
consumer.drain((cmd) => {
  // translate into controller params / SwapTickets
});
```

- Many producers (UI thread, MIDI worker, network worker, AI agents) can fan-in through
  an MPSC hub built **on top of** this primitive.
- A single driver/processor drains and applies commands at block boundaries.

### 5.2 MWMR via ADR-00Y

ADR-00Y uses the ring primitive to build **system-level MWMR**:

- many intent producers → one or more logical `CommandRing`s,
- a single driver per ring, owning controller/processor bindings,
- many observers per domain via `bindObserver`.

The ring primitive is the **MW → 1** leg; `bindObserver` is the **1 → MR** leg.

---

## 6. C++ / Wasm Interop

Because the ABI is fixed:

- C++ can define:

  ```cpp
  struct alignas(64) RingHeader {
      std::atomic<std::uint32_t> writeIndex;
      std::atomic<std::uint32_t> readIndex;
      std::atomic<std::uint32_t> writeSeq;
      std::atomic<std::uint32_t> dropped;
      std::uint32_t reserved[12];
  };

  struct DeckCommandSlot {
      std::uint32_t words[8];
  };
  ```

- JS/Wasm and C++ can map the same memory:

  - JS via `Uint32Array`
  - C++ via `std::uint32_t*` with `std::atomic` access for header fields

- The same `capacity` / `wordsPerSlot` produces identical layouts across runtimes.

This allows:

- JS drivers generating commands for native engines,
- native analyzers or DSP consuming commands produced in JS,
- mixed JS/Wasm/C++ systems sharing the same control plane.

---

## 7. Consequences

- `@seqlok-internal/prototype-core` now exposes **two fundamental concurrency primitives**:

  1. **Seqlock** – for bidirectional state sync (params/meters).
  2. **Ring primitive** – for unidirectional command queues (intent buses).

- MWMR architectures (ADR-00Y) have a concrete, ABI-stable building block for fan-in.

- The primitive remains **semantic-free**; products define:

  - their own `T` payloads (e.g. `DeckCommand`, `SwapTicket`, agent intents),
  - encode/decode functions,
  - higher-level drivers/governors.

- If, in future, applications need richer patterns (e.g. multiple priority queues,
  different overflow policies), those can be built on top of the primitive without
  changing its ABI.

This ADR is the normative source for:

- the presence and layout of the ring primitive in `@seqlok-internal/prototype-core`,
- its relationship to MWMR system design (ADR-00Y),
- its role relative to `bindObserver` and drivers described in ADR-00X / ADR-00Z.
