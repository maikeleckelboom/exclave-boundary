# API & Naming Rationale

**Audience:** future maintainers, contributors, and “why is it called that?” readers.  
**Status:** design rationale, not user-facing API docs.

This document explains why the core Seqlok API is shaped and named the way it is, which alternatives we rejected, and
which parts of the surface are considered stable enough to treat as architectural center.

This is the naming and semantics layer on top of the implementation docs. It is not the low-level mechanics reference.

---

## 1. Top-level mental model

Seqlok is a typed shared-memory wire between:

- a **controller side** (main/UI/host/orchestrator),
- a **processor side** (worker / AudioWorklet / DSP loop), and
- one or more **observer sides** (HUDs, inspectors, telemetry-only workers).

But the wire does not begin with a runtime-only builder object.

It begins with an authored contract.

That authored contract has a canonical form: a serializable spec AST.
The TypeScript builder DSL is the premium authoring surface over that AST, not the canonical format itself.

Today, the public entrypoint for authorship is still:

```ts
const spec = defineSpec(({param, meter}) => ({
  id: "my-synth",
  params: {
    gain: param.f32({min: 0, max: 1}),
    cutoff: param.f32({min: 20, max: 20_000}),
    mode: param.enum(["off", "lp", "hp"]),
    curve: param.f32.array({length: 1024}),
  },
  meters: {
    peak: meter.f32(),
    frame: meter.f32.array({length: 256}),
  },
}));
```

That API shape remains true. But the mental model needs one more layer above it.

The builder callback lowers into a canonical authored AST.
`defineSpec(...)` currently performs the semantic-compilation boundary.
The result is the validated runtime contract that planning consumes.

Conceptually, the stack is:

```text
Builder DSL ───────┐
                   ▼
Authored AST
  → semantic compilation
    → runtime contract
      → deterministic plan
        → shared backing
          → explicit handoff
            → received handoff
              → role-specific bindings
```

Today, core does **not** expose semantic compilation as a separate public function.
That boundary is currently performed inside `defineSpec(...)`.

So the current public flow still reads:

```ts
const spec = defineSpec(/* builder callback or plain AST */);
const plan = planLayout(spec);
const backing = allocateShared(plan);
const controller = bindController(spec, plan, backing);
const handoff = buildHandoff(plan, backing);
```

The important correction is conceptual:

- `defineSpec(...)` is not merely “builder sugar produces a runtime object”
- it is where authored input becomes the validated runtime contract that the rest of the system consumes

The processor and observer sides never see the value of the authored contract at runtime. They only consume the planned
layout embedded in the handoff:

```ts
import {acceptHandoff, bindProcessor, bindObserver} from "@seqlok/core";
import type {MySpec} from "./spec";
import type {Handoff} from "@seqlok/core";

type InitMessage = { type: "INIT"; handoff: Handoff<MySpec> };

let proc: import("@seqlok/core").ProcessorBinding<MySpec> | undefined;
let hud: import("@seqlok/core").ObserverBinding<MySpec> | undefined;

self.onmessage = (ev: MessageEvent<InitMessage>) => {
  if (ev.data.type !== "INIT") return;

  const received = acceptHandoff(ev.data.handoff);

  proc = bindProcessor(received);
  hud = bindObserver(received);
};
```

Rule of thumb:

- the authored contract is canonical
- the builder is the premium TypeScript authoring surface
- `defineSpec(...)` is the current public authored-contract boundary
- `planLayout(...)` starts after that boundary, not before it

---

## 2. Pipeline verbs: why these names

### 2.1 `defineSpec`

We kept `defineSpec` because it:

- mirrors modern declarative entrypoints such as `defineConfig`
- reads clearly in code
- emphasizes authored declaration rather than imperative work

```ts
const spec = defineSpec(/* … */);
```

But the semantic role of `defineSpec(...)` is sharper than “define some schema”.

`defineSpec(...)` is currently the public boundary where authored input becomes the validated runtime contract.

That authored input may arrive through either:

- the builder callback surface, or
- a plain authored AST object

Both are legal inputs to `defineSpec(...)`.
The builder is ergonomic sugar over the same authored contract model.

That means `defineSpec(...)` is doing two jobs today:

1. accepting authored input in supported surface forms
2. performing the semantic-compilation boundary that turns authored structure into the runtime contract consumed by
   planning

This distinction matters.

A spec can be structurally acceptable and still be semantically invalid.
That rejection does not belong to JSON shape alone, and it does not belong to layout planning.
It belongs at the authored-contract boundary.

So while the public call still reads:

```ts
const spec = defineSpec(/* … */);
```

the mental model should be:

```text
authored input
  → defineSpec(...)
    → validated runtime contract
```

Rejected framings:

- “`defineSpec` only builds a runtime object” — too weak
- “the builder callback is the canonical contract” — wrong owner
- “planning starts directly from builder-authored values” — undersells the authored-contract boundary

Literal type precision is a builder-layer benefit.
Portability and schema-valid authored representation belong to the authored AST layer.
`defineSpec(...)` is where those two worlds currently meet.

### 2.2 `planLayout`

We converged on:

```ts
const plan = planLayout(spec);
```

This remains the right public name.

But the conceptual meaning should be stated more precisely:

> derive a deterministic ABI layout from the validated runtime contract

That is stronger and more correct than the older “plan a memory layout from the spec”.

Why the distinction matters:

- planning is downstream of authored input validation
- planning must not become the place where authored meaning is first interpreted
- planning consumes the contract that `defineSpec(...)` has already validated and normalized

So the real stack is:

```text
authored input
  → defineSpec(...)
    → validated runtime contract
      → planLayout(...)
        → deterministic plan
```

Rejected framings:

- “planning starts from raw builder-authored state” — too builder-centric
- “planning is where authored semantics are first checked” — wrong layer
- “planLayout is just sizeof-math” — too weak; the output is an ABI contract

Final decision:

- **Canonical public name:** `planLayout`
- **Conceptual meaning:** derive a deterministic layout contract from the already validated runtime contract

### 2.2.1 Semantic compilation is a real boundary

The current public API does not yet expose a separate `semanticCompile(...)` or similarly named function.

But the boundary is real, and maintainers should think in those terms.

A Seqlok authored contract passes through two distinct validation layers:

1. **Structural validation**
  - shape of the authored AST
  - legal field kinds
  - presence of required fields
  - JSON-Schema-level concerns

2. **Semantic compilation**
  - authored meaning becomes a validated runtime contract
  - invalid numeric ranges are rejected
  - empty enum vocabularies are rejected
  - invalid lengths are rejected
  - nested namespaces are flattened
  - stable defaults are applied

Today, core performs that semantic-compilation boundary inside `defineSpec(...)`.

That is good enough for the current public surface.

But it is important to name this boundary explicitly in doctrine so future abstractions do not quietly treat
builder-only behavior as the semantic owner of the system.

### 2.3 `allocateShared` and `allocateSharedPartitioned`

This step:

```ts
const backing = allocateShared(plan);
```

does something very specific:

- allocates **shared** memory (`SharedArrayBuffer`)
- slices it into typed planes according to the plan

We wanted that sharedness up front.

Alternatives and why they lost:

- `allocateMemory(plan)` — too generic; misses shared memory as the defining fact
- `allocateBacking(plan)` — call-site stutter
- `allocateSharedMemory(plan)` — accurate but noisy
- `createBacking(plan)` — sounds softer than the operation really is

We kept **`allocateShared`** to:

- highlight shared memory
- keep call sites short
- leave room for future sibling stories if needed

With partitioned backings, the sibling stays parallel:

```ts
const backing = allocateSharedPartitioned(plan);
```

Naming stays simple:

- `allocateShared` — golden-path single shared backing
- `allocateSharedPartitioned` — first-class alternative for per-plane packing

Both are driven by the same `planLayout(spec)`.
Only the backing strategy changes.

### 2.4 `bindController` / `bindProcessor` / `bindObserver`

The semantic roles are:

- **Controller** — main/UI/host side
  - writes params
  - reads meters
  - orchestrates intent

- **Processor** — worker/audio/DSP side
  - reads params
  - writes meters
  - runs the hot loop

- **Observer** — read-only role
  - reads params
  - reads meters
  - exists for HUDs, inspectors, telemetry, and visualizers

Bindings attach those roles to the substrate:

```ts
const controller = bindController(spec, plan, backing);
const processor = bindProcessor(received);
const observer = bindObserver(received);
```

Why these names?

They are semantic names, not placement names.

We do **not** want the API centered on where a thing happens to live. We want it centered on what authority that role
holds.

Why not `Host` or `Thread`?

- `Host` is overloaded in audio land
- `Thread` is too implementation-specific
- the same role model may exist across same-thread, worker, or worklet arrangements

The naming trio tells the story cleanly:

- **Controller** — writes params, reads meters
- **Processor** — reads params, writes meters
- **Observer** — reads params, reads meters

That is one of the best asymmetries in the public API. It makes role law visible.

### 2.5 Param verbs: `set`, `update`, `stage`, `hydrate`

The controller param surface is intentionally small and verb-driven:

- `params.set(key, value)` — single scalar write
- `params.update(patch)` — atomic multi-scalar write
- `params.stage(key, cb(view))` — staged array write with one commit
- `params.hydrate(patch)` — colder-path bulk patch for scalars and arrays

We explicitly moved away from older names like `setMany` because `update` better communicates patch semantics without
sounding like a blunt map blast.

The important invariant stays:

- `update` is scalar-only
- arrays move through `stage` on the hotter path
- `hydrate` is bulk and colder-path

This keeps atomicity simple and cost profiles honest.

### 2.6 Meter verbs: `publish`, `snapshot`, `version`

Meters invert the directionality:

- processor side: `publish`
- controller/observer side: `snapshot`
- both sides: `version`

That makes the job of each verb obvious:

- `publish` — commit a coherent new meter frame
- `snapshot` — read a coherent view
- `version` — detect change cheaply before pulling payload

This is one of the places where naming directly teaches the execution model.

### 2.7 `buildHandoff` / `acceptHandoff`

We use:

```ts
const handoff = buildHandoff(plan, backing);
const received = acceptHandoff(handoff);
const processor = bindProcessor(received);
```

“Handoff” won because it sounds like a protocol event:

- one side builds a handoff
- the other side receives it

The object is a handoff of layout plus backing across a trust boundary.

Rejected alternatives:

- `Envelope` — too generic and too object-shaped
- `createHandoff` / `makeHandoff` — weaker semantics
- `serializeBacking` — too low-level and layout-blind

Final pairing:

- **Producer:** `buildHandoff(plan, backing)`
- **Consumer:** `acceptHandoff(handoff)`
- **Binder:** `bindProcessor(received)` / `bindObserver(received)`

That makes trust boundary, adoption boundary, and role binding all distinct.

---

## 3. Canonical authored format versus premium authoring surface

The canonical authored format is the spec AST.

The builder DSL is the premium TypeScript surface over that AST.

Those are related but different concepts:

- the AST is the durable authored contract
- the builder is the most ergonomic way to author that contract inside TypeScript

This split is intentional.

The AST contributes:

- portability
- schema validation
- storage and transport friendliness
- toolability outside the builder runtime

The builder contributes:

- literal inference
- better editor help
- stronger local authoring ergonomics

The builder is important, but it is not the semantic owner of the contract.

That distinction protects Seqlok from drifting into a builder-only architecture whose real contract exists only inside
TypeScript call sites.

### 3.1 Range-only numeric DSL

We converged on a range-only numeric DSL for core numeric params:

```ts
const params = {
  gain: param.f32({min: 0, max: 1}),
  index: param.i32({min: 0, max: 1023}),
};
```

We deliberately do **not** treat UI-centric ideas like `step`, `origin`, or `default` as kernel-owned parts of the core
numeric contract.

Those are higher-level concerns.

The contract owns:

- type family
- admissible range
- shape

That keeps the authored contract stable as a systems boundary rather than quietly turning it into a UX schema.

### 3.2 Enum and enum arrays

We stabilized the `enum` and `enum.array` story:

```ts
const params = {
  mode: param.enum(["off", "lp", "hp"]),
  pattern: param.enum.array({
    values: ["off", "dim", "full"],
    length: 64,
  }),
};
```

Key decisions:

- `values` is the vocabulary
- `length` is the fixed slot count
- backing stores indices, not repeated strings

This is a good example of Seqlok keeping authored meaning separate from transport representation.

---

## 4. Bindings: roles and responsibilities

### 4.1 ControllerBinding

Rough shape:

- **Params**
  - `set`
  - `update`
  - `stage`
  - `hydrate`

- **Meters**
  - `snapshot`
  - `version`

This gives controller a narrow, explicit orchestration surface.

### 4.2 ProcessorBinding

Rough shape:

- **Params**
  - `within`
  - `version` (advanced)

- **Meters**
  - `publish`

This keeps processor hot-path semantics narrow and obvious.

### 4.3 ObserverBinding

Rough shape:

- **Params**
  - coherent read surfaces

- **Meters**
  - coherent read surfaces
  - `version`-based visualization / telemetry loops

Observer is important because it proves Seqlok is not merely a two-party shortcut.
It is a substrate with asymmetrical legal roles.

### 4.4 Why `acceptHandoff` stays separate from `bindProcessor` and `bindObserver`

We intentionally keep:

```ts
const received = acceptHandoff(handoff);
const proc = bindProcessor(received);
const obs = bindObserver(received);
```

instead of collapsing decode and role binding together.

This separation encodes real invariants:

- decode and verification are not the same job as role binding
- one decode can feed many bindings
- some consumers are observers only
- the owner/consumer split stays visible in the API

The principle is simple:

`acceptHandoff(...)` is where a consumer says, “I trust this envelope now.”
`bindProcessor(...)` and `bindObserver(...)` are where the consumer says, “Given that trusted substrate, this is my
role.”

That distinction matters enough to keep visible.

---

## 5. Handoff and compatibility semantics

The public flow is:

- owner side:
  - `defineSpec`
  - `planLayout`
  - `allocateShared`
  - `buildHandoff`

- consumer side:
  - `acceptHandoff`
  - `bindProcessor` / `bindObserver`

The compatibility story is layered:

- authored structure has its own validation concerns
- semantic compilation produces the validated runtime contract
- planning is deterministic for that contract
- handoff carries the plan-derived substrate description
- consumers adopt the planned substrate without re-planning

That is the clean current center.

If broader compatibility windows are introduced later, they should be layered explicitly on top of this model rather
than smuggled in as vague “schema compatibility.”

---

## 6. Error model: why a structured error type

We use a dedicated `SeqlokError` with:

- `code`
- `details`
- `meta`

The naming is partitioned by concern:

- `spec.*`
- `plan.*`
- `backing.*`
- `handoff.*`
- `binding.*`
- runtime family errors where appropriate

This keeps failures legible.

The important architectural point is that authored-contract failures, planning failures, backing failures, and binding
failures are not one undifferentiated blob. The layering should stay visible in the error model too.

---

## 7. Things not in core

A lot of older ideas come back around as tempting API additions. The short rule is:

Seqlok is the wire, not the app store.

That is why core does **not** own:

- rich transactions
- subscriptions
- app-level reactivity semantics
- builder-only convenience abstractions masquerading as canonical contract

The reason is not minimalism for its own sake.
The reason is boundary discipline.

If a feature belongs above the wire, it should stay above the wire.

---

## 8. Mostly frozen versus revisitable

### Mostly frozen

- controller / processor / observer role split
- explicit handoff model
- `defineSpec -> planLayout -> allocateShared -> buildHandoff -> acceptHandoff -> bind*`
- the builder as premium authoring surface over a canonical AST
- semantic compilation before planning, even if currently internal to `defineSpec(...)`
- deterministic layout planning
- explicit hot-path versus colder-path boundaries

### Revisit with strong justification

- exact method names inside bindings
- future public surfacing of semantic compilation as a separate function
- schema artifact packaging details
- advanced authored-contract features that still lower into the same canonical AST

---

## 9. Hard invariants

- The canonical authored format is the spec AST, not the builder callback.
- The builder DSL is the premium TypeScript surface over that AST.
- `defineSpec(...)` is currently the public authored-contract boundary.
- Planning consumes the validated runtime contract, not builder-only behavior.
- No downstream stage may depend on builder-only behavior.
- Published schema is part of the authored-contract story, not an incidental implementation detail.
- Seqlok remains a typed shared-memory wire, not a reactive state-management framework.

---

## 10. Short version

Seqlok does not begin with a builder.
It begins with an authored contract.

The builder is the premium way to author that contract in TypeScript.
The AST is the canonical durable form of that contract.
`defineSpec(...)` is currently where authored input becomes the validated runtime contract.
Planning and runtime realization happen downstream of that boundary.

That is the stack.
