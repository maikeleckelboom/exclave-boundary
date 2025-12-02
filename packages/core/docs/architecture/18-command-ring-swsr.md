# SWSR Command Ring

**Status:** Draft – targeted for `@seqlok/core` v0.3.0
**Audience:** Engine orchestration, Dekzer driver, infra

This document specifies a **Single-Writer Single-Reader (SWSR) command ring** used to
send discrete commands (events) from a control role (UI / driver / host) to a
real-time role (processor / audio engine) over shared memory.

It is deliberately narrow:

- Exactly **one writer** and **one reader** per ring.
- Fixed capacity.
- Bounded, predictable behaviour under pressure.
- No implicit command dropping.

This ring is for **discrete events** (commands), not continuous parameters. For
continuous parameters, Seqlok params/meters remain the primary mechanism.

---

## 1. Roles and Responsibilities

### 1.1 Writer role

Typical examples:

- UI / main thread in Dekzer.
- “CompositeDriver” that converts high-level app actions into low-level commands.

Responsibilities:

- Construct well-formed command payloads.
- Enqueue commands in FIFO order via the ring.
- Respect backpressure (handle `push` failures explicitly).
- Avoid unbounded command spam (coalesce where reasonable).

### 1.2 Reader role

Typical examples:

- AudioWorklet processor controlling a pair of engines.
- Offline processor driving render passes.

Responsibilities:

- Poll/dequeue commands in FIFO order.
- Apply commands atomically and deterministically to local state.
- Bound worst-case work per audio block (e.g. max commands per block).
- Expose any relevant state to Seqlok meters/params.

---

## 2. Command Model

A **command** is a small, fixed-layout record with:

- A **kind** (discriminant).
- A small **payload** (immediate arguments, IDs, scalar values).
- Optional **sequence number** or **timestamp** (for debugging/telemetry).

Conceptually:

- Commands are **at-most-once**: each enqueued command is processed zero or one
  time, never more than once.
- Commands are **in-order**: if writer enqueues `A` then `B`, reader observes
  `A` before `B`.

### 2.1 Example command kinds (Dekzer-flavoured, but generic)

The spec does not freeze the exact set, but it assumes a small discriminated union
shape like:

- `LOAD_TRACK` – attach/replace audio source for a deck.
- `SPAWN_ENGINE` – create a new engine instance (varispeed/stretch/etc.).
- `PRIME_ENGINE` – warm up an engine, optionally with preview reads.
- `ISSUE_SWAP_TICKET` – schedule crossfade from engine A → B at a given frame.
- `SET_ENGINE_PARAM` – discrete param change (e.g. change stretch mode).
- `COMPACT_STATE` – optional housekeeping (e.g. retire engines).

Constraints for payloads:

- Payloads are **POD-style** (plain old data): numbers, small enums, fixed-size
  string IDs or indices.
- No nested pointers, no JS object graphs, no allocations on the hot path.
- All payloads are **fully determined** at enqueue time; reader never performs
  “late binding” lookups that depend on host mutable JS objects.

---

## 3. Ring Semantics

### 3.1 Basic model

The ring is modelled as:

- A fixed-capacity array of slots, `capacity = 2^k` (for cheap masking).
- Two monotonically increasing indices:
  - `writeIndex` – next slot the writer will fill.
  - `readIndex` – next slot the reader will consume.

Derived quantities:

- `size = writeIndex - readIndex` (number of enqueued-but-unread commands).
- Ring is **empty** if `size === 0`.
- Ring is **full** if `size === capacity`.

Both indices are unbounded monotonically increasing counters; physical positions
are `(index & (capacity - 1))`.

### 3.2 Single-Writer, Single-Reader guarantees

Because there is exactly one writer and one reader:

- Writer is the **only** agent that mutates `writeIndex` and the contents of the
  slot it is currently writing.
- Reader is the **only** agent that mutates `readIndex` and the logical "ownership"
  of the slot it is consuming.
- No locks are required; progress is governed by a small number of atomic ops.

Memory ordering constraints (conceptual):

- Writer must **write payload first**, then publish the new `writeIndex`.
- Reader must **observe `writeIndex`**, then read payload from slots where
  `readIndex < writeIndex`.

Implementation details (Atomics, fences) are left to code, but the spec requires:

- A reader never sees partially-written payloads.
- A writer never overwrites a slot that still belongs to the reader.

---

## 4. Backpressure and Overflow Policy

The command ring **must not silently drop** commands.

When the writer attempts to enqueue into a full ring, `push` **fails explicitly**.
The call contract is:

- `push(command)` → returns `true` on success, `false` on failure.
- No internal retries or blocking; the caller controls the degradation strategy.

Recommended writer strategies when `push` fails:

- **Coalesce**: merge successive logical actions into a single later command
  (e.g. many tiny pitch nudges into one final value).
- **Defer**: schedule a retry on the next animation frame / tick.
- **Escalate**: emit a telemetry meter or log indicating command pressure.

Non-goals:

- The ring will not:
  - Spin-wait until there's room.
  - Decide on its own which commands to drop.
  - Resize dynamically (capacity is fixed by design).

Capacity guidance (for docs, not enforced by code):

- Choose capacity such that, for expected peak usage, the reader can drain the
  ring within **one or a few audio blocks** without starving audio work.
- Example heuristic: `capacity >= maxCommandsPerBlock * maxBufferedBlocks`.

---

## 5. Error Handling and Instrumentation

The ring itself is a low-level primitive and does not throw on normal pressure.

Error surfaces:

- **Usage errors** (e.g. misconfigured capacity, illegal indices) are guarded
  at construction time, not at runtime.
- **Operational pressure** is surfaced via `push` returning `false`.

Instrumentation is handled externally via Seqlok meters, e.g.:

- `commandQueue.size` – current queue depth.
- `commandQueue.droppedWrites` – cumulative count of failed `push` attempts.
- `commandQueue.maxObservedDepth` – high-water mark for tuning capacity.

These meters give you dashboard visibility without baking policy into the ring.

---

## 6. Integration with Seqlok

### 6.1 Relationship to params/meters

The command ring carries **discrete events**. Seqlok params/meters carry **state**.

Recommended split:

- Use **params** for continuous, sample-accurate numbers:
  - playback rate, semitone offset, wet/dry mix, etc.
- Use **commands** for "things that happen":
  - load a new track, spawn a new engine, schedule a swap, jump to cue.

Pattern:

- Writer:
  - Uses Seqlok **controller** to update current param values.
  - Uses **command ring** to request structural/state transitions.
- Reader:
  - Uses Seqlok **processor** to read params within an audio block (`within`).
  - Uses **command ring** to process queued events before/after sample loops.

This keeps the ring lean and avoids asking it to be a param transport.

### 6.2 Where the ring lives

The SWSR ring is expected to be backed by:

- A dedicated **SharedArrayBuffer** or a **plane** within a larger Seqlok backing.

But it is **not** part of the canonical spec → plan → backing → handoff DSL.

Instead:

- The ring is a "sidecar" protocol layered beside Seqlok:
  - It may use Seqlok allocation helpers or companion types.
  - It does not affect the params/meters layout or hashes.
  - It is versioned and documented as a separate protocol.

---

## 7. Canonical Flows

This section defines "golden" end-to-end sequences for the ring.

These scenarios will be reflected in both tests and higher-level docs.

### 7.1 Canonical Flow 1 – Load and Play Track

**Goal:** UI requests a new track; processor eventually plays it.

1. Writer (UI) enqueues `LOAD_TRACK` with:

- `deckId`
- `trackId`
- `startPosition` (in samples or seconds)

2. Push succeeds (`true`).
3. Reader (processor) on next audio block:

- Dequeues `LOAD_TRACK` (and any preceding commands).
- Resolves `trackId` against its local registry (or shared map).
- Prepares decoder/stream for the deck.
- Optionally sets a `trackLoaded` meter to signal readiness.

4. Writer sees readiness through:

- Observer reading meters:
  - `trackLoaded` (boolean or enum).
  - `decoderWarmth` or other telemetry.

The ring delivers the **event**, Seqlok meters corroborate the **state**.

### 7.2 Canonical Flow 2 – Engine Swap via SwapTicket

**Goal:** Seamlessly swap from Engine A → Engine B using the hysteresis protocol.

Assumptions:

- Engine A is active.
- Engine B has been spawned but not yet made live.

Sequence:

1. Writer enqueues `SPAWN_ENGINE` with:

- `deckId`
- `engineKind = 'stretch' | 'varispeed' | ...`
- `engineId` (new unique ID)

2. Reader:

- Dequeues `SPAWN_ENGINE`.
- Allocates/configures Engine B in **idle/warming** state.

3. Once Engine B is warmed (internal logic):

- Reader may update a meter like `engineWarmth[engineId]`.

4. Writer, observing meters, decides swap is safe:

- Enqueues `ISSUE_SWAP_TICKET` with:
  - `deckId`
  - `oldEngineId` (A)
  - `newEngineId` (B)
  - `activateAtFrame` (sample-accurate time)
  - `crossFadeDurationFrames`

5. Reader:

- Dequeues `ISSUE_SWAP_TICKET`.
- Schedules crossfade in its internal timeline.
- At `activateAtFrame`, starts crossfade:
  - A's contribution fades → 0.
  - B's contribution fades → 1.
- After crossfade, marks A as **retired** and B as **live**.

Key invariant enforced by the ring:

- There is a precise, ordered record of the life-cycle:
  - spawn → warm → ticket → swap completion.
- No "half-seen" swaps: either the ticket is processed or it isn't, but it won't
  vanish silently.

### 7.3 Canonical Flow 3 – High-frequency Nudge / Coalescing

**Goal:** Handle rapid UI tweaks (e.g. jog wheel nudges) without flooding the ring.

Pattern:

1. UI generates many small logical actions (`+1`, `-1` pitch nudge).
2. Instead of enqueuing every single nudge:

- The writer maintains local, non-shared accumulator state.
- Periodically enqueues a single `SET_ENGINE_PARAM` with the **current**
  desired value.

3. If `push` fails:

- Writer drops the failed command but keeps local accumulator.
- Next tick, attempts another `SET_ENGINE_PARAM` with latest value.

4. Reader:

- Applies latest observed value in-order when dequeued.

The ring thus carries **coalesced state transitions**, not every intermediate twitch.

---

## 8. Non-Goals

- **No MWMR**: this ring does not support multiple writers or readers. MWMR is
  handled at a higher level via composition (multiple SWSR rings, observers, etc.).
- **No dynamic resizing**: capacity is fixed at creation time.
- **No implicit dropping**: all drops are explicit and visible via return values
  and/or meters.
- **No RPC semantics**: no built-in replies or acknowledgements; responses are
  modelled via Seqlok meters or separate mechanisms.

---

## 9. Future Extensions (Out of Scope for v0.3.0)

These are explicitly deferred:

- Priority classes (e.g. "real-time" vs "best-effort" commands).
- Multi-queue scheduling (separate rings for transport vs engine management).
- Formal verification of the ring using TLA+ or similar.

For v0.3.0, the goal is a small, auditable SWSR primitive with:

- Clear invariants.
- Documented backpressure.
- A few well-specified canonical flows that Dekzer and other apps can lean on.
