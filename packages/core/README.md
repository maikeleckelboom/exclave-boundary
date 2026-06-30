# Exclave Boundary

`@exclave/boundary` is a typed shared-memory boundary substrate for coherent state, deterministic layout, explicit handoff, and timing-sensitive runtimes. It provides authored spec compilation, deterministic memory planning, shared backing allocation, explicit handoff artifacts, controller/processor/observer bindings, diagnostics, and structured errors.

Exclave is the ecosystem. Boundary is this package.

The package is ESM-only, typed, MIT licensed, and marked `sideEffects: false`.

## Install

```sh
pnpm add @exclave/boundary
```

## Flow

```text
defineSpec
  -> planLayout
  -> allocateShared / allocateSharedPartitioned / allocateWasmShared
  -> buildHandoff
  -> acceptHandoff
  -> bindController / bindProcessor / bindObserver
```

## Example

```ts
import {
  acceptHandoff,
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
} from "@exclave/boundary";

const spec = defineSpec(({ param, meter }) => ({
  params: {
    runtime: {
      enabled: param.bool(),
      count: param.u32({ min: 0, max: 1000 }),
    },
  },
  meters: {
    runtime: {
      state: meter.enum(["idle", "busy"]),
      delta: meter.i32(),
    },
  },
}));

const plan = planLayout(spec);
const backing = allocateShared(plan);
const controller = bindController(spec, plan, backing);
const processor = bindProcessor(acceptHandoff(buildHandoff(plan, backing)));

controller.params.set("runtime.enabled", true);
controller.params.set("runtime.count", 7);

processor.params.within((params) => {
  if (params.runtime.enabled) {
    processor.meters.publish((meters) => {
      meters.setGroup("runtime", {
        delta: -1,
        state: 1,
      });
    });
  }
});
```

## Spec Contract

`defineSpec()` accepts an authored AST or a plain canonical object. Authored specs may use nested namespaces. Write APIs use explicit canonical string keys, and processor read views expose nested aliases:

```ts
params.runtime.enabled;
params.runtime.count;
```

Anonymous specs receive deterministic `anon_<hash>` ids derived from canonical contents.

## Grouped Meter Publishing

Use `processor.meters.publishGroup("runtime", values)` when a processor already has a typed object for one schema meter group. Inside a larger atomic publish block, use `writer.setGroup("runtime", values)` alongside direct `writer.set("runtime.key", value)` calls or staged array writes.

Grouped publishing maps unprefixed keys under one schema group; it is not arbitrary object flattening. Build derived values such as enum indices, split frame counters, and latency seconds explicitly before publishing the group.

## Package Boundary

This package publishes one runtime package: `@exclave/boundary`. Internal base, schema, and primitive layers are implementation details unless exported from the root package or `@exclave/boundary/diagnostics`.

The packed package must not contain `workspace:*` runtime dependencies. Run:

```sh
pnpm -F @exclave/boundary run test:pack
```

## Development

```sh
pnpm -F @exclave/boundary run build
pnpm -F @exclave/boundary run test
pnpm -F @exclave/boundary run test:types
pnpm -F @exclave/boundary run bench
```

## Documentation

The VitePress docs site lives in `apps/docs`. Historical design notes remain under `packages/core/docs`; treat them as architecture history when they go beyond the current public package boundary.
