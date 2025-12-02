# API Shape Rationale: `spec → plan → backing → handoff → binding`

Why Seqlok takes `spec`, `plan`, and `backing` explicitly, and why that is intentional, not accidental boilerplate.
This chapter also links the naming to responsibilities and folds in lessons learned while building the Typebits plan
library.

---

## Golden pipeline (public surface)

Canonical flow, split across owner (controller) and processor agents.

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  buildHandoff,
  receiveHandoff,
  bindController,
  bindProcessor,
} from "@seqlok/core";
import type { Handoff } from "@seqlok/core";

// Owner / controller side
const spec = defineSpec(/* ... */);
const plan = planLayout(spec);
const backing = allocateShared(plan);
const controller = bindController(spec, plan, backing);
const handoff = buildHandoff(plan, backing);

// Processor / worker side
let processor: ReturnType<typeof bindProcessor> | undefined;

self.onmessage = (
  ev: MessageEvent<{ type: "HANDOFF"; handoff: Handoff<typeof spec> }>,
) => {
  if (ev.data?.type !== "HANDOFF") return;

  const received = receiveHandoff(ev.data.handoff); // reconstructs a safe view
  const processor = bindProcessor(received); // typed by generic if you want: bindProcessor<MySpec>(received)
};
```

The pipeline appears "long" by design.
Each verb reflects a distinct domain with its own invariants and error codes.

---

## 1. Roles of `spec`, `plan`, `backing`, `handoff`, `binding`

| Object    | Role                                     | Owned by       |
|-----------|------------------------------------------|----------------|
| `spec`    | Semantic contract (params/meters)        | spec domain    |
| `plan`    | Deterministic plan blueprint             | plan domain    |
| `backing` | Concrete memory implementing a plan      | backing domain |
| `handoff` | Serializable description of plan+memory  | handoff domain |
| `binding` | Safe facades over memory (R/W protocols) | binding domain |

### `spec`

- Parameter and meter names
- Types (`f32`, `i32`, `bool`, `enum`, arrays)
- Ranges, lengths, enum codec
- Drives TypeScript-level typing

`spec` is a **semantic description** of the contract between controller and processor.
It says _what_ the participants agree to, not _how_ it will be implemented in memory.

### `plan`

- Pure, deterministic mapping from `spec` to byte layout
- Assigns planes, offsets, lengths, alignment
- Computes byte lengths by plane
- Computes plane packing and order

`plan` is a **blueprint**: a pure, serializable description of how the contract is projected into bytes.

Requirements on `plan`:

- Deterministic given a `spec`.
- Independent of any actual memory resources.
- Stable across processes, as long as versions match.

The plan is the bridge between semantic types and raw memory.

### `backing`

- Concrete memory (e.g. `SharedArrayBuffer`) sliced into typed planes
- Implements the layout described by `plan`
- Owns the actual `TypedArray` views

`backing` is where the bytes live.

Key properties:

- Stays deliberately **dumb**: it does not know about `spec` or logical roles.
- Only knows "planes", "offsets", and "lengths".
- Agnostic to how those planes will be used (params vs meters).

### `handoff`

- Version, hash, total bytes
- Plane byte lengths
- References to shared memory (e.g. a SAB)
- Purely structured data suitable for `postMessage` / structured clone
- Enough information for another agent to safely reconstruct binding views without having the original `spec`

### `binding`

- **Controller binding**

  - Writer for Params; reader for Meters.
  - Enforces param range policies and SWMR on the controller side.

- **Processor binding**

  - Reader for Params; writer for Meters.
  - Enforces seqlock coherence and SWMR on the processor side.

- **Observer binding (v0.2.0+)**

  - Reader for Params; reader for Meters.
  - Read-only role for HUDs, inspectors, logging, and telemetry.
  - Uses the same seqlock protocol and coherence policies, but exposes only snapshot/within-style APIs.

Binding objects are the only sanctioned way to touch shared memory in normal code.

---

## 2. Why the "duplication" is intentional

Two calls look superficially redundant:

```ts
const controller = bindController(spec, plan, backing);
const handoff = buildHandoff(plan, backing);
```

In both cases the **pairing** is the same: _"this plan is implemented by this backing"_.

### 2.1 `bindController(spec, plan, backing)` — trusted assembly

Controller binding is the point where the owner side (usually main thread) _proves_ that `spec`, `plan`, and `backing`
are coherent.

`bindController`:

- Verifies that `plan` matches `spec`:

  - same param/meter keys,
  - types match,
  - array dimensions match,
  - enums match.

- Verifies that `backing` has enough capacity to hold all planes for the plan.

- Produces typed facades for params/meters.

`bindController` is a **trusted operation**, usually happening in the "owner" domain:

- If this check fails, it's a clear bug in wiring.
- It's okay to throw loudly; the owner can crash early.
- Errors here are categorized under `binding.*` and do not involve cross-origin concerns.

Once `controller` exists, downstream code does not need to care about memory layout details.

#### Why not let `bindController` allocate memory?

A tempting alternative signature:

```ts
// REJECTED: hides memory responsibility
const controller = bindController(spec, plan);
```

This blurs responsibilities:

- Is `bindController` now responsible for **allocating** shared memory?
- How does the caller get access to the backing for handoff?
- What if we want _different_ allocation strategies (contiguous SAB vs partitioned per-plane SABs vs WASM memory)?

By forcing the caller to provide `backing` explicitly, we ensure:

- Memory allocation stays in the **backing** domain, decoupled from binding.
- It's trivial to swap allocation strategies while keeping the binding protocol stable.
- We avoid an overpowered verb that both allocates and validates.

If ergonomics are needed, they should be layered above, in simple helpers that call the explicit building blocks.

#### Why not feed `spec` directly into `buildHandoff`?

Another tempting shortcut:

```ts
// REJECTED: collapses the plan domain
const handoff = buildHandoff(spec, backing);
```

Reasons this is rejected:

- It conflates `spec` (semantic contract) with `plan` (byte layout).
- It requires `buildHandoff` to re-run planning or have hidden knowledge of the plan.
- It undermines the goal that `plan` is the **only** record of the layout.

Instead:

- The owner is expected to call `planLayout(spec)` once, and hold onto the result.
- `buildHandoff(plan, backing)` has everything it needs:

  - the blueprint (`plan`),
  - the actual memory (`backing`).

### 2.2 `buildHandoff(plan, backing)` — plan vs resource

The handoff literally states:

> “This plan (`plan`) is implemented by this memory (`backing`).”

Keeping them separate:

- Preserves **auditability**:

  - You can log a handoff, inspect sizes, and assert invariants without reconstructing the plan.

- Respects **versioning**:

  - Older processors can reject mismatched versions/hashes.
  - Newer processors can choose to accept or reject depending on backward compatibility policy.

- Keeps **consumer-side** logic simple:

  - `receiveHandoff` doesn't need to know about `spec`.
  - It just validates the plan/backing pair and produces a `ReceivedHandoff<S>`.

Handoff is intentionally focused on the _artifact pair_ (plan+backing).
Semantic meaning (param names, meter purposes) is carried only via the spec hash and type-level information, not dynamic
runtime data.

---

## 3. Why `spec → plan → backing` explicitly, not `spec → binding` directly

From a UX perspective, it's tempting to want:

```ts
// Magical: give me everything in one call
const { controller, processorHandles } = seqlokWire({
  spec,
  ownerRole: "controller",
});
```

Seqlok deliberately resists this pattern in its **kernel** API.

### 3.1 Explicit domains → explicit invariants

Each domain has its own invariants and error codes:

- **spec domain**:

  - shape of params/meters,
  - valid ranges and lengths,
  - enum codecs.

- **plan domain**:

  - deterministic mapping from spec to byte layout,
  - stability guarantees across builds,
  - versioning and hashing.

- **backing domain**:

  - allocation strategies (SAB vs WASM vs other),
  - bounds and alignment checks,
  - ownership semantics.

- **handoff domain**:

  - decoupled serialization,
  - validation at trust boundaries,
  - compatibility checks.

- **binding domain**:

  - R/W protocols,
  - seqlock handling,
  - convenience surface for users.

By keeping calls explicit, Seqlok makes it clear:

- where each error can originate,
- which module is responsible for which invariant,
- what needs to be tested independently.

### 3.2 Multiple bindings from a single plan/backing

Another reason for explicit `plan` and `backing` is **multiple roles** over the same memory.

Examples:

- A single `plan` / `backing` pair can underpin:

  - one controller binding (owner),
  - one processor binding (DSP loop),
  - several observer bindings (HUD, telemetry, debugging workers).

- Partitioned allocation strategies (`allocateSharedPartitioned`) normalize to the same logical plan.

If the kernel API jumped directly from `spec → binding`, reusing the same memory across roles becomes opaque:

- You would risk hidden allocations per binding.
- You would complicate any debugging of memory usage.
- You would make it harder to reason about lifetimes and ownership, especially in multi-agent scenarios.

### 3.3 Independent evolution of domains

Keeping `spec`, `plan`, `backing`, and `handoff` separate allows:

- Evolving **plan** algorithms (alignment strategies, per-plane packing) without touching:

  - allocation code,
  - binding code.

- Evolving **backing** strategies (SAB vs WASM vs hybrid) without changing:

  - how plans are generated,
  - how handoffs are constructed.

- Evolving **handoff** structure, e.g.:

  - adding new hashes / signatures,
  - supporting different transport layers.

Each domain can be improved or optimized in isolation, as long as its interface remains stable.

---

## 4. Lessons from Typebits and early iterations

Seqlok's shape is heavily informed by prior work on the Typebits plan library and early iterations of Seqlok itself.

### 4.1 Typebits: pure planning as a first-class citizen

Typebits was designed as a **pure planning** library:

- Accepts a semantic description of buffers and views.
- Produces deterministic layouts (planes, offsets, lengths).
- Has no knowledge of real memory – it only talks about _spaces_.

Experience from Typebits reinforced:

- Plans should be free of side-effects.
- Planning is a separate concern from binding and from allocation.

Seqlok adopts the same philosophy:

- `planLayout` can be used in test harnesses, design tools, or static analysis without any actual memory.
- Plans can be cached, diffed, and versioned independently of runtime objects.

### 4.2 Early Seqlok iterations: enriched backings and the "god object" problem

Early versions of Seqlok experimented with "enriched backings":

```ts
interface EnrichedBacking<S> {
  plan: Plan<S>;
  sab: SharedArrayBuffer;
  // ...plus extra helper methods
}
```

This "god object" caused several issues:

1. **Testing complexity**:

- Plan tests had to work through enriched backings.
- Backing tests had blurred responsibilities (planning + allocation + binding knowledge).

2. **Layer violations**:

- Backing code started to know too much about:

  - spec shape,
  - semantic meaning of planes,
  - binding behavior.

3. **Ecosystem rigidity**:

- Integrating with other memory managers (e.g., engine-level pools) became difficult.
- Backings carried assumptions that didn't hold in all contexts.

The backlash from these experiments led to a hard rule:

> Backing stays dumb; planning stays pure; binding is the only place that understands both.

### 4.3 Why `plan` is a first-class value, not an implementation detail

It might be tempting to treat `plan` as an internal detail of `allocateShared`:

```ts
// REJECTED: hides plan as an implementation detail
const { backing, controller } = seqlokMakeAll(spec);
```

This hides important details:

- The plan – layout, alignment, and sizes – is a **contract**, not an implementation leak.
- Post-mortem debugging often needs the plan:

  - "Why is this meter misaligned?"
  - "Why does this consumer think the buffer length is N?"

By making `plan` explicit:

- You can log it, snapshot it, and add it to bug reports.
- You can assert version compatibility independently of memory allocation.

It also supports the case where planning is done **offline**:

- Pre-compute plans for all engine presets.
- Store them in a manifest.
- Allocate backings lazily at runtime.

### 4.4 Why `handoff` is decoupled from `spec`

`handoff` carries:

- plan identity and versioning (hash),
- backing identity and sizes,
- enough metadata to validate and reconstruct bindings on the consumer side.

It intentionally does **not** carry the full `spec` value.

Reasons:

- Specs can be large (especially with complex enum codecs and large array params).
- Spec values often live in bundles that shouldn't be rehydrated in all consumers.
- Different agents may carry different versions of the same spec type.

Instead:

- The spec hash is the syncing primitive at the semantic level.
- Type-level generics (`Handoff<MySpec>`) enforce coherence in TypeScript at the call site.
- Runtime validation focuses on plan/backing consistency.

If a consumer needs the actual `spec`, it's expected to import it from its own bundle or manifest.

### 4.5 Observer roles (v0.2.0+) and the N×B₂ use-case

With v0.2.0, Seqlok surfaces a concrete `bindObserver` binding.

Key lessons folded into this:

- There can be multiple read-only consumers over the same plan/backing:

  - HUDs, meters, performance dashboards, logging workers.

- Readers must see coherent snapshots but must not interfere with:

  - controller param writes,
  - processor meter publishes.

`bindObserver`:

- Uses the same underlying plan/backing pair.
- Shares seqlock semantics with processor for read coherence.
- Exposes a reduced, read-only API:

  - `params.snapshot(...)`, `params.within(...)`,
  - `meters.snapshot(...)`, `meters.within(...)`.

Observer roles are a first-class part of the N×B₂ story:

- Many independent observer agents can be wired to the same backing.
- Each has its own budget/degrade policy, independent of processor/controller.

### 4.6 Partitioned backings (v0.2.0+) and allocation flexibility

In addition to the golden path `allocateShared(plan)` (one SAB, contiguous planes), v0.2.0 introduces
`allocateSharedPartitioned(plan)`:

- Splits each plane into its own `SharedArrayBuffer`.
- Keeps the same logical plan.
- Reflects back to the same binding semantics.

Lessons:

- Allocation strategies differ across environments:

  - Some prefer a single large SAB.
  - Others prefer smaller per-plane SABs for operational reasons (e.g. sandboxing, external ownership).

- The plan must not depend on allocation specifics:

  - `plan` remains a pure description.
  - Backing only cares about "does this bundle of buffers respect the plan?".

Both contiguous and partitioned backings are normalized by the plan and exposed via the same binding APIs.

### 4.7 Summary: why enrichment is banned in the kernel

Kernel-level `Backing` is deliberately boring:

- no attached `plan`,
- no attached `spec`,
- no behavior beyond "typed views over shared memory".

The **pairings** live in verbs:

- `allocateShared(plan)` / `allocateSharedPartitioned(plan)` → “give me a backing for this plan (contiguous or per-plane
  SABs).”
- `buildHandoff(plan, backing)` → “stamp this backing as implementing this plan.”
- `bindController(spec, plan, backing)` → “prove this spec matches this plan+backing.”
- `bindProcessor(received)` → “adopt the plan+backing pair referenced by this received handoff.”
- `bindObserver(received)` (v0.2.0+) → “attach a read-only observer role to this received plan+backing.”

Enriched backings are allowed, but only in orchestration layers that wrap these verbs. The kernel stays flat.

---

## 5. Performance considerations

All explicitness lives in **setup**:

- `planLayout(spec)`
- `allocateShared(plan)` / `allocateSharedPartitioned(plan)`
- `bindController(spec, plan, backing)`
- `buildHandoff(plan, backing)`
- `receiveHandoff(handoff)`
- `bindProcessor(received)` / `bindObserver(received)`

The hot paths:

- `processor.params.within(...)`
- `processor.meters.publish(...)`
- `controller.meters.snapshot(...)` (especially with `into` buffers)
- `observer.params.within(...)` / `observer.params.snapshot(...)`
- `observer.meters.within(...)` / `observer.meters.snapshot(...)`

…do:

- zero dynamic planning,
- zero memory re-interpretation,
- no per-access validation beyond the seqlock/Atomics protocol.

We trade a handful of explicit arguments in setup for:

- cleaner layering,
- stronger runtime checks at the edges,
- zero penalty where it actually hurts (RT loops).

---

## 6. Where ergonomics live

Ergonomics should be built **on top of** the golden pipeline, not inside it.

A good pattern for higher-level helpers is:

- Receive `spec` as input.
- Hide `plan` and `backing` where possible.
- Still call the explicit verbs under the hood.

### 6.1 Example: `createSharedWire` helper

```ts
import {
  allocateShared,
  bindController,
  buildHandoff,
  planLayout,
  receiveHandoff,
  bindProcessor,
} from "@seqlok/core";
import type {
  SpecInput,
  ControllerBinding,
  ProcessorBinding,
  Handoff,
} from "@seqlok/core";

export interface SharedWire<S extends SpecInput> {
  spec: S;
  plan: ReturnType<typeof planLayout<S>>;
  backing: ReturnType<typeof allocateShared<S>>; // or allocateSharedPartitioned<S>
  controller: ControllerBinding<S>;
  handoff: Handoff<S>;
}

function createSharedWire<S extends SpecInput>(
  spec: S,
  controllerOptions?: Parameters<typeof bindController<S>>[3],
): SharedWire<S> {
  const plan = planLayout(spec);
  const backing = allocateShared(plan); // or allocateSharedPartitioned(plan) in advanced setups
  const controller = bindController(spec, plan, backing, controllerOptions);
  const handoff = buildHandoff(plan, backing);

  return { spec, plan, backing, controller, handoff };
}

/**
 * Symmetric helper on the consumer side: handoff → processor binding.
 */
export function bindProcessorFromHandoff<S extends SpecInput>(
  handoff: Handoff<S>,
): ProcessorBinding<S> {
  const received = receiveHandoff(handoff);
  return bindProcessor(received);
}
```

Usage:

```ts
// main / controller side
import { spec } from "./my-spec";

const wire = createSharedWire(spec, {
  params: { rangePolicy: "clamp" },
});

// controllers writes params & snapshots meters
wire.controller.params.set("gain", 0.8);

// processor side: just attach from the handoff bundle
const processor = bindProcessorFromHandoff(wire.handoff);
```

This helper:

- Keeps the kernel API shape intact.
- Is trivial to test separately.
- Can evolve independently (e.g., to choose different allocation strategies).

### 6.2 Why ergonomics don't belong in `planLayout` or `allocateShared`

Putting ergonomics into these core verbs would:

- Obscure the domain boundaries.
- Make it harder to provide alternative strategies.
- Force advanced users to work "against" the abstraction rather than with it.

By keeping the kernel API intentionally low-level and explicit:

- Advanced users can build their own orchestration layers.
- Frameworks can wrap Seqlok in whichever higher-level abstractions they prefer.
- The core stays small and verifiable.

---

## 7. Naming decisions and rejected alternatives

We compared three slogans:

1. `defineSpec → planLayout → allocateMemory → buildHandoff → receiveHandoff → bind*`
2. `defineSpec → planLayout → allocateShared → buildHandoff → receiveHandoff → bind*` ← **chosen**
3. `defineSpec → defineLayout → allocateMemory → buildHandoff → receiveHandoff → bind*`

Why `allocateShared`:

- it's precise and truthful about the golden path: **contiguous shared memory**,
- `allocateSharedPartitioned` is the first-class variant for per-plane SABs when that layout is operationally nicer,
- more exotic allocation strategies (WASM memory, external backings) live behind separate helpers or integration layers.

Why not `defineLayout`:

- that verb belongs to a _raw_ plan library,
- Seqlok has a **semantic** DSL (`defineSpec`) followed by **byte planning** (`planLayout`); the layout is derived, we
  don't "define" it by hand.

Why keep `buildHandoff` / `receiveHandoff` instead of something shorter like `encodeHandoff` / `decodeHandoff`:

- `buildHandoff` implies:

  - validation of plan/backing coherence,
  - embedding of necessary metadata (hash, lengths, etc.).

- `receiveHandoff` implies:

  - decoding,
  - validation at the trust boundary,
  - production of a `ReceivedHandoff<S>` typed artefact.

The names are longer but intentionally descriptive; these are not hot-path calls.

---

## 8. Summary

The explicit API shape – `spec → plan → backing → handoff → binding` – is not accidental ceremony:

- Each object (`spec`, `plan`, `backing`, `handoff`, `binding`) lives in a separate domain.
- Each domain has its own invariants and error codes.
- The **only** places where domains meet are the explicit verbs:

  - `planLayout`,
  - `allocateShared` / `allocateSharedPartitioned`,
  - `buildHandoff` / `receiveHandoff`,
  - `bindController` / `bindProcessor` / `bindObserver`.

This structure enables:

- Clear responsibility boundaries.
- Independent evolution of planning, allocation, and binding logic.
- Powerful yet predictable ergonomics in higher-level orchestration code.

The cost is a slightly longer setup pipeline.
The payoff is a system that remains debuggable, testable, and adaptable under real operational pressure.

---

## 9. Introspect domain (`introspect.*`)

`@seqlok/introspect` is a **host-side sidecar** for observability and health. The runtime engine does not depend on it
and can run without it, but hosts are free to enable it in both development and production.

There are three layers involved:

1. **Errors (`introspect.*`)**

- `introspect.counterInvalid`
- `introspect.featureInvalid`

These are raised when the _introspection subsystem itself_ is misconfigured or corrupted:

- invalid counters / budgets / timestamps,
- unknown introspection feature flags.

They carry `ErrorMeta` with:

- `severity: 'warning'`
- `recoverable: true`
- `boundarySafe: false`

`introspect.*` errors represent issues in instrumentation or observability rather than core engine failures. They are
expected to be non-fatal and are primarily useful for developers and operators, even in production logs.

2. **Health interpretation**

   The central `interpretHealth(error)` helper treats `introspect.*` as:

- `status: 'degraded'`
- label along the lines of "Introspection subsystem issue"
- hint: "Introspection is misconfigured; core engine remains healthy."

This keeps introspection failures clearly separate from engine failures.

3. **Introspection toolkit**

   This lives under `src/*` in `@seqlok/introspect`:

- `counters` – named introspection counters (degraded snapshots, spin budget exhaustions, …)
- `budgets` – validated limits for introspection work
- `features` – typed feature flags (some dev-only like `seqlockTrace`, others production-appropriate)
- `session` – start/end introspection sessions with timestamp sanity
- `export` – JSON / Prometheus / CSV export for counters

These modules are intended for:

- CI / stress tests
- dev HUDs and profiling tools
- production dashboards and operator observability
- Node/Electron CLIs that scrape metrics

**Architectural invariant**: Runtime packages never import `@seqlok/introspect`. Production behaviour must not _rely_ on
introspect being present. This keeps the engine decoupled from observability, but does not ban introspect from
production—it simply means the engine runs correctly whether or not introspect is wired in.

## 10. Reviewer checklist

When reviewing changes to Seqlok's API shape, ask:

1. **Does this introduce a new object that crosses domains?**

- If yes, which domain should own it?
- Does it belong in the kernel or in a higher-level layer?

2. **Does this new helper respect the `spec → plan → backing → handoff → binding` pipeline?**

- Or does it try to "shortcut" by hiding these steps?

3. **Does this change couple previously independent domains?**

- E.g. does backing suddenly need to know about spec?
- Does planning suddenly depend on allocation?

4. **Is the proposed naming clear about which domain it lives in?**

- Verbs should reflect their responsibilities.
- Beware of verbs that do "too much".

5. **Can we test this change in isolation?**

- Plan changes should be testable without real memory.
- Backing changes should be testable with synthetic plans.
- Binding changes should be testable with fake specs/plans/backings.

Changes that keep domains separate, preserve explicit verbs, and avoid enriched god-objects are aligned with Seqlok's
design philosophy.
