# Policy: `persistent-handoff`

Continuity-class model for **persistent handoff** between engines.

This model is orthogonal to the overlap-policy models (`single`, `reject-busy`).
It proves lifecycle semantics for explicit snapshot export/import, catchup, and guarded retire.

## Contents

- **English spec**: [`HotSwapPersistentHandoff.md`](./HotSwapPersistentHandoff.md)
- **TLA+**: [`tla/HotSwapPersistentHandoff.tla`](./tla/HotSwapPersistentHandoff.tla)
- **TLC configs**:
  - Full (safety + liveness): [`tla/HotSwapPersistentHandoff.cfg`](./tla/HotSwapPersistentHandoff.cfg)
  - Invariants-only: [`tla/HotSwapPersistentHandoff.invonly.cfg`](./tla/HotSwapPersistentHandoff.invonly.cfg)

## What this model proves

- Capture, install, and catchup phases are legal and bounded.
- No silent downgrade when persistent continuity is required and disallowed.
- Snapshot lineage is consistent with the active engine and accepted ticket.
- Retire is gated on successful install and catchup.
- At most two engines remain active at any time.

## What this model does not prove

- Waveform similarity or psychoacoustic transparency.
- Algorithm-internal numerical stability.
- Time-stretch quality.

Those remain engine-level conformance concerns.

## Relationship to overlap policy

The persistent-handoff model can be composed with either `single` or `reject-busy` overlap policy.
The overlap policy governs whether a new request is accepted; the continuity class governs what happens inside an accepted swap.
