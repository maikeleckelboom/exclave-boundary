# Examples

These examples show the public contract in code. The prose names the boundary guarantees; snippets keep transport sketches separate from the core API.

## Spec Inference and Canonical Keys

```ts twoslash
import { defineSpec } from "@exclave/boundary";

const spec = defineSpec((api) => ({
  id: "examples/transport" as const,
  params: {
    transport: {
      enabled: api.param.bool(),
      mode: api.param.enum(["idle", "active", "fault"]),
      payload: api.param.u8.array(16),
    },
  },
  meters: {
    transport: {
      state: api.meter.enum(["idle", "active", "fault"]),
      drift: api.meter.i32(),
      spectrum: api.meter.f32.array(8),
    },
  },
}));

spec.params["transport.mode"];

spec.meters["transport.spectrum"];
```

The authored shape is nested, but the canonical spec uses dot keys. Those keys are accepted by controller and observer APIs.

## Controller Params

```ts twoslash
import {
  allocateShared,
  bindController,
  defineSpec,
  planLayout,
} from "@exclave/boundary";

const spec = defineSpec((api) => ({
  id: "examples/controller" as const,
  params: {
    transport: {
      enabled: api.param.bool(),
      mode: api.param.enum(["idle", "active", "fault"]),
      payload: api.param.u8.array(16),
    },
  },
  meters: {
    frames: api.meter.u32(),
  },
}));

const plan = planLayout(spec);
const backing = allocateShared(plan);
const controller = bindController(spec, plan, backing);

controller.params.set("transport.enabled", true);
controller.params.set("transport.mode", "active");
controller.params.stage("transport.payload", (payload) => {
  payload.set([1, 2, 3, 4]);
  payload;
});
```

Scalar enum params use labels on the controller side. Processor and meter enum values are numeric indices at the runtime boundary.

## Processor Views

```ts twoslash
import {
  acceptHandoff,
  allocateShared,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
} from "@exclave/boundary";

const spec = defineSpec((api) => ({
  id: "examples/processor" as const,
  params: {
    transport: {
      enabled: api.param.bool(),
      mode: api.param.enum(["idle", "active", "fault"]),
      payload: api.param.u8.array(16),
    },
  },
  meters: {
    frames: api.meter.u32(),
    spectrum: api.meter.f32.array(8),
  },
}));

const plan = planLayout(spec);
const backing = allocateShared(plan);
const accepted = acceptHandoff(buildHandoff(plan, backing));
const processor = bindProcessor(accepted);

processor.params.within((params) => {
  params.transport.enabled;

  params.transport.mode;

  params.transport.payload;
});

processor.meters.publish((meters) => {
  meters.frames(128);
  meters.stage("spectrum", (spectrum) => {
    spectrum[0] = 0.25;
    spectrum;
  });
});
```

The nested aliases inside `within(...)` are read conveniences over the canonical dot-key contract. Array views are ephemeral and scoped to the callback.

## Observer Snapshots

Observers are read-only bindings for telemetry, inspection, or secondary consumers. They can bind from the same accepted handoff as the processor.

```ts twoslash
import {
  acceptHandoff,
  allocateShared,
  bindObserver,
  buildHandoff,
  defineSpec,
  planLayout,
} from "@exclave/boundary";

const spec = defineSpec((api) => ({
  id: "examples/observer" as const,
  params: {
    transport: {
      enabled: api.param.bool(),
      mode: api.param.enum(["idle", "active", "fault"]),
    },
  },
  meters: {
    transport: {
      state: api.meter.enum(["idle", "active", "fault"]),
      drift: api.meter.i32(),
    },
  },
}));

const plan = planLayout(spec);
const backing = allocateShared(plan);
const accepted = acceptHandoff(buildHandoff(plan, backing));
const observer = bindObserver(accepted);

const params = observer.params.snapshot([
  "transport.enabled",
  "transport.mode",
] as const);
const meters = observer.meters.snapshot("transport.state", "transport.drift");

params["transport.mode"];

meters["transport.state"];
```

## BoundaryError Narrowing

```ts twoslash
import { isBoundaryError } from "@exclave/boundary";

export function summarizeError(error: unknown) {
  if (isBoundaryError(error)) {
    error.code;

    return error.toJSON();
  }

  return { name: "Unknown" };
}
```

## Pack Smoke Shape

The release smoke test installs the packed tarball in a fresh consumer and imports from `@exclave/boundary`. That catches missing files, workspace-only dependencies, and broken export maps before publish.
