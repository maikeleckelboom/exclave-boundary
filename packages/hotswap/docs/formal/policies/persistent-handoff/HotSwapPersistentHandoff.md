# Hot-Swap Protocol: Persistent Handoff

**Status:** Proposed — TLA⁺ spec scaffold present  
**Scope:** Continuity-class persistent handoff for `@seqlok/hotswap`  
**Audience:** Seqlok contributors, hotswap implementers, and TLA⁺ authors

This document describes the formal specification for **persistent continuity**
during a structural engine swap.

Persistent continuity means:

- The outgoing engine exports a handoff snapshot.
- The incoming engine installs that snapshot.
- The runtime advances the incoming engine through deterministic replay (catchup) from the capture frame to the crossfade start.
- The swap does not silently degrade when persistent continuity was required.

This is **not** an overlap policy.
Overlap policy (`single`, `reject-busy`) is a separate axis.
This model can be composed with any overlap policy.

---

## Files

```text
packages/hotswap/docs/formal/policies/persistent-handoff/tla/HotSwapPersistentHandoff.tla
packages/hotswap/docs/formal/policies/persistent-handoff/tla/HotSwapPersistentHandoff.cfg
packages/hotswap/docs/formal/policies/persistent-handoff/tla/HotSwapPersistentHandoff.invonly.cfg
```

- `.tla` – TLA⁺ specification of the persistent-handoff protocol.
- `.cfg` – full model-checking configuration (safety + liveness).
- `.invonly.cfg` – invariants-only configuration for faster safety checks.

---

## Scope

This spec covers:

- **Capture** — export running state from the outgoing engine at a known frame.
- **Install** — load the snapshot into the incoming engine, with explicit accept/reject.
- **Catchup** — replay input from capture frame to crossfade start.
- **Downgrade rules** — explicit behavior when persistent continuity cannot be satisfied.
- **Lineage invariants** — snapshot must belong to the correct engine and ticket.
- **Retire gating** — old engine cannot retire until install and catchup succeed.

It does **not** cover:

- Overlap handling (see `../single/` and `../reject-busy/`).
- Waveform similarity or psychoacoustic proof.
- Engine-internal snapshot format.

---

## Lifecycle

The persistent lifecycle extends the aligned lifecycle:

```text
spawn → capture → install → catchup → prewarm → crossfade → retire
```

### Phase semantics

#### `spawn`

Create the candidate engine instance.

#### `capture`

Export a handoff snapshot from the outgoing engine at a known frame boundary.

Requirements:

- RT-safe, no allocation, no blocking
- Bounded execution time
- Tied to a specific capture frame and engine lineage

#### `install`

Install the captured snapshot into the candidate engine.

Requirements:

- Explicit success or failure
- Incompatible payloads rejected
- Config/ABI lineage checked

#### `catchup`

Advance the candidate engine from capture frame to crossfade start by replaying input.

Requirements:

- Deterministic replay input window
- Correct frame lineage
- Output discarded during catchup

#### `prewarm`

Run the candidate engine on real input, discarding output, until stable.

#### `crossfade`

Run both engines in parallel on the same input and blend.

#### `retire`

Retire the outgoing engine only after persistent continuity obligations are satisfied.

Requirements:

- No retire before successful install
- No retire before required catchup is complete
- No silent downgrade if persistent continuity was required and disallowed

---

## Key invariants

### Safety

| Property                       | Description                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| `TypeOK`                       | All variables remain in their declared domains                 |
| `AtMostTwoEngines`             | No more than two engines active (current + next) at any time   |
| `NoGapDuringCrossfade`         | Both engines active during crossfade                           |
| `NoSilentDowngrade`            | Persistent-required swaps do not degrade silently              |
| `SnapshotLineageConsistency`   | Consumed snapshot belongs to correct engine lineage and ticket |
| `RetireAfterPersistentInstall` | Retire implies successful install and catchup                  |
| `NoCrossfadeBeforeReplay`      | Crossfade implies snapshot has reached replayed state          |

### Liveness

| Property                           | Description                                          |
| ---------------------------------- | ---------------------------------------------------- |
| `EventuallyIdle`                   | Every accepted swap eventually returns the lane idle |
| `PersistentSwapEventuallyResolves` | Every persistent swap completes or aborts explicitly |
| `NoCaptureLivelock`                | The protocol does not remain in `capture` forever    |
| `NoInstallLivelock`                | The protocol does not remain in `install` forever    |
| `NoCatchupLivelock`                | The protocol does not remain in `catchup` forever    |

---

## Running the Model

### Workspace Scripts

From the repository root:

```bash
# Fast invariants-only check (safety only)
pnpm tla:hotswap -- --policy persistent-handoff

# Full check (safety + liveness)
pnpm tla:hotswap:full -- --policy persistent-handoff
```

### Direct TLC Invocation

Assuming `tla2tools.jar` is available and the workspace layout is intact:

```bash
java -jar tla2tools.jar \
  -config packages/hotswap/docs/formal/policies/persistent-handoff/tla/HotSwapPersistentHandoff.cfg \
  packages/hotswap/docs/formal/policies/persistent-handoff/tla/HotSwapPersistentHandoff.tla
```

Use the `.invonly.cfg` file for a faster invariants-only run.

---

## Relationship to Requirements and Implementation

The persistent-handoff protocol corresponds to the continuity-class decision in
[`../../adr/hotswap-continuity-classes-and-persistent-handoff.md`](../../adr/hotswap-continuity-classes-and-persistent-handoff.md).

The formal model covers:

- Lifecycle legality for capture, install, catchup, and retire gating.
- Downgrade rules and explicit abort behavior.
- Snapshot lineage and ownership.

Implementation mapping:

- `capture` corresponds to `exportHandoffRT` in the engine ABI.
- `install` corresponds to `importHandoff` in the engine ABI.
- `catchup` corresponds to runtime replay buffer advancement.
- `NoSilentDowngrade` corresponds to runtime enforcement of `allowContinuityDowngrade`.

---

## References

- `../single/HotSwapSingle.md` – base single-swap protocol specification.
- `../reject-busy/HotSwapRejectBusy.md` – multi-swap protocol with reject-while-busy policy.
- `../../adr/hotswap-continuity-classes-and-persistent-handoff.md` – continuity-class ADR.
- Lamport, _Specifying Systems_ – TLA⁺ reference text.
