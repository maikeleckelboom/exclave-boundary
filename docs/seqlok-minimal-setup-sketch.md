# Seqlok Minimal Setup Sketch

This is a companion to the primer, not a replacement for it.

The primer explains what Seqlok is, what boundary it owns, and how the repo is layered.
This sketch shows one small, current, concrete path through that model.

It is intentionally narrow.
It is not the API reference.
For exact surfaces, check `packages/*/README.md` and each package `index.ts`.

---

## One Boundary, Two Sides

Seqlok setup still happens on two sides.

```text
Host side
  defineSpec -> planLayout -> allocateShared -> buildHandoff -> bindController

Worker side
  acceptHandoff -> bindProcessor
                 -> bindObserver   (optional)
```

That ordering matters.

The far side does not reconstruct layout from guesswork.
It accepts an explicit handoff, verifies it, and binds from the accepted artifact.
That is still the core contract shape in `dev`.

---

## Minimal Shape

The spec defines shared shape and bounds.
It does not own UI defaults, product semantics, or orchestration policy.

Current Seqlok groups shared domains under `params` and `meters`.

```ts
const laneSpec = defineSpec(({ param, meter }) => ({
  id: 'lane',

  params: {
    volume: param.f32({ min: 0, max: 1 }),
    pan: param.f32({ min: -1, max: 1 }),
    bypass: param.bool(),
  },

  meters: {
    peakL: meter.f32(),
    peakR: meter.f32(),
  },
}))
```

That shape is small on purpose.
A spec declares what exists and what is legal.
It does not become your application model.

---

## Canonical Host-Side Setup

```ts
const plan = planLayout(laneSpec)
const backing = allocateShared(plan)
const handoff = buildHandoff(plan, backing)

const controller = bindController(laneSpec, plan, backing)
```

That is the explicit long path.

It is the best path to show in a sketch because it keeps the ownership model visible:

- the host defines the spec
- the host plans layout
- the host allocates shared memory
- the host constructs the handoff
- the host binds the controller locally

---

## Canonical Worker-Side Setup

```ts
const accepted = acceptHandoff(handoff)

const processor = bindProcessor(accepted)
const observer = bindObserver(accepted)
```

`bindObserver` is optional.
Use it for passive readers such as diagnostics, dashboards, logging, or tooling.

The important thing is not the names.
The important thing is that the worker binds from a **accepted handoff**, not from an improvised local reconstruction.

---

## Controller Path

The controller is the host-facing, cold-path writer for params and reader for meters.

```ts
controller.params.set('volume', 0.9)

controller.params.update({
  volume: 0.9,
  pan: 0.2,
})

const params = controller.params.snapshot()
const meters = controller.meters.snapshot(['peakL', 'peakR'])
```

This surface favors explicit writes, clear ownership, and allocation-tolerant reads.

---

## Processor Path

The processor is the hot-path reader for params and writer for meters.

```ts
processor.params.within((params) => {
  renderBlock(params.volume, params.pan, params.bypass)

  processor.meters.publish((write) => {
    write.peakL(leftPeak)
    write.peakR(rightPeak)
  })
})
```

This is the tight loop surface.
It exists to stay bounded, coherent, and allocation-free in the hot path.

---

## Optional Observer Path

If you need passive reads without write authority, bind an observer.

```ts
const uiParams = observer.params.snapshot(['volume', 'pan'])
const uiMeters = observer.meters.snapshot(['peakL', 'peakR'])
```

That is useful for telemetry, HUDs, visualizers, analyzers, and dev tools.
It gives you access without blurring ownership.

---

## Host Convenience Path

There is also a host convenience layer.

If you are staying on the owner side and want to reuse the same `{ spec, plan, backing }`
triple cleanly, current Seqlok exposes `createSharedContext(...)`.

```ts
const ctx = createSharedContext(laneSpec)

const controller = bindController(ctx)
const observer = bindObserver(ctx)
const handoff = buildHandoff(ctx)
```

This does **not** replace the canonical model.
It packages the same host-owned ingredients into a reusable context.

That means the long path is still the right mental model, while the context path is the right ergonomic shortcut on the host.

---

## Commands Are a Separate Lane

Commands are for discrete intent, not continuously shared state.

```ts
const mailbox = createCommandMailbox({
  mailboxId: 'lane-1',
  codec,
  layout: { capacity: 256, wordsPerSlot: codec.wordsPerSlot },
})

const result = mailbox.producer.push({
  kind: 'seek',
  targetFrame: 44100 * 150,
})

if (!result.ok) {
  reportCommandFailure(result)
}
```

That lane is optional.
It sits above the shared-state boundary model rather than replacing it.

---

## Hotswap Is Another Layer Above

Hotswap is not hidden magic.
It is an explicit per-block protocol.

At the RT protocol layer, the current surface is shaped like this:

```ts
const decision = stepSwapStateRT(
  state,
  blockFrames,
  activeKind,
  nextKind,
  noneKindSentinel,
)
```

That is intentionally more explicit than a cute one-liner.
The protocol needs to know the current active kind, the pending next kind, and the sentinel for "none".

If you want host-side scheduling instead of raw RT stepping, higher layers can build on top of that.

---

## What This Sketch Leaves Out

On purpose, this sketch does **not** try to teach everything Seqlok can do.

It leaves out, among other things:

- nested spec namespaces that flatten into stable dot-path keys
- enum and enum-array surfaces
- array staging details
- introspection and diagnostics entry points
- bus composition and wider topologies
- host-level scheduling helpers around hotswap

Those are real capabilities.
They are simply not the job of this sketch.

---

## Read This Next

- primer: `seqlok-primer.md`
- package graph and current package docs: `packages/*/README.md`
- exact exports: each package `index.ts`
- core README: `packages/core/README.md`

Use this sketch to get the boundary shape into your head.
Then drop into package docs when you need exact surface detail.
