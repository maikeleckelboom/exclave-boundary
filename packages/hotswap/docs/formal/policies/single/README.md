# Policy: `single`

Base hotswap protocol: **one in-flight swap at a time** (no overlap handling).

This is the **policy-axis** model only.
Continuity-class expansion is modeled separately in `persistent-handoff`.

## Contents

- **English spec**: [`HotSwapSingle.md`](./HotSwapSingle.md)
- **TLA+**: [`tla/HotSwapSingle.tla`](./tla/HotSwapSingle.tla)
- **TLC configs**:
  - Full (safety + liveness): [`tla/HotSwapSingle.cfg`](./tla/HotSwapSingle.cfg)
  - Invariants-only: [`tla/HotSwapSingle.invonly.cfg`](./tla/HotSwapSingle.invonly.cfg)

## Phase lifecycle

The `single` policy uses the aligned 6-phase lifecycle:

`idle → spawn → prime → prewarm → crossfade → retire → idle`

(The orthogonal `persistent-handoff` continuity class extends this with `capture`, `install`, and `catchup`.)
