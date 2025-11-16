# API Shape Rationale: `spec → plan → backing → handoff → bindings`

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
} from '@seqlok/core';

// owner / controller side
const spec = defineSpec(/* … */);
const plan = planLayout(spec);
const backing = allocateShared(plan);

const controller = bindController(spec, backing);
const handoff = buildHandoff(plan, backing);

worker.postMessage({ type: 'HANDOFF', handoff });

// processor / engine side
self.onmessage = (ev) => {
  if (ev.data?.type !== 'HANDOFF') return;

  const received = receiveHandoff(ev.data.handoff); // reconstructs a safe view
  const processor = bindProcessor(received); // typed by generic if you want: bindProcessor<MySpec>(received)
};
```

The pipeline appears "long" by design.
Each verb reflects a distinct domain with its own invariants and error codes.

---

## 1. Roles of `spec`, `plan`, `backing`, `handoff`, `bindings`

| Object     | Role                                     | Owned by       |
| ---------- | ---------------------------------------- | -------------- |
| `spec`     | Semantic contract (params/meters)        | spec domain    |
| `plan`     | Deterministic plan blueprint             | plan domain    |
| `backing`  | Concrete memory implementing a plan      | backing domain |
| `handoff`  | Serializable description of plan+memory  | handoff domain |
| `bindings` | Safe facades over memory (R/W protocols) | binding domain |

### `spec`

- Parameter and meter names
- Types (f32, i32, bool, enum, arrays)
- Ranges, lengths, enum codec
- Drives TypeScript types for controller/processor bindings
- Has identity (structure + hash) used for compatibility checks

### `plan`

- Plane byte lengths (PF32, PI32, PB, PU, MF32, MF64, MU32, MU, …)
- Slot tables: which key lives in which plane at which offset
- Lock placement and stride
- Layout hash and meta used for validation

### `backing`

- Actual `SharedArrayBuffer` (contiguous SAB in the golden path) or other shared memory in advanced setups
- Typed plane views and offsets mapped according to a given plan
- No semantics: it is "just memory arranged like that plan"

### `handoff`

- Version, hash, total bytes
- Plane byte lengths
- References to shared memory (e.g. a SAB)
- Purely structured data suitable for `postMessage` / structured clone
- Enough information for another agent to safely reconstruct bindings without having the original `spec`

### `bindings`

- **Controller binding**

  - Writer for Params; reader for Meters
  - Enforces param range policies and SWMR on the controller side

- **Processor binding**

  - Reader for Params; writer for Meters
  - Enforces seqlock coherence and SWMR on the processor side

Bindings are the only sanctioned way to touch shared memory in normal code.

---

## 2. Why the "duplication" is intentional

Two calls look superficially redundant:

```ts
const controller = bindController(spec, backing);
const handoff = buildHandoff(plan, backing);
```

In both cases the **pairing** is the point.

### 2.1 `bindController(spec, backing)` — lie detector

This is where Seqlok can prove that the `spec` driving UI and code generation matches the memory actually allocated.

It can check, for example:

- Does the spec hash match what the plan/backing claim to implement?
- Do plane byte lengths match expectations for this spec?
- Are control planes present and correctly sized?

Design invariant: **`spec` is the canonical semantic contract**.
`bindController(spec, backing)` is allowed to distrust everything else and verify compatibility before it hands out a
binding.

If this check fails, you get a typed `SeqlokError` instead of:

- Writing into the wrong offsets
- Reading "valid-looking" junk from a mismatched layout
- Debugging ghost bugs at 03:00 because plan + backing silently drifted

### 2.2 `buildHandoff(plan, backing)` — plan vs resource

The handoff literally states:

> “This plan (`plan`) is implemented by this memory (`backing`).”

Keeping them separate:

- Preserves **auditability**:

  - You can inspect "what was promised" (plan) vs "what was allocated" (backing).

- Makes the envelope **portable**:

  - Another agent can receive just the handoff and still reconstruct a safe view (via `receiveHandoff`).

- Keeps error domains clean:

  - Plan errors belong to the plan layer; resource errors belong to backing; handoff errors belong to handoff.

`buildHandoff(plan, backing)` is not "just serialization". It's the canonical point where plan and concrete memory are
paired and stamped for export.

---

## 3. Processor never sees `plan` or raw `backing`

In the golden flow, the processor side **never** deals with plans or backings directly:

```ts
const received = receiveHandoff(handoffFromMain);
const processor = bindProcessor(received);
```

Rationale:

- Processor shouldn't be responsible for planning or memory plumbing.
- Processor should only see a well-typed binding (params/meters) and not worry about planes/offsets.
- The only cross-agent artifact is the `handoff`; that’s the contract between owner and engine.

This keeps the responsibility split sharp:

- Owner: `defineSpec` → `planLayout` → `allocateShared` → `buildHandoff` → `bindController`
- Engine: `receiveHandoff` → `bindProcessor`

Nothing else sneaks across the boundary.

---

## 4. Why we don't "enrich backing" in core

It's tempting to define an enriched backing type that bundles plan metadata:

```ts
// ❌ this is what we *don’t* do in the kernel
type RichBacking = Backing & { plan: Plan; specHash: string /* ... */ };
```

We intentionally avoid this in the core:

- It **fuses domains** (plan ↔ backing) and muddies error boundaries.
- It assumes JS always authors the plan:

  - Future scenarios (e.g. plan from Rust, JS only receiving a handoff) shouldn't rely on a JS-enriched backing.

- Guarantees become inconsistent:

  - “Rich” backings have more invariants than “plain” backings. That’s fragile.

- Kernel signatures stop being truthful about who owns what:

  - A simple "bytes arranged like X" object becomes a quasi-global context.

Enrichment belongs in **orchestration helpers**, not in the kernel. The kernel sticks to:

- `Plan` is a pure description.
- `Backing` is just memory shaped like that plan.
- `Handoff` is the intent to share a specific plan+backing pair.
- `Bindings` are the safe façades.

---

## 5. Performance considerations

All explicitness lives in **setup**:

- `planLayout(spec)`
- `allocateShared(plan)`
- `bindController(spec, backing)`
- `buildHandoff(plan, backing)`
- `receiveHandoff(handoff)`
- `bindProcessor(received)`

The hot paths:

- `processor.params.within(...)`
- `processor.meters.publish(...)`
- `controller.meters.snapshot(...)` (especially with `into` buffers)

…do:

- Zero dynamic planning
- Zero memory re-interpretation
- No per-access validation beyond the seqlock/Atomics protocol

We trade a handful of explicit arguments in setup for:

- Cleaner layering
- Stronger runtime checks at the edges
- Zero penalty where it actually hurts (RT loops)

---

## 6. Where ergonomics live

High-level helpers can close over `spec` and `plan` to reduce repetition while keeping kernel signatures explicit:

```ts
import type { SpecInput } from '@seqlok/core';

export function createControllerKit<S extends SpecInput>(spec: S) {
  const plan = planLayout(spec);

  return {
    spec,
    plan,
    allocateShared: () => allocateShared(plan),

    bindController(
      backing: unknown,
      opts?: {
        /* controller options */
      },
    ) {
      return bindController(spec, backing as never, opts);
    },

    buildHandoff(backing: unknown) {
      return buildHandoff(plan, backing as never);
    },
  };
}
```

This is where convenience belongs:

- Sugar functions can "remember" `spec` and `plan`.
- The kernel APIs remain fully explicit and tell the truth about which domains are involved.

If you want a `DeckSession`, `EngineKit`, or “just give me a controller + handoff” helper, that’s built _on top of_ the
core—not inside it.

---

## 7. Naming decisions and rejected alternatives

We compared three slogans:

1. `defineSpec → planLayout → allocateMemory → buildHandoff → receiveHandoff → bind*`
2. `defineSpec → planLayout → allocateShared → buildHandoff → receiveHandoff → bind*` ← **chosen**
3. `defineSpec → defineLayout → allocateMemory → buildHandoff → receiveHandoff → bind*`

Why `allocateShared`:

- It's precise and truthful about the golden path: **contiguous shared memory**.
- It leaves room for advanced allocation strategies behind separate APIs or integration layers.

Why not `defineLayout`:

- That verb belongs to a _raw_ plan library.
- Seqlok has a **semantic** DSL (`defineSpec`) followed by **byte planning** (`planLayout`). The layout is derived; we
  don't "define" it by hand.

Why keep `buildHandoff` / `receiveHandoff` as explicit verbs:

- They mark the **agent boundary**: “this is where we get ready to cross into another thread/runtime.”
- They carry their own error domain (handoff corruption / incompatibility) instead of burying that inside binds.

### 7.1 Why `handoff` (and not `transfer` or `shared`)

The word **`handoff`** is doing deliberate work in the API. It names a **protocol event** between agents, not just a
container type.

A handoff is the moment where the owner says:

> “This **plan** is implemented by this **backing**, and I am now giving you everything you need to bind to it safely.”

The object produced by `buildHandoff(plan, backing)` is the concrete representation of that event:

- It carries **layout identity** (plan hash, plane byte lengths, version).
- It carries **resource identity** (which shared memory object this plan is implemented on).
- It is **self-contained** enough for `receiveHandoff` to reconstruct a safe `ReceivedHandoff` without the original
  `spec` or `plan` in the receiving agent.

`handoff` also avoids clashes with two heavily-loaded terms in the JS ecosystem.

#### Why not `transfer`?

In the platform APIs, **“transfer” has a precise meaning**:

- `postMessage(value, { transfer: [...] })` moves `Transferable` objects to another agent.
- After transfer, the sender **loses access**: the buffer becomes “neutered” / detached on the sending side.

Seqlok's golden path is the opposite:

- The backing is a `SharedArrayBuffer` or shared `WebAssembly.Memory`.
- **Both** controller and processor must retain access to the same memory region.
- The handoff value itself is cloned structurally; the underlying memory is _shared_, not moved.

Using "transfer" in this context would strongly suggest that the owner relinquishes access to the memory, which is
incorrect and actively misleading for anyone familiar with workers and `Transferable`s.

#### Why not `shared*`?

The word **“shared”** already names the underlying primitives:

- `SharedArrayBuffer`
- shared `WebAssembly.Memory`

Re-using "shared" for the cross-agent envelope ("sharedConfig", "sharedState", …) blurs the line between:

- the **memory** that is physically shared, and
- the **description** of how that memory is laid out and can be safely bound.

The handoff is not "more shared memory"; it is the _contract_ for how a particular shared memory region implements a
particular plan.

By avoiding "shared" in the type name, the docs can say precise things like:

- “The backing is shared memory.”
- “The handoff is the description you send across agents.”

without overloading the same term for two different layers.

#### What `handoff` implies

`handoff` sits in the middle and captures exactly what Seqlok needs:

- It **acknowledges motion** (one agent builds, another receives).
- It is **neutral** about the underlying primitive (SAB today, shared Wasm or something else tomorrow).
- It gives the handoff layer a clean **error domain** for "this plan/backing pair cannot be trusted" without implying
  ownership transfer or re-defining what "shared" means.

The verbs `buildHandoff` and `receiveHandoff` then read naturally as protocol steps:

```ts
const handoff = buildHandoff(plan, backing); // owner prepares the package
const received = receiveHandoff(handoff); // engine validates + reconstructs view
```

They describe _what_ is happening at the agent boundary without colliding with the platform's existing meanings of "
transfer" and "shared".

---

## 8. Allocation variants and the contiguous handoff

The core design assumes a **contiguous backing** as the golden path:

- `allocateShared(plan)` → returns a backing built on a single SAB (or equivalent) that matches `plan`.
- `buildHandoff(plan, backing)` → produces a handoff representing exactly this contiguous layout.

Advanced allocation strategies (e.g., per-plane SABs, shared `WebAssembly.Memory`, external allocators) are:

- Supported via **separate helpers / integration packages**, not additional overloads on the core verbs.
- Free to implement the same `Backing` interface internally and then still call `buildHandoff(plan, backing)` if they
  can present a contiguous view.
- Considered orchestration choices, not changes to the public handshake.

This keeps the canonical story simple:

> There is one blessed way to get a handoff: `allocateShared(plan)` → `buildHandoff(plan, backing)`.

Everything else is "advanced plumbing" that adapts to that contract.

---

## 9. Layer boundaries (visual)

```mermaid
flowchart LR
  A[spec] -- planLayout --> B[plan]
  B -- allocateShared --> C[backing]
  B --- D[plan hash/meta]
  C --- E[shared memory]
  B & C --> F[handoff]
  F -. postMessage .-> G[received]
  A & C --> H[bindController]
  G --> I[bindProcessor]
```

Boundaries:

- **spec domain**: `defineSpec`
- **plan domain**: `planLayout`
- **backing domain**: `allocateShared`
- **handoff domain**: `buildHandoff` / `receiveHandoff`
- **binding domain**: `bindController` / `bindProcessor`

Each box has its own error codes and invariants.

---

## 10. Reviewer checklist

When reviewing API changes or helper layers, ask:

- **Does this merge responsibilities across domains?**

  - If yes, it probably belongs in sugar / orchestration, not kernel.

- **Does this reduce runtime cross-checks at bind time?**

  - If yes, you're trading safety for convenience. Be very sure.

- **Does this assume JS always owns `plan`/`backing`?**

  - Keep the core open to "plan from elsewhere, JS just receives a handoff."

- **Is the gain purely ergonomic?**

  - Prefer helpers that _use_ the core verbs rather than new core verbs that hide them.

- **Does this change the golden pipeline?**

  - If it introduces a new "shortcut", make sure it doesn't undermine spec/plan/backing separation.

---

## 11. Summary

- The API is deliberately verbose about responsibilities: **spec**, **plan**, **backing**, **handoff**, **bindings**.

- The "extra" arguments are guardrails, not noise.

- The golden pipeline is:

  ```ts
  const spec = defineSpec({
    /*...*/
  });
  const plan = planLayout(spec);
  const backing = allocateShared(plan);

  const controller = bindController(spec, backing);
  const handoff = buildHandoff(plan, backing);

  // elsewhere
  const received = receiveHandoff(handoff);
  const processor = bindProcessor(received);
  ```

- Naming favors clarity over minimalism.

- Lessons from Typebits and early iterations all point the same way:

  - Pure plans
  - Dumb memory
  - Checks at the edges
  - Zero-cost hot paths where the real-time work happens.
