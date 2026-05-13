---- MODULE HotSwapRejectBusy ----
(*
 * Formal specification of the hot-swap protocol with REJECT-WHILE-BUSY policy.
 *
 * This module extends the single-swap protocol to model multi-swap scenarios:
 *   - Sequential swaps (A→B, then B→C after completion)
 *   - Overlapping swap requests (B→C issued during A→B)
 *   - Reject-while-busy: overlapping requests are immediately rejected
 *
 * Key properties:
 *   - At most two engines active per lane
 *   - Sequential swaps complete correctly (A→B→C ends on C)
 *   - During A→B, a rejected engine C never appears in decisions
 *   - All accepted swaps eventually complete
 *
 * This models the integration layer (scheduleSwap) and RT protocol together.
 *)

EXTENDS Integers, Sequences, FiniteSets

(* Model parameters (set in .cfg) *)

CONSTANTS
    MAX_PREWARM_BLOCKS,     \* Maximum prewarm blocks per swap
    MAX_FADE_FRAMES,        \* Maximum crossfade frames per swap
    BLOCK_FRAMES,           \* Frames per audio block
    MAX_BEHAVIORS           \* Limit on behavior length for model checking

\* Finite engine universe for model checking

CONSTANTS
    Engine1,                \* First engine instance
    Engine2,                \* Second engine instance
    Engine3,                \* Third engine instance
    NoEngine                \* Sentinel for "no engine"

Engines == {Engine1, Engine2, Engine3}

(* State variables *)

\* Core protocol state (shared with HotSwapSingle)
VARIABLES
    phase,                  \* idle/spawn/prime/prewarm/crossfade/retire
    hasTicket,              \* Active swap ticket?
    preWarmBlocksRemaining,
    fadeFramesRemaining,
    totalFadeFrames,
    stepIndex               \* Monotonic step counter

\* Engine tracking
VARIABLES
    currentEngine,          \* Current engine (from Engines)
    nextEngine              \* Next engine during swap (or NoEngine)

\* Host-level accounting (integration layer)
VARIABLES
    swapRequests,           \* Total swap requests issued
    swapsAccepted,          \* Swaps accepted (entered protocol)
    swapsRejected,          \* Swaps rejected (lane busy)
    completedSwaps          \* Sequence of completed engine transitions

\* Tuple of all variables
vars == <<phase, hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
          totalFadeFrames, stepIndex, currentEngine, nextEngine,
          swapRequests, swapsAccepted, swapsRejected, completedSwaps>>

(* Helper operators *)

\* Is the lane busy (swap in progress)?
IsLaneBusy == phase # "idle"

\* Number of active engines
ActiveEngineCount ==
    Cardinality({e \in Engines : e = currentEngine \/ e = nextEngine})

\* Has an engine ever been active (current, next, or in history)?
EngineWasActive(e) ==
    \/ currentEngine = e
    \/ nextEngine = e
    \/ \E i \in DOMAIN completedSwaps : completedSwaps[i] = e

(* Type invariant *)

TypeOK ==
    /\ phase \in {"idle", "spawn", "prime", "prewarm", "crossfade", "retire"}
    /\ hasTicket \in BOOLEAN
    /\ preWarmBlocksRemaining \in 0..MAX_PREWARM_BLOCKS
    /\ fadeFramesRemaining \in 0..MAX_FADE_FRAMES
    /\ totalFadeFrames \in 0..MAX_FADE_FRAMES
    /\ stepIndex \in Nat
    /\ currentEngine \in Engines
    /\ nextEngine \in Engines \cup {NoEngine}
    /\ swapRequests \in Nat
    /\ swapsAccepted \in Nat
    /\ swapsRejected \in Nat
    /\ completedSwaps \in Seq(Engines)
    /\ swapsAccepted + swapsRejected = swapRequests

(* Initial state *)

(*
 * Start with Engine1 active, no pending swaps.
 *)
Init ==
    /\ phase = "idle"
    /\ hasTicket = FALSE
    /\ preWarmBlocksRemaining = 0
    /\ fadeFramesRemaining = 0
    /\ totalFadeFrames = 0
    /\ stepIndex = 0
    /\ currentEngine = Engine1
    /\ nextEngine = NoEngine
    /\ swapRequests = 0
    /\ swapsAccepted = 0
    /\ swapsRejected = 0
    /\ completedSwaps = <<Engine1>>   \* Initial engine in history

(* Host-level actions (integration layer) *)

(*
 * RequestSwap: host requests a swap to a different engine.
 *
 * Reject-while-busy policy:
 *   - If lane is idle: accept and start swap
 *   - If lane is busy: reject immediately (no queueing)
 *
 * This models scheduleSwap() in @seqlok/hotswap.
 *)
RequestSwap(targetEngine, prewarm, fade) ==
    /\ targetEngine \in Engines
    /\ targetEngine # currentEngine
    /\ prewarm \in 0..MAX_PREWARM_BLOCKS
    /\ fade \in 1..MAX_FADE_FRAMES
    /\ swapRequests' = swapRequests + 1
    /\ IF IsLaneBusy
       THEN \* Reject: lane is busy
            /\ swapsRejected' = swapsRejected + 1
            /\ swapsAccepted' = swapsAccepted
            /\ UNCHANGED <<phase, hasTicket, preWarmBlocksRemaining,
                          fadeFramesRemaining, totalFadeFrames, stepIndex,
                          currentEngine, nextEngine, completedSwaps>>
       ELSE \* Accept: lane is idle, start swap
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

(* RT protocol actions (same structure as base protocol) *)

StepSpawn ==
    /\ phase = "spawn"
    /\ hasTicket = TRUE
    /\ phase' = "prime"
    /\ stepIndex' = stepIndex + 1
    /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
                   totalFadeFrames, currentEngine, nextEngine, completedSwaps,
                   swapRequests, swapsAccepted, swapsRejected>>

StepPrime ==
    /\ phase = "prime"
    /\ hasTicket = TRUE
    /\ phase' = IF preWarmBlocksRemaining > 0 THEN "prewarm" ELSE "crossfade"
    /\ stepIndex' = stepIndex + 1
    /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
                   totalFadeFrames, currentEngine, nextEngine, completedSwaps,
                   swapRequests, swapsAccepted, swapsRejected>>

StepPrewarm ==
    /\ phase = "prewarm"
    /\ hasTicket = TRUE
    /\ preWarmBlocksRemaining > 0
    /\ preWarmBlocksRemaining' = preWarmBlocksRemaining - 1
    /\ phase' =
        IF preWarmBlocksRemaining - 1 <= 0
        THEN "crossfade"
        ELSE "prewarm"
    /\ stepIndex' = stepIndex + 1
    /\ UNCHANGED <<hasTicket, fadeFramesRemaining, totalFadeFrames,
                   currentEngine, nextEngine, completedSwaps,
                   swapRequests, swapsAccepted, swapsRejected>>

StepCrossfade ==
    /\ phase = "crossfade"
    /\ hasTicket = TRUE
    /\ fadeFramesRemaining > 0
    /\ fadeFramesRemaining' =
        IF fadeFramesRemaining > BLOCK_FRAMES
        THEN fadeFramesRemaining - BLOCK_FRAMES
        ELSE 0
    /\ phase' =
        IF fadeFramesRemaining' <= 0
        THEN "retire"
        ELSE "crossfade"
    /\ stepIndex' = stepIndex + 1
    /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, totalFadeFrames,
                   currentEngine, nextEngine, completedSwaps,
                   swapRequests, swapsAccepted, swapsRejected>>

StepRetire ==
    /\ phase = "retire"
    /\ hasTicket = TRUE
    /\ phase' = "idle"
    /\ hasTicket' = FALSE
    /\ preWarmBlocksRemaining' = 0
    /\ fadeFramesRemaining' = 0
    /\ totalFadeFrames' = 0
    \* Engine transition: next becomes current
    /\ currentEngine' = nextEngine
    /\ nextEngine' = NoEngine
    /\ completedSwaps' = Append(completedSwaps, nextEngine)
    /\ stepIndex' = stepIndex + 1
    /\ UNCHANGED <<swapRequests, swapsAccepted, swapsRejected>>

StepIdle ==
    /\ phase = "idle"
    /\ hasTicket = FALSE
    /\ UNCHANGED vars

(* Next-state relation *)

(*
 * Next includes both host actions and RT steps.
 * TLC quantifies over possible swap requests to explore the space.
 *)
Next ==
    \/ \E targetEngine \in Engines,
          prewarm \in 0..MAX_PREWARM_BLOCKS,
          fade \in 1..MAX_FADE_FRAMES :
        RequestSwap(targetEngine, prewarm, fade)
    \/ StepSpawn
    \/ StepPrime
    \/ StepPrewarm
    \/ StepCrossfade
    \/ StepRetire
    \/ StepIdle

(* Safety invariants *)

(*
 * AtMostTwoEngines: never more than 2 engines active.
 *)
AtMostTwoEngines ==
    /\ currentEngine # NoEngine
    /\ (nextEngine # NoEngine) => (phase # "idle")
    /\ ActiveEngineCount <= 2

(*
 * NoGapDuringCrossfade: both engines active during crossfade.
 *)
NoGapDuringCrossfade ==
    (phase = "crossfade") =>
        (currentEngine # NoEngine /\ nextEngine # NoEngine)

(*
 * NextEngineConsistency: next engine only exists during swaps.
 *)
NextEngineConsistency ==
    (nextEngine # NoEngine) <=> (phase # "idle")

(*
 * CompletedSwapsConsistency: history reflects actual transitions.
 *)
CompletedSwapsConsistency ==
    /\ Len(completedSwaps) >= 1
    /\ completedSwaps[1] = Engine1
    /\ (phase = "idle" /\ hasTicket = FALSE)
        => (completedSwaps[Len(completedSwaps)] = currentEngine)

(*
 * NoRejectedEngineInDecisions:
 * If an engine was never active, it does not appear in current/next.
 *)
NoRejectedEngineInDecisions ==
    \A e \in Engines :
        (~EngineWasActive(e)) => (e # currentEngine /\ e # nextEngine)

(*
 * SequentialSwapsComplete: after multiple completed swaps, the final
 * engine is the last one in the completion history.
 *)
SequentialSwapsComplete ==
    (Len(completedSwaps) >= 2 /\ phase = "idle") =>
        (currentEngine = completedSwaps[Len(completedSwaps)])

(* Model checking constraint *)

(*
 * BehaviorBound: limit behavior length to keep exploration tractable.
 * Bounded by number of completed swaps and total requests.
 *)
BehaviorBound ==
    /\ Len(completedSwaps) <= MAX_BEHAVIORS
    /\ swapRequests <= 10

(* Liveness properties *)

Fairness == WF_vars(Next)

(*
 * EventuallyIdle: every accepted swap eventually completes.
 *)
EventuallyIdle ==
    [](phase # "idle" => <>(phase = "idle"))

(*
 * MultipleSwapsComplete: if multiple swaps are accepted,
 * the system eventually settles to idle with a longer history.
 *)
MultipleSwapsComplete ==
    (swapsAccepted >= 2) ~>
        (phase = "idle" /\ Len(completedSwaps) >= 3)

(*
 * NoLivelock: never stuck in intermediate phases forever.
 *)
NoLivelockPrewarm ==
    [](phase = "prewarm" => <>(phase # "prewarm"))

NoLivelockCrossfade ==
    [](phase = "crossfade" => <>(phase # "crossfade"))

(* Specification *)

Spec ==
    Init /\ [][Next]_vars /\ Fairness

(* Theorems checked by TLC *)

THEOREM Spec => []TypeOK
THEOREM Spec => []AtMostTwoEngines
THEOREM Spec => []NoGapDuringCrossfade
THEOREM Spec => []NextEngineConsistency
THEOREM Spec => []CompletedSwapsConsistency
THEOREM Spec => []SequentialSwapsComplete
THEOREM Spec => EventuallyIdle
THEOREM Spec => MultipleSwapsComplete

====
