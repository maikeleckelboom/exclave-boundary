# 📘 Seqlok Architecture: From Pipe to Hub

_A story for newcomers_

Welcome to Seqlok. To understand why the system looks the way it does (MWMR, rings, hubs, observers), it helps to start
from the simplest thing that could possibly work and watch where it breaks.

We didn't build a complex system because we wanted to. We built it because the simple version hit a wall.

---

## Phase 1: The Simple Pipe (SWSR)

**“One writer holds the pen. Everyone else watches.”**

Imagine a shared whiteboard (shared memory) between the Main Thread (UI) and the Audio/Physics Thread (Worker).

- **The rule:** Only **one person** is allowed to hold the marker.
- **The flow:**

  - **Controller (UI):** Writes `Volume = 0.8` on the board.
  - **Processor (Worker):** Reads `Volume = 0.8` and makes sound / updates physics.
  - **Processor (Worker):** Writes `Peak Level = –3 dB` on a different part of the board.
  - **Controller (UI):** Reads `Peak Level` and draws a meter.

This is **SWSR** (Single-Writer, Single-Reader). It’s incredibly fast because there are no arguments over who holds the
marker.

A simple **seqlock** (a version number) makes sure we don’t read while the other person is in the middle of writing: the
writer bumps the version while updating; the reader checks that it didn't change during the read.

### Where it starts to crack

Now plug in a **MIDI keyboard**.

- The UI wants to write "Volume = 0.8".
- The MIDI handler wants to write "Note On: C3" at the same time.

They're both reaching for the marker. If they touch the same shared memory directly, you get race conditions and
glitches.

The "one pipe between two parties" model is too simple for real apps.

---

## Phase 2: The "Noisy Room" Problem

**“Too many people want to talk to the engine.”**

Real apps don't look like "one UI talking to one engine". They look more like a noisy control room.

- **Writers:**

  - Mouse
  - Keyboard
  - MIDI hardware
  - Network (multiplayer / sync)
  - Automation / AI scripts

- **Readers:**

  - React UI
  - WebGPU or Canvas visualizer
  - Analytics / telemetry
  - Recorder / logger

If we let everyone walk up to the whiteboard and scribble directly, we get:

- Writers overwriting each other's changes.
- Readers seeing half-updated state ("torn frames").
- Subtle, timing-sensitive bugs when two things happen at once.

We want the _flexibility_ of **Many Writers, Many Readers (MWMR)** at the system level, but we still want the _safety
and speed_ of **one writer per memory domain**.

So we need another idea.

---

## Phase 3: The "Mailbox" Solution (System-Level MWMR)

**“Don’t write on the board. Send a memo.”**

The key move is: **move complexity into the topology**, not into the raw memory.

Instead of letting every source poke at shared memory, we introduce **mailboxes** and a **hub**.

### 1. Fan-In – Many writers → one hub

Think of a **ring buffer** as a high-speed **mailbox**:

- Writers don't touch the whiteboard.
- Writers drop small messages into their mailbox.
- A single hub opens the mail, decides what to do, and then writes to the board.

Concretely, the pattern looks like this:

- **Writers (MIDI, UI, Network, etc.):**

  - They don't write to the params memory.
  - They drop **commands** like "Play", "Seek to frame 123456", "Set rate to 1.25" into their own mailbox (ring).
  - This is fast, non-blocking, and doesn't require locks.

- **The Hub (typically on the controller side):**

  1. Opens all the mailboxes.
  2. Reads whatever commands arrived.
  3. Applies policy ("What should win? What do we ignore? How do we merge?").
  4. Updates the shared params memory **once**, as the single writer.

From the outside, it feels like "many writers". From the memory's point of view, there is still exactly **one** writer:
the hub.

> **Golden idea:** MWMR lives in how components are connected (the system topology), not inside the low-level memory
> primitive. Under the hood, the shared memory still follows SWSR.

### 2. Fan-Out – One state → many observers

Now flip the direction: many different parts of the app want to _read_ what the engine is doing.

- The UI wants to show a level meter.
- A visualizer wants dense, coherent frames at 60 fps.
- Analytics wants aggregated stats.

If they all poke at the same memory in ad-hoc ways, you get incoherent reads and hard-to-reproduce timing bugs.

So we introduce **observers**:

- An **Observer** is like a security camera pointed at the shared memory.
- It can take a **snapshot** of the state at any time.
- It is **read-only**, so you can have 1, 10, or 100 observers without affecting the engine.

Different readers can use different strategies:

- A **cold path** (like a React UI) might take snapshots less frequently and be okay with “best effort” freshness.
- A **hot path** (like a WebGPU visualizer) might use a stricter seqlock-based loop to get coherent frames even under
  heavy load.

The important part: **none of these observers become writers**. The engine and the controller keep ownership of their
respective write domains.

---

## How the packages map to this story

Once you have this mental picture (whiteboard → noisy room → mailboxes + hub + cameras), the package structure becomes
easier to remember.

These descriptions are intentionally informal — they're here to build intuition, not to replace the technical reference.

### `@seqlok-internal/prototype-core` – the physics

You can think of `core` as the **physics engine** of the shared state:

- It knows how to manage shared memory safely and fast.
- It knows about:

  - the **seqlock** (versioning protocol for SWSR reads/writes),
  - the **shared buffer layout**,
  - and a primitive **ring** implementation you can use as a mailbox.

- It does **not** know what your app's commands mean. As far as `core` is concerned, it's all just bytes and numbers
  moving around.

### `@seqlok/compose` – the blueprint

You can think of `compose` as the **blueprint and wiring**:

- It answers questions like:

  - “How many domains do I have?”
  - “Which ones are controllers, processors, observers?”
  - “Where do I put mailboxes (rings)? Who writes to which mailbox?”

- It helps you go from a _topology description_ ("I have one engine, one hub, these rings…") to a wired set of bindings
  and buffers.
- It doesn't decide what a "PLAY" command does; it just helps you route and organize the pipes and mailboxes.

### Your driver / application – the logic

Finally, there's **your application code**, which plugs Seqlok into a concrete product:

- It defines **what the commands mean**:

  - “When I see a `PLAY` command on this ring, set this param to 1."
  - “When I see an `ENGINE_SWAP` command, schedule a swap at this frame."

- It runs the **hub loop**:

  - Drains mailboxes each tick.
  - Applies policy (priority, modes, conflict resolution).
  - Mutates controller bindings accordingly.

- It also decides how to use observers:

  - Which visualizers to run.
  - How often to sample.
  - How to map meters into visuals.

In short:

- `core` cares about **how** bytes move safely.
- `compose` cares about **where** things are connected.
- Your application cares about **what** those messages _mean_ in your domain.

---

## A note about "command" as its own thing

You might eventually see references to a dedicated "command" layer or helpers (for example, a `CommandRing<T>` type or
common command utilities).

The idea there is:

- Keep `core` focused on primitives (rings, seqlocks, shared memory).
- Potentially have a small, reusable set of helpers for "rings that carry commands".
- Let `compose` focus on wiring those rings into larger topologies.
- Let your application stay in charge of actual behavior and policy.

For now, it's enough to remember the big picture:

> Use mailboxes (rings) and a hub to keep the **memory** simple (SWSR) while the **system** feels flexible (MWMR).
> Seqlok's packages just help you separate those concerns cleanly.
