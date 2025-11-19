# Seqlok E2E Flow – Visual Guide

> How `spec → plan → backing → handoff → bindings` fit together across UI and real-time threads.

This document is the "single page mental model" for Seqlok's end-to-end flow:

- Main thread (controller) defines the shared state and owns **params**.
- Worker / AudioWorklet (processor) owns **meters** and the real-time loop.
- Both talk via a **plan-driven shared memory layout** (planes + seqlocks).

For deeper dives, see:

- `03-seqlok-concurrency-model-and-roles.md`
- `07-seqlok-api-shape-rationale.md`
- `08-seqlok-primitives-and-seqlock.md`
- `09-seqlok-backing-and-plane-plan.md`

---

## Architecture Overview

```mermaid
graph TB
  subgraph "Main Thread (Controller)"
    A[Define Spec<br/>defineSpec] --> B[Plan Layout<br/>planLayout]
    B --> C[Allocate Shared Memory<br/>allocateShared]
    C --> D[Bind Controller<br/>bindController]
    D --> E[Create Handoff<br/>buildHandoff]
    E --> F[Send to Worker<br/>postMessage]
    D --> G[UI Controls<br/>params.set / params.update]
    D --> H[Read Meters<br/>meters.snapshot]
  end

  subgraph "Worker Thread (Processor)"
    F --> I[Receive Handoff<br/>receiveHandoff]
    I --> K[Bind Processor<br/>bindProcessor]
    K --> L[Process Loop]
    L --> M[Coherent Param Read<br/>params.within]
    M --> N[Audio Processing<br/>DSP / simulation]
    N --> O[Atomic Meter Write<br/>meters.publish]
  end

  subgraph "Shared Memory"
    P[Params Domain<br/>PF32 / PI32 / PB / PU]
    Q[Meters Domain<br/>MF32 / MF64 / MU32 / MU]
  end

  G --> P
  M --> P
  O --> Q
  H --> Q
```

> **Verification note:** > `verifyHandoff(plan, received)` exists for diagnostics/tests and can be run on the **controller side** or in a non-RT worker. It is **not** part of the processor's hot path and is omitted from the canonical runtime pipeline above.

---

## Detailed Data Flow

```mermaid
sequenceDiagram
  participant UI as UI Thread
  participant CTL as Controller Binding
  participant MEM as Shared Memory
  participant PROC as Processor Binding
  participant RT as Real-Time Loop

  Note over UI, RT: 1. SETUP PHASE (Main Thread)
  UI ->> UI: defineSpec() → Spec
  UI ->> UI: planLayout(Spec) → Plan
  UI ->> MEM: allocateShared(Plan) → Backing (SharedArrayBuffer)
  UI ->> CTL: bindController(Spec, Backing)
  UI ->> UI: buildHandoff(Plan, Backing) → Handoff
  UI ->> PROC: postMessage({ type: 'HANDOFF', handoff })

  Note over UI, RT: 2. WORKER INIT (Processor Side)
  PROC ->> PROC: receiveHandoff(handoff) → ReceivedHandoff
  PROC ->> PROC: bindProcessor(Spec, ReceivedHandoff)
  PROC ->> RT: Start processing loop

  Note over UI, RT: 3. RUNTIME FLOW

  loop On UI interaction
    UI ->> CTL: controller.params.set('gain', value)
    CTL ->> MEM: Write into PF32 plane (plus LOCK/SEQ in PU)
  end

  loop On each RT tick (e.g. per quantum)
    RT ->> PROC: processor.params.within(callback)
    PROC ->> MEM: Read PU seqlock + param planes
    MEM -->> PROC: Coherent param snapshot
    PROC ->> RT: Run DSP / simulation with snapshot
    RT ->> PROC: processor.meters.publish(writer)
    PROC ->> MEM: Write into MF32/MU32 planes (plus LOCK/SEQ in MU)
  end

  loop On each animation frame
    UI ->> CTL: controller.meters.snapshot()
    CTL ->> MEM: Read MU seqlock + meter planes
    MEM -->> CTL: Coherent meter snapshot
    CTL ->> UI: Update HUD / meters / graphs
  end
```

> **Seqlock nuance:** Writers bump `LOCK` on enter/exit and bump `SEQ` on commit (the one-bump rule).
> The diagram compresses this to a single "update seqlock" step for readability.

---

## Memory Layout Visualization

```mermaid
graph LR
  subgraph "SharedArrayBuffer"
    subgraph "Params Domain"
      P1[PF32<br/>Float32 params]
      P2[PI32<br/>Int32 / enum params]
      P3[PB<br/>Boolean params]
      P4[PU<br/>Params seqlock<br/>LOCK / SEQ]
    end

    subgraph "Meters Domain"
      M1[MF32<br/>Float32 meters]
      M2[MF64<br/>Float64 meters]
      M3[MU32<br/>Uint32 meters]
      M4[MU<br/>Meters seqlock<br/>LOCK / SEQ]
    end
  end

  P1 --> W1[gain: 0.80]
  P1 --> W2[frequency: 440]
  P3 --> W3[mute: false]
  P4 --> W4[PU: LOCK=42, SEQ=21]

  M1 --> R1[rms: 0.324]
  M1 --> R2[peak: 0.891]
  M4 --> R3[MU: LOCK=38, SEQ=19]
```

- **Plan** computes exactly how each param/meter key maps into these planes.
- **Backing** allocates concrete memory and hosts the TypedArray views.
- **Bindings** use that plan to enforce safe, coherent access on each side.

---

## Seqlock Protocol Flow

```mermaid
stateDiagram-v2
  state "Writer (Controller / Processor)" as W
  state "Reader (Controller / Processor)" as R
  state "Memory State" as M

  state M {
    [*] --> Quiescent: LOCK even
    Quiescent --> Writing: LOCK++
    Writing --> Quiescent: LOCK++, SEQ++
  }

  state W {
    [*] --> Ready
    Ready --> WritingParams: Begin write
    WritingParams --> Commit: Payload written
    Commit --> Ready: LOCK++, SEQ++
  }

  state R {
    [*] --> AttemptRead
    AttemptRead --> CheckLock: Read LOCK
    CheckLock --> Spinning: LOCK odd
    Spinning --> AttemptRead: Bounded spin
    CheckLock --> Capture: LOCK even
    Capture --> Validate: Read payload + SEQ
    Validate --> Success: LOCK/SEQ stable
    Validate --> Retry: LOCK/SEQ changed
    Success --> Coherent: Use snapshot
    Retry --> AttemptRead: Retry (bounded)
  }

  W --> M: Writes payload + LOCK/SEQ
  R --> M: Reads LOCK/SEQ + payload
```

Key properties:

- **Single writer per domain** (params vs meters).
- Readers are **lock-free** and **retry-based** with bounded spin/retry budgets.
- On success, readers see a **coherent snapshot**; they never observe partially written payload.

---

## Type Safety Flow

```mermaid
graph TB
  subgraph "Compile Time"
    A[defineSpec DSL] --> B[Inferred Spec type S]
    B --> C[ParamKeys<S>]
    B --> D[MeterKeys<S>]
    B --> E[ParamValueFor<S,K>]
    B --> F[MeterValueFor<S,K>]
    B --> G[ControllerBinding<S>, ProcessorBinding<S>]
  end

  subgraph "Runtime API"
    H[controller.params.set] --> I[Key: ParamKeys<S>]
    H --> J[Value: ParamValueFor<S,K>]

    K[controller.meters.snapshot] --> L[Meter snapshot shape<S>]

    M[processor.params.within] --> N[params view: ParamShape<S>]
    O[processor.meters.publish] --> P[meter writer: MeterWriter<S>]
  end

  C --> I
  E --> J
  F --> L
  G --> H
  G --> K
  G --> M
  G --> O
```

Story in plain terms:

- The DSL (`defineSpec`) defines a **single source of truth**: params + meters.

- The spec type `S` drives:

  - Valid param / meter keys.
  - The value types per key.
  - The shapes of controller/processor bindings.

- At runtime, you only get strongly-typed APIs:

  - `controller.params.set('gain', numberInRange)`
  - `controller.meters.snapshot()`
  - `processor.params.within(params => { … })`
  - `processor.meters.publish(writer => { … })`

Invalid keys/values are rejected at compile time; invalid layouts/backings are rejected at bind time.

---

## Complete E2E Timeline (Conceptual)

This is illustrative, not a performance chart. Units are arbitrary.

```mermaid
gantt
  title Seqlok E2E Timeline (Conceptual)
  dateFormat X
  axisFormat %s

  section Main Thread
    Define Spec & Plan: a1, 0, 10
    Allocate Memory: a2, after a1, 5
    Bind Controller: a3, after a2, 3
    Create Handoff: a4, after a3, 2
    Send to Worker: a5, after a4, 1
    UI Controls (ongoing): a6, after a5, 300
    Meter Reads (ongoing): a7, after a5, 300

  section Worker Thread
    Receive Handoff: b1, after a5, 2
    Bind Processor: b3, after b1, 3
    Process Loop (ongoing): b4, after b3, 300

  section Shared Memory
    Memory Ready: c1, after a2, 310
    Param Updates (ongoing): c2, after a6, 290
    Meter Updates (ongoing): c3, after b4, 290
```

---

## 🎯 Key Visual Takeaways

1. **Two independent domains**

- Params and meters sit in **separate planes** (`PF32/PI32/PB/PU` vs `MF32/MF64/MU32/MU`) with **separate seqlocks**.
- Controller writes params; processor writes meters. There's no cross-domain write contention.

2. **Seqlock-guarded coherence**

- All coherent param reads go through `processor.params.within`.
- All coherent meter reads go through `controller.meters.snapshot`.
- All meter commits go through `processor.meters.publish`.
- The seqlock protocol guarantees snapshot coherence with bounded retries.

3. **Type safety end-to-end**

- `defineSpec` → spec type `S` → bindings and key/value types.
- Invalid keys and values fail at compile time; mismatched backing/plan fails at bind time.

4. **Zero serialization / copies on the hot path**

- SharedArrayBuffer + TypedArrays + Atomics – no JSON, no structured clone, no memcpy loops.

5. **Real-time friendliness**

- Processor binding's hot path (`within` / `publish`) does **no allocations** and uses bounded, predictable seqlock operations.
- UI/main thread can be relatively "squishy"; the strict discipline is concentrated in the processor binding and backing.

This is the whole loop in one picture: **spec → plan → backing → handoff → bindings**, stitched together across agents by shared memory and seqlocks, with TypeScript keeping your keys and value types honest.
