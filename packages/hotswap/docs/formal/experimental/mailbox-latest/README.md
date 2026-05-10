# Policy: `mailbox-latest`

Multi-swap semantics with **latest-wins mailbox** overlap handling.

> **EXPERIMENTAL (Level 3+)**: `mailbox-latest` is not part of the supported
> Level 1–2 taxonomy (`single`, `reject-busy`). Treat this as an experimental /
> future policy model. TLC checks for this policy are not currently considered
> “required to be green”.

If swaps are requested while the lane is busy, the host **never rejects**:
it writes the latest intent into a single-slot mailbox (overwriting any prior
pending intent). The lane converges to the last requested engine once requests
stop.

## Contents

- **English spec**: [`HotSwapMailboxLatest.md`](./HotSwapMailboxLatest.md)
- **TLA+**: [`tla/HotSwapMailboxLatest.tla`](./tla/HotSwapMailboxLatest.tla)
- **TLC configs**:
  - Full (includes liveness): [`tla/HotSwapMailboxLatest.cfg`](./tla/HotSwapMailboxLatest.cfg)
  - Invariants-only: [`tla/HotSwapMailboxLatest.invonly.cfg`](./tla/HotSwapMailboxLatest.invonly.cfg)

## Phase lifecycle

The `mailbox-latest` model uses the aligned 6-phase lifecycle:

`idle → spawn → prime → prewarm → crossfade → retire → idle`

(The orthogonal `persistent-handoff` continuity class extends this with `capture`, `install`, and `catchup`.)
