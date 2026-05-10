# Seqlok: Goals and Non-Goals

**Purpose:** Define what Seqlok _is for_ and what it explicitly refuses to do.

---

## Problem Statement

Modern web and runtime applications increasingly need to share state between fundamentally different execution contexts:

- **UI thread** ↔ **Real-time audio processing** (AudioWorklet)
- **Main thread** ↔ **Compute workers** (Web Workers)
- **JavaScript** ↔ **WebAssembly modules**
- **Simulation engines** ↔ **Rendering/UI**

These contexts have very different constraints:

| UI / Main Thread              | Real-Time / Worker Context          |
| :---------------------------- | :---------------------------------- |
| GC pauses acceptable          | **No GC on the hot path**           |
| `async/await` natural         | **Synchronous reads only**          |
| Convenience over raw speed    | **Strict microsecond budgets**      |
| `postMessage` cost acceptable | **No large copies per quantum**     |
| Can use promises & closures   | **Must avoid allocations in loops** |

**The gap Seqlok fills:**

> A coherent, atomic, type-safe way to share state between these worlds
> **without** sacrificing real-time behavior on the processor side.

Seqlok sits **below** app logic and **above** raw `SharedArrayBuffer + Atomics`. It focuses on one thing: **fast,
predictable, shared memory coordination** between a "Controller" and a "Processor".

---

## Core Goals

### 1. Real-Time Friendly Communication

Seqlok is designed so the **Processor side** (AudioWorklet, RT worker, tight simulation loop) can:

- Read params without taking OS locks
- Avoid object allocations on the hot path (Seqlok itself doesn't allocate in `within`/`publish`)
- Use operations that are **bounded and predictable** (small retry loops, no syscalls)
- Work against **cache-friendly, tightly packed** memory layouts

It uses a **seqlock-based protocol** under the hood:

- Reads are **lock-free and retry-based**:

  - They may spin briefly if a write is in progress, but they don't block on a mutex.

- Writes are short, bounded critical sections (update a few scalars/arrays, bump counters).

**Why this matters:** An AudioWorklet callback typically has ~3ms per quantum at 44.1kHz. A single GC pause or blocking
lock is enough to glitch audio. Seqlok's read path is designed to be predictable and free from JS-level allocations.

---

### 2. Coherent Snapshots

When the Processor reads state, it gets a **coherent snapshot**: all values reflect a single logical moment, not a mix
of old and new.

```ts
// ✅ GOOD: coherent read
processor.params.within((p) => {
  const ratio = p.timeRatio; // 1.5
  const coeffs = p.coeffs; // coeffs correspond to ratio = 1.5
});

// ❌ TORN READ (what Seqlok prevents):
// ratio might be 1.5 while coeffs are still from ratio = 1.0
```

The seqlock logic ensures that if a write lands while the Processor is reading:

- The read is retried until it sees a self-consistent state.
- The Processor never sees "partially updated" params.

This is crucial for:

- Audio DSP (filters, time-stretchers, dynamics)
- Physics and game simulations
- Any domain where internal consistency across multiple fields matters more than "eventual" accuracy.

---

### 3. SWMR Only: Single-Writer Multiple-Reader

Seqlok enforces **strict ownership** per data domain:

- **Params domain:**

  - **Writer:** Controller
  - **Readers:** Processor + diagnostics

- **Meters domain:**

  - **Writer:** Processor
  - **Readers:** Controller + tools

There is **never more than one writer** for a given domain.

This design:

- Makes the seqlock protocol tractable and performant
- Eliminates an entire class of conflicts ("two writers racing to update the same field")
- Keeps the mental model clear:
  **Controller owns inputs; Processor owns outputs.**

If your system needs true multi-writer concurrency on the _same_ fields, Seqlok is not the right primitive.

---

### 4. Schema-First, Deterministic Layout

All shared state is defined **up front** via a typed DSL. For example:

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    frequency: param.f32({ min: 20, max: 20_000 }),
    waveform: param.enum(["sine", "square", "saw"]),
    harmonics: param.f32.array({ length: 16 }),
  },
  meters: {
    rms: meter.f32(),
    spectrum: meter.f32.array({ length: 512 }),
  },
}));
```

From this spec, Seqlok derives:

- A **deterministic memory plan** (planes, offsets, element counts)
- Clear TS types for controller and processor bindings
- Slots for seqlock counters in control planes
- A plan that can be reproduced identically in another agent from a compact handoff

There is:

- No runtime schema negotiation
- No reflection-based plan building
- No dynamic "oh, this field just appeared" behavior

Specs are **structural and stable**: once planned, both sides know exactly what’s in memory.

---

### 5. Type Safety Throughout

Seqlok leans heavily on TypeScript so that many illegal states are just **unrepresentable**:

```ts
// ✅ Type-safe: TS knows 'waveform' is 'sine' | 'square' | 'saw'
controller.params.set("waveform", "sine");

// ❌ Compile-time error
controller.params.set("waveform", "triangle");
//            ~~~~ Type '"triangle"' is not assignable to type '"sine" | "square" | "saw"'.

// ✅ Array access: TS knows harmonics is a read-only Float32Array-like view
processor.params.within((p) => {
  const first = p.harmonics[0]; // number
});
```

Design locks:

- **Zero `any`** in the public API.
- Strongly typed builders (`param.f32`, `param.enum`, `meter.f32.array`, …).
- Controller/Processor bindings preserve the spec's semantics at the type level.
- `@ts-expect-error` only in tests that deliberately probe invalid usage.

The result: many misuses (wrong key, wrong type, invalid enum literal) fail fast at compile time instead of becoming
rare runtime bugs.

---

### 6. Explicit Fail-Fast Philosophy

Seqlok operates at a **primitive level**: memory plan, shared buffers, concurrency. At this level, many errors are
fundamentally **unrecoverable** without risking corruption.

If you:

- Provide invalid or mismatched backing memory
- Violate allocation contracts
- Pass malformed or incompatible handoffs
- Attempt to bind with a mismatched spec/plan

Seqlok will throw a typed `SeqlokError` _immediately_.

It will **not**:

- Attempt silent recovery
- Try to "patch up" mismatched layouts
- Fall back to lossy behavior

The philosophy is simple:

> Fail fast, with a clear error,
> and let higher-level code decide how to recover.

---

## Hard Constraints

### Shared Memory Model: SharedArrayBuffer + Atomics

Seqlok assumes:

- `SharedArrayBuffer` is available and enabled

  - Browsers: COOP/COEP headers and cross-origin isolation
  - Runtimes: SAB support and proper flags

- `Atomics` API is available
- A worker model (Web Workers, AudioWorklets, Node worker_threads, etc.)

There is **no fallback** mode without SAB:

1. The coherence guarantees depend directly on true shared memory.
2. Polyfills using `postMessage` would break real-time assumptions.
3. “Degraded modes” are more dangerous than explicit failure here.

If SAB is not available, Seqlok should not be used.

---

### Concurrency Model: SWMR Only

Seqlok's roles are fixed:

```text
Controller:
  - Writes params
  - Reads meters

Processor:
  - Reads params
  - Writes meters

Consumers (optional):
  - Read meters only (via controller or aggregated views)
```

It will **never** grow support for:

- Multiple controllers writing the same params plane
- Multiple processors writing to the same meters plane
- Bidirectional writes to the same domain

If you need multi-writer semantics, use a different concurrency primitive and accept the extra complexity/overhead.
Seqlok optimizes for the **single-writer case** and will not compromise that.

---

### Schema Commitment

Once you:

1. Define a spec
2. Plan it
3. Allocate backing memory

the structure is treated as **frozen**:

- No adding/removing params/meters in-place
- No changing a param from `f32` to `i32`
- No resizing arrays

If your schema needs to change:

- Define a new spec
- Plan + allocate a new backing
- Migrate state and swap (e.g., with a higher-level "swap at frame" mechanism)

This immutability is what enables:

- Deterministic plan
- Stable hashes for compatibility checks
- Predictable performance characteristics

---

## Non-Goals

### Not a Generic State Library

Seqlok is **not** Redux, Zustand, Jotai, Valtio, or any other general-purpose state management solution.

It does **not** provide:

- Middleware or plugin systems
- Time-travel debugging
- Undo/redo
- Derivations / computed selectors
- React/Vue bindings out of the box

If your state:

- Lives entirely on the main thread, and
- Does not have hard real-time constraints

then you should probably use a standard UI state library instead.

---

### Not a Networking Protocol

Seqlok operates within **one process**, via shared memory.

It does **not** provide:

- Network serialization
- WebSocket/WebRTC transport
- Conflict resolution
- Eventually-consistent replication

For multi-node / over-the-network sync, look at CRDT-based systems (Yjs, Automerge, etc.) or tailored protocols. Seqlok
simply gives you a very fast, very structured **in-process shared state**.

---

### Not a Serialization Format

Seqlok's in-memory plan is:

- **Not human-readable**
- **Not stable** across major versions by design
- **Not intended** for persistence or disk storage

It is an implementation detail optimized for:

- Cache behavior
- Typed array mapping
- Concurrency semantics

To store or send data:

- **Read** values out of Seqlok
- Serialize them via JSON, MessagePack, Protobuf, etc.

Do not treat Seqlok's backing buffer as a long-term storage format.

---

### Not an Actor System or Task Scheduler

Seqlok is about **data**, not about **control flow**.

It does **not** provide:

- Message queues
- Supervision trees
- Remote procedure calls
- Task scheduling/APIs

It's closer to:

> “A shared, concurrently safe struct with strong rules”

than to Akka/Erlang actors or a job system. You can certainly build such systems _on top of_ Seqlok, but Seqlok itself
stays focused on the shared state problem.

---

### Not a Full AudioParam Replacement

Seqlok works very well with Web Audio, but it is **not** a drop-in replacement for `AudioParam`.

**Seqlok params:**

- Written from the Controller, read by the Processor
- Typically updated once per audio quantum (e.g., every 128 frames)
- Can represent scalars, enums, booleans, and arrays

**AudioParam:**

- Integrated into the Web Audio graph
- Supports **sample-accurate** scheduling
- Has built-in ramping functions (linear, exponential, etc.)

The intended pattern:

- Use Seqlok for **device state**:

  - modes, enumerations, multi-dimensional arrays, configuration blobs

- Use AudioParam for **sample-accurate control signals**:

  - gain envelopes, filter cutoff modulation, etc.

They complement each other; neither fully replaces the other.

---

## Comparison to Alternatives

### vs `postMessage`

| Feature               | `postMessage`                | Seqlok                                    |
| :-------------------- | :--------------------------- | :---------------------------------------- |
| Data movement         | Structured clone (copies)    | Zero-copy shared memory                   |
| Latency               | Message-queue dependent (ms) | Immediate load/store (plus Atomics)       |
| Real-time suitability | ❌ GC & queuing can glitch   | ✅ No allocations on hot path (in Seqlok) |
| Coherence             | Per-message, not cross-field | ✅ Coherent snapshots via seqlock         |

**Use `postMessage` when:**

- You don't have real-time constraints
- Occasional copies and GC are fine
- You don't want shared memory complexity

---

### vs Raw SharedArrayBuffer + Atomics

| Feature        | Raw SAB + Atomics                    | Seqlok                            |
| :------------- | :----------------------------------- | :-------------------------------- |
| Type safety    | Manual casting / indexing            | Rich TS types, no `any`           |
| Layout         | Hand-written offsets & magic numbers | Automatic, deterministic planning |
| Concurrency    | DIY protocol                         | Built-in SWMR seqlock             |
| Error handling | Easy silent corruption               | Typed `SeqlokError` on violation  |
| Dev ergonomics | Low-level, error-prone               | High-level, role-based bindings   |

**Use raw SAB + Atomics when:**

- You have a very specialized data plan
- You want to squeeze out every last cycle yourself
- You're willing to own all concurrency invariants manually

---

### vs Web Audio `AudioParam`

| Feature         | `AudioParam`                | Seqlok                                    |
| :-------------- | :-------------------------- | :---------------------------------------- |
| Time resolution | Sample-accurate             | Per-quantum (per `process` call)          |
| Automation      | Built-in scheduling & ramps | Manual (or via AudioParam)                |
| Value types     | Single scalar               | Scalars, arrays, enums, booleans          |
| Integration     | Deep Web Audio integration  | Generic shared memory, works beyond audio |

The sweet spot:

- Use Seqlok for _configuration/state_ and metering (e.g. mode, buffers, analysis).
- Use AudioParam for _control signals_ that must match the sample clock exactly.

---

## Target Use Cases

Seqlok is designed for scenarios with:

- A **Controller** (UI/main/host)
- A **Processor** (AudioWorklet/worker/simulation loop)
- **Shared state** that must be fast, coherent, and type-safe

Examples:

### Audio DSP

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    frequency: param.f32({ min: 20, max: 20_000 }),
    filterType: param.enum(["lowpass", "highpass", "bandpass"]),
    drive: param.f32({ min: 0, max: 10 }),
  },
  meters: {
    rms: meter.f32(),
    spectrum: meter.f32.array({ length: 2048 }),
  },
}));
```

- Controller: writes `frequency`, `filterType`, `drive`
- Processor: reads params; publishes `rms` and `spectrum`

---

### Physics / Game Simulation

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    gravity: param.f32({ min: -20, max: 20 }),
    timestep: param.f32({ min: 0.001, max: 0.1 }),
  },
  meters: {
    fps: meter.f32(),
    positions: meter.f32.array({ length: 3 * 10_000 }), // x,y,z triples
  },
}));
```

- Controller: adjusts `gravity`, `timestep`
- Worker: reads params; writes `fps` and positions array

---

### WebAssembly Modules

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    gain: param.f32({ min: 0, max: 2 }),
  },
  meters: {
    peak: meter.f32(),
  },
}));

// owner / JS side
const plan = planLayout(spec);
const backing = allocateWasmShared(plan, { initialPages: 4 });

const controller = bindController(spec, backing);
const handoff = buildHandoff(plan, backing);

// pass `handoff` (or a serialized form) into your Wasm-using agent.
// processor side (JS worker, engine wrapper, or native code) reconstructs:
const accepted = acceptHandoff(handoffFromMain);
const processor = bindProcessor(accepted);
// or an equivalent binding in the target language using the same plan layout.
```

- JS and Wasm share the same memory & plan, described by the handoff.
- The Controller binds via `bindController(spec, backing)`.
- The Processor (JS worker around Wasm, or native side) binds via `acceptHandoff` → `bindProcessor(accepted)` or an equivalent mapping that respects the same layout.

---

### Video / Encoding Workers

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    bitrateKbps: param.i32({ min: 128, max: 50_000 }),
    codec: param.enum(["h264", "h265", "vp9", "av1"]),
  },
  meters: {
    framesProcessed: meter.f32(),
    compressionRatio: meter.f32(),
  },
}));
```

- Controller: sets `bitrateKbps`, `codec`
- Worker: reads params; publishes progress + stats

---

## What Success Looks Like

You should reach for Seqlok when:

1. You have a **real-time or latency-sensitive loop** in another agent.
2. State must flow **both directions** (params → Processor, meters → Controller).
3. **Coherence matters** — inconsistent reads would be meaningful bugs.
4. **Type safety is non-negotiable** — you want the compiler to catch misuse.

If all four are true, Seqlok is likely the right tool.

If only one or two are true, you might be better served by:

- `postMessage` + structured data
- A UI state library
- A simpler custom protocol on top of SAB

---

## Summary

**Seqlok is:**

- A **shared-memory synchronization primitive** for JS/Wasm
- Designed for **real-time SWMR communication** between Controller and Processor
- **Schema-first**, with deterministic plan from a typed DSL
- **Type-safe**, with zero `any` and strong TS integration
- **Fail-fast**, with structured `SeqlokError` instead of silent corruption

**Seqlok is not:**

- A full state management library
- A networking or persistence layer
- An actor system or RPC framework
- A drop-in replacement for all of Web Audio's scheduling mechanisms

Use Seqlok when you need **coherent, type-safe, real-time state sync across agents**. For everything else, simpler tools
are often better.
