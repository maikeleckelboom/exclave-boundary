# Hot-swap Protocol Contract

This package defines the **protocol** for swapping between two engines
in a single logical slot without audio glitches.

It does **not** know about audio buffers, crossfade curves, or engine
implementations.

## What the protocol guarantees

Given a valid ticket and a cooperating caller:

- At most **two** engines are active for a slot at any time
  (current + next).
- A swap that is accepted via `initSwapStateRT` and driven via repeated
  `stepSwapStateRT` will eventually reach `phase = "idle"` (no stuck
  intermediate states).
- During `"crossfade"`, both current and next are considered active
  every block.
- `progress` is monotonic from 0 → 1 over the lifecycle of a swap.

These properties are captured in the TLA⁺ specs:

- **Base protocol:** `formal/policies/single/tla/HotSwapSingle.tla`
- **Multi-swap (reject-while-busy):** `formal/policies/reject-busy/tla/HotSwapRejectBusy.tla`

and are model-checked with TLC.

**Supported levels:** This contract is normative for Levels 1–2:

- **Level 1** = policy `single` (base single-swap protocol)
- **Level 2** = policy `reject-busy` (overlap defined as "reject while busy")

Anything beyond that is **experimental/future** and
is not part of the shipped contract surface.

## Continuity class is orthogonal to policy level

Swap policy and continuity class are two different axes.

- **`aligned`** — continuity by alignment context, bounded warm-up, and crossfade.
- **`persistent`** — continuity by explicit handoff snapshot, install, catchup, and guarded retire.

The current base contract remains valid for callers that do not opt into persistent continuity.
See [`adr/hotswap-continuity-classes-and-persistent-handoff.md`](./adr/hotswap-continuity-classes-and-persistent-handoff.md).

Do not treat continuity class as another policy level.

## What the caller is responsible for

The caller (engine host / driver) must:

- Construct the **next** engine and associate it with the slot before
  calling `initSwapStateRT(ticket)`.
- Call `stepSwapStateRT` exactly once per audio block, passing:

  - `blockFrames`: number of frames in the current block
  - `activeKind`: kind of the current engine
  - `nextKind`: kind of the staged next engine, or a sentinel
  - `noneKindSentinel`: sentinel value representing "no engine"

- Interpret `SwapStepDecisionRT.kind` as follows:

  - `runCurrentOnly`  
    Run the current engine for output. Do not run the next engine.

  - `runCurrentAndPrewarmNext`  
    Run the current engine for output. Run the next engine in
    prewarm mode and discard its output.

  - `runBothForCrossfade`  
    Run both engines, then mix their outputs according to a
    crossfade curve derived from `fadeFramesRemaining` and the
    ticket's `fadeFrames`.

  - `retireNow`  
    After this block, swap engine handles (next → current), and
    arrange for the retiring engine to be destroyed on a non-RT
    thread after a suitable memory barrier.

- Enforce RT preconditions:

  - `ticketId != 0`
  - `fadeFrames >= 1`
  - `preWarmBlocks >= 0`

  The TS implementation checks these in debug builds; native
  implementations should assert or reject invalid tickets.

- Implement memory ordering:

  On native targets, ensure that all writes performed by the
  retiring engine are visible before it is destroyed or returned
  to a pool (for example with
  `std::atomic_thread_fence(std::memory_order_release)` before
  signalling a reclamation thread).

The protocol deliberately does **not** define:

- The shape of the crossfade curve (linear, equal-power, etc.).
- How `atFrame` is aligned with transport / tempo.
- How engines are constructed or pooled.
- How tickets are delivered to the audio thread (command ring,
  lock-free transport, etc.).

These are left to the surrounding host (Dekzer, native engine, etc).

## Multi-swap behavior (Level 2): reject-while-busy policy

For scenarios where multiple swap requests occur with the currently
implemented policy:

- If a swap is **idle**: accept the new swap request.
- If a swap is **active** (any phase except idle): **reject** the new request.

This reject-while-busy policy is proven correct in
`formal/policies/reject-busy/tla/HotSwapRejectBusy.tla`.

Experimental / future policies (Level 3+) are intentionally out of scope for Levels 1–2; see [exploratory/hotswap-advanced-multi-swap.md](./exploratory/hotswap-advanced-multi-swap.md).

## Formal verification

All properties are formally verified using TLA⁺ model checking:

- **Base protocol** (single swap): `formal/policies/single/tla/HotSwapSingle.tla`

  - Millions of states explored.
  - Proves: `AtMostTwoEngines`, `NoGapDuringCrossfade`,
    `EventuallyIdle`, etc.

- **Multi-swap** (reject-while-busy): `formal/policies/reject-busy/tla/HotSwapRejectBusy.tla`
  - Tens of thousands of states explored.
  - Proves: sequential swaps work, overlapping requests are safely
    rejected under the policy above.

See `formal/README.md` for how to run the model checker.
