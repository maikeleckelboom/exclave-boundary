# Hot-Swap Protocol: Reject-While-Busy

**Status:** Implemented – TLA⁺ spec and configs present  
**Scope:** Multi-swap behavior with _reject-while-busy_ policy for `@seqlok/hotswap`  
**Audience:** Seqlok contributors, hotswap implementers, and TLA⁺ authors

This document describes the formal specification of the hot-swap protocol
extended with a **reject-while-busy** policy:

- Multiple sequential swaps (e.g. Engine1 → Engine2 → Engine3 → …).
- Overlapping swap requests are immediately rejected (no queueing).
- Host-level tracking of accepted and rejected requests.
- All base `HotSwapSingle` safety and liveness properties preserved.

The specification is encoded in `HotSwapRejectBusy.tla` and is verified using
the TLC model checker.

For the base single-swap protocol, see `../single/HotSwapSingle.md`.

For the orthogonal continuity-class model, see [`../persistent-handoff/HotSwapPersistentHandoff.md`](../persistent-handoff/HotSwapPersistentHandoff.md)
and [`../../adr/hotswap-continuity-classes-and-persistent-handoff.md`](../../adr/hotswap-continuity-classes-and-persistent-handoff.md).

This spec covers **overlap policy only**; it does not prove persistent handoff semantics.

---

## Files

```text
packages/hotswap/docs/formal/policies/reject-busy/tla/HotSwapRejectBusy.tla
packages/hotswap/docs/formal/policies/reject-busy/tla/HotSwapRejectBusy.cfg
packages/hotswap/docs/formal/policies/reject-busy/tla/HotSwapRejectBusy.invonly.cfg
```

- `.tla` – TLA⁺ specification of the reject-while-busy protocol.
- `.cfg` – full model-checking configuration (safety + liveness).
- `.invonly.cfg` – invariants-only configuration for faster checks.

---

## Scope of the Specification

`HotSwapRejectBusy.tla` extends the base protocol with:

### 1. Multiple Engine Instances

The model introduces a finite set of concrete engine identities:

- `Engine1`, `Engine2`, `Engine3`, and `NoEngine` as a sentinel.

Swaps can chain, for example:

- Engine1 → Engine2 → Engine3 → Engine1 → …

The spec tracks the currently active engine and the in-flight target engine.

### 2. Host-Level Request Accounting

The integration layer behavior (e.g. `scheduleSwap`) is modeled explicitly with:

- `swapRequests` – total swap requests issued.
- `swapsAccepted` – requests admitted into the protocol (idle lane).
- `swapsRejected` – requests rejected because the lane is busy.
- `completedSwaps` – sequence of completed engine transitions.

This allows the model to prove that:

- Accounting is consistent.
- Completed engine history matches the lane’s `currentEngine`.

### 3. Reject-While-Busy Policy

The host action `RequestSwap` models the scheduling policy:

```tla
RequestSwap(targetEngine, prewarm, fade) ==
    /\ targetEngine \in Engines
    /\ targetEngine # currentEngine
    /\ prewarm \in 0..MAX_PREWARM_BLOCKS
    /\ fade \in 1..MAX_FADE_FRAMES
    /\ swapRequests' = swapRequests + 1
    /\ IF IsLaneBusy
       THEN \* Reject
            /\ swapsRejected' = swapsRejected + 1
            /\ swapsAccepted' = swapsAccepted
            /\ UNCHANGED <<phase, hasTicket, preWarmBlocksRemaining,
                           fadeFramesRemaining, totalFadeFrames,
                           stepIndex, currentEngine, nextEngine,
                           completedSwaps>>
       ELSE \* Accept
            /\ swapsAccepted' = swapsAccepted + 1
            /\ swapsRejected' = swapsRejected
            /\ phase' = "spawn"
            /\ hasTicket' = TRUE
            /\ preWarmBlocksRemaining' = prewarm
            /\ fadeFramesRemaining' = fade
            /\ totalFadeFrames' = fade
            /\ nextEngine' = targetEngine
            /\ stepIndex' = stepIndex + 1
            /\ UNCHANGED <<currentEngine, completedSwaps>>
```

`IsLaneBusy` is defined as `phase # "idle"`.
A busy lane rejects new requests without altering the active swap.

---

## Proven Properties

The model proves both safety and liveness properties.

### Safety Invariants

The following invariants are checked in both the full and invariants-only
configurations:

| Property                      | Description                                                      |
| ----------------------------- | ---------------------------------------------------------------- |
| `TypeOK`                      | All variables remain in their declared domains                   |
| `AtMostTwoEngines`            | No more than two engines active (current + next) at any time     |
| `NoGapDuringCrossfade`        | Both engines active during crossfade                             |
| `NextEngineConsistency`       | `nextEngine` is non-`NoEngine` only when the protocol is active  |
| `CompletedSwapsConsistency`   | Completed history is consistent with actual engine transitions   |
| `SequentialSwapsComplete`     | Engine chains (e.g. 1→2→3) end on the correct final engine       |
| `NoRejectedEngineInDecisions` | Rejected engines never appear as `currentEngine` or `nextEngine` |

These invariants ensure that:

- Engine slot usage is bounded and well-structured.
- The reject-while-busy policy does not corrupt the active swap.
- The recorded history matches the lane state.

### Liveness Properties

The full configuration additionally checks temporal properties:

| Property                | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| `EventuallyIdle`        | Every accepted swap eventually returns the lane idle   |
| `MultipleSwapsComplete` | Accepted multi-swap sequences eventually settle        |
| `NoLivelockPrewarm`     | The protocol does not remain in prewarm indefinitely   |
| `NoLivelockCrossfade`   | The protocol does not remain in crossfade indefinitely |

These properties rely on weak fairness assumptions over the `Next` relation.

---

## Running the Model

### Workspace Scripts

From the repository root:

```bash
# Fast invariants-only check (safety only)
pnpm tla:hotswap -- --policy reject-busy

# Full check (safety + liveness)
pnpm tla:hotswap:full -- --policy reject-busy
```

- With `-- --policy reject-busy`, `tla:hotswap` runs TLC with `HotSwapRejectBusy.invonly.cfg`.
- With `-- --policy reject-busy`, `tla:hotswap:full` runs TLC with `HotSwapRejectBusy.cfg`.

### Direct TLC Invocation

Assuming `tla2tools.jar` is available and the workspace layout is intact:

```bash
java -jar tools/tla/tla2tools.jar \
  -config packages/hotswap/docs/formal/policies/reject-busy/tla/HotSwapRejectBusy.cfg \
  packages/hotswap/docs/formal/policies/reject-busy/tla/HotSwapRejectBusy.tla
```

Use the `.invonly.cfg` file for a faster invariants-only run.

---

## Interpreting TLC Output

A successful run prints output similar to:

```text
Model checking completed. No error has been found.
...
252978 states generated, 14881 distinct states found, 0 states remaining.
```

Key points:

- “No error has been found” indicates that all specified invariants and temporal
  properties hold for the explored state space.
- `states generated` and `distinct states found` give a sense of coverage.
- Depth values indicate the length of the longest behavior explored.

Compared to `HotSwapSingle`, this model typically explores fewer distinct states,
since:

- The configuration constrains the number of swap attempts.
- The goal is to verify host-level policy behavior rather than re-explore all
  prewarm/fade combinations in detail.

---

## Configuration Constants

The `.cfg` files define constants that control state-space exploration:

```tla
MAX_PREWARM_BLOCKS = 1
MAX_FADE_FRAMES    = 4
BLOCK_FRAMES       = 2
MAX_BEHAVIORS      = 3

Engine1 = "Engine1"
Engine2 = "Engine2"
Engine3 = "Engine3"
NoEngine = "NoEngine"
```

These settings imply:

- A single prewarm block per swap in the model.
- Short crossfades to keep the state space tractable.
- Up to three completed swaps recorded in `completedSwaps`.

The behavior constraint in the TLA spec is:

```tla
BehaviorBound ==
    /\ Len(completedSwaps) <= MAX_BEHAVIORS
    /\ swapRequests <= 10
```

This bound:

- Limits the length of swap chains.
- Limits the total number of swap attempts.
- Keeps model checking practical while still exercising multi-swap behavior and
  overlapping request patterns.

Values can be adjusted to trade off runtime against exploration depth.

---

## State-Space Tuning Guidelines

Typical tuning patterns:

- **Development runs (fast feedback):**

  - Lower `MAX_BEHAVIORS` (e.g. 2).
  - Lower `MAX_FADE_FRAMES`.
  - Tighten `swapRequests` bound.

- **CI / pre-release runs (deeper coverage):**

  - Increase `MAX_BEHAVIORS` (e.g. 4).
  - Increase `MAX_FADE_FRAMES`.
  - Relax `swapRequests` bound modestly.

- **Exploratory runs:**

  - Relax `swapRequests` and `MAX_BEHAVIORS` further.
  - Expect substantially longer runtimes due to combinatorial growth.

---

## Representative Scenarios

The state space includes both sequential and overlapping swaps.

### Sequential Swaps

Example pattern:

1. Lane idle, `currentEngine = Engine1`.
2. Request swap to `Engine2` → accepted.
3. Swap `Engine1 → Engine2` completes.
4. Lane idle, `currentEngine = Engine2`.
5. Request swap to `Engine3` → accepted.
6. Swap `Engine2 → Engine3` completes.
7. Lane idle, `currentEngine = Engine3`.

The model verifies that:

- At most two engines are active at any time.
- `completedSwaps` ends with `Engine3`.
- Idle states are consistent with the completed history.

### Overlapping Requests

Example pattern:

1. Lane idle, `currentEngine = Engine1`.
2. Request swap to `Engine2` → accepted (lane becomes busy).
3. Swap from `Engine1` to `Engine2` enters prewarm or crossfade.
4. Request swap to `Engine3` while busy → rejected.
5. Swap `Engine1 → Engine2` completes.
6. Lane idle, `currentEngine = Engine2`.

The model verifies that:

- `Engine3` does not appear as `currentEngine` or `nextEngine` during the active
  swap.
- `swapsRejected` reflects the rejected request.
- The active swap and its invariants are not affected by the rejection.

---

## Relationship to Requirements and Implementation

The reject-while-busy protocol corresponds to the integration behavior described
in the ADRs for multi-swap hotswap requirements. The formal model covers:

- Sequential multi-swap behavior.
- Immediate rejection of overlapping requests.
- Preservation of base hotswap invariants.

Implementation mapping:

- `RequestSwap` corresponds to the host-side `scheduleSwap` function.
- `swapsAccepted` / `swapsRejected` correspond to host-level counters that can
  be mirrored in telemetry or diagnostics.
- `completedSwaps` corresponds to derived or explicitly tracked engine histories
  used for debugging and observability.

The TLA model and the TypeScript/C++ implementations should exhibit equivalent
observable behavior with respect to:

- Engine transitions.
- Accepted vs rejected requests.
- Invariants over engine activity and swap phases.

---

## Future Extensions

The reject-while-busy protocol forms the basis for more advanced policies.

Possible extensions include:

- **Future overlap handling:** accept additional swaps while one is active,
  with defined Level 3+ behavior.
- **Cancellation:** introduce a host-level action that transitions an in-flight
  swap to a safe cancellation path.
- **Additional engine identities:** expand `Engines` to four or more concrete
  values, with additional bounds to keep state space manageable.

Such extensions would be modeled in separate TLA modules (for example
future overlap-handling module(s) (Level 3+)) that build on the same core invariants.

---

## References

- `../single/HotSwapSingle.md` – base single-swap protocol specification.
- `../single/tla/HotSwapSingle.tla` / `.cfg` – formal model and configuration for the base protocol.
- ADR documents under `packages/hotswap/docs/adr/` describing multi-swap requirements.
