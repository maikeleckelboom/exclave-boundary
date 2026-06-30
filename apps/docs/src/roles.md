# Controller, Processor, and Observer Roles

Exclave Boundary exposes separate role bindings because each side has different authority and timing pressure.

## Controller

The controller is the host-side writer for params and reader for meters. It usually lives with UI, automation, preset hydration, or orchestration code.

Controller responsibilities:

- Write one scalar param with `params.set(...)`.
- Write scalar micro-batches with `params.update(...)`.
- Write array params through the explicit `params.stage(...)` window.
- Hydrate cold-path scalar and array state with `params.hydrate(...)`.
- Read meter snapshots, using `snapshot({ into })` when array buffers should be reused.
- Own range policy and meter degradation options.

## Processor

The processor is the timing-sensitive runtime binding. It reads params and publishes meters inside explicit callback windows.

Processor responsibilities:

- Read params inside `params.within(...)`.
- Use nested read aliases derived from the same spec.
- Treat array param views as callback-scoped.
- Publish scalar meters with direct writer functions or `writer.set(...)`.
- Publish array meters with `writer.stage(...)`.
- Keep planning, allocation, validation, logging, and orchestration outside the tight loop.

## Realtime Quantum Flow

`within(...)` gives the processor a coherent callback-scoped param view. Array views from that callback are ephemeral: read or copy what you need, but do not retain them after the callback returns.

```mermaid
flowchart LR
  tick["Audio quantum start<br/>for example 128 samples"]
  within["processor.params.within(...)"]
  read["coherent param read"]
  process["process audio"]
  publish["processor.meters.publish(...)"]
  write["write meters"]
  done["quantum complete"]

  tick --> within
  within --> read
  read --> process
  process --> publish
  publish --> write
  write --> done

  subgraph bounded["Bounded realtime section"]
    within
    read
    process
    publish
  end
```

`publish(...)` writes meters back for the controller or an observer. The realtime section should stay bounded, synchronous, and allocation-conscious.

## Observer

The observer is a read-only binding for telemetry, inspection, visualizers, and secondary consumers.

Observer responsibilities:

- Read param snapshots.
- Read meter snapshots.
- Use `within(...)` for coherent read windows when snapshot allocation is not appropriate.
- Avoid writes entirely.

## Choosing a Role

| Need | Role |
| --- | --- |
| Update control state from UI or host automation. | Controller |
| Read control state in a timing-sensitive loop. | Processor |
| Publish runtime meters. | Processor |
| Feed diagnostics, visualization, or a HUD. | Observer |
| Own the memory plan and backing allocation. | Owner/controller side before binding |
