# API and Naming Rationale

**Audience:** maintainers, contributors, and anyone asking why the public Seqlok surface is named and shaped the way it
is.

**Status:** design rationale, not the normative API reference.

This document explains why the core surface uses its current verbs and role names, what those names are trying to
protect, and which naming temptations Seqlok deliberately rejects.

For the live runtime role model and public signatures, see:

- `03-seqlok-concurrency-model-and-roles.md`
- `07-seqlok-api-shape-rationale.md`
- `09-seqlok-api-reference.md`

---

## 1. Top-level mental model

Seqlok is a typed shared-memory coordination kernel with three first-class roles:

- **controller**
- **processor**
- **observer**

But the runtime surface does not begin with those bindings.
It begins with an authored contract.

That contract is normalized into a validated runtime contract, then planned, then realized in backing memory, then
handed across a boundary, then bound into a role-specific surface.

The conceptual stack is:

```text
authored contract
  → defineSpec(...)
    → validated runtime contract
      → planLayout(...)
        → backing
          → handoff
            → accepted handoff
              → role bindings
```

This ordering matters because it keeps ownership honest:

- authored meaning is settled before planning
- planning owns layout, not authored interpretation
- handoff owns boundary transfer
- bindings own role-specific runtime access

The names are chosen to reinforce that separation.

---

## 2. The contract is primary, not the builder callback

One of the most important naming and teaching corrections in modern Seqlok is this:

> the builder callback is not the contract model

The authored contract is primary.

Seqlok accepts more than one authoring surface:

- a plain object / AST-style authored shape
- a builder callback for premium TypeScript ergonomics

Both routes lower into the same semantic boundary.

So when this document talks about names, it is doing so from the authored-contract model outward.
Not from the callback DSL inward.

That is why the surface centers on verbs like:

- `defineSpec`
- `planLayout`
- `buildHandoff`
- `acceptHandoff`
- `bindController`
- `bindProcessor`
- `bindObserver`

and not on some “big builder object” story.

---

## 3. Why `defineSpec`

We keep `defineSpec(...)` because it says the right thing at the right layer.

It does not merely mean “run some builder sugar.”
It names the public semantic-compilation boundary where authored input becomes the validated runtime contract.

Why this name works:

- it reads declaratively
- it matches established configuration DSL conventions without being vague
- it does not overclaim runtime behavior
- it allows both plain-object and builder-based authoring without changing the meaning of the call

Rejected directions:

- `buildSpec`
- `createSpec`
- `makeSpec`

Those sound more like factories than a semantic boundary.
They understate what the function actually does.

`defineSpec(...)` is the correct name because the call is about establishing contract meaning, not merely manufacturing
an object.

---

## 4. Why `planLayout`

`planLayout(spec)` is one of the most important verbs in the public surface because it names the move from contract
meaning into deterministic memory realization.

Why this name works:

- it foregrounds the output: a layout plan
- it makes planning explicit rather than implicit
- it avoids pretending this is just “build the next object”
- it reinforces that layout is a real owned layer in the system

Rejected directions:

- `planSpec`
- `createPlan`
- `buildPlan`
- `layoutSpec`

Problems with those alternatives:

- too generic
- too spec-centric
- too factory-like
- too likely to blur semantics and layout together

`planLayout(...)` tells the truth:

- authored meaning has already been normalized
- now we are planning layout

That is exactly the distinction the system needs.

---

## 5. Why `allocateShared`, `allocateSharedPartitioned`, and `allocateWasmShared`

These names are deliberately concrete.

They name backing realization strategies, not abstract “resource creation.”

### `allocateShared`

This is the golden-path contiguous shared backing strategy.

Why the name works:

- it says allocation is happening
- it says shared memory is central
- it avoids vague nouns like “context” or “runtime”

### `allocateSharedPartitioned`

This says the same thing, but with the alternative packing strategy made explicit.

That parallel naming is good because:

- the plan stays the same
- only the backing realization changes
- the difference is visible in the API surface

### `allocateWasmShared`

This explicitly names Wasm-backed shared memory realization.

Again, that is the right layer to be explicit.
The contract and the plan do not become “Wasm contracts.”
The backing realization becomes Wasm-backed shared memory.

These names are better than something like:

- `createBacking`
- `createMemory`
- `allocateMemory`

because those names hide the part that matters most here: the backing strategy is not incidental.

---

## 6. Why `createSharedContext`

`createSharedContext(spec)` is a convenience surface, not a second architecture.

That is exactly why the name should sound like a helper and not like a hidden substrate owner.

It bundles:

- `spec`
- `plan`
- `backing`

into one host-side value.

Why the name works:

- “context” signals bundled resources and setup locality
- “shared” keeps the memory model visible
- “create” is appropriate because this is convenience allocation/setup work

The important doctrinal point is not the word “context.”
It is that the convenience bundle does not replace the explicit pipeline.

That is why Seqlok should not drift into teaching context as the real architecture.
The real architecture remains:

- contract
- plan
- backing
- handoff
- bindings

Context is just a host-side convenience bundle over that.

---

## 7. Why `buildHandoff` and `acceptHandoff`

These names encode one of the most important boundaries in the system.

### `buildHandoff`

This is the owner-side act of assembling the boundary envelope.

The name works because it sounds like a protocol event, not a generic serialization helper.

It says:

- a boundary transfer object is being prepared
- the owner side is doing the preparation
- the object is meant to be handed across a boundary

### `acceptHandoff`

This is the consumer-side trust-boundary step.

The name works because it says more than “parse” or “decode.”
It says the receiving side is validating and accepting the boundary object into trusted runtime use.

That distinction matters a lot.

Seqlok should not collapse this into hidden work inside another binding call, because then the trust boundary disappears
from the public story.

That is why the canonical consumer-side shape is:

```ts
const accepted = acceptHandoff(handoff);
const processor = bindProcessor(accepted);
const observer = bindObserver(accepted);
```

That pipeline teaches the truth:

- handoff acceptance is setup-path trust-boundary work
- role binding happens after that trust boundary

Rejected directions:

- `decodeHandoff`
- `parseHandoff`
- `receiveEnvelope`
- `buildEnvelope`

Those are either too mechanical or too generic.
They do not express the ownership boundary strongly enough.

---

## 8. Why the role names are `controller`, `processor`, and `observer`

Seqlok uses semantic role names, not location names.

That is a deliberate choice.

### Why `controller`

Controller is the role that:

- writes params
- reads meters
- usually lives on the owner / host / UI side

Why not `host`?

Because “host” is too overloaded and too topological.
It says where something might live, not what it owns.

Why not `mainThread`?

Because that is too implementation-specific.
A role should not be named after one possible runtime placement.

`controller` works because it names the role's function.

### Why `processor`

Processor is the role that:

- reads params
- writes meters
- usually lives in the execution loop / worker / worklet side

Why not `engine`?

Because `engine` starts to imply too much domain meaning.
Not every processor role is literally the engine identity of the application.

Why not `thread`?

Because that confuses runtime placement with role ownership again.

`processor` works because it names the functional role at the coordination boundary.

### Why `observer`

Observer is the read-only role that:

- reads params
- reads meters
- never becomes a writer

This name matters because Seqlok needed to stop hand-waving this role as “consumers” or “tools.”

`observer` says:

- read-only
- substrate-aware
- first-class

It is a better role name than vague umbrella language because it locks the ownership model cleanly.

---

## 9. Why `bindController`, `bindProcessor`, and `bindObserver`

The shared verb `bind` is intentional.

These APIs do not create the underlying substrate.
They attach a role-specific runtime surface onto an already-determined substrate.

That is exactly what “bind” says.

Why not:

- `createController`
- `makeProcessor`
- `openObserver`

Because those names either sound too factory-like or too disconnected from the shared substrate.

`bind*` keeps the ownership model visible:

- substrate already exists
- role surface is being attached to it

That is why the shared verb is one of the cleanest parts of the naming system.

---

## 10. Why controller param verbs are split

Controller param verbs are deliberately not collapsed into one giant update surface.

The core split is:

- `set`
- `update`
- `stage`
- `hydrate`

Each one carries cost and intent information.

### `set`

Single scalar write.

Why the name works:

- obvious
- narrow
- no mystery about scale

### `update`

Atomic multi-scalar patch.

Why this is better than old “setMany”-style language:

- it reads like patch semantics, not dumb blasting
- it keeps the surface honest about being a grouped scalar update

### `stage`

Array mutation through an explicit mutable view.

This name is good because it implies:

- write work is being prepared within a commit window
- the surface is not a casual scalar setter
- arrays are being treated differently on purpose

### `hydrate`

Cold-path bulk application surface.

This is a good name because it sounds like bulk state materialization rather than tiny hot-path mutation.

That distinction matters a lot.
The API should not hide bulk work under a name that sounds scalar-cheap.

---

## 11. Why processor verbs are `within` and `publish`

These names are among the most semantically successful parts of core.

### `within`

`processor.params.within(...)` says:

- there is a bounded coherent read window
- the callback lives within that window
- the surface is scoped and runtime-sensitive

That is much better than a generic `read`, `snapshot`, or property-based surface for the hot path.

### `publish`

`processor.meters.publish(...)` says:

- a coherent outward meter commit is being made
- the processor is the writer
- the operation is one explicit publish window

That is stronger and truer than vague alternatives like `writeMeters` or `commitMeters`.

The current names communicate scope and ownership well.
They should be treated as stable unless there is a truly better semantic replacement.

---

## 12. Why there is no giant do-everything API

Seqlok deliberately avoids “one big surface” thinking.

Examples of what it avoids owning in core:

- subscriptions
- reactive callbacks
- app-level transactions
- implicit planner/binder magic that hides the boundary steps
- property-object APIs that disguise commit scope

This restraint is part of the naming rationale too.

When a system owns too many layers, its names become mushy:

- store names leak into wire semantics
- convenience names start lying about ownership
- runtime cost disappears behind pretty syntax

Seqlok avoids that by keeping the names blunt and layer-specific.

---

## 13. Naming rules that fall out of the doctrine

A good Seqlok public name should do at least one of these clearly, and preferably more than one:

- reveal the owned layer
- reveal the role boundary
- reveal whether this is setup, layout, boundary transfer, or runtime binding work
- reveal whether the operation is narrow or bulk
- avoid inventing a second authority model where none exists

A bad public name usually does one of these:

- hides the owned layer
- sounds like generic app-state convenience
- blurs authored meaning and runtime layout
- blurs trust-boundary work and role-binding work
- blurs hot-path and cold-path semantics

That is the real naming test.
Not whether a word sounds modern.

---

## 14. What is stable and what is still just convenience

Mostly stable at the doctrinal level:

- `defineSpec`
- `planLayout`
- `allocateShared` / `allocateSharedPartitioned` / `allocateWasmShared`
- `createSharedContext`
- `buildHandoff`
- `acceptHandoff`
- `bindController`
- `bindProcessor`
- `bindObserver`
- controller / processor / observer role names
- the split between narrow hot-path verbs and colder bulk/setup verbs

Convenience surfaces should always remain subordinate to the primary model.

If a future convenience helper starts to obscure those boundaries, it should be treated with suspicion.

---

## 15. Short version

The public Seqlok naming system is trying to preserve a few truths:

- authored contract comes first
- planning is its own owned layer
- backing realization is explicit
- handoff is a real boundary event
- acceptance is a real trust-boundary step
- roles are semantic, not topological
- binding attaches a role to a substrate, it does not invent the substrate
- narrow verbs should stay narrow
- bulk/setup verbs should admit they are bulk/setup work
- convenience helpers may exist, but they are not co-equal architectural pillars

That is why the names look the way they do.

They are not arbitrary.
They are trying to stop the architecture from lying.
