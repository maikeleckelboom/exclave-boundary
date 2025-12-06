# Technique Discovery Agenda: Dekzer & Ghost DJ

|                  |            |
|------------------|------------|
| **Version**      | 0.2        |
| **Owner**        | Maikel     |
| **Last updated** | 2025-12-06 |

---

> **Framing**: This isn't just product development—it's discovering **reusable patterns** for real-time AI co-pilot
> systems. The goal is to extract techniques that can be written down, defended, and applied beyond DJ software.

**Internal thesis**:
> Before "deep tech money" or "TU Delft collab," you need things-that-actually-work-in-the-world you can point at and
> say: *"This isn't a slide, this is a technique. It solves a hard class of problems."*

---

## 1. Techniques You Already Have

These aren't just implementation details—they're **patterns** that generalize beyond DJ software.

### 1.1 Command Ring + Swap Discipline

**Pattern**: Single-writer/single-reader ring with explicit command schema. Everything goes through it. No spooky
mutation, no "UI talks directly to engine."

**What it solves**:

- Deterministic real-time control surface for any co-pilot system
- Human and AI actors use the same API with the same constraints
- Every action is logged, inspectable, replayable

**Generalization**: "Mixed-initiative control via SWSR ring"—applicable to robotics, GPU pipelines, physics sims, any
system where multiple actors (human + AI) need to coordinate under real-time constraints.

**Evidence**: Documented in Seqlok Primer (command lifecycle section); visualized in Command Ring Lab.

### 1.2 Spawn + Prime + PreWarm + CrossFade (Never Live Configure)

**Pattern**: You never mutate the active engine. You spawn a new instance, prime it (configure), pre-warm it (let it
stabilize), then crossfade. The old engine retires cleanly.

**What it solves**:

- "Hot reload for DSP with zero glitches"
- Configuration changes that would cause discontinuities become seamless transitions
- The active engine is always in a known-good state

**Generalization**: Applicable anywhere you have stateful processors that can't tolerate mid-stream reconfiguration—GPU
shader pipelines, physics simulations, video encoders, any "heavy" stateful component.

**Evidence**: Formalized in `@seqlok/hotswap` (SwapStateRT, stepSwapStateRT); visualized in HotSwap Lab.

### 1.3 Session Log as Spine

**Pattern**: Log `{frameIndex, command, meta}` as the source of truth. Everything else—state reconstruction, Ghost
training, explainability—derives from replaying that log.

**What it solves**:

- Explainable AI: every Ghost suggestion traces back to observable events
- Deterministic forensic replay: reproduce any session exactly
- Training data: sessions become supervised trajectories without special instrumentation

**Generalization**: "Event sourcing for real-time performance systems"—applicable to any domain where you need both
real-time execution and post-hoc analysis (game replay, flight recorders, trading systems).

**Evidence**: Formalized in Ghost DJ Data Model (CommandEvent, LoggedCommandEvent).

### 1.4 Reflex vs Reflection Split

**Pattern**: Hard real-time "reflex" loop (audio thread + Seqlok + engines) is strictly separated from "reflection"
loop (Ghost, vector DB, LLMs). No blocking calls, no DB, no networking, no GC-heavy work in the reflex path.

**What it solves**:

- Keeps audio glitch-free under load
- Makes timing guarantees analyzable (worst-case execution time)
- Gives a clean boundary for AI experiments: you can swap Ghost implementations without touching the reflex path

**Generalization**: "Reflex vs reflection" applies to any real-time co-pilot system where you have:

- A hard, low-latency control loop
- A soft, high-latency reasoning loop

(e.g., robotics, AR/VR, trading systems)

**Evidence**: Documented in Strategy doc (reflex vs reflection is sacred); Vector DB Guide ("Vector DB is pure
reflection layer. Never near audio callback.")

---

## 2. Frontier Areas: Where to Invent New Techniques

These are relatively unexplored territories where you can discover and codify new patterns.

### 2.1 Real-Time Co-Pilot Control Patterns — P0

**The gap**: Everyone talks about "AI assistant," but almost nobody has **hard rules** for:

- What an LLM/AI is allowed to do at audio callback rate under tight latency budgets
- How commands from human + AI interleave under sample-accurate constraints
- How to encode "authority modes" in a way you can prove safe

**Technique candidates**:

| Candidate Technique                   | Description                                                                                   | Validation Method                   |
|---------------------------------------|-----------------------------------------------------------------------------------------------|-------------------------------------|
| **Authority mode invariants**         | Formal rules: Ghost cannot emit commands that violate Takeover/Edit/Passive mode semantics    | TLA+ spec, runtime assertion        |
| **Budget-gated suggestion**           | AI suggestions computed async, presented only when within latency budget                      | Measure end-to-end latency in lab   |
| **Invariant-enforcing ring consumer** | Ring consumer validates all commands (human or AI) against safety invariants before execution | Unit tests + integration tests      |
| **Mixed-initiative interleaving**     | Defined semantics for when human command preempts queued AI command                           | State machine spec, edge case tests |
| **Compiler-not-daemon rule**          | LLMs compile intent to commands offline; no LLM calls in audio-tight path                     | Code audit + latency tracing        |

**Discovery process**:

1. Build thin slice: command ring + single deck + Ghost suggestion queue
2. Play with it. Notice: "If Ghost does X, it feels unsafe. But if constrained to Y, it feels great."
3. Write that down as a rule, a diagram, invariants, maybe a formal spec
4. Try to break it with "evil Ghost" scenarios (stress tests that spam commands, violate modes); refine invariants until
   the engine stays safe

### 2.2 Macro-Planning for Performance as Control Theory — P0

**The gap**: Nobody treats a DJ set like a **control problem** over a 60–120 min horizon with constraints and measurable
state, where the objective is "keep energy in the right band, avoid fatigue, land the arc clean."

**Technique candidates**:

| Candidate Technique                   | Description                                                                                                       | Validation Method                                                         |
|---------------------------------------|-------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| **Archetype as reference trajectory** | Set archetype (warmup → peak → cooldown) defines target energy curve over time                                    | Compare actual energy curve to archetype in post-session review           |
| **MPC-inspired micro-corrections**    | Ghost as a model-predictive-style planner: observe current state, predict N bars ahead, suggest small corrections | A/B test: Ghost-guided vs unguided sets, measure deviation from archetype |
| **Energy feedback loop**              | Measure "crowd energy" proxy (could be as simple as DJ's manual marker), feed back to planner                     | Manual markers → bandit feedback → improved suggestions                   |
| **Arc constraint satisfaction**       | Hard constraints: "must hit peak energy by minute 45," "no energy crash > 20% between tracks"                     | Constraint solver or rejection sampling for suggestions                   |

**Discovery process**:

1. Define minimal archetype: `[{t: 0, energy: 0.3}, {t: 45, energy: 0.9}, {t: 90, energy: 0.5}]`
2. Build energy estimator from track features (`energyPerBar`)
3. Log actual energy trajectory during sets
4. Compare, notice patterns, codify as constraints

### 2.3 Session Logs → Learning Signals — P1

**The gap**: Most DJs have zero structured logs. Most ML folks have never seen a set as a supervised trajectory. You can
explore how to turn performance logs into training data.

**Technique candidates**:

| Candidate Technique                            | Description                                                                      | Validation Method                                                    |
|------------------------------------------------|----------------------------------------------------------------------------------|----------------------------------------------------------------------|
| **State/action/outcome compression**           | Compress full session log to minimal (state, action, reward) tuples              | Measure: can you recover the "feel" of the set from compressed data? |
| **Bandit feedback from suggestion acceptance** | When Ghost suggests and DJ accepts/rejects, treat as bandit feedback             | Online learning: does acceptance rate improve over sessions?         |
| **Manual moment markers as supervision**       | DJ marks "this felt good" / "this sucked" → sparse reward signal                 | Train reward model, measure correlation with post-session rating     |
| **Transition quality scoring**                 | Heuristic or learned model: score each transition, weight training data by score | A/B: does training on high-score transitions improve policy?         |

**Discovery process**:

1. Log 10–20 full sessions with moment markers
2. Build minimal state vector (Ghost DJ Data Model Appendix B)
3. Train tiny policy net, observe what it learns
4. Notice: "It picks up X but misses Y"—that tells you what features matter
5. Start with intentionally tiny models (e.g., linear or shallow MLP) so failures are interpretable; this helps decide
   what features you actually need before going bigger

### 2.4 UX Patterns for Co-Performance — P2

> **Note**: This is likely a later frontier. Focus first on getting *any* Ghost suggestions into the UI, then iterate
> towards these patterns.

**The gap**: Wildly underexplored. How do you show suggestions without breaking flow? How does the DJ say "yes/no/later"
in 100ms without thinking?

**Technique candidates**:

| Candidate Technique                       | Description                                                                | Validation Method                                         |
|-------------------------------------------|----------------------------------------------------------------------------|-----------------------------------------------------------|
| **Glanceable suggestion display**         | Suggestion visible in peripheral vision, no cognitive load to parse        | User test: can DJ identify suggestion while mixing?       |
| **Single-gesture accept/reject**          | Physical mapping: one button = accept, one button = reject, no menus       | Measure: time-to-decision, error rate                     |
| **Staged suggestion preview**             | Suggestion shown as "what would happen if" before commitment               | User feedback: does preview reduce regret?                |
| **Contextual suggestion timing**          | Ghost only surfaces suggestions at "safe" moments (e.g., after drop lands) | Log suggestion timing vs accepted/rejected; find patterns |
| **Explanation on demand, not by default** | Ghost can explain, but only when asked; default is silent operation        | A/B: does unsolicited explanation help or hurt flow?      |

**Discovery process**:

1. Build minimal suggestion UI (text overlay, LED indicator, whatever)
2. Practice sets with it
3. Notice: "This pattern worked, these 5 were cognitive overload"
4. Write that down as interaction patterns

---

## 3. The Discovery Methodology

This is how you turn "building Dekzer" into "discovering techniques."

### 3.1 The Loop

```
Build thin slice (command ring + deck + one feature)
         │
         ▼
    Use it for real
         │
         ▼
Notice: "If X happens, it feels wrong. But Y feels great."
         │
         ▼
Write it down as:
  • A rule ("Ghost must never...")
  • A diagram (state machine, data flow)
  • Invariants (formal or informal)
         │
         ▼
    Test edge cases
         │
         ▼
   Extract the pattern
         │
         ▼
Repeat with next thin slice
```

### 3.2 What "Writing It Down" Looks Like

**Level 1: Rule**
> "Ghost is only allowed to emit commands that satisfy invariants X/Y/Z."

**Level 2: Diagram**

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Human     │────▶│   Ring      │────▶│   Engine    │
│  (UI/MIDI)  │     │  (validate) │     │  (execute)  │
└─────────────┘     └─────────────┘     └─────────────┘
       ▲                   ▲
       │                   │
┌─────────────┐            │
│   Ghost     │────────────┘
│  (suggest)  │   (same validation)
└─────────────┘
```

**Level 3: Invariants (code)**

```typescript
// Safety invariant: AI never stops a deck abruptly
function validateCommand(cmd: GhostDjCommand, mode: AuthorityMode): boolean {
  if (cmd.type === 'deck.stop' && mode !== 'Edit') {
    return false; // Ghost can only stop in Edit mode
  }
  // ... more invariants
  return true;
}
```

**Level 4: Optional formal model**

For some techniques (e.g., swap state machine, command ring invariants), you *may* capture them in a TLA+ spec or
similar. Not required for every pattern—Rule → Diagram → Invariants (code) is already enough to "count."

### 3.3 When a Pattern Becomes a "Technique"

A pattern earns the label "technique" when:

1. It solves a **class** of problems, not just one instance
2. You can **explain** it to someone who doesn't know your codebase
3. It has **invariants** you can test or verify
4. It **generalizes** beyond DJ software (even if you discovered it there)

---

## 4. Prioritized Discovery Roadmap

Based on current Seqlok/Dekzer state and the 2026 strategy. Phases are keyed to **technical state**, not calendar
quarters.

### Phase 1: Validate Existing Techniques

*Precondition: One-deck lab works end-to-end*

**Goal**: Prove the four existing patterns work in practice, not just in isolation.

| Technique         | Validation Target                          | Success Criteria                         |
|-------------------|--------------------------------------------|------------------------------------------|
| Command Ring      | One-deck lab with full session logging     | Can replay any session deterministically |
| Hotswap           | Signalsmith stretch engine swap under load | Zero glitches during config change       |
| Session Log       | Log 5 full practice sets, replay all       | Frame-accurate reconstruction verified   |
| Reflex/Reflection | Ghost suggestions running alongside audio  | No audio glitches when Ghost is active   |

**Phase 1 DoD**:

- You can run a one-deck lab in the browser
- It uses command ring + hotswap + session logs together
- You can record + replay at least 5 practice sessions without divergence
- Reflex path metrics show no degradation when reflection loop is active
- Audio glitch budget validated: zero XRuns over 1h sessions at 128-sample buffers

**Artifacts**:

- [ ] Working one-deck lab with all four patterns integrated
- [ ] "Seqlok Way" document: how these patterns compose

### Phase 2: Discover Co-Pilot Patterns

*Precondition: Ghost can suggest tracks; two-deck lab stable*

**Goal**: Find the first 2–3 real-time co-pilot control patterns.

| Discovery Target           | Method                                                          | Artifact                                 |
|----------------------------|-----------------------------------------------------------------|------------------------------------------|
| Authority mode rules       | Build modes, play with Ghost suggestions, notice failures       | Invariant spec for Takeover/Edit/Passive |
| Budget-gated suggestion    | Measure suggestion latency, find safe threshold                 | Documented latency budget                |
| Human preemption semantics | Test: what happens when human acts during queued Ghost command? | State machine diagram                    |
| Evil Ghost stress test     | Spam commands, violate modes, verify engine stays safe          | Test suite + failure log                 |

### Phase 3: Discover Planning Patterns

*Precondition: Archetypes + energy estimator exist*

**Goal**: Find the first archetype/energy planning patterns.

| Discovery Target                  | Method                                              | Artifact                          |
|-----------------------------------|-----------------------------------------------------|-----------------------------------|
| Archetype as reference trajectory | Define 2–3 archetypes, compare actual sets          | Archetype spec + deviation metric |
| Energy feedback loop              | Manual markers during sets, correlate with outcomes | Marker → feedback pipeline        |
| Transition quality heuristic      | Score transitions post-hoc, find patterns           | Scoring function + validation     |

### Phase 4: Discover UX Patterns

*Precondition: Can rehearse full sets in Dekzer*

**Goal**: Find interaction patterns that don't break flow.

| Discovery Target             | Method                                                              | Artifact                   |
|------------------------------|---------------------------------------------------------------------|----------------------------|
| Glanceable suggestion        | A/B test display locations/styles                                   | Documented display pattern |
| Single-gesture accept/reject | Try different mappings, measure time-to-decision                    | Recommended mapping        |
| Contextual suggestion timing | Log when suggestions are accepted vs rejected, find timing patterns | Timing heuristic           |

---

## 5. Connection to Existing Specs

| Spec                    | How It Supports Technique Discovery                                    |
|-------------------------|------------------------------------------------------------------------|
| **Seqlok Primer**       | Defines the substrate; existing techniques (ring, hotswap) live here   |
| **Ghost DJ Data Model** | Defines what gets logged; enables session log analysis                 |
| **Deck Audio MVP**      | Defines audio behavior; techniques must preserve this contract         |
| **Strategy Doc**        | Defines scope/modes/guardrails; techniques implement these constraints |
| **Vector DB Guide**     | Defines embedding/search; future techniques for similarity + planning  |

---

## 6. What This Gets You

If you execute this discovery process:

**Short term (2026)**:

- 3–5 documented techniques you can point to and say "this is how Dekzer does X"
- Working system that embodies those techniques
- Clear articulation of what's novel vs what's engineering

**Medium term (2027+)**:

- Publishable patterns:
  - *"Mixed-initiative real-time control via SWSR ring and invariants"*
  - *"Archetype-guided macro planning for creative arcs"*
- Foundation for TU Delft-style collaborations: "Here's a technique, let's formalize it"
- Differentiation story: "We didn't just add AI features; we invented a new control architecture"

**The drone analogy**: TU Delft drone folks did lots of sim, lots of failed routes, then patterns emerged. You're doing
the same in **time + audio** instead of **space + thrust**.

---

## 7. Measurement & Instrumentation Baseline

Technique discovery without instrumentation turns into story-time. For any lab where we're trying to discover or
validate a technique, we default to collecting:

### 7.1 Real-Time / Engine Metrics

- Audio glitch counter (XRuns, missed deadlines)
- Per-block processing time histogram (min/avg/p95/p99)
- Hotswap events: duration, overlap, gain curves used
- Buffer configuration: samples per block, sample rate, worst-case latency

### 7.2 Control / Ghost Interaction Metrics

- Command ring stats: occupancy, overflow/underflow counts
- Suggestion pipeline latency (candidate gen → UI)
- Suggestion outcomes: accepted / rejected / ignored
- Command validation failures: which invariants were violated

### 7.3 Set-Level / Planning Metrics

- Energy curve over time (coarse, per 4/8 bars)
- Archetype deviation: distance from reference trajectory
- Crowd / DJ feedback proxies (manual markers, post-set rating)

**The rule**:
> If we're treating something as a candidate technique, we should be able to show at least one metric that improved when
> we adopted it.

---

## 8. Real-Time Constraints & Budgets

Understanding the actual timing constraints is critical for technique discovery.

### 8.1 The Audio Callback Boundary

**Hard real-time constraint**: Audio callback runs at ~344 Hz (128 samples @ 44.1 kHz) or ~375 Hz (128 samples @ 48
kHz).

This means:

- **Budget per audio block**: ~2.9ms @ 44.1 kHz, ~2.67ms @ 48 kHz
- **No blocking operations**: No network, no file I/O, no DB queries, no GC-heavy allocations
- **Predictable worst-case**: Every operation in the audio path must have bounded execution time

**The reflex path** operates at audio callback rate. This is 6–7× faster than typical UI/game loops (60 Hz / 16.7ms).

### 8.2 Layered Timing Budgets

| Layer                  | Rate       | Budget             | Allowed Operations                            |
|------------------------|------------|--------------------|-----------------------------------------------|
| **Audio callback**     | 300–375 Hz | ~2.7–2.9 ms        | DSP, command dequeue, state update            |
| **Command submission** | Variable   | <1ms               | Command validation, ring enqueue              |
| **UI/Render**          | 60 Hz      | ~16.7 ms           | React render, canvas draw                     |
| **Ghost suggestion**   | Async      | Seconds to minutes | LLM calls, vector search, feature computation |

**Critical rule**: Operations in faster layers cannot call into slower layers. The audio callback cannot wait for Ghost.

### 8.3 Technique Validation Criteria

When claiming "zero glitches" or "real-time safe," we mean:

- **Zero XRuns** (audio underruns) over 1-hour sessions
- **p99 latency** stays under 80% of budget (safety margin)
- **Worst-case** measured and documented, not just average-case

Any technique that claims to be "real-time safe" must provide these measurements.

---

## 9. Anti-Techniques & Pitfalls

Not every clever hack qualifies as a technique. We explicitly do **not** count these as techniques:

- **Entangled heuristics**
  - Rules that are tightly bound to current UI or product quirks and don't generalize.

- **"Just use a bigger model"**
  - Relying on scaling an LLM instead of improving structure, invariants, or logs.

- **LLM-in-the-loop at audio rate**
  - Any design that puts network/LLM calls in the audio callback path is automatically disqualified.

- **Unlogged magic**
  - Behaviours that can't be reconstructed from session logs and metrics.

- **"Works on my machine" timing**
  - Techniques that only succeed under best-case conditions, not worst-case validated budgets.

**Pitfall pattern**:
> "It works in this specific build on my machine"  
> but:
> - can't be explained cleanly,
> - can't be tested,
> - can't be replayed/logged,
> - fails under load or on slower hardware.

Those are allowed as temporary experiments, but they **never** graduate to "technique".

---

## 10. Externalization Hooks (Papers, Talks, Theses)

Each technique cluster should eventually have at least one "export path":

- **Systems angle**: Seqlok + command rings + hotswap
  - Target: real-time / systems / concurrency communities
  - Framing: "Sub-3ms budget mixed-initiative control"

- **AI/Planning angle**: Ghost, archetypes, macro planning
  - Target: human-AI collaboration, planning, MIR / creative AI
  - Framing: "Long-horizon creative planning with real-time constraints"

- **HCI/UX angle**: Co-performance interfaces, modes, suggestions
  - Target: CHI / NIME / interactive systems
  - Framing: "Flow-preserving AI suggestions for performance contexts"

This agenda is the internal source of truth; any external artifact (paper, thesis, TU Delft collab) should reference
concrete techniques and metrics from here, not create new concepts off to the side.

---

## 11. Next Actions

1. [ ] Review this document; mark any frontiers that feel most promising
2. [ ] Ensure Phase 1 scope (one-deck lab) is on track with current Seqlok state
3. [ ] Start treating lab sessions as "research notes": what worked, what didn't, why
4. [ ] Pick one frontier from §2 to prototype alongside Phase 2 work
5. [ ] Create a `docs/techniques/` folder and drop this file in as `technique-discovery-agenda.md`
6. [ ] Establish baseline metrics for Phase 1: measure current XRun rate, per-block latency distribution

---

*Document type: Research Agenda / Discovery Framework*
*Companion docs: dekzer-2026-strategy-set-lab.md, ghost-dj-data-model.md, Seqlok-Primer.md*
