# API Reference

This page covers the public `@exclave/boundary` surface. Internal folders such as backing planes, seqlock primitives, and validation helpers are implementation details unless exported from the root package or diagnostics subpath.

## Spec

- `defineSpec(input)` compiles authored AST or plain canonical input.
- `CanonicalSpec` is the runtime spec shape with required `id`.
- `CanonicalSpecFromAst<T>` maps an authored AST type to canonical dot keys.
- `ParamDef` and `MeterDef` describe supported leaf definitions.

Supported params include `f32`, `i32`, `u32`, `bool`, `enum`, and arrays for `f32`, `i32`, `u32`, `u8`, `i8`, `i16`, `u16`, `bool`, and `enum`.

Supported meters include `f32`, `f64`, `i32`, `u32`, `bool`, `enum`, and arrays for `f32`, `f64`, `u32`, and `bool`.

```ts twoslash
import { defineSpec, type CanonicalSpecFromAst } from "@exclave/boundary";

const authored = {
  id: "api/spec" as const,
  params: {
    filter: {
      cutoff: { kind: "f32", min: 20, max: 20_000 },
    },
  },
} as const;

const spec = defineSpec(authored);
type Canonical = CanonicalSpecFromAst<typeof authored>;

spec.params["filter.cutoff"];
```

## Plan and Backing

- `planLayout(spec)` returns a deterministic memory plan.
- `allocateShared(plan)` creates single-buffer shared backing.
- `allocateSharedPartitioned(plan)` creates per-plane shared backing.
- `allocateWasmShared(plan, memory)` attaches compatible shared WebAssembly memory.

## Binding

- `bindController(spec, plan, backing, options?)`
- `bindProcessor(source, options?)`
- `bindProcessor(spec, plan, backing, options?)`
- `bindObserver(source, options?)`
- `bindObserver(spec, plan, backing, options?)`

`source` can be a handoff, accepted handoff, or shared context where supported.

Role-specific public types include `ControllerBinding`, `ProcessorBinding`, `ObserverBinding`, `ControllerParams`, `ProcessorParams`, `ObserverParams`, `ControllerMeters`, `ProcessorMeters`, `ObserverMeters`, `ParamValueFor`, `MeterValueFor`, `ScalarParamPatch`, `HydratePatch`, `ParamsSnapshot`, and `MetersSnapshot`.

### ControllerParams

`controller.params` is the controller-side write surface for params.

| Member | Contract |
| --- | --- |
| `set(key, value)` | Set one scalar param. |
| `update(patch)` | Apply a scalar-only micro-batch and publish once. |
| `stage(key, callback)` | Open the explicit hot-path write window for one array param. |
| `hydrate(patch)` | Load cold-path scalar and array state; array values may be copied. |
| `snapshot(...)` | Read params; pass `{ keys, into }` to reuse array buffers. |
| `version()` | Return the current param update sequence. |

`update(...)` does not accept array params. Use `stage(...)` for hot-path array writes or `hydrate(...)` when loading saved state.

### ControllerMeters

`controller.meters` is the controller-side read surface for meters. Processors publish meters.

| Member | Contract |
| --- | --- |
| `snapshot(...)` | Read meters; pass `{ keys, into }` to reuse array buffers. |
| `version()` | Return the current meter update sequence. |

### ProcessorMeters

`processor.meters` is the processor-side write surface for meters.

| Member | Contract |
| --- | --- |
| `publish(callback)` | Publish one atomic meter transaction. |
| `publishGroup(group, values)` | Publish one schema meter group with unprefixed group keys. |
| `version()` | Return the current meter update sequence. |

Inside `publish(...)`, `writer.set(key, value)` still accepts fully qualified scalar meter keys such as `"runtime.blockSamples"`. `writer.setGroup(group, values)` accepts the same group value shape used by `publishGroup(...)` and keeps the write inside the enclosing transaction.

```ts twoslash
import { defineSpec, type MeterGroupValues } from "@exclave/boundary";

const spec = defineSpec(({ meter }) => ({
  id: "api/meters" as const,
  meters: {
    runtime: {
      blockSamples: meter.u32(),
      state: meter.enum(["idle", "running"]),
    },
  },
}));

type RuntimeMeters = MeterGroupValues<typeof spec, "runtime">;

const values: RuntimeMeters = {
  blockSamples: 128,
  state: 1,
};

declare const processor: import("@exclave/boundary").ProcessorBinding<
  typeof spec
>;

processor.meters.publishGroup("runtime", values);

processor.meters.publish((writer) => {
  writer.setGroup("runtime", values);
  writer.set("runtime.blockSamples", 256);
});
```

Grouped publishing is for schema groups: `publishGroup("runtime", values)` maps unprefixed keys in `values` to canonical meter keys under `runtime.*`. It is not arbitrary object flattening. Derived values, such as enum indices or split frame counters, should still be constructed explicitly before publishing.

## Handoff

- `buildHandoff(plan, backing)` creates a boundary artifact.
- `buildHandoff(context)` creates a boundary artifact from a shared context.
- `acceptHandoff(handoff)` validates and normalizes a received artifact.
- `verifyHandoff(localPlan, remotePlan)` compares plan identity and byte length.

## Diagnostics and Errors

- `BoundaryError` is the structured error class.
- `isBoundaryError(value)` narrows unknown errors.
- `getErrorMeta(code)` and `getErrorMessage(code)` expose registry metadata.
- `interpretHealth(error)` maps known error domains to health guidance.

Diagnostics exports live at `@exclave/boundary/diagnostics`.

See [Diagnostics](/diagnostics) and [Error Model](/error-model) for integration guidance.
