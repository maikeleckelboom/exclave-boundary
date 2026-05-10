# Seqlok — Public Story

> **Classification:** Public story / blog essay. Not a canonical API reference.  
> This document explains why Seqlok exists, where it fits, and what kind of problem it is built to solve.

---

## 1. Why this exists

Seqlok came from a very specific frustration.

If you build real-time systems on the web, you eventually hit a boundary that feels much worse than it looks on paper.

The UI thread is comfortable. It is expressive, productive, and forgiving. You can move quickly there. State libraries
feel nice. `requestAnimationFrame` feels close enough to live. DevTools are excellent. Everything invites iteration.

Then there is the other side: the loop that actually has timing pressure.

That might be an `AudioWorklet`. It might be a worker driving a simulation. It might be a worker feeding a graphics
pipeline. Whatever it is, it wakes up and expects the data it needs to already be present, already coherent, and cheap
to read.

That side does not care that the UI is elegant. It does not care that your state library is ergonomic. It does not care
that a message usually arrives quickly enough.

It cares about one thing: whether the data is there, complete, and safe to consume inside the time budget.

That is the gap Seqlok was built for.

Not general worker messaging. Not app-wide state management. Not collaborative data. Not a new framework. Just this
problem:

**How do you move live state across a thread boundary when one side is timing-sensitive, readers cannot tolerate
half-written state, and the hot path has to stay allocation-free?**

That is the whole story.

---

## 2. What Seqlok is not

It is important to say this plainly, because a lot of engineering waste starts when a tool is used outside its natural
territory.

Seqlok is not for most applications.

If you are building a dashboard, admin panel, editor, or standard SaaS product, do not use this. If your updates happen
a few times per second and a small delay is fine, do not use this. If cross-thread state is just an implementation
detail, do not use this.

Use `postMessage`. Use a clean protocol. Keep your system simple.

Those tools are better for the majority case.

Seqlok is for the narrower case where the timing budget is real and the consequences of inconsistency are visible.

That usually means some combination of the following:

- a loop with genuine timing pressure
- UI-driven parameters that must be visible immediately
- live output flowing back the other way
- a system where a couple of milliseconds can become a glitch, a frame miss, or user-visible instability

Audio is the clearest example, which is why Seqlok started there. But the shape is broader than audio. The underlying
issue is the same any time one part of the system is soft and human-facing while another part is tight, repetitive, and
intolerant of jitter.

---

## 3. The core idea

Seqlok is built around a simple attitude:

**Do not turn the thread boundary into magic.**

That sounds obvious, but a lot of systems do exactly that.

They hide ownership. They blur who is allowed to write what. They treat transport format, authored meaning, and runtime
layout as one collapsed blob. They let shared state spread without a clear contract. Then six months later the system
still works, but nobody fully trusts it.

Seqlok goes the other way.

It makes ownership explicit. It makes layout deterministic. It makes handoff explicit. It makes the hot path narrow and
disciplined. It accepts that a thread boundary is a real boundary and treats it like one.

That decision drives everything else.

---

## 4. Single writer per domain

The first hard rule is ownership.

Shared state is split into domains, and each domain has exactly one writer.

In the common setup there are two domains.

**Params domain** is UI to real-time. These are values the host or controller owns: gain, cutoff, mode, envelopes,
transport settings, feature toggles, and so on.

**Meters domain** is real-time to UI. These are values the processor owns: RMS, peak, counters, timing stats, analysis
values, and similar outputs.

That rule is intentionally strict.

The moment both sides are allowed to sometimes write the same piece of state, you no longer have a bridge. You have
shared mutability with ambiguous authority, which is where trust starts to collapse.

So Seqlok does not allow that ambiguity.

The controller owns inputs. The processor owns outputs. If some data does not fit that model, it probably belongs on a
different channel.

That is not a weakness. That is the boundary doing its job.

---

## 5. A compiled layout, not a bag of offsets

The second decision is that memory layout must be derived, not improvised.

The bad version of this kind of system is easy to imagine: a pile of manually maintained offsets, comments explaining
why something starts at byte 32, and enough hidden coupling that nobody wants to touch it.

Seqlok refuses that route.

Instead it follows a deterministic pipeline:

```text
Spec      → declaration of fields, types, domains, and authored meaning
Plan      → deterministic memory layout, offsets, sizes, slot tables
Backing   → actual shared memory plus typed views
Handoff   → explicit descriptor sent across the boundary
Bindings  → role-specific APIs reconstructed on each side
```

Each stage has one job.

The spec says what exists.
The plan decides where it lives.
The backing stores it.
The handoff describes it.
The bindings expose the legal surface for a given role.

That is more disciplined than ad hoc shared memory, and that discipline buys real things:

- independent agreement on layout from the same declaration
- explicit drift detection instead of silent mismatch
- better failure modes when assumptions break
- a system that can be audited in a diff instead of guessed at from runtime behavior

This matters because shared memory becomes dangerous very quickly once the layout stops being mechanically derived.

---

## 6. Why seqlocks

Once ownership is clear, the next problem is coherence.

A reader on the timing-sensitive side must never see half-written state.

At the same time, blocking is the wrong tool for the hottest path in this environment. In particular, on the audio side,
blocking is simply not acceptable.

That is why Seqlok uses seqlocks.

The writer marks a domain as being written, performs the write, then marks it complete and bumps the sequence.

The reader checks whether a write is in flight, reads the sequence, reads the data, then checks the sequence again. If
the sequence changed, it retries.

That gives readers a very useful guarantee: they either see a coherent snapshot or they try again. They never proceed
with torn state.

There are other correct concurrency strategies. Seqlocks are not the only legitimate answer. They are just a very good
fit for read-heavy paths where readers must stay cheap and non-blocking.

That is the kind of trade Seqlok keeps making. Not universally optimal. Correct for this lane.

---

## 7. Three layers that stay separate

One of the stronger parts of the design is that Seqlok does not collapse authored meaning, runtime contract, and
transport representation into one thing.

Those are three different layers.

**Authored meaning** is what the spec expresses. Names, labels, units, ranges, and human-readable intent.

**Runtime contract** is what planning produces. Offsets, typed planes, slot tables, lock words, sequence layout, and
exact memory structure.

**Transport representation** is the raw data in memory. Numbers, atomic words, floating-point values, integer enum tags.

Why keep those separate?

Because if you collapse meaning into transport, the wire representation starts owning too much. And if you collapse
meaning into layout, your semantics start leaking into offsets and implementation trivia.

Both routes produce systems that are harder to evolve and harder to trust.

Seqlok keeps the human-facing layer human, the contract layer deterministic, and the transport layer primitive.

That separation is why you can have a spec that still reads like authored intent while the underlying storage remains
dense numeric shared memory.

The machine gets the primitive representation it wants. The developer gets an API that still feels like authored
software instead of byte arithmetic.

---

## 8. Hot path versus cold path

Another important boundary in Seqlok is execution cost.

Not every API belongs under the same expectations, and pretending otherwise would be dishonest.

The processor-side operations are hot-path operations. They live inside timing-sensitive code and are designed around
that constraint.

That is where operations like these live:

- `params.within(...)`
- `meters.publish(...)`

They are meant to stay bounded and allocation-free.

Other parts of the system are cold-path or setup-path work:

- declaring the spec
- planning the layout
- allocating backing memory
- constructing the handoff
- receiving the handoff
- taking snapshots
- host-side writes and diagnostics

Those can optimize for explicitness, clarity, and ergonomics instead.

This split matters because it makes the runtime contract visible in the API shape itself. The library is telling you
which surfaces belong near the hot loop and which ones do not.

That is good design. The interface should teach the user how the system expects to be used.

---

## 9. Failure should be honest

Seqlok sits low enough in the stack that most failures are really contract failures.

If the producer and consumer disagree about the spec, that is not a minor runtime inconvenience. If the environment
cannot safely provide shared memory, that is not something to wave away. If the backing is too small for the planned
layout, the system is simply not valid.

So Seqlok fails clearly.

It does not try to be clever about broken assumptions.

Examples include:

- spec hash mismatch
- backing too small for the layout
- unsupported environment for safe `SharedArrayBuffer` use
- invalid or mismatched handoff state

The point is not to be harsh. The point is to keep the boundary trustworthy.

A low-level system that silently recovers from invalid assumptions often becomes harder to reason about than one that
simply stops and explains what failed. Higher layers can decide what recovery means. Seqlok's job is to make the failure
legible.

---

## 10. Why build this on the web

A reasonable response to all of this is: why do this on the web at all?

The answer is not ideological. It is practical.

For many products, the web already provides the platform surface you want:

- easy distribution
- frictionless updates
- access to Web Audio, MIDI, HID, WebGPU, and related APIs
- shared memory primitives through `SharedArrayBuffer` and `Atomics`

So the real question is not whether the web is perfect. It is not.

The real question is this:

**Given that this is already the platform, how do we build the sharpest possible thread boundary inside it?**

Seqlok is one answer.

It does not pretend the browser becomes hard real-time because you used a better memory protocol. That would be
nonsense. What it does do is respect the timing-sensitive parts that actually exist and stop feeding them avoidable
jitter through generic messaging patterns.

---

## 11. Where it fits with other tools

Seqlok makes more sense when you stop asking whether it replaces other tools and ask where it belongs next to them.

It does not replace collaborative state systems. CRDT-based systems solve a very different problem: multi-writer,
distributed, often offline-capable state.

It does not replace `postMessage` for ordinary worker traffic. That is still the right choice most of the time.

It does not replace every form of locking. Other concurrency strategies remain valid in other environments.

A serious system might use all of these together.

For example:

- project or document state in a collaborative model
- commands and events over message passing
- timing-sensitive params and meters through Seqlok

That is not overlap. That is each tool staying in its lane.

---

## 12. What stayed constant

Looking back, the implementation details changed more than once. But the center stayed the same.

Seqlok has always been about a few stubborn principles:

- explicit ownership
- deterministic planning
- explicit handoff
- no ambient registry
- no magic thread-boundary discovery
- no pretending the hot path and the setup path are the same kind of environment

That consistency is what gives the system its shape.

It is also why Seqlok ends up feeling calmer than many lower-level shared-memory designs. The system is not trying to be
clever. It is trying to be inspectable.

That is the real goal.

The bridge between a UI and a timing-sensitive loop should not be mysterious. It should not be cute. It should not be a
pile of hidden coupling.

It should be explicit, mechanical, and boring enough that you can trust it.

That is what Seqlok is trying to become.

---

## Appendix: Structural reference

### Golden flow

```text
declared spec
  → deterministic layout
    → shared backing
      → explicit handoff
        → accepted handoff
          → owner-side binding
            → processor-side binding
```

### SWMR domains

```text
Params domain
  One owner, one writer: host / controller
  Many readers: processor, diagnostics, mirrors

Meters domain
  One owner, one writer: processor
  Many readers: host / controller, visualizers, loggers
```

### Seqlock state machine per domain

```text
   even ──[writer begins]────► odd
      ▲                        │
      └─[writer ends, seq++]───┘

even  readers may proceed if sequence stays stable
odd   readers back off and retry
```

### Hot / cold boundary

```text
COLD  — spec declaration, planning, backing allocation,
        handoff construction and receipt

────────────────────────────────────────────────────

HOT   — params.within, meters.publish
        processor side, bounded and allocation-free

COLD  — controller writes, snapshot reads
        host side, ergonomic, may allocate
```

---

*End of document.*

