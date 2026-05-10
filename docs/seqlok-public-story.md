# Seqlok — Public Story

> **Classification:** Public story / blog essay. Not a canonical API reference.  
> This document explains why Seqlok exists, where it fits, and what kind of problem it is built to solve.

---

## 1. Why this exists

Seqlok came from a very specific frustration.

If you build real-time systems on the web, sooner or later you hit a boundary that feels much worse than it looks in
architecture diagrams.

The UI side is comfortable. It is expressive, productive, forgiving. You can move quickly there. State libraries feel
nice. `requestAnimationFrame` feels close enough to live. DevTools are excellent. Everything invites iteration.

Then there is the other side: the loop that actually has timing pressure.

That might be an `AudioWorklet`. It might be a worker driving a simulation. It might be a worker feeding a graphics
pipeline. Whatever it is, it wakes up and expects the data it needs to already be present, already coherent, and cheap
to read.

That side does not care that your UI is elegant. It does not care that a state library feels ergonomic. It does not care
that a message usually arrives quickly enough.

It cares about one thing: whether the data is there, complete, and safe to consume inside the time budget.

That is the gap Seqlok was built for.

Not general worker messaging. Not app-wide state management. Not collaborative data. Not a framework. Just this problem:

**How do you move live state across a thread boundary when one side is timing-sensitive, readers cannot tolerate
half-written state, and the hot path has to stay allocation-free?**

That is the whole story.

---

## 2. What Seqlok is not

It helps to say this plainly, because a lot of engineering waste starts when a tool gets used outside its natural
territory.

Seqlok is not for most applications.

If you are building a dashboard, a typical web app, an internal tool, an editor, or anything where “real-time” mostly
means “updates often enough,” then Seqlok is the wrong answer.

Use `postMessage`.
Use a clear protocol.
Keep your system simple.

Those tools are better for the majority case.

Seqlok is for the narrower case where the timing budget is real and the consequences of inconsistency are visible.

That usually means some combination of the following:

- a loop with genuine timing pressure
- UI-driven parameters that should become visible immediately
- live output flowing back the other way
- a system where a couple of milliseconds can become a glitch, a frame miss, or user-visible instability

Audio is the clearest example, which is why Seqlok started there. But the shape is broader than audio. The underlying
issue is the same any time one part of the system is soft and human-facing while another part is tight, repetitive, and
intolerant of jitter.

---

## 3. The core idea

Seqlok is a compiled shared-memory bridge for single-writer domains across a real thread boundary.

You author a contract. That contract compiles into a deterministic memory layout. That layout is backed by shared
memory. A handoff descriptor crosses the boundary. Each side reconstructs only the role-specific surface it is allowed
to use. Writers publish coherent updates. Readers either observe a stable snapshot or retry.

That is the mechanism.

The attitude behind it matters just as much:

**Do not turn the thread boundary into magic.**

A lot of systems do exactly that. They blur ownership. They hide who is allowed to write what. They collapse authored
meaning, runtime layout, and transport representation into one blob. They let shared state spread without a narrow
contract. The result often still works, but people stop trusting it.

Seqlok goes the other way.

It makes ownership explicit. It makes layout deterministic. It makes handoff explicit. It keeps the hot path narrow. It
accepts that the boundary is real and treats it like one.

That decision drives everything else.

---

## 4. Single writer per domain

The first hard rule is ownership.

Shared state is split into domains, and each domain has exactly one writer.

In the common setup there are two domains.

**Params domain** is UI to real-time. These are values the host or controller owns: gain, mode, cutoff, playback rate,
envelope settings, feature toggles, and so on.

**Meters domain** is real-time to UI. These are values the processor owns: RMS, peak, counters, timing stats, analysis
values, and similar outputs.

That rule is intentionally strict.

The moment both sides are allowed to sometimes write the same piece of state, you no longer have a bridge. You have
shared mutability with ambiguous authority. That is where trust starts to collapse.

So Seqlok does not allow that ambiguity.

The controller owns inputs. The processor owns outputs. If some data does not fit that model, it probably belongs on a
different channel.

That is not a weakness. That is the boundary doing its job.

---

## 5. It begins with an authored contract

Seqlok does not begin with a runtime-only builder object. It begins with an authored contract.

That contract can be authored through the TypeScript builder surface, but it can also exist as plain data. The builder
is the premium authoring surface. It is not the canonical format.

The canonical format is a serializable authored AST: schema-valid, diffable, hashable, and portable. From there, Seqlok
performs a separate semantic compilation step. That is where authored structure becomes a validated runtime contract.
Only then does layout planning begin.

```text
Builder DSL ───────┐
                   ▼
Authored AST (serializable, JSON-Schema-valid)
  → semantic compilation (validated runtime contract)
    → plan (deterministic ABI layout)
      → backing
        → handoff
          → bindings
```

That separation is deliberate.

It keeps authored meaning portable.
It keeps semantic validation explicit.
It keeps planning downstream of a real contract instead of builder-only behavior.
And it lets Seqlok be both pleasant to author in TypeScript and honest as a cross-boundary systems substrate.

The builder still matters.

It gives you richer literal inference, better editor help, and a more expressive authoring surface inside code. But that
is the builder's contribution on top of the contract, not the contract itself.

That distinction is one of the reasons Seqlok feels more disciplined than most typed runtime DSLs at this layer.

---

## 6. A compiled layout, not a bag of offsets

Once the authored contract becomes a validated runtime contract, the next decision is that memory layout must be
derived, not improvised.

The bad version of this kind of system is easy to imagine: a pile of manually maintained offsets, comments explaining
why something starts at byte 32, and enough hidden coupling that nobody wants to touch it.

Seqlok refuses that route.

Instead it follows a deterministic pipeline:

```text
Authored contract
  → semantic compilation
    → plan
      → backing
        → handoff
          → bindings
```

Each stage has one job.

The authored contract says what exists.
Semantic compilation validates meaning and produces the runtime contract.
The plan decides where it lives.
The backing stores it.
The handoff describes it.
The bindings expose the legal surface for a given role.

That is more disciplined than ad hoc shared memory, and that discipline buys real things:

- independent agreement on layout from the same contract
- explicit drift detection instead of silent mismatch
- better failure modes when assumptions break
- a system that can be inspected in a diff instead of guessed at from runtime behavior

This matters because shared memory becomes dangerous very quickly once layout stops being mechanically derived.

---

## 7. Why seqlocks

Once ownership is clear, the next problem is coherence.

A reader on the timing-sensitive side must never see half-written state.

In practice, a torn read is not an abstract concurrency bug. It is the moment one side observes half of the old state
and half of the new state and acts on a combination that never truly existed.

At the same time, blocking is the wrong tool for the hottest path in this environment. On the audio side especially,
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

## 8. Three layers that stay separate

One of the stronger parts of the design is that Seqlok does not collapse authored meaning, runtime contract, and
transport representation into one thing.

Those are three different layers.

**Authored meaning** is what the contract expresses. Names, labels, units, ranges, and human-readable intent.

**Runtime contract** is what semantic compilation and planning produce. Flattened key space, validated defs, offsets,
typed planes, slot tables, lock words, and sequence layout.

**Transport representation** is the raw data in memory. Numbers, atomic words, floating-point values, integer enum tags.

Why keep those separate?

Because if you collapse meaning into transport, the wire representation starts owning too much. And if you collapse
meaning into layout, your semantics start leaking into offsets and implementation trivia.

Both routes produce systems that are harder to evolve and harder to trust.

Seqlok keeps the human-facing layer human, the contract layer deterministic, and the transport layer primitive.

That separation is why you can author with names and domain meaning while the underlying storage remains dense numeric
shared memory.

The machine gets the primitive representation it wants. The developer gets an API that still feels like authored
software instead of byte arithmetic.

---

## 9. Hot path versus cold path

Another important boundary in Seqlok is execution cost.

Not every API belongs under the same expectations, and pretending otherwise would be dishonest.

The processor-side operations are hot-path operations. They live inside timing-sensitive code and are designed around
that constraint.

That is where operations like these live:

- `params.within(...)`
- `meters.publish(...)`

They are meant to stay bounded and allocation-free.

Other parts of the system are cold-path or setup-path work:

- authoring the contract
- schema validation
- semantic compilation
- planning the layout
- allocating backing memory
- constructing the handoff
- receiving the handoff
- taking snapshots
- host-side writes and diagnostics

Those can optimize for explicitness, clarity, and ergonomics instead.

This split matters because the runtime contract becomes visible in the API shape itself. The library is telling you
which surfaces belong near the hot loop and which ones do not.

That is good design. The interface should teach the user how the system expects to be used.

---

## 10. Why it is stronger than it first appears

Some of Seqlok's value is easy to miss if you only read it as a concurrency utility.

The contract is not just typed. It is serializable.

That matters because the authored declaration is not a clever runtime object that only exists inside one process. It can
exist as plain data. It can be stored, diffed, hashed, generated, inspected, shipped, and verified across boundaries
without turning into framework residue.

The DSL is not only doing ergonomic type work. It is lowering into a contract that semantic compilation turns into a
concrete runtime boundary.

That is a much stronger claim. The authored declaration does not merely improve the developer experience. It feeds a
real compiled substrate. Offsets, slots, lock words, field placement, and role visibility are derived from authored
intent instead of being hand-maintained folklore.

The plan is deterministic and checkable.

Given the same validated contract, you get the same layout. That gives you drift detection, compatibility checks, better
tooling, and a much more trustworthy failure story than ad hoc shared memory usually has.

Human meaning and machine transport stay separate.

The contract can preserve labels, units, ranges, and domain intent, while the transport stays primitive and dense. That
separation is one of the reasons the system scales without degenerating into byte-offset sludge.

The role surfaces are asymmetrical on purpose.

Controller and processor do not receive the same API with different names. They get different legal surfaces because
they have different jobs and different timing constraints. That is not polish. That is architecture.

The backing model is real.

Seqlok is not only a pattern for thinking about shared state. It has concrete backing strategies, explicit handoff, and
a reconstruction model that avoids ambient registries and hidden lookups. You build a bridge. You hand it off. The other
side reconstructs what it is allowed to see.

That is why Seqlok is best understood as a bridge substrate, not a total architecture.

It does one narrow class of crossing well. Precisely because it stays narrow, it also points beyond its first use case.
The same discipline becomes interesting anywhere a high-frequency lane has to cross a runtime boundary cleanly.

---

## 11. Why this exists on the web

The web is already a serious runtime surface for a lot of products.

It gives you distribution, iteration speed, mature UI tooling, and access to APIs like Web Audio, MIDI, HID, WebGPU,
`SharedArrayBuffer`, and `Atomics`. The platform has limits, but that is not the interesting question.

The interesting question is this:

**If this is already the platform, what is the sharpest possible way to cross from the soft side of the app into the
timing-sensitive side?**

Seqlok is one answer.

It does not pretend the browser becomes hard real-time. It does not romanticize the environment. It just takes the
boundary seriously and refuses to route the hottest lane through tools that were built for looser kinds of state
sharing.

---

## 12. Where it fits with other tools

Seqlok makes more sense when you stop asking whether it replaces other tools and ask where it belongs next to them.

It does not replace collaborative state systems. CRDT-based systems solve a very different problem: multi-writer,
distributed, often offline-capable state.

It does not replace `postMessage` for ordinary worker traffic. That is still the right choice most of the time.

It does not replace every form of locking. Other concurrency strategies remain valid in other environments.

A serious system might use all of these together.

For example:

- project or document state somewhere else
- commands and events over message passing
- timing-sensitive params and meters through Seqlok

That is not overlap. That is architecture.

---

## 13. Honest handoff, not hidden discovery

Shared memory systems get slippery when reconstruction becomes implicit.

A buffer appears somewhere. Some module already knows how to interpret it. Another part of the system discovers it
through ambient context, global registration, or side-channel agreement. The code still runs, but the boundary stops
being honest.

Seqlok is stricter than that.

The handoff is explicit.

One side constructs a descriptor that says, in effect: this is the plan we agreed on, this is the backing that satisfies
it, and this is the role you are allowed to reconstruct. The other side receives that descriptor and rebuilds its view
from there.

No ambient singleton. No magical lookup. No hidden registry pretending not to be global state.

That choice sounds small, but it changes the character of the system. It keeps the crossing inspectable. It keeps setup
separate from use. It keeps authority visible.

That is boring in the best sense.

---

## 14. Failure should be honest

Seqlok sits low enough in the stack that most failures are really contract failures.

If the producer and consumer disagree about the contract, that is not a minor runtime inconvenience. If the environment
cannot safely provide shared memory, that is not something to wave away. If the backing is too small for the planned
layout, the system is simply not valid.

So Seqlok fails clearly.

It does not try to be clever about broken assumptions.

Examples include:

- schema-invalid authored input
- semantically invalid authored input
- backing too small for the layout
- unsupported environment for safe `SharedArrayBuffer` use
- invalid or mismatched handoff state

The point is not to be harsh. The point is to keep the boundary trustworthy.

A low-level system that silently recovers from invalid assumptions often becomes harder to reason about than one that
simply stops and explains what failed. Higher layers can decide what recovery means. Seqlok's job is to make the failure
legible.

---

## 15. What stayed constant

Implementation details changed. The center did not.

Seqlok is built around a few stubborn decisions:

- explicit ownership
- authored contract first
- semantic compilation before planning
- deterministic planning
- explicit handoff
- no ambient registry
- no magical boundary discovery
- no confusion between hot-path work and setup-path work

That is why it feels calmer than a lot of shared-memory systems at this layer. It is not trying to be clever. It is
trying to be inspectable.

The bridge between a UI and a timing-sensitive loop should not be mysterious. It should not hide authority. It should
not depend on folklore. It should be explicit, mechanically derived, and narrow enough to trust.

That is what Seqlok is.

---

## Structural reference

### Golden flow

```text
builder or plain AST
  → authored contract
    → semantic compilation
      → deterministic plan
        → shared backing
          → explicit handoff
            → received handoff
              → role-specific bindings
```

### SWMR domains

```text
Params domain
  One owner, one writer: host / controller
  Many readers: processor, diagnostics, observers

Meters domain
  One owner, one writer: processor
  Many readers: host / controller, observers, loggers
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
COLD  — authorship, schema validation, semantic compilation,
        planning, backing allocation, handoff construction

────────────────────────────────────────────────────

HOT   — params.within, meters.publish
        processor side, bounded and allocation-free

COLD  — controller writes, snapshot reads, diagnostics,
        observer visualization, host-side orchestration
```
