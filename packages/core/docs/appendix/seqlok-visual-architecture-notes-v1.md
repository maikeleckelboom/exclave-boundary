# Seqlok Visual Architecture Notes

> Internal visuals that map the core Seqlok pipeline, memory layout, role separation, and error system.
> These diagrams are explanatory, not normative – exact offsets and internal details may evolve.

---

## 1. End-to-End Flow: From Spec to Shared Memory

```mermaid
flowchart TD
  A[defineSpec] --> B[planLayout]
%% Backing allocation
  B --> C["allocateShared (contiguous SAB)"]
  B --> C2["allocateWasmShared (shared Wasm, advanced)"]
%% Golden path handoff (contiguous-only)
  C --> D[buildHandoff]
  D --> E[postMessage]
  E --> F[receiveHandoff]
  F --> G[bindProcessor]
%% Controller bindings (both backing flavors)
  B --> H[bindController]
  C --> H
  C2 --> H

  subgraph "Memory Plan Generation"
    B --> I[Compute plane sizes]
    I --> J[Assign param/meter slots]
    J --> K[Align planes]
    K --> L[Hash spec/plan]
  end

  subgraph "Runtime Binding"
    H --> M[Controller: write params]
    G --> N[Processor: read params]
    G --> O[Processor: write meters]
    M --> P[Shared memory]
    N --> P
    O --> P
  end
```

**Notes**

- The **golden handoff path** is:
  `defineSpec → planLayout → allocateShared → buildHandoff → postMessage → receiveHandoff → bindProcessor`.
- `allocateWasmShared(plan, memory)` is an **advanced alternative backing** that can feed `bindController`, but does **not
  ** currently feed `buildHandoff` (handoff assumes the contiguous `SharedBacking`).
- Processor side never sees `spec` or raw `plan` – only `Handoff` → `ReceivedHandoff` → `bindProcessor(received)`.

---

## 2. Memory Plane Architecture (Canonical Packing Order)

```text
Shared backing planes (ABI v1)

Plane  Type          Role                              Alignment / Notes
-----  ------------- -------------------------------   ------------------------------
PF32   Float32Array  Param payload (f32 scalars/arrays) 4-byte, packed first
PI32   Int32Array    Param payload (i32, enums)         4-byte
PB     Uint8Array    Param bool payload (0/1)           1-byte
PU     Uint32Array   Param seqlock [LOCK, SEQ]          4-byte elems; may be padded
MF32   Float32Array  Meter payload (f32 scalars/arrays) 4-byte
MF64   Float64Array  Meter payload (f64 scalars/arrays) 8-byte
MU32   Uint32Array   Meter payload (u32/bool meters)    4-byte
MU     Uint32Array   Meter seqlock [LOCK, SEQ]          4-byte elems; may be padded
```

**Notes**

- Canonical **plane set** and element sizes match the backing & primitives docs.

- ABI-stable **packing order** (`BACKING_PLANE_PACK_ORDER_V1`) is:

  ```text
  PF32 → PI32 → PB → PU → MF32 → MF64 → MU32 → MU
  ```

- Actual byte offsets per plane are computed by `planLayout(spec)` from:

  - per-plane byte lengths, and
  - alignment rules (`roundUpTo`, `BYTES_PER_ELEM[plane]`).

- Control planes `PU`/`MU` hold **only** `[LOCK, SEQ]` and may be padded out to at least one cache line; padding is an
  implementation detail, not an ABI promise.

---

## 3. Seqlock Protocol: Writer / Reader Dance

```mermaid
sequenceDiagram
  participant C as Controller (Writer)
  participant PU as PU seqlock
  participant M as Shared memory (PF32/PI32/PB)
  participant R as Processor (Reader)
  Note over C, R: PARAM WRITE FLOW
  C ->> PU: beginWrite() — LOCK++ (odd)
  C ->> M: Write param data (PF32 / PI32 / PB)
  C ->> PU: endWrite() — SEQ++ then LOCK++ (even)
  Note over C, R: PARAM READ FLOW (primitive tryRead semantics)
  R ->> PU: spinUntilEven(LOCK, spinBudget)
  R ->> PU: Read SEQ (seq0)
  R ->> M: Snapshot param data
  R ->> PU: Read SEQ (seq1) + verify LOCK even
  alt seq0 === seq1 && LOCK even
    R ->> R: Coherent snapshot
  else
    R ->> R: Retry (up to retryBudget)
  end
```

**Notes**

- This is the **primitive** seqlock protocol (`tryRead`-style), not necessarily the exact current binding
  implementation (which may start from this and add convenience).
- On success, the reader sees a **coherent snapshot** (no mixed old/new payload). On failure, it reports a bounded
  spin/retry timeout rather than silently degrading.

---

## 4. Type System Inference Chain

```text
Spec definition → type-safe controller binding
┌─────────────────────────────────────────────────────────────────────────────┐
│ defineSpec(({ param, meter }) => ({                                         │
│   params: {                                                                 │
│     cutoff: param.f32({ min: 20, max: 20_000 }),                            │
│     mode: param.enum({ values: ['normal', 'granular'] }),                   │
│   },                                                                        │
│   meters: {                                                                 │
│     peak: meter.f32({ min: 0, max: 1 }),                                    │
│   },                                                                        │
│ }))                                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼ TypeScript inference
┌─────────────────────────────────────────────────────────────────────────────┐
│ ControllerBinding<{                                                         │
│   params: {                                                                 │
│     cutoff: number;               // from f32                               │
│     mode: 'normal' | 'granular';  // literal union from enum values         │
│   };                                                                        │
│   meters: {                                                                 │
│     peak: number;                // from f32 meter                          │
│   };                                                                        │
│ }>                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Notes**

- Inline `values: ['normal', 'granular']` yields a **literal union** – no `as const` needed in TS ≥ 5.x.
- From this single `spec`:

  - `planLayout` derives the memory layout.
  - `bindController` / `bindProcessor` derive the binding types and legal keys/ranges.
  - Handoff verification uses the derived hash.

---

## 5. Error System: Fail-Fast Error Families

```mermaid
graph TB
  A[Error thrown] --> B{Error code domain}
  B --> C[env.*<br/>Environment / platform]
  B --> D[spec.*<br/>Definition validation]
  B --> E[plan.*<br/>Planning / layout]
  B --> F[backing.*<br/>Memory allocation & mapping]
  B --> G[handoff.*<br/>Cross-agent payload]
  B --> H[bindings.*<br/>Usage & contract]
  B --> I[internal.*<br/>Invariant violation]
  C --> C1[Unrecoverable<br/>SAB/Atomics unavailable,<br/>COOP/COEP missing]
  D --> D1[Never recoverable at runtime<br/>Fix your spec/DSL usage]
  E --> E1[Extremely rare<br/>Treat as bug or pathological spec]
  F --> F1[Configuration fault<br/>Mismatched plan/backing,<br/>invalid buffer]
  G --> G1[Protocol violation<br/>Hash/layout mismatch]
  H --> H1[User error<br/>Bad keys / ranges / roles]
  I --> I1[Library bug or corrupted inputs]
```

**Notes**

- Domains & examples match the structured `SeqlokErrorCode` union and error docs (`env.*`, `backing.*`, `handoff.*`,
  `bindings.*`, etc.).
- Backing and environment errors are **not “recoverable”** in core; callers should treat them as configuration /
  programming faults and fail fast.
- Additional domains like `primitives.*` and `diagnostics.*` exist in the implementation and can be documented in the
  dedicated error doc.

---

## 6. Controller vs Processor: Role Separation

```text
┌─────────────────────┐                ┌───────────────────────┐
│   CONTROLLER        │                │     PROCESSOR         │
│   (Main Thread)     │                │     (Worker/AW)       │
├─────────────────────┤                ├───────────────────────┤
│ • Writes params     │                │ • Reads params         │
│ • Reads meters      │                │ • Writes meters        │
│ • Initiates handoff │◄─ postMessage ─│ • Receives handoff     │
│ • UI integration    │                │ • Audio/DSP / engine   │
└─────────────────────┘                └───────────────────────┘
         │                                      │
         ▼                                      ▼
┌─────────────────────────────────────────────────────────────┐
│                 SHARED MEMORY PLANES                        │
│  ┌─────────────┐                ┌─────────────┐             │
│  │   PARAMS    │                │   METERS    │             │
│  │  PF32/PI32  │◄── Controller  │ MF32/MF64   │◄── Processor│
│  │     PB      │    writes      │    MU32     │   writes    │
│  │             │                │             │             │
│  │      PU     │    Processor   │      MU     │ Controller  │
│  │ [LOCK,SEQ]  │◄── reads       │ [LOCK,SEQ]  │   reads     │
│  └─────────────┘                └─────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

**Notes**

- Exactly one writer per domain:

  - Controller writes **params** + `PU`; processor reads them.
  - Processor writes **meters** + `MU`; controller reads them.

- No one writes into the other side's control plane; SWMR is enforced per domain.

---

## 7. Snapshot Performance Tiers (Controller Side)

```text
Controller meter snapshot usage tiers
┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
│     TIER 0       │     TIER 1       │     TIER 2       │     TIER 3       │
│   Zero-alloc     │  Single-key      │   Selected keys  │   Full snapshot  │
├──────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ .snapshot({      │ .snapshot(       │ .snapshot(       │ .snapshot()      │
│   into: {        │   ['rms']        │   ['rms',        │                  │
│     spectrum:    │ )                │    'spectrum'],  │                  │
│       buf        │                  │   { into: bufs } │                  │
│   },             │                  │ )                │                  │
│ })               │                  │                  │                  │
│                  │                  │                  │                  │
│ • Reuse buffers  │ • Fast path      │ • Filtered keys  │ • All meters     │
│ • No GC          │ • Minimal copy   │ • Moderate work  │ • Max work       │
└──────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

**Notes**

- Mirrors the documented `meters.snapshot` API: optional keys array + optional `{ into }` object for zero-alloc
  snapshots.
- This is purely about **work level**:

  - TIER 0: zero alloc, fixed buffers, minimal copying.
  - TIER 3: convenient but maximal read bandwidth.

---

## 8. Build Pipeline Overview

```mermaid
flowchart LR
  A[Source TypeScript] --> B[Vite/Rollup build]
  B --> C[ESM .js output]
  B --> D[.d.ts type declarations]

  subgraph "Internal optimizations"
    B --> E[Tree shaking]
    E --> F[Dead code elimination]
    F --> G[Constant folding]
  end

  subgraph "Type safety"
    B --> H[Strict TS config]
    H --> I[Generic constraint checks]
    I --> J[Literal type preservation]
  end
```

**Notes**

- Matches the current build story: ESM-only output, strict TS, and a single public entrypoint, with `index.d.ts`
  mirroring the runtime surface.

---

## 9. Cache Line Isolation Strategy

```text
Seqlock plane isolation (PU/MU)

CPU cache line facts (typical):
  • Apple M-series: often 128B cache lines
  • Many x86-64:     often 64B cache lines

Seqlok backing policy (implementation detail):
  • Treat PU/MU as tiny "control planes" for [LOCK, SEQ].
  • Optionally pad these control planes out to (at least) one cache line
    to reduce false sharing with hot PF32/PI32/MF32/MF64 data.
  • Exact padding/stride is not part of the public ABI and may evolve.

Consequence:
  • Seqlock atomics are kept away from bulk payload data in typical builds.
  • Planner + backing still guarantee:
      - plane alignment by element size, and
      - seqlock planes contain exactly [LOCK, SEQ].
```

---

## 10. Primitive Seqlock `tryRead` State Machine (Per-Call)

```mermaid
stateDiagram-v2
  [*] --> SpinForEvenLock
%% Spin until we see an even lock, bounded by spinBudget
  SpinForEvenLock --> SpinForEvenLock: lock odd\n&& spins < spinBudget\n(spins++)
  SpinForEvenLock --> SpinBudgetExceeded: lock odd\n&& spins >= spinBudget
  SpinForEvenLock --> ReadSeq0: lock even
%% Snapshot seq, run reader, then resample lock+seq
  ReadSeq0 --> ReadData
  ReadData --> ReadLock1Seq1
  ReadLock1Seq1 --> VerifyCoherence
%% Coherence:
%%   coherent   = lock1 even && seq0 === seq1
%%   incoherent = lock1 odd  || seq0 !== seq1
  VerifyCoherence --> Success: coherent
  VerifyCoherence --> Retry: incoherent\n&& retries < retryBudget
  VerifyCoherence --> RetryBudgetExceeded: incoherent\n&& retries >= retryBudget
%% Each retry restarts the spin/read cycle
  Retry --> SpinForEvenLock: retries++
%% Terminal outcomes:
%%   Success            -> { ok: true, value, status:{spins,retries} }
%%   SpinBudgetExceeded -> timeout (reason: 'spin')
%%   RetryBudgetExceeded-> timeout (reason: 'retry')
  Success --> [*]
  SpinBudgetExceeded --> [*]
  RetryBudgetExceeded --> [*]
```

**Notes**

- Describes a **single call** to a primitive `tryRead`:

  - Bounded spinning on `LOCK` until even (`spinBudget`).
  - Snapshot of `SEQ` and payload.
  - Re-check (`lock1`, `seq1`) and either succeed or retry.

- Timeouts are split:

  - `SpinBudgetExceeded` → lock never observed even within budget.
  - `RetryBudgetExceeded` → every coherent attempt lost a race.

---

## 11. Higher-Level Acquisition Helper with Degradation Policy

```mermaid
stateDiagram-v2
  [*] --> AttemptRead
  AttemptRead --> CoherentResult: ok === true
  AttemptRead --> TimeoutResult: ok === false
  CoherentResult --> ReturnCoherent
  ReturnCoherent --> [*]
  TimeoutResult --> ThrowError: degrade === 'throw'
  TimeoutResult --> ReturnLatest: degrade === 'returnLatest'
  TimeoutResult --> ReturnPrevious: degrade === 'returnPrevious'
  ThrowError --> [*]
  ReturnLatest --> [*]
  ReturnPrevious --> [*]
```

**Notes**

- This diagram is **not part of the seqlock primitive**; it sketches a _caller-side helper_ that decides what to do when
  `tryRead` times out.
- Typical policies:
  - `throw` → fail fast (e.g. for correctness-critical paths).
  - `returnLatest` → best-effort snapshot (HUD-only, non-critical metrics).
  - `returnPrevious` → reuse last known coherent value for stability.
- Keeping degradation out of the primitive preserves a clear separation:
  - Primitive: "Did I get a coherent snapshot within budgets?"
  - Helper: "What should I _do_ if I didn't?"

---
