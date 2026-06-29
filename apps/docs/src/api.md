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

Role-specific public types include `ControllerBinding`, `ProcessorBinding`, `ObserverBinding`, `ControllerParams`, `ProcessorParams`, `ObserverParams`, `ControllerMeters`, `ProcessorMeters`, `ObserverMeters`, `ParamValueFor`, `MeterValueFor`, `ParamsSnapshot`, and `MetersSnapshot`.

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
