# Memory and Layout Model

The authored spec is not memory. `planLayout(spec)` is the lowering step that turns canonical fields into byte sizes, plane offsets, and a layout identity.

## Canonical Fields

Nested authored fields collapse to canonical dot keys before layout:

```text
params.filter.cutoff -> "filter.cutoff"
meters.engine.rms    -> "engine.rms"
```

The plan uses that canonical field set. Controller writes, snapshots, diagnostics, and generated examples should use the same keys.

## Plan First, Allocate Second

Allocation consumes a plan:

```ts
const plan = planLayout(spec);
const backing = allocateShared(plan);
```

The binding layer does not silently re-plan. Passing a plan and backing that do not describe the same memory is a contract error.

## Planes

The implementation maps fields into typed planes for scalar and array storage. The exact plane names are implementation detail, but the public consequence is stable:

- Numeric param and meter fields map to typed shared-memory regions.
- Boolean and enum values have explicit storage representations.
- Array fields reserve fixed lengths at plan time.
- Coherent reads and writes use seqlock-protected domains.

## Coherent Snapshot Mechanism

Coherent snapshots are built around a small sequence check. The writer marks a sequence as changing, writes values, then marks it stable; the reader only uses a copied snapshot when the sequence is stable before and after the copy.

```mermaid
flowchart TD
  subgraph writer["Writer side"]
    w1["begin publish"]
    w2["mark sequence changing"]
    w3["write values"]
    w4["mark sequence stable"]
  end

  subgraph reader["Reader side"]
    r1["read sequence before"]
    r2["copy values"]
    r3["read sequence after"]
    r4{"sequence stable?"}
    r5["use coherent snapshot"]
    r6["retry bounded read"]
  end

  w1 --> w2 --> w3 --> w4
  r1 --> r2 --> r3 --> r4
  r4 -->|yes| r5
  r4 -->|no| r6
  r6 --> r1
  w2 -. "may invalidate in-flight read" .-> r4
  w4 -. "next stable snapshot" .-> r1
```

This is the mechanism behind coherent param reads and meter snapshots. High-level code should use the role bindings; the low-level sequence details matter mainly when debugging timing or integration problems.

## Backing Choices

| Allocation | Use |
| --- | --- |
| `allocateShared(plan)` | One contiguous `SharedArrayBuffer`; the simplest handoff shape. |
| `allocateSharedPartitioned(plan)` | Separate buffers per plane; useful when host integration wants plane-level separation. |
| `allocateWasmShared(plan, memory)` | Attach compatible shared `WebAssembly.Memory`; useful for WASM-oriented runtimes. |

Only `shared` and `shared-partitioned` backing are currently represented by the handoff protocol.

## Callback-Scoped Views

Array views in `params.within(...)`, `params.stage(...)`, and meter `stage(...)` callbacks are ephemeral. They point into shared backing or callback-owned scratch space. Do not store them for later use.
