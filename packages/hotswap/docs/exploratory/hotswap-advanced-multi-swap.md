# Lane Hot-Swap Advanced Multi-Swap (Level 3+ — Exploratory)

**Status:** Exploratory  
**Not binding**  
**Not scheduled**

---

## READ THIS FIRST

This document is a **parking lot for future fancy behavior** on top of a single **lane**. Nothing here is:

- Required for v0.3.x
- Scheduled for implementation
- A constraint on current work

**Purpose:** Prevent Level 2 from accidentally smuggling Level 3+ complexity through the side door.

**When this becomes "law":** After Level 2 is shipped, stable, and battle-tested in production.

> Host concepts like a "deck" are free to treat one lane as "the deck's audio lane", but Seqlok itself only knows
> about **lanes** and engines.

---

## 1. Purpose

Level 3 explores **expressive**, higher-order swap behavior on a single **lane**:

- **Queued swaps** with automatic follow-up fades
- **Retarget / coalesce** semantics for "change my mind mid-fade"
- **Richer perceptual constraints** (how it _feels_ to a DJ/ghost planner sitting on top of the lane)
- **Extended invariants** for formal models (beyond "1 ticket, 2 engines")

This is explicitly **not** a commitment for v0.3.x. It's a catalog of behaviors we deliberately exclude from Level 2.

### Relationship to lower levels

```text
Level 1: One swap is always sane
         ↓
Level 2: Many swaps in a row are sane (sequential + reject-while-busy)
         ↓
Level 3+: Fancy swap patterns (queue, retarget) without melting the audio thread
```

**Scope:** Single lane.
**Out of scope here:** Multi-lane / "deck group" coordination (reserved for a future Level 4).

---

## 2. Goals and Non-Goals

### 2.1 Goals

- Allow a controller to express **intent streams**, not just single tickets:

  - "Go A→B now, then B→C when that's done"
  - "Fade towards C instead of B; I changed my mind mid-fade"

- Maintain clear, testable invariants:

  - Bounded number of active engines per lane
  - No audio discontinuities on queue / retarget
  - No unbounded queue growth or "forgotten" tickets

- Keep the **RT surface simple**: the lane's `stepBlock` still just runs the current plan (active ticket + optional
  queued ticket), with no new RT-visible policy knobs.

### 2.2 Non-Goals (for Level 3)

- ❌ Cross-lane / cross-deck coordination (lane groups, bus-wide fades) → Level 4 territory
- ❌ "Infinite" ticket streams or complex scheduling languages → overkill
- ❌ Psychoacoustic optimality guarantees → research problem, not engineering spec
- ❌ Automatic "smart" behavior without explicit policy selection → too magical

**Keep Level 3 about:** explicit, opt-in, composable **lane swap policies** with clear contracts, implemented at the
host / scheduler layer on top of the Level 2 lane core.

---

## 3. Feature Axis A: Queued Swaps

At Level 2, overlapping policy is **Reject While Busy** (one active ticket per lane; host sees `"lane-busy"` from
`scheduleSwap`).

Level 3 explores **Queue Until Idle** as an optional lane policy built on top of the same core protocol.

### 3.1 Queue semantics (L3-Q1)

**Basic contract (per lane):**

Each lane may hold:

- At most **one active ticket** (currently executing)
- At most **one queued ticket** (waiting for the active ticket to complete)

**New ticket arrival while busy:**

Policy choice (to be decided if/when implementing):

- **Option A (Overwrite):** New ticket replaces the queued ticket (latest-wins)
- **Option B (Reject if queued):** New ticket is rejected if the queue slot is already occupied

**Key invariants (strict 2-engine mode):**

- Queued ticket must **not** affect:

  - The current `phase` of the active ticket
  - Active engine gains (no crossfade interference)
  - Active ticket's completion (no early termination)

- When the active ticket returns to `idle`:

  - Queued ticket is installed at a well-defined frame boundary
  - Starts a fresh `prewarm → crossfade → retire → idle` cycle
  - There exists at least one **idle plateau** for the active ticket's target before the queued ticket starts

### 3.2 Prewarm policy for queued tickets (L3-Q2)

Two modes to consider:

#### Mode 1: Strict 2-engine (v0.3.x-compatible baseline)

- Queued ticket **does not** prewarm early
- At most 2 engines active per lane, always
- Queued ticket begins prewarm only after the active ticket retires

**Pros:**

- ✅ Preserves Level 1 / 2 "max 2 engines per lane" invariant
- ✅ No RT budget surprises
- ✅ Simpler TLA+ model

**Cons:**

- ❌ Second fade might have perceptible "cold start" latency

---

#### Mode 2: 3-engine prewarm (experimental, Level 3+)

- Queued ticket **may** begin prewarm during tail of active crossfade
- Invariant becomes "at most 3 engines per lane"
- Only allowed during specific phase windows (e.g. late crossfade + early idle)

**Example timeline (single lane):**

```text
Active: A→B crossfade (frames 0–128)
Queued: B→C ticket waiting

Frame  64: Active crossfade is 50% complete
        → Queued ticket's C engine begins prewarm
        → Now running: A (fading out), B (fading in), C (prewarming)

Frame 128: Active swap completes, A retires
        → Now running: B (active), C (prewarming)

Frame 129: Queued ticket installs, begins its crossfade
        → Now running: B (fading out), C (fading in)
```

**Pros:**

- ✅ Smoother back-to-back transitions
- ✅ No perceptible "cold start" on the second fade

**Cons:**

- ❌ Violates the strict "max 2 engines" invariant
- ❌ Requires tighter RT budgeting (3 engines rendering)
- ❌ More complex TLA+ model (3-way state space)
- ❌ Potential for pathological cases (queue thrashing)

**Status:** If ever implemented, 3-engine prewarm should be **experimental** and guarded by explicit policy/flags until
RT budget is proven viable.

### 3.3 Open questions for queued swaps

- **Queue depth:** Always max 1 queued ticket per lane? Or allow deeper queues (2–3)?

  - Deeper queues → more complex state, harder to reason about
  - Recommendation: start with **max 1** queued ticket per lane and revisit only if a real use case emerges

- **Queue visibility:** Can controllers query "is there a queued ticket on this lane"?

  - Useful for UI feedback ("next fade pending")
  - Adds observability surface area in Seqlok / introspect

- **Queue cancellation:** Can you cancel a queued ticket explicitly?

  - Or only via replacement / overwrite policy?
  - Needs to be reflected in logs and outcome events if added.

---

## 4. Feature Axis B: Retarget / Coalesce

Level 3 also explores **"change of mind" mid-fade** behavior on a single lane.

**Scenario:**

1. A→B fade is in progress (crossfade phase)
2. Controller issues ticket to C **before** A→B finishes

**Question:** What should happen on that lane?

### 4.1 Retarget-to-latest (L3-R1)

**Behavior:**

- Treat the current fade as a path towards "latest requested engine"
- Conceptually morph A→B into A→C (or B→C, depending on chosen semantics)

**Constraints:**

- Gains must change **continuously** (no jumps)
- Audio must never "snap back" to an older engine
- Total energy must remain bounded (no gain > 1.0 + ε per engine)

**Implementation sketch:**

Becomes a piecewise-defined fade:

```text
Frames 0–64:   Standard A→B segment (before retarget request)
Frames 64–128: Bend towards C with smooth curve
               - A continues fading out (or holds)
               - B adjusts trajectory (fade out or stabilize)
               - C fades in to reach 1.0 by frame 128
```

**Perceptual challenge:**

- How to define "smooth curve" mathematically?
- Equal-power? S-curve? Custom spline?
- What happens if B barely started fading in (retarget after 1 frame)?

**Status:** Requires research + user testing. Not for v0.3.x.

---

### 4.2 Cancel-and-restart (L3-R2)

**Simpler alternative:**

When a new ticket arrives during A→B on a lane:

1. Optionally **shorten / abort** A→B at the next block boundary
2. Start a fresh A→C fade from the _current_ audio state

- "Current state" = whatever the gain coefficients were at the abort point

**Pros:**

- ✅ Much simpler to specify and test
- ✅ Clear "early retire" semantics (controller-visible)
- ✅ No complex curve math

**Cons:**

- ❌ May produce slightly non-uniform perceived loudness
- ❌ "Wasted" partial fade (A→B never completes)
- ❌ Perceptible discontinuity if abort timing is unlucky

**Open question:**

- Should abort happen **immediately** (next block) or at a **next safe point** (e.g. end of current crossfade segment)?

---

### 4.3 Comparison: R1 vs R2

| Aspect              | Retarget-to-latest (R1) | Cancel-and-restart (R2) |
| ------------------- | ----------------------- | ----------------------- |
| Complexity          | High (curve math)       | Low (abort + restart)   |
| Smoothness          | Theoretically better    | May have discontinuity  |
| Testability         | Hard (define "smooth")  | Easy (abort = retire)   |
| Perceptual quality  | Unknown (needs testing) | "Good enough" likely    |
| Implementation risk | High                    | Low                     |

**Recommendation for initial Level 3 exploration:** Start with **R2 (cancel-and-restart)** as baseline, prove it works,
then consider R1 if user feedback actually demands it.

---

### 4.4 Integration with queued swaps

**What if both features are enabled on a lane?**

Scenario: A→B active, C queued, D arrives mid-fade

Policy matrix (per lane):

| Retarget mode | Queue mode | Behavior                            |
| ------------- | ---------- | ----------------------------------- |
| None          | None       | Reject D (Level 2 baseline)         |
| R2 (cancel)   | None       | Abort A→B, start A→D, discard B     |
| None          | Queue      | Reject D (queue full with C)        |
| R2 (cancel)   | Queue      | Abort A→B, start A→D, queue stays C |
| R1 (retarget) | Queue      | Retarget A→B→D, queue stays C       |

**Conclusion:** These features **compose**, but the composition matrix is large. Level 3 should pick **one canonical
combo** (e.g. "R2 + Queue mode A") and test that thoroughly before supporting the full matrix.

---

## 5. Perceptual & UX Constraints

Level 3 starts to talk about **"how it feels"** rather than just "is it mathematically valid", as seen by a DJ or Ghost
controller _using_ a lane.

### 5.1 Minimum fade durations

**Problem:** Rapid retargeting can produce "machine-gun" stuttering.

**Constraint ideas:**

- Minimum `fadeFrames` for retargeted fades (e.g. at 48 kHz, 32 frames ≈ 0.67 ms)
- Exponential backoff on retarget rate (first retarget = instant, subsequent retargets delayed)

**Status:** Design intent only; no concrete values proposed yet.

### 5.2 Maximum retarget rate

**Problem:** Controller spam could thrash a lane's swap system.

**Constraint ideas:**

- Max N retargets per second per lane (e.g. 4–10 Hz for human controllers, maybe more for offline Ghost runs)
- Reject / queue retargets that arrive "too fast"

**Implementation note:** This is likely enforced at the `scheduleSwap` / host policy layer, not in RT code.

### 5.3 Debouncing / hysteresis

**Problem:** Noisy controller input (e.g. LLM changing its mind every 100 ms) creates poor UX.

**Possible solutions:**

- **Option A:** Build debouncing into `scheduleSwap`

  - Con: policy decisions belong in controllers / host runtime, not in the lane core

- **Option B:** Provide debounce helpers in an SDK / host library

  - Pro: keeps Seqlok runtime simple; gives controllers explicit control

**Recommendation:** Option B (SDK helper), not a baked-in runtime feature.

### 5.4 Curve families

For retarget / crossfade quality, consider offering a **curve plugin system** at the host or engine-bank level:

- Equal-power (default)
- Linear (for testing)
- S-curve (smooth perceptual fade)
- Custom (user-provided function)

**Status:** Out of scope for Level 3 _lane_ spec; mention as a future extension point for hosts / decks.

---

## 6. Extended Invariants & Modeling

Level 3 extends the invariants from Level 2 at the **lane** level.

### L3-I1: Bounded engines per lane

**Strict mode (v0.3.x-compatible):**

- At most **2 engines** active per lane at any time
- Active ticket's `currentEngineKind` + `nextEngineKind` only

**Experimental 3-engine mode:**

- At most **3 engines** active per lane at any time
- Active current + active next + queued prewarm engine

**TLA+ requirement:** Model must prove this bound under all Level 3 transitions.

---

### L3-I2: No ghost engines

**Invariant:**

Every audible engine at any time on a lane must be:

- The **current engine** of the active ticket, OR
- The **next engine** of the active ticket in a documented phase (`prewarm` / `crossfade`), OR
- The **prewarm engine** of a queued ticket (only in 3-engine mode, only during allowed windows)

**Anti-pattern:**

An engine C must never appear in decisions / audio if:

- No active or queued ticket references C as current or next, AND
- C is not explicitly in a prewarm window

**Test strategy:** Audit all `RecordedAudioBlock` entries; assert every non-zero gain corresponds to a known ticket's
engine.

---

### L3-I3: Retarget safety

**Gain bounds (test harness):**

For **strict 2-engine mode**:

- Per-engine gain ≤ 1.0 + ε
- Total gain across engines ≤ 2.0 + ε

For **experimental 3-engine prewarm mode**:

- Per-engine gain ≤ 1.0 + ε
- Total gain across engines stays within a documented bound
  (e.g. ≤ 2 + 0.5 + ε; exact value to be chosen when 3-engine mode is designed)

These are **test harness bounds** for constant engines (A=1, B=2, C=3), not psychoacoustic guarantees. For real music,
these bounds would likely be expressed in terms of RMS or LUFS, but the constant-engine harness uses simple amplitude
bounds for mathematical verifiability.

**Rationale:**

- Per-engine bound: prevents individual engine from "exploding"
- Total bound: prevents energy buildup during multi-way crossfades

---

### L3-I4: Queue stability

**Invariant (per lane):**

If a ticket is queued at frame F:

- It must eventually either:

  - Be installed (after the active ticket retires), OR
  - Be explicitly replaced / cancelled (via policy), OR
  - Expire (if expiry is implemented)

**Anti-pattern:**

A queued ticket must never:

- Be "forgotten" (stays queued forever while active ticket loops)
- Be installed while the active ticket is still non-idle
- Appear in audio / decisions before it's installed

---

### 6.5 TLA+ modeling scope

For Level 3, the formal model must cover:

- ✅ Queued ticket as explicit state (not just "pending command")
- ✅ Retarget / cancel transitions (R2 at minimum)
- ✅ L3-I1 through L3-I4 as safety properties
- ✅ Liveness: "every accepted ticket eventually completes or is explicitly cancelled"

Still out of scope:

- ❌ Cross-lane / cross-deck interactions → Level 4
- ❌ Full retarget curve math (R1) → research problem
- ❌ Perceptual quality metrics → not formally verifiable

**Status:** TLA+ updates for Level 3 are blocked until the Level 2 lane model is proven correct and stable.

---

## 7. Migration / Feature Flags

Level 3 behavior should be **opt-in**, not silently enabled.

### 7.1 Swap policy as explicit configuration (per lane or host runtime)

Each lane (or host-level "deck" built on a lane) has a **swap policy** setting, interpreted by the host-side scheduler
that wraps `scheduleSwap`:

```ts
type SwapPolicy =
  | "reject-busy" // Level 2 baseline
  | "queue-until-idle" // Level 3, Queue mode
  | "retarget-latest" // Level 3, Retarget mode (R1)
  | "cancel-and-restart"; // Level 3, Retarget mode (R2)

interface LaneSwapConfig {
  readonly swapPolicy: SwapPolicy;
  // ... other config (min fade, rate limits, etc.)
}
```

**Implementation status:**

- Only `"reject-while-busy"` is expected to ship in v0.3.x.
- The other policies are **names reserved for future work**, so we don't have to bikeshed strings later.
- Actual policy implementation likely lives in a host-side scheduler that:

  - Consumes lane state / introspection (e.g. `isLaneBusy`, queued ticket), and
  - Calls `scheduleSwap` + interprets `SwapResult`.

**Configuration surface (when implemented):**

- Lane creation: `createLaneRuntime({ swapPolicy: "queue-until-idle", ... })`
- Host-level deck wrapper: `createDeck({ swapPolicy: "cancel-and-restart", ... })`
- Possibly env default: `SEQLOK_SWAP_POLICY` for system-wide default

Exact API is TBD when features land.

### 7.2 Policy discovery

Controllers and Ghost DJ should be able to:

- **Query** effective policy for a lane (or deck built on that lane)
- **Request** a policy at construction (subject to runtime support)
- **Fallback** gracefully if the requested policy is unsupported

### 7.3 Compatibility guarantee

Existing callers that assume "reject while busy" **must not** see behavior change unless they:

- Explicitly opt into a Level 3 policy, OR
- Deploy to a runtime that defaults to a Level 3 policy with a clear migration notice

Recommendation: default stays `"reject-while-busy"` until Level 3 behavior is battle-tested.

---

## 8. Open Questions (Level 3)

These are deliberately **unanswered** in this exploratory doc:

### Q1: Queue depth

- How many queued tickets per lane long-term?
- Current thinking: max 1 (single queue slot)
- Revisit if real use cases emerge for deeper chains (A→B→C→D sequences)

### Q2: Ticket language

- Do we want a small **declarative ticket language** instead of the imperative API?

  - Example: `lane.scheduleChain(["A→B", "B→C", "C→A"])`

- Or stay with ad-hoc `scheduleSwap` calls?

- Trade-off: expressiveness vs complexity and debuggability.

### Q3: Curve plugin system

- How much of retarget semantics is hard-coded vs "curve plugin" territory?
- Should hosts provide custom crossfade curves?
- Or is a built-in set (linear, equal-power, S-curve) sufficient?

### Q4: Cross-lane / cross-deck awareness

- Should Level 3 know about other lanes (e.g. for bus-wide fades / deck pairs)?
- Or is that explicitly Level 4 (lane / deck groups)?
- Current stance: **Level 3 = single-lane only**. Multi-lane / deck groups are Level 4.

### Q5: Real-world validation

- What DJ / Ghost DJ patterns actually need Level 3 features?
- Are we solving real problems or just building "cool tech"?
- Recommendation: user research + logs from real sessions before committing to implementation.

---

## 9. Relationship to Level 2

**Clear boundary (per lane):**

| Aspect                  | Level 2                | Level 3                              |
| ----------------------- | ---------------------- | ------------------------------------ |
| Active tickets per lane | Exactly 1              | 1 active + 0–1 queued                |
| Overlapping behavior    | Reject (RWB)           | Queue or Retarget (policy-dependent) |
| Max engines per lane    | 2                      | 2–3 (mode-dependent)                 |
| Complexity              | "Is it correct?"       | "How fancy before brain melts?"      |
| Spec / implementation   | **Shipping in v0.3.x** | **Exploratory only**                 |

**Why this boundary matters:**

- Level 2 is the **sanity layer**: it proves multi-swap isn't fundamentally broken.
- Level 3 is the **UX / expressiveness layer**: it makes multi-swap feel powerful and forgiving for humans + Ghost.

You can't do Level 3 safely until Level 2 lanes are rock-solid in production.

---

## 10. Next Steps (When Level 2 is Done)

0. **Re-validate:** Confirm Level 2 lanes are stable in production (logs, incidents, perf metrics).
1. **User research:** What swap patterns do real controllers / Ghost DJ actually need?
2. **Pick one feature axis:** Queue **or** Retarget, not both initially.
3. **Prototype:** Implement chosen feature as an experimental host-side policy on top of Level 2.
4. **Benchmark:** Prove RT budget works (especially for any 3-engine mode).
5. **Test:** Extend the engine-bank harness to cover Level 3 scenarios and invariants.
6. **Model:** Update TLA+ spec to prove L3-I1 through L3-I4.
7. **Document:** Convert the relevant slices of this exploratory doc into a proper ADR once a feature lands.

**Do NOT:**

- ❌ Start implementing Level 3 behavior before Level 2 ships and stabilizes.
- ❌ Mix Level 3 complexity into Level 2 PRs.
- ❌ Promise Level 3 features to users / hosts without clear caveats.

---

## 11. Summary

**Level 3 is fancy, not fundamental.**

It's parked here so we can:

- Reference it when someone asks "but what about retargeting / queues?"
- Keep it out of Level 2 scope discussions
- Have a starting point when we're actually ready to build it

Litmus test for scope:

> "Does a controller using only sequential swaps (A→B, wait, B→C) need this?"

- If **yes** → that belongs in Level 1 / 2.
- If **no** → that belongs in Level 3 (or higher).

That keeps Level 2 focused on **multi-swap sanity on a lane**, and Level 3 focused on **multi-swap fancy**—without
letting "deck" leak into Seqlok's core surface.
