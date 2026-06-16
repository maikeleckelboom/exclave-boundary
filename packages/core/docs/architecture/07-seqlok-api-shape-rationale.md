# API Shape Rationale: `spec → plan → backing → handoff → binding`

Why Seqlok takes `spec`, `plan`, and `backing` explicitly, and why that is intentional, not accidental boilerplate.

This document is about ownership boundaries.
The point is not ceremony.
The point is that each stage owns a different class of responsibility, and the public API should admit that plainly.

---

## Golden pipeline

Canonical flow, split across owner side and consumer side.

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  buildHandoff,
  acceptHandoff,
  bindController,
  bindProcessor,
  bindObserver,
} from "@seqlok/core";
import type { Handoff } from "@seqlok/core";

// owner side
const spec = defineSpec(/* ... */);
const plan = planLayout(spec);
const backing = allocateShared(plan);
const controller = bindController(spec, plan, backing);
const handoff = buildHandoff(plan, backing);

// consumer side
let processor: ReturnType<typeof bindProcessor> | undefined;
let observer: ReturnType<typeof bindObserver> | undefined;

self.onmessage = (
  ev: MessageEvent<{ type: "HANDOFF"; handoff: Handoff<typeof spec> }>,
) => {
  if (ev.data?.type !== "HANDOFF") return;

  const accepted = acceptHandoff(ev.data.handoff);
  processor = bindProcessor(accepted);
  observer = bindObserver(accepted);
};
```

The pipeline looks long because it names real stages:

- authored contract, structurally described by `@seqlok/schema`
- semantic compilation in `@seqlok/core` via `defineSpec(...)`
- byte plan
- backing realization
- boundary handoff
- role binding

If the kernel collapsed those into one magical call, it would hide the places where invariants actually live.

---

## 1. What each value owns

| Value     | Role                                     | Domain owner   |
| --------- | ---------------------------------------- | -------------- |
| `spec`    | compiled runtime contract                | core spec domain |
| `plan`    | deterministic byte plan                  | plan domain    |
| `backing` | concrete memory implementing a plan      | backing domain |
| `handoff` | serializable description of plan+memory  | handoff domain |
| `binding` | role-specific access surface over memory | binding domain |

### `spec`

`spec` is the value returned by `defineSpec(...)`. Core has already compiled the authored AST into runtime meaning:

- parameter and meter names
- kinds such as `f32`, `i32`, `bool`, `enum`, arrays
- ranges, lengths, enum vocabularies
- TypeScript-level contract shape
- canonical runtime identity

It says **what** exists.
It does not say how bytes are laid out.

The pre-`defineSpec(...)` authored AST belongs to `@seqlok/schema`; schema does not own this compiled runtime value.

### `plan`

`plan` owns deterministic projection into bytes:

- planes
- offsets
- lengths
- alignment
- byte totals
- compatibility metadata

It says how the semantic contract is projected into memory.
It does not allocate memory.

### `backing`

`backing` owns concrete memory:

- `SharedArrayBuffer` or other supported shared-memory realization
- typed-array views over the plan-defined layout
- capacity and bounds of the actual storage

Backing stays deliberately dumb.
It does not own spec semantics or runtime roles.

### `handoff`

`handoff` owns the transfer boundary:

- versioning
- plan identity
- sizes
- references to shared memory
- enough metadata to reconstruct a safe consumer-side view

It is the structured artifact that crosses the boundary.

### `binding`

`binding` owns role-correct access:

- controller writes params and reads meters
- processor reads params and writes meters
- observer reads params and meters

Bindings are the sanctioned runtime facades.
Normal code should not be touching raw shared-memory views directly.

---

## 2. Why the explicit pairings are intentional

Two pairings are easy to call "duplication" if you are not thinking in ownership terms:

```ts
const controller = bindController(spec, plan, backing);
const handoff = buildHandoff(plan, backing);
```

They are not duplicates.
They are two different claims.

### `bindController(spec, plan, backing)`

This says:

> "Prove that this semantic contract matches this plan and this backing, then give me the owner-side role surface."

That is why `bindController` takes all three inputs.

It is the trusted owner-side assembly point.

It verifies:

- that `plan` matches `spec`
- that `backing` is large enough and correctly shaped for `plan`
- that the role surface can be built safely

If this fails, the wiring is wrong and the failure should be loud.

### `buildHandoff(plan, backing)`

This says:

> "Stamp this backing as implementing this plan, so another agent can accept it across the boundary."

That is why `buildHandoff` does **not** take `spec`.

It is about the boundary artifact, not about re-proving semantic meaning.

---

## 3. Rejected shortcuts

### Rejected: `bindController(spec, plan)` allocating memory implicitly

```ts
const controller = bindController(spec, plan);
```

That would blur domains immediately.

Questions it would force:

- who owns allocation strategy?
- how does the caller get the backing for handoff?
- how do we swap contiguous, partitioned, or external backing strategies?

Allocation belongs in the backing domain, not inside binding.

### Rejected: `buildHandoff(spec, backing)`

```ts
const handoff = buildHandoff(spec, backing);
```

That would collapse semantic meaning and layout into one fuzzy step.

`buildHandoff` should not re-plan or carry hidden layout knowledge.
The plan is the authoritative record of layout.

### Rejected: `spec → binding` in one magical call

```ts
const { controller, processorHandles } = seqlokWire({ spec });
```

That shape is fine for higher-level helpers.
It is wrong as the kernel surface.

The kernel needs explicit stages because explicit stages make ownership testable, debuggable, and swappable.

---

## 4. Why `spec → plan → backing` stays explicit

### Explicit domains mean explicit invariants

Each domain has its own invariants and its own failure modes:

- **spec domain**

  - legal field kinds
  - valid ranges and shapes
  - canonical runtime identity

- **plan domain**

  - deterministic byte layout
  - alignment
  - plane assignment
  - compatibility metadata

- **backing domain**

  - allocation strategy
  - capacity
  - typed view realization

- **handoff domain**

  - transfer safety
  - trust-boundary validation
  - cross-agent reconstruction

- **binding domain**
  - role-correct access
  - seqlock usage
  - scoped runtime surface

If the API hides those stages, it also hides where the invariant failed.

### Multiple bindings over one substrate are real

A single `plan` / `backing` pair may underpin:

- one controller binding
- one processor binding
- several observer bindings

That is not an edge case.
It is part of the reason the kernel refuses to pretend that "spec goes straight to one binding."

### Independent evolution matters

Keeping `spec`, `plan`, `backing`, and `handoff` separate allows the system to evolve without hidden coupling.

You can change:

- planning rules without changing allocation strategy
- allocation strategy without changing binding semantics
- handoff metadata without rewriting the semantic layer

That separation is one of the main reasons the model stays durable.

---

## 5. Why `plan` is a first-class value

It is tempting to treat `plan` as an internal detail of allocation.
That is the wrong instinct.

`plan` is not an implementation leak.
It is the explicit record of byte-level contract realization.

Making `plan` explicit lets you:

- log it
- snapshot it
- diff it
- attach it to bug reports
- verify compatibility independently of actual allocation

It also supports offline or precomputed planning workflows.

If Seqlok ever hides `plan` inside "helpful" factories, it starts lying about where the layout contract actually lives.

---

## 6. Why `handoff` is decoupled from `spec`

`handoff` carries:

- plan identity
- sizes
- shared-memory references
- the metadata needed to accept the substrate safely on the consumer side

It intentionally does **not** carry the entire `spec` value.

Reasons:

- the spec is semantic input, not the boundary artifact
- specs can be large
- consumers may carry their own local copy of the same spec
- runtime validation should stay focused on plan/backing compatibility, not dynamic spec transport

The handoff is not "portable authored meaning."
It is "this already-planned substrate may now be accepted across the boundary."

---

## 7. Observer and allocation flexibility belong in the same model

Observer is not an afterthought.
It is one more reason the explicit pipeline is correct.

Many read-only consumers may attach to the same accepted substrate:

- HUDs
- telemetry workers
- performance dashboards
- debugging tools

Likewise, backing strategy may vary:

- one contiguous shared allocation
- partitioned per-plane allocation
- other supported shared-memory realizations

Those variations do **not** justify collapsing the kernel surface.
They justify keeping plan, backing, handoff, and binding separate so the variations remain honest.

---

## 8. Performance reason, not just architectural taste

All of this explicitness lives in setup:

- `planLayout(spec)`
- `allocateShared(plan)`
- `bindController(spec, plan, backing)`
- `buildHandoff(plan, backing)`
- `acceptHandoff(handoff)`
- `bindProcessor(accepted)`
- `bindObserver(accepted)`

The hot paths do **not** pay for that structure repeatedly:

- `processor.params.within(...)`
- `processor.meters.publish(...)`
- controller param writes
- observer snapshot and coherent read loops

Those hot paths do zero dynamic planning and zero memory reinterpretation.
The price is a handful of explicit setup calls.
The payoff is a runtime surface that stays cheap where it matters.

---

## 9. Where ergonomics belong

Ergonomics belong **above** the kernel.

A higher-level helper may absolutely hide some setup steps:

```ts
const wire = createSharedWire(spec);
```

That is fine, as long as the helper is transparently built on top of the explicit kernel verbs.

The same rule applies to key ergonomics. The canonical flat keyspace is the runtime identity; call sites consume it
directly. Any helper that projects it into another shape sits outside the ownership spine, is not a pipeline stage
between spec and planning, and does not own runtime identity.

The rule is:

- helpers may compress the ceremony
- helpers may not erase ownership boundaries from the kernel model

If ergonomics start living inside `planLayout`, `allocateShared`, or binding itself, the kernel stops being crisp.

---

## 10. Naming follows ownership

The names are intentionally descriptive because the calls name real boundaries:

- `defineSpec`
- `planLayout`
- `allocateShared`
- `buildHandoff`
- `acceptHandoff`
- `bindController`
- `bindProcessor`
- `bindObserver`

These are not hot-path calls.
Brevity is less important here than semantic honesty.

For the same reason, `buildHandoff` / `acceptHandoff` are better than shorter codec-sounding verbs like `encodeHandoff` / `decodeHandoff`.
The important thing is not merely serialization.
The important thing is building and accepting a trust-boundary artifact.

---

## 11. Reviewer checklist

When reviewing API-shape changes, ask:

1. Does this introduce a new object that crosses domains?
2. Does this helper preserve the `spec → plan → backing → handoff → binding` model?
3. Does it hide a real responsibility boundary?
4. Does the name say which domain owns the step?
5. Can the change still be tested in isolation at the domain it claims to belong to?

If a proposal collapses domains, hides plan ownership, or smuggles allocation into binding, it is moving in the wrong direction.
