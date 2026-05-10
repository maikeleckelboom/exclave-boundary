# Hot-Swap Continuity Classes and Persistent Handoff

**Status:** Proposed ADR  
**Date:** 2026-05-10  
**Depends on:**

- `CONTRACT.md` (Levels 1–2 protocol contract)
- `engine/engine-lifecycle-spec.md` (current engine lifecycle)
- `engine/engine-sdk-guide.md` (current engine ABI guidance)
- `adr/hotswap-multi-swap-requirements.md` (Level 2 overlap policy)
- Existing TLA+ specs under `formal/policies/single` and `formal/policies/reject-busy`

---

## READ THIS FIRST

This ADR does **not** redefine the existing Level 1 / Level 2 / Level 3 taxonomy.

Those levels are about **swap policy**:

- **Level 1**: single-swap correctness
- **Level 2**: reject-while-busy overlap policy
- **Level 3+**: exploratory/future overlap policies such as queueing or retarget

This ADR introduces a **separate continuity axis** for what kind of state handoff a swap provides:

- `aligned`
- `persistent`

That distinction matters.

Today Seqlok hotswap is a strong **instance replacement** protocol with alignment context. It is **not yet** a
first-class persistent-state transfer protocol. This ADR closes that gap without lying about what the current system
guarantees.

---

## 1. Purpose

Seqlok currently supports hot-swapping a running engine by:

1. creating a new engine instance,
2. priming it with alignment context,
3. prewarming it,
4. crossfading,
5. retiring the old instance.

That is good enough for the existing contract, but it is too soft for engines whose internal DSP state matters during
swap, especially time-stretch and pitch-shift engines that maintain rolling analysis/synthesis state.

The current `PrimeContext` surface provides:

- playback position,
- recent input history,
- optional opaque outgoing phase state.

That is useful, but it does **not** amount to a formal promise that internal engine state is preserved across the swap.
The current design still permits a cold-start fallback when handoff quality is incomplete.

For engines such as Signalsmith-based stretchers, Dekzer needs a stronger contract:

> It must be possible to hot-swap while audio is already playing through active DSP, including active time-stretch or
> pitch processing, without treating state continuity as a vague best-effort hint.

This ADR defines that stronger contract.

---

## 2. Problem Statement

### 2.1 What the current design does well

The current hotswap design already gives us:

- immutable structural engine instances,
- off-RT create / destroy,
- on-RT prewarm / crossfade execution,
- bounded active-engine count,
- formal safety/liveness proofs for the base lifecycle and current overlap policy.

That foundation stays.

### 2.2 What the current design does not yet guarantee

The current design does **not** yet define:

- a formal persistent-state export/import contract,
- a way to require persistent continuity instead of best-effort alignment,
- explicit downgrade behavior,
- lineage constraints on handoff payloads,
- replay/catchup requirements between captured state and crossfade start,
- formal verification obligations for handoff validity.

### 2.3 Why this matters

Without an explicit persistent-handoff contract, the system cannot honestly claim:

- that a running stretch engine preserves internal rolling state across swap,
- that active time-stretch or pitch processing can survive a structural swap with a strong continuity guarantee,
- that failure to preserve state will be surfaced explicitly instead of silently degrading.

That gap is architectural, not cosmetic.

---

## 3. Goals and Non-Goals

### 3.1 Goals

This ADR aims to:

- introduce a **continuity-class axis** orthogonal to swap-policy levels,
- distinguish **alignment continuity** from **persistent continuity**,
- define a first-class engine handoff ABI for persistent state transfer,
- require **explicit** downgrade/abort behavior,
- support hot-swapping while active DSP is running, including active stretch / pitch processing, when the engine family
  honestly supports persistent handoff,
- define the runtime lifecycle needed to make persistent handoff real,
- define new TLA+ proof obligations for handoff correctness.

### 3.2 Non-Goals

This ADR does **not**:

- redefine Level 1 / 2 / 3 overlap policy taxonomy,
- promise that every engine family can support persistent handoff,
- require psychoacoustic sample-perfect proof in TLA+,
- define algorithm-internal snapshot formats for every engine,
- replace live parameter updates for non-structural controls such as `stretchRatio` or `pitchRatio`,
- require three active engines per lane.

Persistent handoff is a stronger continuity contract for structural swaps. It is not a replacement for live param
updates.

---

## 4. Decision Summary

We introduce an orthogonal continuity axis with two normative request classes:

```ts
export type ContinuityRequirement = "aligned" | "persistent";
```

We also define a granted result class that may reflect explicit downgrade:

```ts
export type ContinuityGranted = "cold" | "aligned" | "persistent";
```

### Core decision

A swap may now request one of two continuity classes:

- **`aligned`**

  - Current model, formalized.
  - New instance receives alignment context such as playback position, input history, and optional engine-defined
    auxiliary state.
  - Best for engines that can start seamlessly from bounded context but do not expose stable persistent snapshots.

- **`persistent`**
  - Stronger model.
  - The outgoing engine exports a handoff snapshot.
  - The incoming engine installs that snapshot.
  - The runtime replays input from capture point to crossfade start.
  - The swap may not silently degrade if persistent continuity was required.

### Critical rule

**No silent downgrade.**

If `persistent` continuity is requested and downgrade is not allowed, the swap must either:

- complete under `persistent` continuity, or
- fail explicitly.

It must not quietly fall back to `aligned` or `cold` behavior.

---

## 5. Architectural Position

### 5.1 What stays true

These current laws remain intact:

- Structural configuration changes still happen by instance replacement, not live mutation.
- The driver still owns lifecycle sequencing and crossfade.
- Engines still remain parallel-safe during crossfade.
- Non-structural parameters remain live-update territory.
- Existing Level 1 / Level 2 guarantees remain valid for callers that do not opt into persistent continuity.

### 5.2 What changes

We now explicitly recognize that there are **two different kinds of continuity**:

1. **Aligned continuity**

- continuity by context and bounded catch-up,
- no formal promise that full internal state is preserved.

2. **Persistent continuity**

- continuity by formal handoff snapshot, import, replay, and guarded retire,
- explicit success/failure semantics.

This stops the contract from overstating what `PrimeContext` alone can do.

---

## 6. Public API Additions

### 6.1 Swap ticket additions

```ts
export interface SwapTicket {
  readonly ticketId: number;
  readonly atFrame: number;
  readonly fadeFrames: number;
  readonly preWarmBlocks: number;

  readonly continuityRequirement?: ContinuityRequirement;
  readonly allowContinuityDowngrade?: boolean;
}
```

### 6.2 Swap result additions

```ts
export interface SwapResult {
  readonly accepted: boolean;
  readonly reason?:
    | "lane-busy"
    | "invalid-ticket"
    | "out-of-range"
    | "handoff-unsupported"
    | "handoff-capture-failed"
    | "handoff-import-failed"
    | "handoff-replay-failed"
    | "internal-error";
  readonly ticketId?: number;

  readonly continuityRequested?: ContinuityRequirement;
  readonly continuityGranted?: ContinuityGranted;
}
```

### 6.3 Compatibility rule

If `continuityRequirement` is omitted, existing callers continue to behave as today.

Recommended default:

- current structural swaps default to `aligned`,
- `persistent` is opt-in until the relevant engines and runtime support are present and battle-tested.

---

## 7. Engine Capability and Handoff ABI

### 7.1 Capability discovery

Persistent continuity cannot be host-guessed. It must be engine-declared.

```ts
export type HandoffSupport = "none" | "aligned" | "persistent";

export interface HandoffCapability<TConfig> {
  readonly support: HandoffSupport;
  readonly handoffAbiVersion?: number;
  readonly maxSnapshotBytes?: number;

  canHandoff(
    fromConfig: Readonly<TConfig>,
    toConfig: Readonly<TConfig>,
  ): {
    readonly supported: boolean;
    readonly continuityGranted: ContinuityGranted;
    readonly reason?:
      | "different-algorithm-family"
      | "incompatible-quality-mode"
      | "state-schema-mismatch"
      | "engine-declines";
  };
}
```

### 7.2 Snapshot types

```ts
export interface HandoffSnapshotDescriptor {
  readonly abiVersion: number;
  readonly sourceEngineFamily: string;
  readonly sourceConfigHash: string;
  readonly captureFrame: number;
  readonly latencySamples: number;
  readonly payloadByteLength: number;
}

export interface ExportedHandoffSnapshot {
  readonly descriptor: HandoffSnapshotDescriptor;
  readonly payload: ArrayBuffer;
}
```

### 7.3 Engine handoff extension ABI

```ts
export interface EngineHandoffABI<TConfig, THandle> {
  getHandoffCapability(): HandoffCapability<TConfig>;

  exportHandoffRT?(
    handle: THandle,
    frame: number,
    targetBuffer: ArrayBuffer,
  ): ExportedHandoffSnapshot;

  importHandoff?(
    handle: THandle,
    snapshot: ExportedHandoffSnapshot,
    ctx: PrimeContext,
  ): {
    readonly accepted: boolean;
    readonly reason?:
      | "abi-version-mismatch"
      | "config-incompatible"
      | "payload-invalid"
      | "engine-rejected";
  };
}
```

### 7.4 Ownership rules

- The **engine** owns:

  - snapshot structure,
  - config compatibility judgment,
  - export/import validity,
  - any internal replay semantics needed to make the handoff meaningful.

- The **hotswap runtime** owns:

  - sequencing,
  - buffer provisioning,
  - capture timing,
  - replay/catchup orchestration,
  - explicit downgrade/abort behavior,
  - retire legality.

- The **host/controller** owns:
  - requested continuity class,
  - whether downgrade is allowed,
  - user-facing recovery / retry behavior.

---

## 8. Lifecycle Changes

### 8.1 Current lifecycle

Today the engine-facing lifecycle is effectively:

```text
spawn → prime → preWarm → crossFade → retire
```

That remains correct for aligned continuity.

### 8.2 New lifecycle for persistent continuity

For `persistent` continuity, the lifecycle is split as follows:

```text
spawn → capture → install → catchup → preWarm → crossFade → retire
```

### 8.3 Phase semantics

#### `spawn`

Create the candidate engine off the audio thread.

#### `capture`

At a block boundary, export a handoff snapshot from the currently active engine into preallocated memory.

Requirements:

- RT-safe
- no allocation
- no blocking
- bounded execution time
- tied to a known capture frame

#### `install`

Install the captured snapshot into the candidate engine.

Requirements:

- explicit success/failure
- reject incompatible ABI/config/payload
- may happen off the audio thread unless the engine family explicitly requires otherwise

#### `catchup`

Advance the candidate engine from the snapshot capture frame to the intended crossfade start by replaying the same input
history / buffered input stream the active engine has already consumed.

This phase is mandatory for persistent continuity unless capture and crossfade start are the same frame.

Without `catchup`, the contract is not honestly persistent.

#### `preWarm`

Run the candidate engine with real input and discard output until it is stable for crossfade.

#### `crossFade`

Run current and next in parallel on the same input and blend in the driver.

#### `retire`

Retire the old engine only after the continuity conditions for the accepted swap have been satisfied.

---

## 9. Aligned vs Persistent: Required Semantics

### 9.1 `aligned`

An `aligned` swap guarantees:

- correct lifecycle sequencing,
- position-aware startup,
- bounded context-based continuity,
- no silent confusion about overlap policy.

An `aligned` swap does **not** guarantee:

- full preservation of internal DSP state,
- stable replayable engine lineage,
- explicit handoff snapshot import.

### 9.2 `persistent`

A `persistent` swap guarantees:

- explicit engine-declared compatibility,
- snapshot capture from the outgoing engine,
- explicit snapshot installation into the incoming engine,
- catchup/replay from capture point to crossfade start,
- no silent downgrade when downgrade is disallowed,
- explicit failure if persistent handoff cannot be honored.

### 9.3 Cold fallback

`cold` is a **granted result class**, not a normative request class.

It exists so the runtime can describe what actually happened when downgrade is permitted.

Example:

- caller requests `persistent`,
- engine/runtime cannot satisfy it,
- caller allowed downgrade,
- runtime returns `continuityGranted: "aligned"` or `"cold"` explicitly.

The runtime must not hide that outcome.

---

## 10. Signalsmith and Similar Engines

### 10.1 Intent

This ADR exists in part to support structural hot-swaps while audio is already playing through active time-stretch /
pitch-processing engines.

That includes Signalsmith-based stretch engines.

### 10.2 Honest support boundary

This ADR does **not** claim that every Signalsmith-backed adapter automatically supports `persistent` continuity.

For any engine family, `persistent` continuity is honest only if at least one of the following is true:

- the engine can export/import enough internal state to resume meaningfully,
- the engine can be cloned exactly at a capture boundary,
- the full effective running state can be reconstructed from a formally defined snapshot + replay window.

If none of those is true, the engine may still support `aligned`, but it must not claim `persistent`.

### 10.3 Product truth

After this ADR, Seqlok may truthfully support the statement:

> It is possible to hot-swap while active stretch or pitch DSP is running.

But the stronger statement:

> persistent state survives the swap

is only valid for engine families and transition pairs that implement this ABI honestly.

---

## 11. Runtime Requirements

### 11.1 No silent downgrade

If `continuityRequirement = "persistent"` and `allowContinuityDowngrade = false`, then the runtime must not enter
`crossFade` unless persistent continuity has been successfully established.

### 11.2 Capture lineage

A snapshot must be tied to:

- the current active engine instance lineage,
- a specific capture frame,
- a specific source config hash / engine family,
- the specific accepted ticket that will consume it.

### 11.3 Replay / catchup integrity

If capture occurs before crossfade start, the runtime must provide the candidate engine enough deterministic replay
input to advance from capture point to crossfade start.

### 11.4 Bounded active-engine count

This ADR preserves the current strict two-engine model unless an explicit future policy changes that.

Persistent continuity must fit within:

- current engine
- next engine

No third audible engine is introduced by this ADR.

### 11.5 Memory and buffer ownership

The runtime must own:

- handoff snapshot buffer allocation policy,
- replay buffer retention window,
- safe reclamation timing after retire.

No allocation may occur on the audio thread for handoff capture.

---

## 12. TLA+ Model Expansion

### 12.1 Why the current model is insufficient

The current TLA+ model proves lifecycle and overlap safety, but it does not model:

- handoff payload lineage,
- explicit continuity class,
- downgrade legality,
- replay/catchup requirements,
- persistent-install gating for retire.

### 12.2 New state variables

The persistent-handoff model should add variables along these lines:

```tla
phase \in {
  "idle", "spawn", "capture", "install",
  "catchup", "prewarm", "crossfade", "retire"
}

continuityRequested \in {"aligned", "persistent"}
continuityGranted \in {"cold", "aligned", "persistent"}
downgradeAllowed \in BOOLEAN
snapshotState \in {"none", "captured", "installed", "replayed"}
snapshotOwner \in Engines \cup {NoEngine}
snapshotTicket \in TicketIds \cup {NoTicket}
```

Exact names may differ in the final spec.

### 12.3 Required safety properties

The formal model must prove at least:

#### `NoSilentDowngrade`

If `persistent` was requested and downgrade is not allowed, `crossfade` cannot occur under non-persistent continuity.

#### `SnapshotLineageConsistency`

A consumed snapshot must belong to the current active engine lineage and to the accepted ticket that consumes it.

#### `NoCrossfadeBeforeReplay`

For persistent swaps, `crossfade` implies the snapshot has reached the replayed state.

#### `RetireAfterPersistentInstall`

For persistent swaps, `retire` implies successful capture, install, and catchup.

#### `AtMostTwoEngines`

Still holds in the persistent-handoff model.

#### `FallbackExplicit`

If downgrade occurs, the granted continuity class must reflect it explicitly.

### 12.4 Required liveness properties

The formal model must also prove:

#### `PersistentSwapEventuallyResolves`

Every accepted persistent swap eventually either:

- completes and returns to idle, or
- aborts explicitly with a handoff failure.

#### `NoCaptureLivelock`

The protocol cannot remain in `capture` forever.

#### `NoInstallLivelock`

The protocol cannot remain in `install` forever.

#### `NoCatchupLivelock`

The protocol cannot remain in `catchup` forever.

### 12.5 What TLA+ still does not prove

TLA+ is still not the place to prove:

- waveform similarity,
- psychoacoustic transparency,
- algorithm-internal numerical stability,
- time-stretch quality.

Those remain engine-level conformance and integration-test concerns.

---

## 13. Conformance and Test Strategy

### 13.1 Engine-level conformance

Each engine family that claims `persistent` continuity must provide tests for:

- snapshot export/import compatibility,
- rejection of invalid snapshot payloads,
- deterministic replay/catchup from a captured point,
- correct decline for unsupported config transitions.

### 13.2 Runtime integration tests

The hotswap harness should gain tests for:

- persistent-required swap rejects when unsupported,
- persistent-required swap does not silently degrade,
- explicit downgrade result when downgrade is allowed,
- no retire before persistent install/replay is complete,
- final idle engine corresponds to accepted persistent ticket.

### 13.3 Stretch-engine scenarios

Signalsmith-focused scenarios should include:

- active stretch processing during structural swap,
- active pitch processing during structural swap,
- quality-tier swap inside same engine family,
- algorithm-family swap where only `aligned` is possible,
- explicit failure path where persistent continuity is required but unsupported.

---

## 14. Documentation Coupling

If this ADR is accepted, the following docs must be updated in lock-step:

- `CONTRACT.md`

  - clarify that current Levels 1–2 remain swap-policy levels,
  - add continuity-class terminology,
  - keep persistent handoff out of the core claim until formally landed.

- `engine/engine-lifecycle-spec.md`

  - split aligned lifecycle from persistent lifecycle,
  - add `capture`, `install`, and `catchup` semantics.

- `engine/engine-sdk-guide.md`

  - add handoff capability discovery and snapshot ABI,
  - demote `phaseState?: unknown` from implied persistence.

- `formal/README.md`

  - add the persistent-handoff formal spec and scope.

- `README.md`
  - link this ADR in the ADRs section.

---

## 15. Migration and Rollout

### Phase 1: doctrine

- Accept this ADR.
- Add continuity-class terminology to docs.
- State clearly that current `prime` implies `aligned`, not `persistent`.

### Phase 2: engine ABI extension

- Add optional capability discovery and handoff ABI.
- Do not make persistent continuity mandatory for all engines.

### Phase 3: runtime implementation

- Add capture / install / catchup sequencing.
- Add explicit downgrade / abort result plumbing.

### Phase 4: formal model

- Add `formal/policies/persistent-handoff/...` TLA+ model and English spec.
- Prove lifecycle and downgrade/lineage invariants.

### Phase 5: conformance

- Add engine-family conformance suites.
- Mark engine/config pairs as `aligned` or `persistent` based on real evidence, not aspiration.

---

## 16. Consequences

### Positive

- The contract becomes honest about continuity strength.
- Active stretch/pitch DSP can be supported under a real persistent-handoff model.
- Engine families can declare exactly what they support.
- Formal verification scope becomes clearer.
- No more vague overloading of `PrimeContext` as if it already solved persistence.

### Costs

- More runtime phases and bookkeeping.
- Snapshot/replay buffer ownership becomes a first-class concern.
- Engine authors must implement real handoff support to claim `persistent`.
- Docs, tests, and formal models must all expand together.

### Risk if we do nothing

If we do nothing, the docs keep implying more continuity than they can formally support, especially for long-lived DSP
stateful engines.

That is not acceptable for a serious real-time substrate.

---

## 17. Acceptance Bar

This ADR should be considered accepted only when:

1. the continuity axis is documented consistently,
2. the engine ABI extension is defined,
3. runtime sequencing for persistent continuity is specified,
4. TLA+ obligations are written down,
5. downgrade behavior is explicit,
6. no doc implies that `PrimeContext` alone equals persistent state transfer.

---

## 18. Final Summary

The current Seqlok hotswap model is:

> create a new instance, align it, prewarm it, crossfade it, retire the old one.

That remains valid.

This ADR adds the missing stronger mode:

> if the engine family supports it, capture real running state, install it into the new instance, replay to the swap
> point, then crossfade without silent downgrade.

That is the correct substrate for serious persistent continuity during hot-swaps of active DSP engines, including
Signalsmith-based stretch engines where the adapter can support it honestly.
