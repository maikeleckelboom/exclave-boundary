# Quickstart

This is the smallest complete Exclave Boundary flow: define a spec, plan memory, allocate backing, build a handoff, accept it on the runtime side, and bind the roles that read or write shared state.

## Boundary Flow

`defineSpec`, `planLayout`, `allocateShared`, and `buildHandoff` happen before the runtime side binds. The controller can already exist on the main side while a handoff is accepted in a worker, an AudioWorklet, or another timing-sensitive runtime.

```mermaid
flowchart TD
  subgraph main["Main thread / controller side"]
    spec["defineSpec<br/>author the boundary shape"]
    plan["planLayout<br/>compute memory layout"]
    backing["allocateShared<br/>create shared backing"]
    controller["bindController<br/>write params, read meters"]
    handoff["buildHandoff<br/>portable boundary artifact"]
    transport["postMessage<br/>send handoff"]
  end

  subgraph runtime["Worker / AudioWorklet / realtime side"]
    accept["acceptHandoff<br/>validate protocol, plan, backing"]
    processor["bindProcessor<br/>read params, publish meters"]
  end

  spec --> plan
  plan --> backing
  backing --> controller
  backing --> handoff
  handoff --> transport
  transport --> accept
  accept --> processor
  controller -. "same SharedArrayBuffer backing" .- processor
```

The handoff is the portable artifact. It carries the plan and backing descriptor so the receiving side can validate before interpreting shared memory.

```ts twoslash
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
  id: "quickstart/control" as const,
  params: {
    runtime: {
      enabled: param.bool(),
      count: param.u32({ min: 0, max: 1_000_000 }),
      window: param.f32.array(8),
    },
  },
  meters: {
    status: meter.enum(["idle", "busy", "fault"]),
    signedDelta: meter.i32(),
  },
}));

spec.params["runtime.enabled"];

const plan = planLayout(spec);
const backing = allocateShared(plan);

const controller = bindController(spec, plan, backing);
const handoff = buildHandoff(plan, backing);
const accepted = acceptHandoff(handoff);
const processor = bindProcessor(accepted);

controller.params.set("runtime.enabled", true);
controller.params.set("runtime.count", 42);
controller.params.stage("runtime.window", (view) => {
  view.fill(1);
});

processor.params.within((params) => {
  if (params.runtime.enabled) {
    params.runtime.count;

    processor.meters.publish((meters) => {
      meters.status(1);
      meters.signedDelta(-1);
    });
  }
});

const meterSnapshot = controller.meters.snapshot();
meterSnapshot;
```

Write APIs use explicit canonical string keys such as `"runtime.enabled"`. Processor read views expose nested aliases such as `params.runtime.enabled` inside `within(...)`; array views are callback-scoped and should not be retained.

## What Crosses the Boundary

The handoff is the boundary artifact. It carries the plan and backing descriptor. It can be moved with a worker message, an AudioWorklet port message, or another host transport, but the transport is not the contract.

```ts
worker.postMessage({ type: "boundary-handoff", handoff });
```

On the receiving side, treat inbound values as untrusted until `acceptHandoff(...)` validates the protocol version, plan shape, packing mode, and backing sizes.
