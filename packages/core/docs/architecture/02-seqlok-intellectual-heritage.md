# Seqlok: Intellectual Heritage & Reading List

_A conceptual map of the ideas behind Seqlok_

Seqlok doesn't invent new physics – it assembles proven systems concepts and adapts them to JavaScript,
SharedArrayBuffer, Web Audio, Workers, and Wasm.

This document is a guided reading list and a map from "classic ideas" → "how Seqlok uses them."

---

## TL;DR

Seqlok = **Shared memory** + **Version numbers** + **Scope safety**

- 🔒 **SharedArrayBuffer** → Memory both threads can access
- 🔄 **Seqlocks** → Version numbers to detect mid-read changes
- 🎯 **RAII-style scoping** → “You only get access while inside this function”
- 👑 **SWMR** → One writer per data domain, many readers
- 🎛️ **CQRS** → Separate controls (params) from telemetry (meters)

Everything else is "just" making these patterns **deterministic, typed, and TypeScript-friendly**.

---

## Core Concepts & Their Origins

### 1. Memory Safety & Resource Management

#### RAII (Resource Acquisition Is Initialization)

**Concept in one sentence**
Tie the lifetime of a resource (file, lock, buffer) to a scope so it's automatically cleaned up when the scope ends.

**Reading**

- 📚 [Wikipedia: RAII](https://en.wikipedia.org/wiki/Resource_acquisition_is_initialization)
- 📚 [cppreference: RAII](https://en.cppreference.com/w/cpp/language/raii.html)
- 📚 [GeeksforGeeks: Resource Acquisition Is Initialization](https://www.geeksforgeeks.org/cpp-resource-acquisition-is-initialization/)

**How Seqlok applies this idea**

JavaScript doesn't have destructors, but Seqlok simulates RAII with **scope-bound callbacks**:

```ts
// processor side (real-time code)
processor.params.within((params) => {
  // safe, coherent view of all params in this audio quantum
  const gain = params.gain;
  const cutoff = params.cutoff;

  const output = this.dsp.process(input, gain, cutoff);

  processor.meters.publish((meters) => {
    meters.peak(output.peak);
    meters.rms(output.rms);
  });

  return output.signal;
});
```

- `within(...)` → access to **param views** is only valid inside the callback.
- `publish(...)` → access to **meter views** is only valid inside the callback.

You never get a "naked" view to store and use later. The scope _is_ the lifetime, which is RAII's core idea.

---

### 2. Lock-Free / Optimistic Synchronization

#### Seqlocks (Sequence Locks)

**Concept in one sentence**
Readers run without taking a lock, but they detect when a writer changed data mid-read (using a sequence number) and retry.

**Reading**

- 📚 [Linux Kernel: Sequence counters and seqlocks](https://docs.kernel.org/locking/seqlock.html)
- 📚 [Linux Inside: SeqLock](https://0xax.gitbooks.io/linux-insides/content/SyncPrim/linux-sync-6.html)
- 📚 [DPDK: `rte_seqlock`](https://doc.dpdk.org/api/rte__seqlock_8h.html)
- 📚 [Lock-free reads through data replication](https://www.dgoldblatt.com/lock-free-reads-through-data-replication.html)

**The "hard way" vs Seqlok**

Naive manual seqlock usage:

```js
// manual seqlock pattern with Atomics
let seqBefore: number;
let seqAfter: number;

do {
  seqBefore = Atomics.load(ctrlU32, SEQ_INDEX); // load sequence
  // ...read data from one or more typed arrays...
  seqAfter = Atomics.load(ctrlU32, SEQ_INDEX);
  // retry if writer was active or seq changed
} while (seqBefore !== seqAfter || (seqBefore & 1) === 1);
```

The Seqlok way:

```ts
// processor-side, coherent param read
processor.params.within((params) => {
  // all scalar and array params are coherent for this callback
  const { gain, cutoff } = params;
  const result = this.dsp.process(input, gain, cutoff);
  // no manual Atomics, no manual loops
});
```

**How Seqlok uses seqlocks**

- Param domain has a seqlock → `params.within(...)` uses it internally.
- Meter domain has a seqlock → `meters.publish(...)` (processor) and `meters.snapshot(...)` (controller) use it internally.
- Writers bump `LOCK`/`SEQ` in the relevant control plane.
- Readers retry until they see a stable `(LOCK, SEQ)` pair.

The API hides the seqlock dance but preserves its properties.

---

### 3. Concurrency Patterns & Ownership

#### SWMR (Single-Writer / Multiple-Reader)

**Concept in one sentence**
Exactly one actor is allowed to mutate a dataset; many actors may read from it concurrently.

**Reading**

- 📚 [HDF Group: Introduction to SWMR](https://support.hdfgroup.org/documentation/hdf5-docs/advanced_topics/intro_SWMR.html)
- 📚 [h5py: SWMR documentation](https://docs.h5py.org/en/stable/swmr.html)
- 📚 [MathWorks: SWMR example](https://www.mathworks.com/help/matlab/import_export/read-and-write-data-concurrently-using-single-writermultiple-reader-swmr.html)

**How Seqlok applies SWMR**

Seqlok uses SWMR as a **design rule** at the domain level:

- **Params:**

  - Single writer: Controller (UI / host).
  - Readers: Processor and any observers.

- **Meters:**

  - Single writer: Processor (real-time engine).
  - Readers: Controller and tools.

That discipline is enforced by API shape:

- No "write meters" on the controller.
- No "write params" on the processor.

This removes an entire class of "who is allowed to change this?" bugs.

---

#### CQRS (Command–Query Responsibility Segregation)

**Concept in one sentence**
Keep "things that change state" (commands) separate from "things that read state" (queries), often with different models.

**Reading**

- 📚 [Martin Fowler: CQRS](https://martinfowler.com/bliki/CQRS.html)
- 📚 [CQRS: A Deep Dive into Command Query Responsibility Segregation](https://solutionsarchitecture.medium.com/cqrs-a-deep-dive-into-command-query-responsibility-segregation-4fd83d79f756)

**Naive vs Seqlok**

Naive shared object:

```js
// ❌ naive shared state (racey, unstructured)
const state = {
  gain: 1.0,
  peak: 0.0,
};

// UI:
state.gain = slider.value; // writes
console.log(state.peak); // reads

// audio thread:
const gain = state.gain; // reads
state.peak = computePeak(buffer); // writes

// no ownership, no separation, potential torn reads if shared
```

Seqlok's CQRS-style split:

```ts
// ✅ controller side (UI / host)
controller.params.set("gain", slider.value);
const meters = controller.meters.snapshot();
console.log(meters.peak);

// ✅ processor side (RT engine)
processor.params.within((params) => {
  const gain = params.gain;
  const output = this.dsp.process(input, gain);

  processor.meters.publish((m) => {
    m.peak(output.peak);
  });
});
```

**How Seqlok applies CQRS**

- **Commands** → params (what the controller wants the device to do).
- **Queries** → meters (what the device is currently doing / reporting).

Seqlok applies CQRS **at the shared-memory boundary**, not just at API or HTTP level.

---

### 4. JavaScript Platform Foundations

#### SharedArrayBuffer & Atomics

**Concept in one sentence**
SharedArrayBuffer gives JavaScript agents a common block of memory; Atomics provides the operations needed to synchronize safely over that memory.

**Reading**

- 📚 [MDN: SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
- 📚 [MDN: Atomics](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics)
- 📚 [How to achieve parallelism for SharedArrayBuffer and Atomics](https://stackoverflow.com/questions/45230334/how-to-achieve-parallelism-for-sharedarraybuffer-and-atomics)
- 📚 [What JavaScript SharedArrayBuffer Actually Lets You Do](https://medium.com/@AlexanderObregon/what-javascript-sharedarraybuffer-actually-lets-you-do-9589f449fd75)
- 📚 [SharedArrayBuffer and Memory Management in JavaScript](https://medium.com/@artemkhrenov/sharedarraybuffer-and-memory-management-in-javascript-06738cda8f51)

**Naive vs Seqlok**

Naive SAB usage:

```js
// ❌ hand-rolled plan
const sab = new SharedArrayBuffer(1024);
const f32 = new Float32Array(sab);
const u32 = new Uint32Array(sab);

// somewhere you decide:
// gain at index 0
// cutoff at index 1
// peak at index 10
// plus some magic indices for versioning

// no schema, no safety, lots of magic numbers.
```

Seqlok approach (canonical flow):

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    gain: param.f32({ min: 0, max: 2 }),
    cutoff: param.f32({ min: 20, max: 20_000 }),
  },
  meters: {
    peak: meter.f32(),
  },
}));

// owner / controller side
const plan = planLayout(spec);
const backing = allocateShared(plan);
const controller = bindController(spec, backing);
const handoff = buildHandoff(plan, backing);

// send `handoff` to the processor agent (worker / AudioWorklet)
const received = receiveHandoff(handoffFromMain);
const processor = bindProcessor(received);
```

Seqlok uses SAB/Wasm as the raw medium, but:

- The **Spec** describes structure.
- The **Plan** computes deterministic layout.
- The **Backing** allocates the actual memory.
- The **Handoff** carries "this plan + this backing" to other agents.
- The **Bindings** expose it as safe, typed controller/processor APIs.

---

## The Synthesis

All of the above combine into Seqlok's core model:

```text
RAII-style scoping   +   seqlock synchronization   +   SWMR & CQRS discipline
        ↓                         ↓                             ↓
 within()/publish()        coherent snapshots          param/meter separation
        ↓                         ↓                             ↓
 scoped access to          fast, retryable reads       clear ownership & roles
 shared views              and atomic commits          (controller vs processor)
```

On top of that sits the structural pipeline:

```text
Spec  →  Plan  →  Backing  →  Handoff  →  Bindings
(what)   (plan)  (memory)    (wire)      (API)
```

- **Spec**: declarative description of params + meters.
- **Plan**: deterministic memory plan (planes, offsets, seqlock slots).
- **Backing**: actual SharedArrayBuffer / WebAssembly.Memory allocation.
- **Handoff**: compact description that lets another agent reconstruct views safely.
- **Bindings**:

  - Controller: `bindController(spec, backing)` on the owner side.
  - Processor: `receiveHandoff(handoff)` → `bindProcessor(received)` on the engine side.

---

## Mental Models for Seqlok

These analogies help new developers reason about the system.

### Audio Mixer Model

- **Params** = knobs and faders.
- **Meters** = LED bargraphs showing levels.
- **Seqlocks** = “do not read while a big atomic change is being applied.”
- **SWMR** = one person is allowed to move each fader; everyone may look.

### Recipe Card Model

- **Params** = a complete recipe card you hand to the chef.
- **Meters** = the chef’s report: “texture looks good”, “temperature is 180°C”.
- **`within`** = “read the whole recipe at once, then cook based on that.”
- **`publish`** = “write out the results in one coherent update.”

### 🏎️ Race Pit Stop Model

- **Params** = instructions to the driver (pace, tire strategy).
- **Meters** = telemetry coming from the car (speed, tire temp).
- **SWMR** = only the crew chief talks to the driver; everyone else just listens.
- **Seqlocks** = make sure you don’t read a half-updated telemetry packet.

---

## From Naive Shared State to Seqlok

A concrete "aha" comparison:

```js
// ❌ naive shared mutable state (conceptual)

// UI thread:
audioParams.gain = slider.value;

// audio thread:
const gain = audioParams.gain; // could see a half-write if truly shared
```

You'd need custom locking, manual versioning, and disciplined usage to make this safe.

```ts
// ✅ Seqlok-style

// controller / UI:
controller.params.set("gain", slider.value);

// processor / audio:
processor.params.within((params) => {
  const gain = params.gain; // coherent with all other params
  const out = this.dsp.process(input, gain);

  processor.meters.publish((m) => {
    m.peak(out.peak);
    m.rms(out.rms);
  });
});
```

The **only way** to touch shared state is via `within` / `publish` / `snapshot`, so the concurrency rules are baked into
the API.

---

## Learning Path for New Developers

### Start Here (Beginner)

1. **RAII & scoping**
   Understand "resource lives for a scope" and map that to `within` / `publish`.

2. **SWMR**
   Learn why "one writer, many readers" simplifies ownership.

3. **SharedArrayBuffer basics**
   Know what SAB is and why browsers restrict it.

### Then Dive Deeper (Intermediate)

4. **Seqlocks**
   See how sequence numbers enforce coherent reads in read-mostly structures.

5. **CQRS**
   Recognize the benefit of separate command and query models.

6. **Atomics**
   Practice with `Atomics.load/store/add` and understand visibility guarantees.

### Advanced Topics (Expert)

7. Compare **seqlocks vs RCU vs classic locks**.
8. Study **cache coherence** and false sharing for performance tuning.
9. Look at **Linux kernel / DPDK** seqlock usage and map those patterns to Seqlok's plan.

---

## For Code Reviewers

When reviewing Seqlok usage:

- ✅ **Scoped access (RAII-style)**

  - All param/meter interaction goes through `within`, `publish`, or `snapshot`.
  - No long-lived references to internal views escape callbacks.

- ✅ **SWMR discipline**

  - Only the controller writes params.
  - Only the processor writes meters.

- ✅ **Seqlock correctness**

  - No direct, concurrent access to shared primitives outside the bindings.
  - All coherent reads use the provided helpers.

- ✅ **CQRS separation**

  - Params are used as **inputs** (commands), meters as **outputs** (telemetry).
  - No "hidden command" encoded in meters or "hidden telemetry" stored in params.

If these invariants hold, the code is aligned with Seqlok's design principles and with the literature linked above.

---

## Glossary (Quick Reference)

- **RAII** — Resource lifetime tied to scope/lifetime of an object or block.
- **Seqlock** — Synchronization primitive using a sequence counter; readers retry if writers changed data mid-read.
- **SWMR** — Single-Writer / Multiple-Reader; exactly one writer per dataset, many readers.
- **CQRS** — Command–Query Responsibility Segregation; separate models for “doing” and “asking.”
- **SharedArrayBuffer (SAB)** — Shared memory buffer usable across workers/agents in JS.
- **Atomics** — JS operations (`Atomics.load`, `Atomics.store`, etc.) that provide ordering and atomicity on shared memory.
- **Params** — Seqlok’s domain for control inputs (what the controller asks the device to do).
- **Meters** — Seqlok’s domain for telemetry outputs (what the device reports back).
- **Controller** — Side that owns params and reads meters (typically UI/host).
- **Processor** — Side that reads params and owns meters (typically RT/DSP/worker code).
