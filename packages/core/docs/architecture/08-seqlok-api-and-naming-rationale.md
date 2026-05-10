# API & Naming Rationale

**Audience:** future maintainers, contributors, and “why is it called that?” readers.
**Status:** design rationale, not user-facing API docs.

This file explains _why_ the core Seqlok API is shaped and named the way it is, which alternatives we tried, and which
parts of the surface are considered "frozen" for v1.

For how the pieces fit together at a systems level, see:

- **08 – Primitives & Seqlock** (dual-counter seqlock)
- **09 – Backing & Layout** (planes, offsets, hashing)
- **11 – E2E Visual Guide** (spec → plan → backing → handoff → bindings)
- **12 – Coherent Reads & Memory Planes** (snapshot/within + planes)
- **13 – Implementation Notes (Kernel)** (low-level mechanics)

This doc is the naming + semantics layer on top of that.

---

## 1. Top-level mental model

Seqlok is a **typed shared-memory wire** between:

- a **controller side** (main/UI/host/orchestrator),
- a **processor side** (worker / AudioWorklet / DSP loop), and
- (v0.2.0+) one or more **observer sides** (HUDs, inspectors, telemetry-only workers).

The owner/main side is responsible for:

```ts
// 1) Describe the schema.
export const spec = defineSpec(({ param, meter }) => ({
  id: "my-synth",
  params: {
    gain: param.f32({ min: 0, max: 1 }),
    cutoff: param.f32({ min: 20, max: 20_000 }),
    mode: param.enum(["off", "lp", "hp"]),
    curve: param.f32.array({ length: 1024 }),
  },
  meters: {
    peak: meter.f32(),
    frame: meter.f32.array({ length: 256 }),
  },
}));

// 2) Plan a memory layout from the spec.
const plan = planLayout(spec);

// 3) Allocate backing memory (SharedArrayBuffer + typed planes).
// Contiguous golden path:
const backing = allocateShared(plan);
// Advanced: per-plane SABs via allocateSharedPartitioned(plan).

// 4) Bind the controller role on the owner/main side.
export const controller = bindController(spec, plan, backing);

// 5) Build a handoff bundle for consumer side(s).
export const handoff = buildHandoff(plan, backing);
```

The processor/observer side never sees the _value_ of `spec` at runtime. It only consumes the planned layout embedded in
the handoff:

```ts
// worker / AudioWorklet
import { acceptHandoff, bindProcessor, bindObserver } from "@seqlok/core";
import type { MySpec } from "./spec";
import type { Handoff } from "@seqlok/core";

type InitMessage = { type: "INIT"; handoff: Handoff<MySpec> };

let proc: import("@seqlok/core").ProcessorBinding<MySpec> | undefined;
let hud: import("@seqlok/core").ObserverBinding<MySpec> | undefined;

self.onmessage = (ev: MessageEvent<InitMessage>) => {
  if (ev.data.type !== "INIT") return;

  const accepted = acceptHandoff(ev.data.handoff);
  //    ^? AcceptedHandoff<MySpec>

  proc = bindProcessor(accepted);
  hud = bindObserver(accepted);
  //  ^? ProcessorBinding<MySpec> / ObserverBinding<MySpec>
};
```

Conceptually:

1. `defineSpec` – describe the **schema** (params + meters).
2. `planLayout` – derive a **memory layout plan** from the spec.
3. `allocateShared` / `allocateSharedPartitioned` – allocate the **shared backing** (SAB(s) + planes).
4. `bindController` – attach the **controller role** to that backing.
5. `buildHandoff` / `acceptHandoff` – ship layout + backing across a boundary.
6. `bindProcessor` – attach the **processor role** to the accepted layout.
7. `bindObserver` – attach one or more **read-only observer roles** to that same layout/backing.

The verbs are chosen to reflect those responsibilities; the rest of this doc is mostly "why this name and not the
half-dozen other ones we tried".

---

## 2. Pipeline verbs: why these names

### 2.1 `defineSpec`

We kept `defineSpec` because it:

- mirrors other modern DSLs (`defineConfig`, `defineStore`, etc.),

- reads clearly in code:

  ```ts
  const spec = defineSpec(/* … */);
  ```

- emphasizes **declarative description**, not “do work now”.

Rejected variants:

- `createSpec`, `buildSpec` – more factory-ish, less obviously declarative.
- `makeSpec` – cute but weaker semantic signal.

The DSL lives here: keys, kinds, arrays vs scalars, enum vocabularies. All _types_ flow out of this one value.

### 2.2 `planLayout`

We converged on:

```ts
const plan = planLayout(spec);
```

Technically this is "please plan this spec", but what we actually care about is:

> derive a **memory layout** that we can implement in multiple languages.

`planLayout` makes the _output_ explicit. It also reads well in the golden pipeline:

```ts
const spec = defineSpec(/* … */);
const plan = planLayout(spec);
const backing = allocateShared(plan);
```

Rejected variants:

- `planSpec` – too spec-centric; downplays that the result _is_ the layout contract.
- `planMemory` – low-level tone, makes it sound like sizeof-math rather than ABI.
- `layoutSpec` – sounds like UI / layout engine territory.
- `createPlan` / `buildPlan` – generic factory verbs; lose the “plan” concept.

Final decision:

- **Canonical name:** `planLayout`.
- **Conceptual meaning:** “given this spec, plan a concrete layout across planes and seqlocks.”

### 2.3 `allocateShared` (not `allocateMemory`)

This step:

```ts
const backing = allocateShared(plan);
```

does something very specific:

- allocates **shared** memory (`SharedArrayBuffer`), and
- slices it into typed planes (`PF32`, `PI32`, `PB`, `PU`, `MF32`, `MF64`, `MU32`, `MU`) according to the plan.

We wanted that "sharedness" up front.

Alternatives and why they lost:

- `allocateMemory(plan)` – too generic; misses the key fact that this is SAB + Atomics territory.
- `allocateBacking(plan)` – call-site stutter: `const backing = allocateBacking(plan);`.
- `allocateSharedMemory(plan)` – accurate but noisy; the “memory” part isn’t buying much.
- `createBacking(plan)` – sounds soft; hides the fact this can realistically fail (out of memory / policy).

We kept **`allocateShared`** to:

- highlight shared memory,
- keep call sites short,
- leave room for a hypothetical `allocateLocal(plan)` story later (SSR / non-SAB simulations).

With v0.2.0, we add a sibling:

```ts
const backing = allocateSharedPartitioned(plan);
```

for per-plane SABs. Naming stays parallel:

- `allocateShared` – golden-path single SAB.
- `allocateSharedPartitioned` – first-class alternative for per-plane SAB packing.

Both are driven by the same `planLayout(spec)`; only the backing strategy changes.

### 2.4 `bindController` / `bindProcessor` / `bindObserver`

The two primary semantic roles:

- **Controller** – main/UI/host side:

  - writes params,
  - reads meters,
  - orchestrates intent.

- **Processor** – worker/audio/DSP side:

  - reads params,
  - writes meters,
  - runs the hot loop.

Bindings attach those roles to a backing:

```ts
const controller = bindController(spec, plan, backing); // owner/main side
const processor = bindProcessor(accepted); // processor side
```

Why **“controller”**?

- Matches the intuitive "controller reacts to UI/events and drives state".
- Reads cleanly in docs: `ControllerBinding<S>` vs `ProcessorBinding<S>`.
- Makes invariants easy to phrase:

  > “Each backing may have **at most one controller and one processor**.”

Why not `Host` or `Thread`?

- `Host` is overloaded in audio land (DAW/plugin host). The controller here might be one deck in a larger host.
- `Thread` is too implementation-specific (we also bind in Worklets and "same-thread processors").
- We want **semantic** names ("what they do"), not "where they live".

On the processor side, v2 removes the requirement to pass `spec` at runtime:

- **Old era:** `bindProcessor(spec, accepted)` – type + runtime spec on processor.
- **Current:** `bindProcessor(accepted)` – processor uses `AcceptedHandoff<S>` only; `S` is purely a _type_.

That aligns with the threat model (cooperative bundle, not hostile actors) and keeps processor code slim.

For observers, v0.2.0 surfaces the previously "conceptual" role as a real binding:

```ts
const observer = bindObserver(accepted);
```

- **Observer** is named to emphasize:

  - read-only params/meters,
  - HUD/visualization/telemetry use-cases,
  - no impact on seqlock writers.

The naming trio:

- **Controller** – writes params, reads meters.
- **Processor** – reads params, writes meters.
- **Observer** – reads params, reads meters.

makes roles self-explanatory while keeping the verbs symmetric (`bind*`).

### 2.5 Param verbs: `set`, `update`, `stage`, `hydrate`

The controller param API is intentionally small and verb-y:

- `params.set(key, value)` – scalar one-off write (**hot path**).
- `params.update(patch)` – atomic multi-param **scalar** write (**hot path**).
- `params.stage(key, cb(view))` – RAII writes into array params with exactly one seqlock bump (**hot path**).
- `params.hydrate(patch)` – bulk scalar + array patch for presets, snapshots, project restore, and IPC (**cold path**).

We explicitly moved away from earlier names like `setMany`:

```ts
// old prototype
controller.params.setMany({ gain: 0.5, cutoff: 2000 });

// current
controller.params.update({ gain: 0.5, cutoff: 2000 });
```

Reasons:

- “setMany” sounds like a blunt blast of a map into backing.
- “update” suggests **patch semantics** (“apply this update”) and reads better next to `publish` / `within`.

We also didn't ship a public `transaction` API; see §7.2 for that design history.

Key invariant:

- `update` is **scalar-only forever**: array params are always written through `stage` on the hot path, or through
  `hydrate` on the cold path.
- `hydrate` is explicitly **cold-path**: great for presets and snapshots, not meant for per-frame or audio-rate loops.

This keeps the cost profile of `update` obvious (no hidden large memcopies) while still making bulk state changes
ergonomic via `hydrate`.

### 2.6 Meter verbs: `publish`, `snapshot`, `version`

Meters are inverted:

- Processor side: `meters.publish(writer)` → single coherent commit.
- Controller side: `meters.snapshot(keys?, opts?)` → coherent read.
- Both sides: `meters.version()` → cheap change-detection counter (SEQ).

The idea is to make "write vs read vs change-check" obvious from the name:

- `publish` – push a new coherent set of meter values into shared memory.
- `snapshot` – pull a coherent view from shared memory.
- `version` – check whether the meter domain changed without reading payload.

Example controller loop:

```ts
const buffers = { spectrum: new Float32Array(2048) };
let lastVersion = 0;

function frame() {
  const v = controller.meters.version(); // MU.SEQ
  if (v !== lastVersion) {
    const { peak, spectrum } = controller.meters.snapshot(
      ["peak", "spectrum"],
      {
        into: buffers,
      },
    );

    drawMeters(peak, spectrum);
    lastVersion = v;
  }
  requestAnimationFrame(frame);
}
```

### 2.7 `buildHandoff` / `acceptHandoff` (not `Envelope`)

We use:

```ts
const handoff = buildHandoff(plan, backing);
const accepted = acceptHandoff(handoff);
const processor = bindProcessor(accepted);
```

We liked "handoff" because it sounds like a **protocol event**:

> one side builds a handoff, the other side accepts it.

The object is literally a _handoff_ of:

- the layout (plan metadata), and
- the shared memory (SAB list + plane offsets).

Why not `Envelope`?

- We tried `buildEnvelope` / `receiveEnvelope`.
- It _did_ match the `postMessage` vibe ("stick it in an envelope and send it").
- But:

  - too generic ("envelope for what?"),
  - too object-shaped, not lifecycle-shaped,
  - no implication of ownership/role.

Other rejected variants:

- `createHandoff`, `makeHandoff` – generic factory verbs, weaker semantics.
- `serializeBacking` – too low-level; ignores plan/layout semantics.

Final pairing:

- **Producer:** `buildHandoff(plan, backing)`
- **Consumer:** `acceptHandoff(handoff)` → `AcceptedHandoff<S>`
- **Binder:** `bindProcessor(accepted)` (and `bindObserver(accepted)` for read-only roles)

---

## 3. DSL & layout: what belongs here vs other docs

This doc isn't the full DSL reference (that's for the API ref), but a few naming decisions are worth recording.

### 3.1 Range-only numeric DSL

We converged on a **range-only** DSL for core numeric params:

```ts
const params = {
  gain: param.f32({ min: 0, max: 1 }),
  index: param.i32({ min: 0, max: 1023 }),
};
```

Deliberately _not_ included at DSL level:

- `step`
- `origin`
- `default` / `initialValue`

Those now live in UI / host policy; the kernel just enforces:

- the type (f32 vs i32),
- the allowed numeric **range**.

This keeps the spec:

- portable across very different UIs,
- stable as an ABI, not a UX contract.

### 3.2 Enum & enum arrays

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

Naming decisions:

- `values` – the enum vocabulary (labels), shared across all slots.
- `length` – number of slots; fixed by spec.
- Backing uses **indices** into `values` in the `PI32` plane.

We explicitly document this in "How Enum Arrays Work" so people don't assume we're repeating strings in memory.

---

## 4. Bindings: roles & responsibilities

### 4.1 ControllerBinding

Rough shape (omitting all the generics noise):

- **Params**

  - `params.set(key, value)` – single scalar write (range policy enforced, one commit).
  - `params.update(patch)` – atomic multi-scalar write (one commit).
  - `params.stage(key, cb(view))` – RAII array write with one commit.
  - `params.hydrate(patch)` – cold-path bulk patch for scalars + arrays (one commit).

- **Meters**

  - `meters.snapshot(keys?, opts?)` – coherent read.
  - `meters.version()` – SEQ counter.

This gives you:

- obvious hot-path verbs (`set`/`update`/`stage`),
- a single cold-path bulk verb (`hydrate`),
- a consistent story about atomic commits (one seqlock bump per call).

### 4.2 ProcessorBinding

Rough shape:

- **Params**

  - `params.within(cb)` – coherent read window.
  - `params.version()` – SEQ for params (advanced).

- **Meters**

  - `meters.publish(cb)` – stage/write/commit meter changes.

We intentionally don't expose `subscribe` here; see §7.3.

### 4.3 Why `acceptHandoff` is separate from `bindProcessor` / `bindObserver`

We **intentionally** keep:

```ts
const accepted = acceptHandoff(handoff);

const proc = bindProcessor(accepted);
const obs = bindObserver(accepted);
```

instead of collapsing it into a single:

```ts
// (intentionally *not* an API)
const proc = bindProcessorFromHandoff(handoff);
```

This isn't accidental boilerplate; it encodes a few important invariants.

> Note (v0.2.0): `bindObserver` started life as a purely conceptual role in design docs. It is now a real public binding
> with the same trust-boundary story as `bindProcessor`. This section still talks about it conceptually; see the API
> reference for the exact surface.

#### 4.3.1 Trust boundary vs role binding

Handoff decode and role binding have different responsibilities:

- `acceptHandoff(handoff)`
  → “I got this opaque envelope from somewhere. Decode it, validate it, and give me a **trusted** description of the
  backing and layout."

- `bindProcessor(accepted)` / `bindObserver(accepted)`
  → “Given a **trusted** handoff, attach my role-specific API to it."

Conceptually:

```txt
Owner side                     Wire                     Consumer side
-----------             ------------------             --------------
spec → plan → backing → Handoff<S>  → acceptHandoff → AcceptedHandoff<S> → bindProcessor / bindObserver
```

`acceptHandoff` is the **trust boundary**. Putting that logic _inside_ `bindProcessor` would hide this boundary and
blur "decode & verify" with "attach a processor".

#### 4.3.2 One decode, many bindings

A single consumer environment often needs multiple bindings to the **same** memory:

```ts
const accepted = acceptHandoff(handoff);

const proc = bindProcessor(accepted);
const hudObs = bindObserver(accepted);
const debugObs = bindObserver(accepted);
```

If `bindProcessor` internally did `acceptHandoff`:

- you either pay multiple redundant decodes, or
- you invent internal caching that entangles "decode the envelope" with "which bindings exist".

By keeping `acceptHandoff` explicit:

- the consumer decodes the envelope **once**, and
- the resulting `AcceptedHandoff<S>` becomes the canonical "this layout+backing is now trusted" handle, reusable across
  any bindings.

This is crucial for multi-domain / MWMR-style topologies where the same SAB+layout is observed by many roles.

#### 4.3.3 Not all consumers are processors

Some consumers only want to **observe** state (HUD, inspector, logging) and might never host a processor:

```ts
const accepted = acceptHandoff(handoff);

// This worker only inspects / visualizes state
const observer = bindObserver(accepted);
```

If `acceptHandoff` were "hidden inside" `bindProcessor`, we would need parallel “do-everything” entrypoints for other
roles or reintroduce `(spec, backing)` overloads for convenience. Keeping `acceptHandoff` as a standalone step gives
all consumer roles a shared, explicit decode step.

#### 4.3.4 Clear owner vs consumer split

The public API encodes a sharp distinction:

- **Owner side** (creates the world):

  - `defineSpec`
  - `planLayout`
  - `allocateShared` / `allocateSharedPartitioned`
  - `buildHandoff`
  - `bindController(spec, plan, backing, ...)`

- **Consumer side** (adopts the world):

  - `acceptHandoff(handoff)`
  - `bindProcessor(accepted, ...)`
  - `bindObserver(accepted, ...)`

Rule of thumb:

- If you have `spec + plan + backing`, you’re on the **owner** side → you can only bind a **controller**.
- If you only have a `Handoff<S>`, you’re on the **consumer** side → your first step is `acceptHandoff`.

Putting `acceptHandoff` inside `bindProcessor` or `bindObserver` breaks that mental model and encourages overloaded
“do-everything” entrypoints.

#### 4.3.5 Orchestration, registry, and tooling

Higher-level packages (`@seqlok/compose` / orchestration, registries, debug tools) work directly with handoff envelopes:

```ts
function attachDomain<S extends SpecInput>(handoff: Handoff<S>) {
  const accepted = acceptHandoff(handoff);

  // Decide role(s) based on context
  const proc = bindProcessor(accepted);
  const obs = bindObserver(accepted);
}
```

These layers care about:

- validating the envelope,
- tracking generations / growth,
- swapping bindings over time.

They need the decoded form (`AcceptedHandoff<S>`) without being forced to “also stand up a processor right now”.

#### 4.3.6 Performance vs semantics

`acceptHandoff`:

- runs **once per consumer per domain**, not per quantum,
- does envelope validation + view materialization,
- is firmly in the setup/boot path, not in the DSP/render hot path.

The cost is negligible compared to the clarity we gain:

- a clean pipeline: `Handoff<S> → AcceptedHandoff<S> → Binding`,
- a well-defined trust boundary,
- reusable decoded handoffs for multiple bindings,
- a stable owner/consumer split that scales to more roles and complex topologies.

Slogan:

> `acceptHandoff` is where a consumer says **“I trust this envelope now.”** > `bindProcessor` / `bindObserver` are how a consumer says **“Given that trusted memory, this is my role.”**

We keep them separate so the API surface permanently encodes that distinction, even when everything happens to run on
the same thread.

---

## 5. Handoff & verification semantics

The v2 canonical flow is:

- main side:

  - `defineSpec` → `planLayout` → `allocateShared` → `buildHandoff`

- processor side:

  - `acceptHandoff` → `bindProcessor(accepted)`

The **plan compatibility** story is:

- `planLayout` is deterministic for a given spec + options.
- The `Plan` carries a spec hash and layout metadata.
- `buildHandoff` embeds that plan into the handoff.
- `acceptHandoff` reconstructs an `AcceptedHandoff<S>` containing:

  - the SAB(s),
  - the per-plane offsets and lengths,
  - the plan metadata used by `bindProcessor`.

Where to do deep verification (plan diffing, extra paranoia) is left to higher-level tooling:

- core can expose `verifyHandoff(plan, accepted)` for test/dev usage;
- `bindProcessor(accepted)` is the slim golden path for production, matching the cooperative threat model.

We explicitly _do not_ require re-planning on the processor side in v2; `bindProcessor` works purely from
`AcceptedHandoff<S>`.

---

## 6. Error model: why a structured error type

We use a dedicated `SeqlokError` with:

- `code` – machine-readable identifier (e.g. `spec.invalid`, `plan.overflowRisk`, `binding.doubleBind`),
- `details` – structured per-throw payload (where, key, expected, received, etc.),
- `meta` – severity, scope, `boundarySafe` hints.

Naming rationale:

- Codes are partitioned by **layer**:

  - `spec.*` – DSL issues.
  - `plan.*` – planning/layout issues.
  - `backing.*` – `allocateShared` / SAB / planes issues.
  - `handoff.*` – build/accept/verify issues.
  - `binding.*` – controller/processor/observer binding issues.
  - `params.*`, `meters.*` – runtime value issues.
  - `diagnostics.*` – diagnostics-only failure modes.

This keeps telemetry and bug reports searchable by **concern** rather than one big error namespace.

We're deliberately conservative with granularity:

- `spec.rangeInvalid` is worth distinguishing from `spec.duplicateKey`;
- `spec.rangeInvalidStepOrigin` vs `spec.rangeInvalid` isn't, because the DSL no longer exposes step/origin.

---

## 7. Things _not_ in core (and why)

A lot of older ideas show up in conversations ("do you support transactions?"). The short answers live here, so they
don't keep re-appearing as accidental API surface.

### 7.1 Old host + thread bindings

The "big host" era had:

```ts
const host = bindHost(spec, backing);
const thread = bindThread(spec, backing);

host.params.set("gain", 0.5);
host.params.setMany({ gain: 0.5, cutoff: 2000 });

host.params.transaction((draft) => {
  draft.gain = 0.5;
  draft.cutoff = 2000;
});

host.params.subscribe("gain", (value) => {
  // reactive updates
});
```

Plus helpers like `setSpan` for array slices, plan strategies exposed as configuration, and microtask-batched
subscriptions.

This was fun but wrong-layered:

- It turned Seqlok into a **state management library** instead of a **wire**.
- It entangled **reactivity semantics** (subscribe/batching) with the ABI.
- It bloated the surface area with things apps/frameworks already do well.

Modern Seqlok keeps:

- the seqlock-backed memory model,
- the spec → plan → backing → handoff pipeline,
- atomic commits and coherent reads,

and leaves:

- transactions,
- subscriptions,
- app-level state orchestration,

to higher layers.

### 7.2 Why there is no public `transaction`

The `transaction(fn)` prototype API was intended as:

```ts
host.params.transaction((draft) => {
  draft.gain = 0.5;
  draft.cutoff = 2000;
});
```

We dropped it because:

- The atomicity we _do_ need is already provided by:

  - a single `params.update(patch)` call on the controller, and
  - the seqlock commit around that call.

- Anything richer ("nesting", "rollback", "commit/abort semantics") is **policy**, and looks different between apps.

If you want "transactional" higher-level operations, you write them in app code:

```ts
function setGainAndCutoff(
  ctl: ControllerBinding<typeof spec>,
  gain: number,
  cutoff: number,
) {
  ctl.params.update({ gain, cutoff });
}
```

So when someone asks "where is `transaction`?” the answer is:

> The atomic commit lives at `params.set` / `params.update` / `params.stage` / `params.hydrate` and `meters.publish`.
> Richer transactions live above the wire, not inside it.

### 7.3 Why there is no `subscribe`

Similarly, we removed the earlier:

```ts
host.params.subscribe("gain", (value) => {
  // listen to changes
});
```

because:

1. **Reactivity is a framework concern.**

   React, Vue, RxJS, Signals, etc. all have their own ideas about:

- scheduling,
- batching,
- backpressure,
- error handling.

Forcing one inside Seqlok would either be too opinionated or too weak.

2. **It complicates the mental model.**

   The controller's job in the wire model is simple:

- write params,
- occasionally read meters.

`subscribe` encourages people to treat Seqlok as a mini store, which drags in questions like:

- Are callbacks sync or batched?
- What's the ordering across keys?
- Which thread are callbacks on?
- What if a callback throws?

3. **It couples ABI and ergonomics.**

   The ABI is "typed shared memory + seqlocks". How you surface that into your UI or state layer is a separate concern.

If you want reactivity:

- use `params.update`/`params.set` as the commit point, and/or
- poll `meters.version()` + `snapshot` into whatever reactive system you're already using.

### 7.4 Old vs new concepts (quick map)

| Old prototype idea          | What it did                          | Current equivalent / story                        |
|-----------------------------|--------------------------------------|---------------------------------------------------|
| `bindHost`                  | Big main-thread binding with extras  | `bindController` (narrow, params/meters only)     |
| `bindThread`                | Worker binding                       | `bindProcessor(accepted)`                         |
| `params.setMany(patch)`     | Batch param write                    | `params.update(patch)`                            |
| `params.transaction(fn)`    | Multi-param window + batched signals | App-level helper using `update`                   |
| `params.subscribe(key, cb)` | Reactive watcher API                 | Not in core; userland stores/adapters handle this |
| Plan strategies in userland | Choose layout manually               | Single canonical planner: `planLayout`            |

Big shift:

> **Old Seqlok:** “small reactive store + memory wire.”
> **Current Seqlok:** “boring predictable wire” you _plug into_ your store / engine.

### 7.5 Why there is no `controller.params.volume.set(…)` or `.get()`

Seqlok bindings are a **typed shared-memory wire**, not a reactive store with per-field objects.

On the controller side:

- All **writes** go through `params.set`, `params.update`, `params.stage`, or `params.hydrate`, each of which maps
  directly onto a single seqlock-protected commit.
- All **reads** go through `params.snapshot(…)`, which gives you a coherent view of one or many params in a single
  seqlock read.

A property-style API like `controller.params.volume.set(0.8)`:

- would require either allocating per-param objects or using Proxy traps,
- obscures atomicity (two `.set(…)` calls mean two commits, not one),
- and hides the fact that reads are seqlock snapshots, not trivial property reads.

If you prefer "handles" like `volume.set(value)` and `volume.get()`, build them in your own control layer on top of the
controller binding (for example, small helpers that delegate to `params.set` / `params.snapshot`).
`@seqlok/core` stays the boring, explicit wire.

---

## 8. Frozen vs revisitable decisions (v1)

**Mostly frozen for v1:**

- Pipeline verbs and roles:

  - `defineSpec` → `planLayout` → `allocateShared` / `allocateSharedPartitioned`
    → `buildHandoff` → `acceptHandoff` → `bindController` / `bindProcessor` / `bindObserver`.

- Controller vs processor vs observer split and their responsibilities.

- Range-only numeric DSL (`{min,max}`) and the current param/meter kind set:

  - params: `f32`, `i32`, `bool`, `enum`, `*.array`, `enum.array`.
  - meters: `f32`, `f64`, `u32`, `bool`, `*.array`.

- “One atomic commit per `params.set` / `params.update` / `params.stage` / `params.hydrate` / `meters.publish`”
  semantics.

- Seqlock-based coherence with per-family control planes (`PU`, `MU`).

- Cooperative same-bundle threat model (no adversarial JS hardening beyond compatibility checks).

**Revisitable (with strong justification):**

- Exact method names _within_ bindings if a better verb set emerged (`update` / `publish` / `within` is pretty clean,
  but not sacred).
- The exposure shape of debug/verification helpers (`verifyHandoff`, dev-only paranoid modes).
- Soft limits / tuning knobs for `planLayout` (max array length, total bytes).
- Where exactly advanced sanity checks live (core vs `@seqlok/debug`-style addon).

If you change any of the **frozen** names or semantics, this doc should be updated with:

- the new canonical name,
- the rationale,
- and the alternatives that were considered and rejected.

That's how we keep the API intentional instead of "whatever sounded nice that week".

---

## 9. Diagnostics domain (`diagnostics.*`)

Diagnostics in Seqlok is **introspection-only**. It lives entirely off the hot path and is not required for normal use.

There are three layers involved:

1. **Errors (`diagnostics.*`)**

- `diagnostics.counterInvalid`
- `diagnostics.featureInvalid`

These are raised when the _diagnostics subsystem itself_ is misconfigured or corrupted:

- invalid counters / budgets / timestamps,
- unknown diagnostics feature flags.

They carry `ErrorMeta` with:

- `severity: 'warning'`
- `recoverable: true`
- `boundarySafe: false`

2. **Health interpretation**

   The central `interpretHealth(error)` helper treats `diagnostics.*` as:

- `status: 'degraded'`
- label along the lines of "Diagnostics subsystem issue"
- hint: "Introspection is misconfigured; core engine remains healthy."

This keeps diagnostics failures clearly separate from engine failures.

3. **Diagnostics toolkit (internal, non-barrel)**

   This lives under `src/diagnostics/*` and is currently _not_ part of the public API:

- `counters` – named introspection counters (degraded snapshots, spin budget exhaustions, …)
- `budgets` – validated limits for diagnostics-only work
- `features` – typed debug feature flags (e.g. `seqlockTrace`, `swapTimeline`)
- `session` – start/end diagnostics sessions with timestamp sanity
- `export` – JSON / Prometheus / CSV export for counters

These modules are intended for:

- CI / stress tests,
- dev HUDs and profiling tools,
- Node/Electron CLIs that scrape diagnostics.

Core primitives, planning, backing, and bindings **do not depend** on diagnostics. Integration is opt-in and always
attached at the edges (tests, tools, dev wrappers), never in the real-time hot path.
