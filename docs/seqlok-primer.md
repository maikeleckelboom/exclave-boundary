# Seqlok Primer

Seqlok is a **schema-first shared-memory coordination kernel** for coherent state exchange across execution boundaries.

It turns a declared state contract into a deterministic shared layout, carries that layout across a boundary through
explicit handoff, and binds each participant to a specific role with clear read and write semantics.

Seqlok is infrastructure, not application model.
It does not define your domain.
It defines a precise coordination kernel that your domain code can rely on.

Today the public implementation targets TypeScript runtimes built on SharedArrayBuffer and worker/worklet boundaries.

---

## The Problem

Time-critical systems have a recurring tension:

**1. The critical loop cannot stall.**  
Some execution paths have a fixed service budget. They cannot tolerate blocking, allocation, or unbounded coordination
work in the hot path.

**2. State still has to move across boundaries.**  
A host side needs to send intent, configuration, and control changes into a running loop. That running loop often needs
to publish metrics, status, or observations back out.

Naive approaches fail in predictable ways:

- Mutexes can block.
- Queues often introduce allocation, jitter, or ownership ambiguity.
- Raw `Atomics` work for isolated words, but coherent multi-word exchange is where many hand-rolled designs quietly
  collapse into fragile seqlock reimplementation.

Seqlok exists to make that boundary explicit and disciplined.

It gives you structured, zero-allocation primitives for coherent exchange, then builds a typed, role-aware surface on
top.

---

## Core Law

Each shared domain has **one explicit owner, one writer, and many readers**.

Seqlok does not hide that law behind convenience.

If one side owns parameter writes and the other side owns metric writes, that is not just a usage style. That is the
contract. The library is built to make those ownership boundaries legible and enforceable.

---

## Three Mechanisms

Everything in Seqlok falls into three mechanism families.

### 1. Shared State (continuous)

Continuous state exchange across a boundary, backed by a **seqlock** with **SWMR** semantics.

Typical shape:

- host side writes params and reads metrics
- processor side reads params and writes metrics

What matters is not the example roles. What matters is the ownership split.

Seqlok guarantees that:

- reads are coherent across multi-word state
- the hot path remains bounded and zero-allocation
- the API surface reflects the performance contract instead of hiding it

The hot and cold split is deliberate:

- `within`, `publish` are hot-path verbs
- `snapshot`, `hydrate` are cold-path verbs

That is not naming style.
That is contract surface.

### 2. Commands (discrete)

Discrete one-shot events across a boundary, backed by a **SWSR ring**.

This is for intent that should not live in continuously shared state:

- trigger
- seek
- install
- swap
- reconfigure
- advance phase

Properties:

- producer never blocks
- overflow is surfaced explicitly
- failure is visible at the boundary, not hidden behind retry folklore

An optional higher layer can schedule commands to exact frame positions when needed.

### 3. Hotswap (live replacement)

A protocol for replacing a live stateful processor without tearing down the whole running system.

Seqlok does not define what your engines are.
It defines the swap contract:

- explicit phases
- explicit per-block instructions
- explicit progression rules
- no hidden authority over engine internals

The result is live replacement with a visible state machine instead of ad hoc handover code.

---

## Canonical Mental Model

Seqlok deployments split cleanly across a boundary.

Setup happens on two sides:

```text
Owner / host side:
  defineSpec -> planLayout -> allocateShared -> buildHandoff -> bindController

Receiver / worker side:
  acceptHandoff -> bindProcessor
                 -> bindObserver   (optional)
```

The handoff is not incidental glue.
It is the boundary object.

It carries the exact layout and binding information needed for the receiving side to attach to the shared kernel without
guessing, reconstructing, or reaching behind the owner.

Nothing binds on the far side without an explicit accepted handoff.

At runtime, the kernel minimum is small:

```text
params.within(cb)
meters.publish(cb)
```

Optional layers sit above that:

```text
consumer.drain(hooks)
stepSwapStateRT(...)
```

That layering matters.

A deployment using only `@seqlok/core` is complete.
Commands, hotswap, and integration layers are additive, not mandatory.

---

## Canonical Flow 1 - Param / Metric Exchange

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Host side                                                                  │
│ UI, automation, control surfaces, orchestration logic                      │
└───────────────┬───────────────────────────────────────────────┬────────────┘
                │                                               ▲
                │ params.set() / update() / hydrate()           │ meters.snapshot()
                ▼                                               │
         ┌───────────────┐                             ┌───────────────┐
         │ param domain  │◄───────────────────────────►│ metric domain │
         │   seqlock     │   SharedArrayBuffer         │   seqlock     │
         │               │     (seqlock-backed)        │               │
         └───────┬───────┘                             └───────▲───────┘
                 │                                             │
                 │ params.within(cb)                           │ meters.publish(cb)
                 ▼                                             │
┌────────────────┴─────────────────────────────────────────────┴─────────────┐
│ Processor side                                                             │
│ time-critical loop / worker                                                │
└────────────────────────────────────────────────────────────────────────────┘
```

The ownership law is strict:

- host side is the sole writer of params
- processor side is the sole writer of metrics

These are SWMR invariants, not conventions.

Trust in a shared-memory system comes from visible ownership, not from vague assurances of thread safety.

---

## Canonical Flow 2 - Command Dispatch

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Host side                                                                  │
│ enqueue intent: seek, trigger, install, swap, reconfigure                  │
└──────────────────────────────────────┬─────────────────────────────────────┘
                                       │ producer.push(cmd)
                                       ▼
                              ┌──────────────────────┐
                              │     command ring     │
                              │      SWSR queue      │
                              │   [cmd][cmd][cmd]    │
                              └──────────┬───────────┘
                                         │ consumer.drain(hooks)
                                         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Processor side                                                             │
│ optional exact-frame scheduling layer when relevant                        │
│                                                                            │
│ frame 0 ──────────────┬──────────────────────┬────────────────── frame N   │
│                       │                      │                             │
│                    [seek]                [trigger]               [install] │
└────────────────────────────────────────────────────────────────────────────┘
```

If the ring is full, `push` returns a structured failure and the command is dropped.

That is intentional.

The producer does not block.
The system does not pretend overflow is harmless.
A missed command is a visible boundary failure, not an invisible queueing story.

---

## Hotswap Lifecycle

```text
┌──────┐   ┌───────┐   ┌───────┐   ┌──────────┐   ┌───────────┐   ┌────────┐
│ idle │──►│ spawn │──►│ prime │──►│ prewarm  │──►│ crossfade │──►│ retire │
└──┬───┘   └───────┘   └───────┘   └──────────┘   └───────────┘   └───┬────┘
   ▲                                                                  │
   └──────────────────────────────────────────────────────────────────┘
```

During crossfade, both engines run.

Seqlok defines:

- the phase machine
- the per-block instruction contract
- the progression model

Your application defines:

- what the engines are
- how state is prepared
- how output blending works
- what "good replacement" means in domain terms

`stepSwapStateRT` is pure.
It advances protocol state and returns instructions.
It does not allocate, block, or reach into engine internals.

That separation is the point.

---

## What Makes Seqlok Distinct

Seqlok is not merely lock-free.

What distinguishes it is the full contract shape:

- declared state contract
- deterministic layout planning
- explicit handoff across the boundary
- role-bound bindings on the receiving side
- ownership-visible read and write rules
- hot-path verbs that encode the runtime contract directly

That is a much stronger claim than "some lock-free primitives."

Seqlok is boundary-conscious coordination infrastructure.

---

## Simplified Package Stack

The diagram below shows the principal layers.
The full workspace includes additional tooling and support packages. See `packages/README.md` for the authoritative
graph.

```text
                                ┌──────────────────────────────┐
                                │ @seqlok/integration          │
                                │ reference drivers, timeline, │
                                │ hotswap slot, boundary glue  │
                                └──────────────┬───────────────┘
                                               │
                           ┌───────────────────┼──────────────────────┐
                           ▼                   ▼                      ▼
                 ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
                 │ @seqlok/hotswap  │  │ @seqlok/commands │  │  @seqlok/core    │
                 │ live swap        │  │ discrete intent  │  │ spec -> layout   │
                 │ protocol         │  │ lane             │  │ -> alloc -> bind │
                 └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
                          │                     │                     │
                          └─────────────┬───────┴─────────────┬───────┘
                                        ▼                     ▼
                               ┌──────────────────┐  ┌──────────────────┐
                               │@seqlok/primitives│  │  @seqlok/base    │
                               │ seqlock, SWSR    │  │ typed codes,     │
                               │ ring, memory ops │  │ error domains    │
                               └──────────────────┘  └──────────────────┘

                                  ┌──────────────────────────────┐
                                  │ @seqlok/introspect           │
                                  │ diagnostics and inspection   │
                                  │ tooling, never in hot path   │
                                  └──────────────────────────────┘
```

| Package               | Role                                                         |
|-----------------------|--------------------------------------------------------------|
| `@seqlok/base`        | shared error types, numeric domain codes, zero external deps |
| `@seqlok/primitives`  | seqlock and SWSR ring on `SharedArrayBuffer`                 |
| `@seqlok/core`        | typed spec -> layout -> alloc -> handoff -> bind lifecycle   |
| `@seqlok/commands`    | command codec and mailbox over the primitive ring            |
| `@seqlok/hotswap`     | phase machine and per-block swap instructions                |
| `@seqlok/integration` | reference drivers, exact-frame scheduling, boundary glue     |
| `@seqlok/introspect`  | diagnostics and inspection helpers for dev and test          |

### How to Read the Repo

Start at `@seqlok/core`.

That is the center of gravity for most readers.
It shows the public lifecycle clearly: spec, layout, allocation, handoff, bind.

Drop down into `@seqlok/primitives` and `@seqlok/base` only if you want the substrate details.

Go upward into `@seqlok/commands`, `@seqlok/hotswap`, and `@seqlok/integration` when you want the optional protocol
layers built on top of the core boundary model.

That traversal order matches how the system is meant to be understood.

---

## When to Use Seqlok

**Good fit:**

- you have a time-critical execution path that cannot block or allocate
- you need coherent continuous state delivery across a boundary
- you need metrics or observations to flow back out coherently
- you need discrete command delivery without blocking the producer
- you need live replacement of a stateful processor
- you want ownership boundaries to stay explicit instead of being dissolved into convenience APIs

**Not the right tool:**

- you only need ordinary message passing between non-critical workers
- your latency constraints are loose enough that a mutex is acceptable
- you need many independent writers to the same shared domain
- you want the library to model your application semantics for you

Seqlok is intentionally narrower than that.

---

## Examples, Not Identity

Audio systems are one strong fit.
So are other fixed-budget loops, simulation workers, media pipelines, and boundary-sensitive runtimes.

But Seqlok is not "an audio library."
It is not a DSP framework.
It is not a transport model.

Those are application concerns.

Seqlok stays at the coordination boundary.

---

## Where to Go Next

| What you need                                  | Where to look                                          |
|------------------------------------------------|--------------------------------------------------------|
| full workspace graph and package relationships | `packages/README.md`                                   |
| per-package API surfaces                       | `packages/*/README.md` or `index.ts`                   |
| concurrency model and role rules               | `docs/03-seqlok-concurrency-model-and-roles`           |
| error domain registry and numeric codes        | `docs/15-seqlok-error-system-and-fail-fast-philosophy` |
| hotswap visualization or playground            | `packages/playground`                                  |
| architecture decisions and design rationale    | `docs/`                                                |

The source of truth for any specific API is always the package's own `index.ts`.

This primer is intentionally higher-level than that.
Its job is to make the system legible before you drop into implementation detail.
