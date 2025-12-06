# Lane Hot-Swap Multi-Swap Requirements (Level 2.5)

**Status:** Accepted for v0.3.x (policy + implementation shipped)  
**Date:** 2025-12-04 (last updated: 2025-12-06)  
**Depends on:** Level 2 (single-swap correctness) — already passing

---

## Purpose

This document defines the requirements for **Level 2.5**: guaranteeing that multiple hot-swaps on a single lane behave
sanely and predictably.

Level 2 established that a **single** A→B swap is correct at both protocol and sample level.  
Level 2.5 extends this to:

- sequences of swaps (A→B→C), and
- overlapping swap *requests* (A→B while B→C is requested mid-fade).

**Core principle:** multiple swaps in a row must not turn the lane into a chaos goblin.

---

## 0. Prerequisites (Level 2 — Already Satisfied)

These must remain green before Level 2.5 can be considered complete. They are enforced by existing tests in:

- `lane.timeline.integration.test.ts`
- `lane.engine-bank.integration.test.ts` (single-swap cases)

**Important architectural note:**

Level 2.5 focuses on **lane + engine-bank semantics** where swaps are issued via `scheduleSwap` through a mailbox and
processed by the hotswap slot driver. This is distinct from the **pure timeline layer** which supports
cancel-by-replacement semantics for timeline commands in general.

The timeline layer (`processTimelineBlock`, `TimelineDriver`) can handle arbitrary command replacement patterns. Level
2.5 specifically addresses the **higher-level lane integration** where:

- Swaps are scheduled through `scheduleSwap` (not raw timeline commands)
- The mailbox + hotswap slot driver mediate the behavior
- Engine bank interactions produce actual audio

See **Section 10, Q4** for alignment considerations between these layers.

**Required invariants (Level 2):**

- ✅ Single A→B swap executes all phases correctly:  
  `idle → prewarm → crossfade → retire → idle`
- ✅ Crossfade gain envelope is smooth and monotonic across the fade window  
  (for test engines A = 1.0 → B = 2.0, envelope averages increase smoothly).
- ✅ Prewarm phase does not leak next-engine audio to output
  - Output during `prewarm` is indistinguishable from "current-only A".
- ✅ Same-engine swap (A→A) produces stable output at 1.0
  - Crossfade A→A yields samples ≈ 1.0 for the entire fade.
- ✅ "Missing engine" produces **bounded** output (no explosions)
  - With next engine missing, crossfade output stays in `(0.0, 1.0)` for the test engines:
    it never exceeds the current engine's level and never goes negative.
- ✅ Very short `fadeFrames` completes cleanly within block budget
  - Crossfade completes in ≤ 2 blocks and transitions clearly from "mostly A" to "mostly B".
- ✅ Zero-length segments produce no audio samples
  - Protocol may emit segments of `frames = 0`; those must not cause any samples to be rendered.

These are the foundation Level 2.5 builds on. If any of these regress, Level 2.5 is automatically broken.

---

## 1. Sequential Swaps (Requirement 2.5-S1) ✅

**Status:** PASSING  
**Test (engine-bank harness, Level 2):**  
`lane engine bank integration: higher-order swaps → "supports sequential swaps A→B→C without regressing engines"`

**Test (timeline harness, Level 2.5 sanity):**  
Back-to-back swap coverage in `lane.timeline.integration.test.ts` (sequential cases).

### 1.1 Scenario

The scenario is defined in terms of the test harness:

1. Lane starts on engine **A** (constant output 1.0).
2. We schedule and complete a swap **A→B**:
  - Swap is installed at `atFrame = 0`.
  - We call `runUntilSwapComplete(blockFrames, maxBlocks)` until the harness observes
    a full cycle back to `phase === "idle"`.
3. We then schedule and complete a swap **B→C**:
  - Second ticket is scheduled at `atFrame = timeline.frame` (i.e. after the first swap is fully settled).
  - Again, we run until the system returns to `phase === "idle"`.

The engines used in the test harness are:

```ts
EngineKind.A = 1.0;
EngineKind.B = 2.0;
EngineKind.C = 3.0;
````

These constant values are **test-only fixtures** used to make the crossfade math
directly observable; production engines are free to output arbitrary audio.

### 1.2 Required guarantees

The system **MUST** guarantee the following for this sequential pattern:

#### 2.5-S1.1 First swap completion (A→B)

After A→B completes (first `runUntilSwapComplete` returns):

* At least one `idle` block exists where:

  * `decision.status.activeEngineKind === EngineKind.B`
  * Audio samples are approximately 2.0 for the constant-engine harness:

    * Mean of that block is close to 2.0 within a small numerical tolerance.

#### 2.5-S1.2 Second swap completion (B→C)

After B→C completes (second `runUntilSwapComplete` returns):

* At least one `idle` block exists where:

  * `decision.status.activeEngineKind === EngineKind.C`
  * Audio samples are ≈ 3.0 (same tolerance story as above).

#### 2.5-S1.3 Monotonic engine progression at idle

Once any `idle` block with `activeEngineKind === EngineKind.B` has appeared:

* **No later `idle` block** may have `activeEngineKind === EngineKind.A`.

In other words, for settled idle phases, engine identity is monotone A → B → C across this sequence.
You never "fall back" to A after the lane has idled on B.

### 1.3 Implementation notes

* The **sequential** requirement assumes that the second ticket is scheduled **at or after** the frame where the first
  swap has fully completed (i.e. after `runUntilSwapComplete`).
* The test harness treats the lane as a single logical engine pipeline:

  * It asserts on engine identity via `decision.status.activeEngineKind`.
  * It cross-checks identity against audio via constant engines (1/2/3).
* Other sequences (e.g. A→B→D→E) should satisfy the same "no regression of idle engine" pattern, but Level 2.5 enforces
  the A→B→C case specifically as a concrete witness.

---

## 2. Overlapping Swaps (Requirement 2.5-O1) ✅

**Status:** PASSING (Reject While Busy policy implemented)

**Runtime policy:** **Reject While Busy** at the host + lane level.

**Key tests:**

* `packages/hotswap/tests/hotswap.schedule-swap.test.ts`

  * `"rejects when the lane reports busy and does not enqueue"`
    (covers `isLaneBusy` + `SwapResult` contract)
* `packages/integration/tests/lane.timeline.integration.test.ts`

  * `"ignores overlapping replacement while swap is busy (reject-while-busy)"`
  * `"handles rapid successive swaps (stress test at DJ tempo)"`
  * `"overlapping replacement during crossfade keeps original swap and completes cleanly"`

### 2.1 Problem statement

What happens when:

1. Swap A→B is scheduled and enters `prewarm` or `crossfade`.
2. Before A→B completes (i.e. before the lane returns to `idle`), a **second ticket** B→C is scheduled on the **same
   lane**.

This is a real controller pattern: live UI or Ghost DJ logic may issue a new swap while the previous one is still in
flight. The runtime must have a clear, documented policy for this case.

For Level 2.5, we explicitly assume **at most one active ticket per lane** at any time.
Overlapping behavior is defined in terms of *requests* arriving while that single ticket
is in progress.

### 2.2 Chosen policy for v0.3.x: Reject While Busy

#### Behavior

* While `decision.status.phase !== "idle"`, the lane is considered **swap-busy**.
* New swap tickets are rejected at the **host scheduling layer**:

  * `scheduleSwap` consults an optional `isLaneBusy()` hook on the config.
  * If it returns `true`, the function returns a `SwapResult` with
    `accepted: false` and `reason: "lane-busy"`.
  * The ticket is **not** enqueued into the mailbox.
* On the RT side, if an overlapping `installSwap` command somehow appears
  (e.g. from a non-conforming sender), the `HotswapSlotDriver` is required
  to ignore it while a ticket is active and keep the current protocol on track.

#### Invariants (for test engines A/B/C)

During an in-flight A→B swap:

* No block may have `activeEngineKind === EngineKind.C`.
* No block may have `nextEngineKind === EngineKind.C`.
* Final idle state must be indistinguishable from a single A→B scenario:

  * idle engine = B,
  * idle audio ≈ 2.0.

The overlapping integration test in `lane.timeline.integration.test.ts` asserts that:

* A replacement ticket scheduled while the slot is mid-swap does *not* change
  the eventual outcome of the current swap.
* The system eventually returns to `phase: "idle"` with the original ticket’s
  target engine active.

#### Tradeoffs

* ✅ Simple to implement and reason about.
* ✅ Makes it clear to callers that they need to respect a "busy" window.
* ✅ Avoids 3-engine states at the protocol level; the TLA invariant "at most 2 engines" still holds.
* ❌ Controllers must handle "swap rejected while busy" and retry later.

### 2.3 Non-chosen policies (documented but not implemented)

For completeness, two alternative policies remain *design space only* (see Level 3 ADR):

* **Queue Until Idle**

  * Accept second ticket, queue, and install after current swap completes.
  * Implies a queued-ticket state and more complicated reasoning.
* **Retarget / Coalesce**

  * Morph in-flight swap into a different target (e.g. A→B becomes A→C).
  * Requires multi-target crossfade semantics and careful perceptual design.

These are explicitly **out of scope** for Level 2.5. They are reserved for a future
"Level 3: expressive multi-target fades" milestone.

---

## 3. Test Harness Stability (Requirement 2.5-H)

### 2.5-H1: Canonical harness API ✅

**Status:** SATISFIED (but must remain stable)

`createLaneEngineHarness()` is the canonical integration harness for:

> mailbox → timeline → hotswap slot → engine bank → audio

For Level 2.5 it is now a **spec surface**, not just a test helper.

**Required capabilities:**

* Supports at least `EngineKind.A`, `EngineKind.B`, `EngineKind.C` with constant outputs:

  * A = 1.0, B = 2.0, C = 3.0.
* Exposes:

  * `recordedAudio: RecordedAudioBlock[]`
    (per segment: samples + `SwapStepDecisionRT`).
  * `timeline.frame: number`
    for scheduling subsequent swaps.
* Provides:

  * `runUntilSwapComplete(blockFrames, maxBlocks)` that:

    * drives the timeline in block-sized steps, and
    * returns after the system has gone through a non-idle phase and back to `idle` again,
    * or exhausts `maxBlocks`.

**Commitment:**
Future refactors must either preserve this harness API or update Level 2 / 2.5 docs and tests together. Randomly
breaking the harness is equivalent to breaking the spec.

---

### 2.5-H2: No zombie tickets / no engine regression ✅

**Status:** SATISFIED for the current A→B / A→B→C / overlapping tests.

**Requirement:**

Across any finite sequence of swaps on a single lane:

* Every swap ticket must either:

  * run to completion (`prewarm → crossfade → retire → idle`), or
  * be cleanly rejected/ignored by the overlapping policy.
* The final `idle` engine and audio must correspond to **the last successfully installed ticket**.
* There must be no "zombie" engine state: an engine that appears in decisions or audio
  despite not being the current or next engine of any active ticket.

**Enforcement today:**

* Single A→B tests verify "no zombie A after B".
* Sequential A→B→C tests verify:

  * there is an idle plateau with B,
  * then an idle plateau with C,
  * and no idle blocks regress to A after B has been observed.
* Overlapping tests verify:

  * a rejected overlapping ticket never leaks into decisions or audio,
  * the original swap still completes cleanly,
  * final idle state reflects the original accepted ticket.

---

## 4. Documentation Coupling (Requirement 2.5-D1)

**Status:** PARTIAL

### 2.5-D1.1 `HOTSWAP_INTEGRATION.md` updates

`HOTSWAP_INTEGRATION.md` includes a **Multi-Swap Behavior** section that:

* Describes sequential swaps A→B→C and links them to the integration tests.
* States the overlapping policy as **Reject While Busy**.
* Points to this ADR (`hotswap-multi-swap-requirements.md`) as the normative
  requirements and test matrix.

If `HOTSWAP_INTEGRATION.md` changes its coverage or terminology, this ADR must
be updated in lock-step.

### 2.5-D1.2 Requirements doc linkage

From `HOTSWAP_INTEGRATION.md`, the canonical link is:

```md
For detailed multi-swap requirements and test specifications, see
[HOTSWAP_MULTI_SWAP_REQUIREMENTS.md](adr/hotswap-multi-swap-requirements.md).
```

(Exact relative path may differ depending on docs layout; the link must resolve.)

---

## 5. Error Handling & Observability (Requirement 2.5-E)

### 2.5-E1: Swap rejection feedback ✅

**Status:** IMPLEMENTED via `scheduleSwap` + `SwapResult`.

`scheduleSwap` returns a structured result instead of forcing callers to rely
only on exceptions:

```ts
interface SwapResult {
  readonly accepted: boolean;
  readonly reason?:
    | "lane-busy"
    | "invalid-ticket"
    | "out-of-range"
    | "internal-error";
  readonly ticketId?: number;
}
```

**Behavior:**

* For overlapping swaps (Reject While Busy):

  ```ts
  const result = scheduleSwap(config, ticket);
  // → { accepted: false, reason: "lane-busy", ticketId: <id> }
  ```

* For invalid tickets (protocol preconditions violated):

  ```ts
  const result = scheduleSwap(config, badTicket);
  // → { accepted: false, reason: "invalid-ticket", ticketId: <id> }
  ```

* For out-of-range or configuration issues, `reason` moves to `"out-of-range"`
  or `"internal-error"` as appropriate.

**Design constraint:**

Callers can distinguish "rejected because busy" from "rejected because invalid
ticket" **without** parsing error messages or relying on exceptions.

Transport failures (mailbox closed / overflow) are still surfaced as typed
`commands.*` errors, not encoded in `SwapResult`.

### 2.5-E2: Diagnostic hooks ⏳ (nice-to-have)

For debugging and monitoring multi-swap scenarios, each lane should expose
a minimal status surface:

* Current phase (`idle | prewarm | crossfade | retire`)
* Active ticket ID (if any)
* Monotonically increasing "rejected swaps" counter

These can be implemented via lane-level introspection, but are not strictly
required to call Level 2.5 "done" for v0.3.x.

---

## 6. Performance Constraints (Requirement 2.5-P)

**Status:** Intent documented; dedicated micro-benchmarks still TODO.

### 2.5-P1: Sequential swap overhead

Running N sequential swaps (A→B→C→D...) must not:

* Accumulate memory leaks (ticket state must be cleaned up)
* Degrade block processing time
* Leave dangling timers or callbacks

**Future validation:**
A 10× sequential swap micro-benchmark should show final block processing time ≈ first block time (within measurement
noise).

### 2.5-P2: Overlapping rejection is O(1)

Rejecting an overlapping swap must:

* Happen **off the audio thread** (in `scheduleSwap` or installer layer)
* Be O(1) in both time and allocations
* Never block RT processing

**Implication:**
Rejection logic runs before the mailbox enqueue, not during `stepBlock`.

---

## 7. Compatibility (Requirement 2.5-C)

### 2.5-C1: Level 2 contracts remain unchanged

All Level 2 single-swap contracts remain valid:

* Existing code that schedules one swap at a time sees **no behavior change**.
* No new failure modes for single-swap usage patterns.
* Performance characteristics unchanged for one-swap-per-lane scenarios.

### 2.5-C2: Opt-in complexity

Multi-swap behavior is **only** observable if:

* User explicitly schedules a second swap before the first completes (sequential or overlapping), or
* User consumes the new `SwapResult` diagnostics.

**Migration story:**
"If you never overlapped swaps before, you're safe."

---

## 8. Formal Verification Coverage (Requirement 2.5-V)

**Status:** Scope defined; TLA+ model updates still TODO.

### In scope for v0.3.x model:

The existing TLA+ specification must be extended to prove:

* **"At most 2 engines active per lane"** still holds under multi-swap scenarios.
* Sequential A→B→C never regresses to A at idle.
* Overlapping A→B + B→C under "Reject While Busy" never exposes C in any decision.

### Out of scope (deferred to Level 3):

* Queue semantics (`queue-until-idle`).
* Retarget/coalesce policies.
* Cross-lane interactions (multi-lane coordination).

**Verification commitment:**
The model must prove the existing 2-engine invariant under Level 2.5 rules; anything beyond that is explicitly deferred.

---

## 9. Adoption Checklist (Requirement 2.5-A)

If you're already using hotswap in production:

### Before Level 2.5:

* [ ] **Audit call sites:** Do you ever call `scheduleSwap` twice on the same lane without waiting for idle?
* [ ] **Add telemetry:** Log when swaps are scheduled (timestamp, lane ID, ticket ID) to detect accidental overlaps.
* [ ] **Review usage patterns:** Do you need sequential swaps (A→B→C) or only single swaps?

### After Level 2.5 (Reject While Busy policy live):

* [ ] **Handle rejection status:** Check `result.accepted` and handle `reason: "lane-busy"` in UI/controller logic.
* [ ] **Add monitoring:** Track swap rejection rate per lane as a health metric
  - High rejection rate → controller bug or UI spam.
* [ ] **Update documentation:** Note that overlapping swaps are rejected at the host scheduling layer until the lane
  returns to idle.

---

## 10. Open Design Questions (as of 2025-12-06)

### Q1: Per-lane or global rejection?

**Decision:** Rejection is **per-lane**.

* Lane-0 can be busy while lane-1 still accepts swaps.
* No global lock; system can have multiple concurrent swaps (one per lane).

### Q2: Prewarm during queue?

**Decision:** Out of scope for Level 2.5.
Prewarm of queued tickets is a Level 3 concern as it risks violating the 2-engine invariant.

### Q3: Ticket expiry?

**Decision:** Not needed for Level 2.5.
Tickets do not expire on their own; they are either installed, rejected, or overwritten by later host logic.

### Q4: Align lane-level overlapping policy with timeline cancel-by-replacement?

**Current stance:**

* Timeline layer keeps cancel-by-replacement as a low-level capability.
* Lane layer exposes a **more conservative** policy (Reject While Busy) to simplify controller programming.
* Future Level 3 work may expose richer policies (`queue-until-idle`, `retarget-*`) on top of the same core protocol.

---

## 11. Summary: What Must Be Done for Level 2.5

| Requirement                   | Status           | Notes                                  |
|-------------------------------|------------------|----------------------------------------|
| **2.5-S1** Sequential swaps   | ✅ PASS           | Engine-bank & timeline tests green     |
| **2.5-O1** Overlapping policy | ✅ PASS           | Reject-while-busy implemented & tested |
| **2.5-H1** Harness API        | ✅ PASS           | Must keep stable                       |
| **2.5-H2** No zombie tickets  | ✅ PASS (current) | Covered by sequential + overlap tests  |
| **2.5-D1** Docs               | 🟡 PARTIAL       | Integration doc linked; keep in sync   |
| **2.5-E1** SwapResult         | ✅ PASS           | Implemented in `scheduleSwap`          |
| **2.5-P** Performance         | 📝 Intent only   | Micro-benchmarks still TODO            |
| **2.5-V** Formal model        | 📝 In progress   | TLA update not yet merged              |

---

## Ultra-short summary

**Level 2 = "one swap is always sane."**
**Level 2.5 = "many swaps in a row are still sane, and overlapping ones are politely rejected."**

