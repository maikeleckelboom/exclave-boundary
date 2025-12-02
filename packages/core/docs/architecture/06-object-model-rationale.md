# Seqlok Object Model & Non-OOP Core Rationale (Canonical Flow Edition)

> Why the Seqlok **kernel** is function-centric and not object-oriented – and why that's intentional, not an accident.

The Seqlok core is deliberately **not** designed as a set of stateful objects or contexts. Instead, it is built on:

- Algebraic data types (`SpecInput`, `Plan<S>`, `Backing`, `Handoff`, bindings)
- Pure or "pure-ish" functions between them
- Explicit module boundaries (`primitives` → `spec` → `plan` → `backing` → `handoff` → `binding`)

Object-oriented APIs are allowed – and expected – **on top** of this (orchestration, framework adapters, app code).
The kernel itself stays functional for reasons of correctness, analyzability, portability, and layering.

This version of the document assumes the **canonical flow** is the only supported, canonical way to wire Seqlok:

- **Owner / main side:** `defineSpec` → `planLayout` → `allocateShared` → `buildHandoff` → `bindController`
- **Worker / processor side:** `receiveHandoff` → `bindProcessor`

Everything below is written in terms of that flow, with the **plan** explicitly threaded into `bindController`:

```ts
bindController(spec, plan, backing, options?);
```

---

## 1. Design Principle

**Design principle.** The Seqlok core models concurrency and memory layout using **data + functions**, not “big objects
with methods".

At the kernel level, APIs are shaped like the canonical flow:

```ts
// owner / main
const spec = defineSpec(/* ... */); // DSL → SpecInput
const plan = planLayout(spec); // SpecInput → Plan<S>
const backing = allocateShared(plan); // Plan<S> → Backing
const handoff = buildHandoff(plan, backing); // Plan<S> × Backing → Handoff
const controller = bindController(spec, plan, backing); // SpecInput × Plan<S> × Backing → ControllerBinding<S>

// worker / processor
const received = receiveHandoff(handoff); // Handoff → ReceivedHandoff<S>
const processor = bindProcessor(received); // ReceivedHandoff<S> → ProcessorBinding<S>
```

Higher layers (orchestration, worklet helpers, React/Vue bindings, app code) are free to wrap this into:

- Factories
- Context objects
- Classes
- Hooks/composables

But the **concurrency kernel** itself is _not_ expressed as:

```ts
const ctx = new SeqlokContext(spec);
ctx.allocate();
const controller = ctx.createController();
const handoff = ctx.buildHandoff();
```

Ergonomics moves "upwards"; correctness-critical logic stays "flat and explicit" in terms of the canonical flow.

---

## 2. Why classic OO is a bad fit for shared-memory concurrency

Traditional OO shines when you want:

- Objects with identity
- Encapsulated mutable state
- Behavioral polymorphism (virtual methods, overrides)
- “Tell, don’t ask”: send messages and let the object decide

Seqlok's problem space is different:

- `SharedArrayBuffer` + `Atomics`
- Single-Writer / Multiple-Reader (SWMR) discipline
- Strict, shared **plan** across threads / workers / runtimes
- Seqlock-style coherence protocols

The questions Seqlok needs to answer are:

- **Spatial:**
  Which bytes belong to which logical field (key → plane → offset)?
- **Temporal:**
  Who is allowed to write them, and in what order (sequences, lock protocol)?
- **Aliasing:**
  How do multiple readers get coherent snapshots without torn reads?
- **Compatibility:**
  Does this `spec` actually match this `plan`, this `backing`, and this `handoff`?

Those are **memory-model** and **type-theory** questions, not "class hierarchy" questions.

In that context, "hidden mutable state behind method calls" is not a feature – it's a liability.

> **Thesis.**
> OO's strengths (encapsulation, behavioral polymorphism, dynamic dispatch) do not address Seqlok's primary concerns
> (plan determinism, alias safety, atomic coherence). For a shared-memory concurrency kernel, explicit data and pure-ish
> operations are more valuable than opaque object state.

---

## 3. Functions + data are easier to reason about (and verify)

Seqlok's core operations in the canonical flow are intentionally shaped like **total functions** on immutable inputs
wherever possible:

- `planLayout(spec): Plan<S>`
- `allocateShared(plan): Backing`
- `buildHandoff(plan, backing): Handoff`
- `receiveHandoff(handoff): ReceivedHandoff<S>`
- `bindController(spec, plan, backing, options?): ControllerBinding<S>`
- `bindProcessor(received, options?): ProcessorBinding<S>`

### 3.1. Compositional reasoning

You can treat the canonical flow as two simple pipelines.

Owner / main:

```ts
const spec = defineSpec(/* ... */);
const plan = planLayout(spec);
const backing = allocateShared(plan);
const handoff = buildHandoff(plan, backing);
const controller = bindController(spec, plan, backing);
```

Worker / processor:

```ts
const received = receiveHandoff(handoff);
const processor = bindProcessor(received);
```

Preconditions and postconditions are explicit:

- If `planLayout(spec)` succeeds, `plan` encodes a valid, non-overlapping layout.
- If `allocateShared(plan)` succeeds, `backing` is large enough and aligned for that plan.
- If `buildHandoff(plan, backing)` succeeds, the handoff envelope consistently describes `plan` + `backing`.
- If `receiveHandoff(handoff)` succeeds, the processor has a verified `ReceivedHandoff<S>` view.
- If `bindController(spec, plan, backing)` or `bindProcessor(received)` succeeds, Seqlok has proven that the
  spec/plan/backing/handoff chain is compatible for this binding.

This shape is friendly to:

- Property-based testing
- Potential formalization in proof systems
- Static checks (TypeScript types track the spec through to bindings)

A stateful "context" object, by contrast, accumulates hidden state:

```ts
const ctx = new SeqlokContext(spec);
ctx.allocate();
const controller = ctx.createController();
```

Correctness now depends on:

- Implicit ordering (did you forget `allocate()`?)
- Internal flags like `ctx.isAllocated`
- Hidden caches and mutation

all of which live **behind** method boundaries instead of in explicit data.

### 3.2. Testing and invariants

Tests can exercise the canonical flow functions directly:

- Planner invariants (no overlap, correct plane lengths)
- Backing invariants (correct SAB size and alignment)
- Handoff invariants (hashes, byte totals, identity of the plan)
- Binding invariants (spec ↔ plan ↔ backing ↔ handoff consistency)
- Seqlock properties (no torn reads under concurrent access)

It's much harder to specify and test invariants against a "god context" that mutates its own internals on each method
call.

---

## 4. Cross-runtime and polyglot friendliness

Seqlok targets:

- Browsers (SAB + Workers / AudioWorklet)
- Node / Deno (`worker_threads`)
- Environments with shared `WebAssembly.Memory`

The canonical flow is intentionally **portable**:

- `Plan<S>` is a plain data structure describing the layout.
- `allocateShared(plan)` constructs raw shared memory for that layout.
- `buildHandoff(plan, backing)` serializes the plan/backing relationship into a portable envelope.
- `receiveHandoff(handoff)` re-establishes a verified view of the same layout on the processor side.
- `bindController(spec, plan, backing, options?)` and `bindProcessor(received, options?)` map typed views on top of the
  backing according to that plan.

Any language with:

- Integer arithmetic
- Typed arrays / slices
- Atomics or equivalent fences

can re-implement the core behavior against the same invariants.

> **Design goal.**
> No part of Seqlok's correctness should depend on JavaScript's `class` model or method dispatch. The semantics should
> be
> expressible purely as "data + functions" along the canonical flow, so an equivalent implementation in another language is
> straightforward.

Heavy OO in the kernel would pull in JS-specific concepts (prototype chains, subclassing) that make porting and
verification unnecessarily harder.

---

## 5. Layered architecture vs big objects

Seqlok enforces a strict layering:

- `primitives` – atomics, seqlock
- `spec` – DSL and spec types
- `plan` – planning from `spec` → `Plan<S>`
- `backing` – allocate shared memory from a plan
- `handoff` – serialize/verify cross-thread plan + memory
- `binding` – controller/processor bindings over backings
- above that: **orchestration**, in separate helpers/packages

Each layer has a small, explicit API and depends on a restricted set of lower layers.

The canonical flow function signatures **encode those dependencies**:

- `planLayout(spec)` lives in `plan`
- `allocateShared(plan)` lives in `backing`
- `buildHandoff(plan, backing)` lives in `handoff`
- `receiveHandoff(handoff)` lives in `handoff`
- `bindController(spec, plan, backing, options?)` and `bindProcessor(received, options?)` live in `binding`

They make the architecture visible in the types.

A large OO `Context` or `Engine` object tends to:

- Import multiple layers at once
- Accumulate responsibilities ("plan + allocate + buildHandoff + bind + …")
- Blur where an error actually originates (spec vs plan vs backing vs handoff vs binding)

Over time, that leads to:

- Tighter coupling
- More "reach-through" (one method poking directly at multiple lower layers)
- Weaker enforcement of layer rules

> **Intent.**
> Seqlok's kernel is closer to a well-designed C library with strong types than to a classical OO "engine" object. The
> canonical flow is expressed as a sequence of explicit module calls; their relationships are visible in the type
> signatures.

---

## 6. Where OO _is_ welcome: orchestration and integrations

This is **not** a blanket rejection of object-orientation. It's a **scoping decision**:

- Kernel: **functional, data + functions**, minimal internal state, explicit layering, canonical flow only.
- Above kernel: **use whatever abstraction is ergonomic**:

  - Builder/factory helpers
  - Context objects
  - Classes
  - Hooks/composables (React/Vue/etc.)
  - Framework-specific adapters

Examples of places where OO / context styles are perfectly fine:

- `@seqlok/web` – helpers for AudioWorklet / browser orchestration
- `@seqlok/react` – React hooks and providers
- `@seqlok/devtools` – inspector UIs, stateful debug contexts
- App-level "Session" / "Deck" / "Engine" classes in consumer code

These can wrap the canonical flow:

```ts
// example sketch: orchestration helper (could be OO, could be functional)
export function createControllerKit<S extends SpecInput>(spec: S) {
  const plan = planLayout(spec);
  const backing = allocateShared(plan);
  const handoff = buildHandoff(plan, backing);
  const controller = bindController(spec, plan, backing);

  return {
    spec,
    plan,
    backing,
    handoff,
    controller,
  };
}

// worker side
export function initProcessor<S extends SpecInput>(handoff: Handoff<S>) {
  const received = receiveHandoff(handoff);
  return bindProcessor(received);
}
```

The important part: this lives **on top of** the kernel and delegates to the canonical flow functions. If an integration
layer goes wrong, the core invariants remain intact.

> **Policy.**
> “OO belongs in orchestration and integration layers, not in the concurrency kernel. The kernel stays at the golden
> flow level."

---

## 7. Reviewer FAQ: "Why not a big context object?"

When reviewers ask:

> “Why not have a `SeqlokContext` that hides spec/plan/backing and just gives me `.allocate()`, `.bind()`,
> `.handoff()`?”

You can answer along these lines, in terms of the canonical flow:

1. **Correctness & reasoning**

- Function-centric APIs make it easier to specify and test invariants about
  `spec → plan → backing → handoff → bindings`.
- A context object hides critical state transitions behind method calls, making it harder to reason about correctness.

2. **Shared-memory domain**

- Implicit mutable state is hostile in SAB + Atomics + seqlock scenarios.
- We want explicit flows:

  ```ts
  defineSpec → planLayout → allocateShared → buildHandoff → receiveHandoff → bind*
  ```

3. **Layering**

- A big context would necessarily depend on `spec`, `plan`, `backing`, `handoff`, and `binding` all at once, collapsing
  the carefully separated domains.
- Current function signatures encode layer dependencies directly.

4. **Polyglot & portability**

- A data+function kernel is easier to re-implement or verify in other languages.
- No correctness property depends on JavaScript's class semantics.

5. **Ergonomics via composition**

- We provide (or endorse) higher-level helpers/factories that close over `spec`/`plan` to reduce repetition, while still
  delegating to the canonical flow.
- The kernel stays small, explicit, and predictable.

A concise line you can reuse:

> We chose not to make the Seqlok core OO because the problem is about **memory and time**, not “objects and methods”.
> OO is a great tool for orchestration and UI integration; it's the wrong tool for defining a portable, verifiable
> concurrency kernel. The canonical flow gives us that kernel.

---

## 8. Summary

- The Seqlok **core** is intentionally non-OOP and organized around a single **canonical flow**:

  - Owner / main: `defineSpec` → `planLayout` → `allocateShared` → `buildHandoff` →
    `bindController(spec, plan, backing, options?)`
  - Worker / processor: `receiveHandoff` → `bindProcessor(received, options?)`

- The kernel is:

  - Data + pure-ish functions
  - Explicit `spec → plan → backing → handoff → bindings` pipeline
  - Strictly layered into `primitives` / `spec` / `plan` / `backing` / `handoff` / `binding`

- This shape:

  - Matches the needs of shared-memory concurrency
  - Simplifies testing and potential formal reasoning
  - Keeps the design polyglot-friendly
  - Preserves the strict layering enforced elsewhere in the project

- Object-oriented abstractions are encouraged **above** the kernel, where they can improve ergonomics without
  compromising the concurrency model or the canonical flow.

In other words: the core is designed like a **portable systems library** with a single, explicit canonical flow; the OO
“nice bits” live one layer higher.
