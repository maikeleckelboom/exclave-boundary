# Hot-Swap Protocol: Single-Swap Specification

**Status:** Implemented – TLA⁺ spec and configs present  
**Scope:** Base single-swap protocol for `@seqlok/hotswap`  
**Audience:** Seqlok contributors, hotswap implementers, and TLA⁺ authors

This document describes the **formal specification** of the base hot-swap
protocol for a single swap between two engines. The protocol is modeled in
TLA⁺ and verified with the TLC model checker.

The focus is:

- A single in-flight swap (no queuing, no overlapping requests).
- At most two engines active: one current, one next.
- No gaps during crossfade.
- Eventual completion of each accepted swap.

This model proves base lifecycle, engine-count, and liveness.
It does **not** prove persistent-handoff semantics.
Those are modeled separately in `../persistent-handoff/HotSwapPersistentHandoff.md`.

Multi-swap behavior with reject-while-busy policy is specified separately in
`../reject-busy/HotSwapRejectBusy.md`.

---

## Files

```text
packages/hotswap/docs/formal/policies/single/tla/HotSwapSingle.tla
packages/hotswap/docs/formal/policies/single/tla/HotSwapSingle.cfg
packages/hotswap/docs/formal/policies/single/tla/HotSwapSingle.invonly.cfg
```

- `.tla` – TLA⁺ specification of the single-swap protocol.
- `.cfg` – full model-checking configuration (safety + liveness).
- `.invonly.cfg` – invariants-only configuration for faster safety checks.

---

## Properties Verified

### Safety invariants

The model checks the following invariants in both the full and invariants-only
configurations:

| Property                    | Description                                              |
| --------------------------- | -------------------------------------------------------- |
| `TypeOK`                    | All state variables remain within their declared domains |
| `AtMostTwoEngines`          | No more than two engines are active at any time          |
| `NoGapDuringCrossfade`      | Both engines are active during crossfade                 |
| `NoOrphanedNextEngine`      | `nextEngine` exists only when a swap ticket is active    |
| `PhaseTicketConsistency`    | Non-idle phases imply an active ticket                   |
| `PrewarmCounterConsistency` | Prewarm counter is positive only in valid phases         |
| `FadeFramesConsistency`     | Fade-frame tracking is consistent with configured bounds |

These invariants ensure that the protocol respects resource bounds and maintains
a structurally valid swap lifecycle in all reachable states.

### Liveness properties

The full configuration additionally checks temporal properties:

| Property                 | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `EventuallyIdle`         | Every non-idle state eventually leads back to idle       |
| `ProgressNeverDecreases` | `stepIndex` is monotonically non-decreasing              |
| `NoLivelockPrewarm`      | The protocol does not remain in `prewarm` indefinitely   |
| `NoLivelockCrossfade`    | The protocol does not remain in `crossfade` indefinitely |

These properties rely on standard weak fairness assumptions over the `Next`
relation in the TLA⁺ spec.

---

## Running the Model

### Workspace scripts

From the repository root:

```bash
# Invariants-only (safety) for the single-swap protocol
pnpm tla:hotswap

# Full verification (safety + liveness) for the single-swap protocol
pnpm tla:hotswap:full
```

The scripts default to the `single` policy and use the corresponding
`HotSwapSingle` configuration files.

### Direct TLC invocation

With `tla2tools.jar` available and the workspace layout intact:

```bash
# Full check (safety + liveness)
java -jar tools/tla/tla2tools.jar \
  -config packages/hotswap/docs/formal/policies/single/tla/HotSwapSingle.cfg \
  packages/hotswap/docs/formal/policies/single/tla/HotSwapSingle.tla

# Invariants-only (faster)
java -jar tools/tla/tla2tools.jar \
  -config packages/hotswap/docs/formal/policies/single/tla/HotSwapSingle.invonly.cfg \
  packages/hotswap/docs/formal/policies/single/tla/HotSwapSingle.tla
```

---

## Interpreting TLC Output

### Successful run

Typical successful output:

```text
Model checking completed. No error has been found.
...
2979221 states generated, 2339348 distinct states found, 0 states remaining.
Finished in 01min 38s
```

This indicates that:

- All invariants and temporal properties in the configuration hold.
- The explored state space (millions of states) contains no counterexamples.

### Counterexample

If an invariant or property is violated, TLC reports an error and prints a
witness behavior:

```text
Error: Invariant AtMostTwoEngines is violated.
Error: The following behavior constitutes a counter-example:

State 1: <Initial predicate>
  phase = "idle"
  hasTicket = FALSE
  ...

State 2: <AcceptTicket(2, 4)>
  phase = "spawn"
  ...
```

The reported behavior is a minimal sequence of states demonstrating the
violation and is suitable for mapping back to implementation-level scenarios.

---

## Protocol Overview

### Phases and transitions

The spec models a finite set of phases:

- `idle`
  No active swap. Exactly one engine is running (current engine).

- `spawn`
  Swap ticket was accepted; next engine instance now exists but has not yet
  processed audio.

- `prime`
  First processing block for the next engine. Output is discarded; internal
  state is initialized.

- `prewarm`
  Additional processing blocks for the next engine. Output is discarded; e.g.
  reverb tails or lookahead buffers settle.

- `crossfade`
  Current and next engines both produce output. The caller performs the actual
  mix; the protocol tracks remaining fade frames.

- `retire`
  Crossfade finished. Engine handles are swapped; the old engine is retired and
  the protocol returns to `idle`.

The TLA⁺ `Next` relation includes:

- `AcceptTicket(prewarm, fade)` – transition from `idle` into `spawn`.
- `StepSpawn` – `spawn → prime`.
- `StepPrime` – `prime → prewarm` or `prime → crossfade`.
- `StepPrewarm` – `prewarm → prewarm` or `prewarm → crossfade`.
- `StepCrossfade` – `crossfade → crossfade` or `crossfade → retire`.
- `StepRetire` – `retire → idle`.
- `StepIdle` – self-loop in `idle` to represent no-op blocks.

All valid sequences of these actions are explored by TLC.

### State machine sketch

```text
                    +--------------------------------------+
                    |                                      |
                    v                                      |
    +-------+  AcceptTicket  +-------+  step   +-------+  |
    | idle  | -------------->| spawn |-------->| prime |  |
    +-------+                +-------+         +-------+  |
        ^                                          |      |
        |                               +----------+------+
        |                               |                 |
        |                               v (prewarm>0)    v (prewarm=0)
        |                         +---------+       +-----------+
        |                         | prewarm |------>| crossfade |
        |                         +---------+       +-----------+
        |                               |                 |
        |                               +-----------------+
        |                                          |
        |                                          v
        |                                    +---------+
        +------------------------------------| retire  |
                                             +---------+
```

---

## Configuration Constants

The `.cfg` files define constants that parameterize the model:

```tla
MAX_PREWARM_BLOCKS = 3      \* Number of prewarm blocks explored
MAX_FADE_FRAMES    = 8      \* Maximum crossfade length in frames
BLOCK_FRAMES       = 2      \* Frames per audio block
MAX_STEP_INDEX     = 20000  \* Upper bound on stepIndex for behaviors
```

Interpretation:

- Larger `MAX_PREWARM_BLOCKS` and `MAX_FADE_FRAMES` increase the state space by
  exploring more combinations of prewarm and fade durations.
- `BLOCK_FRAMES` controls how fade frames are decremented per block.
- `MAX_STEP_INDEX` bounds the length of behaviors TLC considers, preventing
  unbounded stuttering paths.

These values are chosen to keep the state space tractable while exercising a
representative range of configurations.

---

## Relationship to Implementation

The single-swap TLA⁺ specification represents the protocol-level behavior,
independent of any specific language or engine implementation.

Key correspondences:

- `currentEngineActive` / `nextEngineActive`
  Map to engine-slot occupancy in the runtime (e.g. engine pointers or handles).

- `preWarmBlocksRemaining` / `fadeFramesRemaining` / `totalFadeFrames`
  Map to counters or scheduler state driving prewarm and crossfade phases.

- `stepIndex`
  Represents a logical progression counter. In implementations, similar
  progression can be expressed via block counters, frame indices, or command
  sequence numbers.

The specification guarantees that, under the modeled assumptions:

- No more than two engine instances are active per lane.
- Crossfade operations do not leave gaps in engine activity.
- Every accepted swap eventually completes and returns the protocol to
  `idle`.

Implementations in TypeScript, C++, or other languages are expected to preserve
these properties. Test harnesses can replay behaviors analogous to TLC traces
to validate conformance.

---

## Relation to Multi-Swap Specifications

`HotSwapSingle` serves as the foundation for more complex behaviors:

- `HotSwapRejectBusy` extends the single-swap protocol with:

  - Multiple concrete engine identities.
  - Host-level scheduling policy (reject-while-busy).
  - Accounting for accepted and rejected swap requests.

Multi-swap properties (e.g. "A→B→C ends on C" under a given policy) are
verified in the extended specification, while the core engine lifecycle
invariants (two engines, no gaps, eventual completion) remain shared.

---

## References

- `../reject-busy/HotSwapRejectBusy.md` – multi-swap protocol with reject-while-busy policy.
- `../persistent-handoff/HotSwapPersistentHandoff.md` – persistent-handoff continuity model.
- `../reject-busy/tla/HotSwapRejectBusy.tla` / `.cfg` – formal model and configuration for the extended protocol.
- Lamport, _Specifying Systems_ – TLA⁺ reference text.
- TLA⁺ Toolbox and TLC documentation for further details on model checking.
