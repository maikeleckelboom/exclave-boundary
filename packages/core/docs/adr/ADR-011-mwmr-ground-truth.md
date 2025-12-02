# ADR-011: MWMR System Model and Guardrails

**Status**: Accepted
**Date**: 2025-11-19
**Owner**: _TBD_

**Related**:

- ADR-00Y — MWMR System Architecture via Domains + Observers + Rings
- ADR-00Z — Observer Binding Role in `@seqlok/core`
- ADR-010 — Ring Primitive in `@seqlok/core`
- ADR-00C — Meter Writes & Snapshot `into` (Controller side)
- ADR-00F — ControllerParams.hydrate() for Cold-Path Bulk Updates
- ADR-00X — `@seqlok/compose` for System-Level Composition

---

## 1. Context

Real-time systems like Dekzer, agent swarms, and multi-user collaborative applications require **many-writer / many-reader (MWMR)** behavior:

- Many intent sources: UI, MIDI, network, AI agents, automation, IPC bridges
- Many state consumers: HUDs, WebGPU visualizers, telemetry, analyzers, hardware bridges

However, traditional mutex-based MWMR introduces:

- **priority inversion** (low-priority thread blocks high-priority audio/render thread),
- **unbounded latency** (lock acquisition time is unpredictable),
- **deadlock risk** (multiple mutexes, complex lock ordering),
- **real-time unsafety** (blocking syscalls are incompatible with RT constraints).

ADR-00Y, ADR-00Z, and ADR-010 establish the architectural pieces for **lock-free MWMR**:

- SWMR seqlock planes (params/meters),
- SWSR ring primitive (intent buses),
- observer bindings (read-only fan-out),
- composition via `@seqlok/compose`.

This ADR **formalizes the invariants** those decisions imply and establishes normative guardrails for code review, tooling, and documentation.

---

## 2. Decision

**Core principle:**

> **MWMR exists only at the system topology level, never at the primitive/memory level.**

### 2.1 Primitive-Level Semantics (Immutable)

`@seqlok/core` primitives are **strictly** single-writer:

- **Seqlock planes** (params/meters): **SWMR**

  - Exactly one writer per domain (controller for params, processor for meters)
  - Any number of readers via seqlock-protected snapshots

- **Ring primitive** (see ADR-010 for ABI): **SWSR**
  - Exactly one producer binding per ring instance
  - Exactly one consumer binding per ring instance
  - Fixed wire layout: 64-byte header + u32 slots

### 2.2 System-Level MWMR (Emergent)

MWMR behavior emerges from **composition**:

```
Many Writers (Intent Sources)
    ↓  ↓  ↓  ↓
Multiple SWSR Rings (one per producer)
    ↓
Single Hub/Governor (MPSC via ring fanin)
    ↓
Single ControllerBinding (domain authority)
    ↓
Domain State (SWMR planes)
    ↓  ↓  ↓  ↓
Many Readers (ObserverBindings)
```

- **Fan-in (MW → 1)**: Many producers → SWSR rings → hub drains all → single controller applies
- **Fan-out (1 → MR)**: Single domain state → many observers snapshot independently

### 2.3 Per-Domain Authority

For any Seqlok domain `Domain<S>`:

1. **Exactly one** `ControllerBinding<S>` instance (params writer)
2. **Exactly one** `ProcessorBinding<S>` instance (meters writer)
3. **Zero or more** `ObserverBinding<S>` instances (read-only)

No code outside these bindings writes to Seqlok planes, regardless of system complexity.

---

## 3. Invariants (Normative)

These rules are **hard constraints**. Any violation is an architectural defect:

1. **Single writer per domain**

- At most one `ControllerBinding<S>` may exist for params
- At most one `ProcessorBinding<S>` may exist for meters
- Each `ControllerBinding<S>` and `ProcessorBinding<S>` instance is owned by exactly one runtime (thread/worker/process) and must only be used from that runtime

2. **Observers are strictly read-only**

- `ObserverBinding<S>` exposes only:
  - `params.snapshot()`, `params.version()`
  - `meters.snapshot()`, `meters.version()`
- No `set`, `update`, `stage`, `publish`, `hydrate` methods

3. **Ring primitive is SWSR**

- Each ring instance (see ADR-010 for memory layout and ordering details) has exactly one producer and one consumer
- MPSC is achieved via **multiple SWSR rings**, not mutex on a single ring

4. **No blocking primitives in real-time paths**

- No `Mutex`, `Semaphore`, `ConditionVariable`, or blocking IPC
- Audio threads, GPU upload loops, particle integrators: lock-free only
- Seqlock reads use bounded spin/retry, not blocking waits

5. **Intent flow is unidirectional**

- All state mutations flow: `Producer → Ring → Hub → Controller → Plane`
- No direct cross-thread calls to `controller.params.*` or `processor.meters.*`

6. **Cross-process boundaries use IPC, not Seqlok**

- Seqlok operates within a single address space (renderer, main, worker)
- Electron renderer ↔ main, OS processes: use IPC/sockets, not shared Seqlok backings

---

## 4. Prohibited Patterns

### 4.1 Multiple Controller Bindings

```ts
// ❌ WRONG: Multiple controllers for same domain
const ctrlUI = bindController(spec, backing); // UI thread
const ctrlMIDI = bindController(spec, backing); // MIDI thread

ctrlUI.params.set("gain", 0.8); // RACE
ctrlMIDI.params.set("gain", 0.9); // RACE
```

**Why wrong:**

- Both threads write to same param plane
- No coordination between writes
- Violates SWMR invariant
- Causes tearing, lost updates, undefined behavior

---

### 4.2 Direct Cross-Thread Controller Calls

```ts
// ❌ WRONG: Multiple threads calling same controller
const controller = bindController(spec, backing); // Deck worker

// UI thread
onSliderChange((value) => {
  controller.params.set("gain", value); // Called from UI thread
});

// MIDI thread
onMIDIFader((value) => {
  controller.params.set("gain", value); // Called from MIDI thread
});
```

**Why wrong:**

- Controller binding lives in deck worker thread
- Calling from UI/MIDI threads is cross-thread mutation
- Even with "one controller", this violates thread safety
- Must route through rings instead

---

### 4.3 Mutex on Single Ring for MPSC

```ts
// ❌ WRONG: Mutex around single ring to get MPSC
const ring = allocateRing({ capacity: 64, wordsPerSlot: 8 });
const mutex = new Mutex();

function enqueueFromAnyThread(cmd: Command) {
  mutex.lock(); // BLOCKS other producers
  ring.push(cmd);
  mutex.unlock();
}
```

**Why wrong:**

- Introduces blocking (mutex.lock can wait indefinitely)
- Priority inversion if RT thread hits contended mutex
- Defeats purpose of lock-free architecture
- Correct approach: multiple SWSR rings, one per producer

---

### 4.4 Observer with Write Capability

```ts
// ❌ WRONG: Observer that tries to write
const observer = bindObserver(spec, received);

function updateFromHUD(value: number) {
  observer.params.set("gain", value); // Type error: no such method
}
```

**Why wrong:**

- Observers are read-only by design
- TypeScript prevents this, but conceptually wrong
- Writes must go through controller binding via ring

---

## 5. Recommended Patterns

### 5.1 MPSC via Multiple SWSR Rings

```ts
// ✅ CORRECT: Each producer gets own SWSR ring
//
// Note: Ring type names below are illustrative;
// see ADR-010 for exact exported API and signatures.

class MPSCIntentBus {
  private producers: Map<ProducerId, RingProducer<Command>>;
  private consumers: Map<ProducerId, RingConsumer<Command>>;

  addProducer(id: ProducerId): RingProducer<Command> {
    const ring = allocateRing({ capacity: 64, wordsPerSlot: 8 });
    const producer = bindRingProducer(ring, encodeCommand);
    const consumer = bindRingConsumer(ring, decodeCommand);

    this.producers.set(id, producer);
    this.consumers.set(id, consumer);

    return producer; // Each producer writes to OWN ring
  }

  // Hub is single consumer across ALL rings
  drainAll(): Command[] {
    const commands: Command[] = [];
    for (const consumer of this.consumers.values()) {
      consumer.drain((cmd) => commands.push(cmd));
    }
    return commands;
  }
}
```

**Properties:**

- No two producers ever call `push()` on the same ring instance
- Each ring is SWSR (primitive guarantee)
- Producer and consumer bindings created once, reused per drain
- MPSC behavior emerges from hub consuming multiple rings
- Zero blocking, wait-free enqueue for each producer

---

### 5.2 Canonical Dekzer Deck Topology

```ts
// ─────────────────────────────────────────────────────────
// Domain Setup (Canonical Flow)
// ─────────────────────────────────────────────────────────
const deckSpec = defineSpec({
  /* ... */
});
const deckPlan = planLayout(deckSpec);
const deckBacking = allocateShared(deckPlan);
const deckHandoff = buildHandoff(deckPlan, deckBacking);

// ─────────────────────────────────────────────────────────
// Main Thread: Observer + Ring Producer
// ─────────────────────────────────────────────────────────
const deckObserver = bindObserver(deckSpec, deckHandoff);
const uiRing = system.getRingProducer("transport", "ui-main");

slider.onInput = (value) => {
  uiRing.push({ type: "SET_GAIN", value }); // Intent, not direct write
};

function renderFrame() {
  const meters = deckObserver.meters.snapshot(["rms", "peak"]);
  updateVUMeters(meters); // Read-only
  requestAnimationFrame(renderFrame);
}

// ─────────────────────────────────────────────────────────
// MIDI Bridge Thread: Observer + Ring Producer
// ─────────────────────────────────────────────────────────
const midiObserver = bindObserver(deckSpec, deckHandoff);
const midiRing = system.getRingProducer("transport", "midi-bridge");

midiController.on("fader", (value) => {
  midiRing.push({ type: "SET_GAIN", value }); // Intent
});

setInterval(() => {
  const { playhead } = midiObserver.params.snapshot(["playhead"]);
  updateMIDILEDs(playhead); // Read-only
}, 16);

// ─────────────────────────────────────────────────────────
// Deck Worker Thread: Controller + Ring Consumer (HUB)
// ─────────────────────────────────────────────────────────
const deckController = bindController(deckSpec, deckBacking);
const transportRing = system.getRingConsumer("transport");

function deckWorkerTick() {
  // Drain ALL intent sources (UI, MIDI, network, AI, automation)
  transportRing.drain((cmd) => {
    switch (cmd.type) {
      case "SET_GAIN":
        deckController.params.set("gain", cmd.value);
        break;
      case "SEEK":
        deckController.params.update({ playhead: cmd.frame });
        break;
      case "HYDRATE":
        deckController.params.hydrate(cmd.preset);
        break;
    }
  });
}

setInterval(deckWorkerTick, 10); // 100Hz hub tick

// ─────────────────────────────────────────────────────────
// AudioWorklet Thread: Processor Only
// ─────────────────────────────────────────────────────────
const deckProcessor = bindProcessor(deckSpec, deckHandoff);

function audioProcess(inputs: Float32Array[], outputs: Float32Array[]) {
  deckProcessor.params.within((params) => {
    const { gain, rate } = params;

    // DSP...

    deckProcessor.meters.publish((meters) => {
      meters.rms = computeRMS(outputs);
      meters.peak = computePeak(outputs);
    });
  });
}

// ─────────────────────────────────────────────────────────
// WebGPU Visualizer Worker: Observer Only
// ─────────────────────────────────────────────────────────
const vizObserver = bindObserver(deckSpec, deckHandoff);

function renderParticles() {
  const { waveformData } = vizObserver.meters.snapshot(["waveformData"]);

  // Upload SAB-backed view directly to GPU
  device.queue.writeBuffer(storageBuffer, 0, waveformData);

  draw();
  requestAnimationFrame(renderParticles);
}
```

**Key properties:**

- **Canonical flow**: `defineSpec → planLayout → allocateShared → buildHandoff` (ADR-001)
- **Main, MIDI**: Observers + ring producers (no writes to planes)
- **Deck worker**: Single controller + ring consumer (only params writer)
- **AudioWorklet**: Single processor (only meter writer)
- **WebGPU worker**: Observer only (read-only)
- **Intent flow**: UI/MIDI → rings → hub → controller → planes
- **State flow**: Planes → observers (via seqlock snapshots)

---

## 6. Consequences

### 6.1 Real-Time Safety

- **Lock-free**: No blocking syscalls in hot paths
- **Bounded latency**: Seqlock retries have configurable max attempts
- **Wait-free writes**: Ring enqueue is wait-free for producers
- **No priority inversion**: Can't happen without locks
- **Deterministic**: All operations have predictable worst-case timing

### 6.2 Architectural Clarity

- **Easy code review**: Violations are obvious

  - Multiple `bindController` calls? Reject.
  - Mutex in audio path? Reject.
  - Observer with write methods? Type error.

- **Clear mental model**:

  - Primitives = SWMR (planes) + SWSR (rings)
  - System = MWMR via composition (rings + hubs + observers)

- **Testable invariants**:
  - Static analysis can detect multiple controller bindings
  - Runtime validation can check ring producer counts
  - Type system prevents observer writes

### 6.3 Cross-Language Portability

- **C++/Wasm interop**: Primitives are atomics + layout

  - No mutex/IPC semantics to translate
  - Same ABI works in JS, Wasm, native C++
  - See ADR-010 for wire layout (64-byte header + u32 slots) and memory-ordering details

- **Platform neutrality**: No OS-specific primitives
  - Works in browser, Node, Electron, Tauri
  - Same code runs in main thread, workers, AudioWorklets

### 6.4 Scalability

- **System complexity scales independently of primitive complexity**:

  - Add more domains: each is still SWMR
  - Add more observers: each reads independently
  - Add more intent sources: each gets own ring

- **No contention growth**:
  - Writers don't coordinate with each other (only with hub)
  - Readers don't coordinate with each other (only with writer)
  - Hub is single-threaded, no internal locks

---

## 7. Summary

This ADR formalizes the MWMR model established by ADR-00Y, ADR-00Z, and ADR-010:

- **Primitives** (`@seqlok/core`): SWMR planes + SWSR rings
- **System** (`@seqlok/compose` + drivers): MWMR via composition
- **Hard rule**: "MWMR exists only at the system topology level, never at the primitive/memory level"

Any design that violates the invariants in section 3 or uses patterns from section 4 is architecturally incorrect and must be rejected.

This is the normative reference for:

- code review guidelines,
- architecture documentation,
- tooling and linters,
- C++/Wasm binding design,
- third-party integration contracts.
