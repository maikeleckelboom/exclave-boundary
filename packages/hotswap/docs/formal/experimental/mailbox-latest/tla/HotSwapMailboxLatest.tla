---- MODULE HotSwapMailboxLatest ----
(*
 * HotSwap protocol with MAILBOX LATEST-WINS semantics + seqno.
 *
 * Key semantics:
 *   - Never reject swap requests.
 *   - Busy lane stores latest intent in a single-slot mailbox (overwrite).
 *   - Requests that match the in-flight target (nextEngine) are treated as "reaffirm":
 *       * clear pending mailbox (cancel retarget) but do NOT restart progress.
 *   - Retarget at safe boundaries:
 *       * spawn|prime|prewarm: restart swap toward pending
 *       * crossfade: optional abort early in fade only (DSP gate)
 *       * retire: chain immediately (no idle gap)
 *
 * "Committed" definition (precise):
 *   - A swap is committed when the new engine becomes the PRIMARY output,
 *     i.e. at the end of retire when currentEngine := nextEngine.
 *   - crossfade is audible but still cancellable early by policy.
 *)

EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
  MAX_PREWARM_BLOCKS,
  MAX_FADE_FRAMES,
  BLOCK_FRAMES,
  Engine1, Engine2, Engine3, NoEngine

Engines == {Engine1, Engine2, Engine3}
Phases  == {"idle","spawn","prime","prewarm","crossfade","retire"}

VARIABLES
  \* Environment control (for liveness assumptions)
  writesEnabled,

  \* Core protocol
  phase,
  hasTicket,
  preWarmBlocksRemaining,
  fadeFramesRemaining,
  totalFadeFrames,
  stepIndex,

  \* Engine tracking
  currentEngine,
  nextEngine,

  \* Mailbox payload (latest intent)
  pendingEngine,
  pendingPrewarm,
  pendingFade,

  \* Mailbox seqno (ABA-safe)
  pendingSeq,
  consumedSeq,

  \* Host request bookkeeping (for liveness + metrics)
  swapRequests,
  lastReqEngine,

  \* Metrics (names match semantics)
  swapsStarted,        \* swap executions started (immediate or from pending)
  pendingOverwrites,   \* pending slot clobbered by a newer request
  pendingClears,       \* pending cleared by "reaffirm nextEngine"
  noOpRequests,        \* requests that change nothing (idle->same as current)
  completedSwaps

vars ==
  << writesEnabled,
     phase, hasTicket, preWarmBlocksRemaining, fadeFramesRemaining, totalFadeFrames, stepIndex,
     currentEngine, nextEngine,
     pendingEngine, pendingPrewarm, pendingFade, pendingSeq, consumedSeq,
     swapRequests, lastReqEngine,
     swapsStarted, pendingOverwrites, pendingClears, noOpRequests,
     completedSwaps >>

IsLaneBusy == phase # "idle"

HasPending ==
  pendingSeq > consumedSeq

PendingCount ==
  IF HasPending THEN 1 ELSE 0

ActiveEngineCount ==
  Cardinality({e \in Engines : e = currentEngine \/ e = nextEngine})

TypeOK ==
  /\ writesEnabled \in BOOLEAN
  /\ phase \in Phases
  /\ hasTicket \in BOOLEAN
  /\ preWarmBlocksRemaining \in 0..MAX_PREWARM_BLOCKS
  /\ fadeFramesRemaining \in 0..MAX_FADE_FRAMES
  /\ totalFadeFrames \in 0..MAX_FADE_FRAMES
  /\ stepIndex \in Nat
  /\ currentEngine \in Engines
  /\ nextEngine \in Engines \cup {NoEngine}
  /\ pendingEngine \in Engines \cup {NoEngine}
  /\ pendingPrewarm \in 0..MAX_PREWARM_BLOCKS
  /\ pendingFade \in 0..MAX_FADE_FRAMES
  /\ pendingSeq \in Nat
  /\ consumedSeq \in Nat
  /\ consumedSeq <= pendingSeq
  /\ swapRequests \in Nat
  /\ lastReqEngine \in Engines
  /\ swapsStarted \in Nat
  /\ pendingOverwrites \in Nat
  /\ pendingClears \in Nat
  /\ noOpRequests \in Nat
  /\ completedSwaps \in Seq(Engines)

TicketConsistency ==
  hasTicket <=> IsLaneBusy

AtMostTwoEngines ==
  ActiveEngineCount <= 2

NoGapDuringCrossfade ==
  (phase = "crossfade") => (currentEngine # NoEngine /\ nextEngine # NoEngine)

CrossfadeEnginesDistinct ==
  (phase = "crossfade") => (currentEngine # nextEngine)

(*
 * Conservation for *requests* under mailbox semantics.
 *
 * Each host request is accounted for as one of:
 *   - swapsStarted        (started immediately OR later by consuming pending)
 *   - pendingOverwrites   (previous pending intent superseded)
 *   - pendingClears       (pending intent cleared by reaffirming nextEngine)
 *   - noOpRequests        (idle + requested current engine)
 *   - PendingCount        (currently pending, not yet turned into swapsStarted)
 *
 * This matches "latest-wins" semantics without pretending anything was rejected.
 *)
AccountingOK ==
  swapsStarted + pendingOverwrites + pendingClears + noOpRequests + PendingCount = swapRequests

Init ==
  /\ writesEnabled = TRUE
  /\ phase = "idle"
  /\ hasTicket = FALSE
  /\ preWarmBlocksRemaining = 0
  /\ fadeFramesRemaining = 0
  /\ totalFadeFrames = 0
  /\ stepIndex = 0
  /\ currentEngine = Engine1
  /\ nextEngine = NoEngine
  /\ pendingEngine = NoEngine
  /\ pendingPrewarm = 0
  /\ pendingFade = 0
  /\ pendingSeq = 0
  /\ consumedSeq = 0
  /\ swapRequests = 0
  /\ lastReqEngine = Engine1
  /\ swapsStarted = 0
  /\ pendingOverwrites = 0
  /\ pendingClears = 0
  /\ noOpRequests = 0
  /\ completedSwaps = <<Engine1>>

(*
 * Host request. Never rejected.
 *
 * Cases:
 *  - idle + target = currentEngine: no-op (counts noOpRequests)
 *  - idle + target != currentEngine: start immediately (swapsStarted++)
 *  - busy + target = nextEngine: reaffirm; clear pending mailbox (pendingClears++)
 *  - busy + otherwise: write mailbox (seq++); overwrite counts pendingOverwrites
 *)
RequestSwap(targetEngine, prewarm, fade) ==
  /\ writesEnabled = TRUE
  /\ targetEngine \in Engines
  /\ prewarm \in 0..MAX_PREWARM_BLOCKS
  /\ fade \in 1..MAX_FADE_FRAMES
  /\ swapRequests' = swapRequests + 1
  /\ lastReqEngine' = targetEngine

  /\ IF ~IsLaneBusy
     THEN
       IF targetEngine = currentEngine
       THEN
         /\ noOpRequests' = noOpRequests + 1
         /\ UNCHANGED << phase, hasTicket, preWarmBlocksRemaining, fadeFramesRemaining, totalFadeFrames,
                        currentEngine, nextEngine,
                        pendingEngine, pendingPrewarm, pendingFade, pendingSeq, consumedSeq,
                        swapsStarted, pendingOverwrites, pendingClears, completedSwaps, writesEnabled, stepIndex >>
       ELSE
         /\ swapsStarted' = swapsStarted + 1
         /\ phase' = "spawn"
         /\ hasTicket' = TRUE
         /\ preWarmBlocksRemaining' = prewarm
         /\ fadeFramesRemaining' = fade
         /\ totalFadeFrames' = fade
         /\ nextEngine' = targetEngine
         /\ stepIndex' = stepIndex + 1
         /\ UNCHANGED << currentEngine,
                        pendingEngine, pendingPrewarm, pendingFade, pendingSeq, consumedSeq,
                        pendingOverwrites, pendingClears, noOpRequests, completedSwaps, writesEnabled >>
     ELSE
       IF targetEngine = nextEngine
       THEN
         \* Reaffirm in-flight swap; cancel any retarget intent.
         /\ pendingClears' = pendingClears + 1
         /\ consumedSeq' = pendingSeq
         /\ pendingEngine' = NoEngine
         /\ pendingPrewarm' = 0
         /\ pendingFade' = 0
         /\ UNCHANGED << phase, hasTicket, preWarmBlocksRemaining, fadeFramesRemaining, totalFadeFrames,
                        currentEngine, nextEngine, pendingSeq,
                        swapsStarted, pendingOverwrites, noOpRequests, completedSwaps, writesEnabled, stepIndex >>
       ELSE
         /\ pendingOverwrites' = pendingOverwrites + (IF HasPending THEN 1 ELSE 0)
         /\ pendingSeq' = pendingSeq + 1
         /\ pendingEngine' = targetEngine
         /\ pendingPrewarm' = prewarm
         /\ pendingFade' = fade
         /\ UNCHANGED << phase, hasTicket, preWarmBlocksRemaining, fadeFramesRemaining, totalFadeFrames,
                        currentEngine, nextEngine, consumedSeq,
                        swapsStarted, pendingClears, noOpRequests, completedSwaps, writesEnabled, stepIndex >>

(*
 * Environment action: stop producing new requests.
 * Used for the liveness contract: "once spam stops, converge to last request".
 *)
DisableWrites ==
  /\ writesEnabled = TRUE
  /\ writesEnabled' = FALSE
  /\ UNCHANGED << phase, hasTicket, preWarmBlocksRemaining, fadeFramesRemaining, totalFadeFrames, stepIndex,
                 currentEngine, nextEngine,
                 pendingEngine, pendingPrewarm, pendingFade, pendingSeq, consumedSeq,
                 swapRequests, lastReqEngine,
                 swapsStarted, pendingOverwrites, pendingClears, noOpRequests, completedSwaps >>

(*
 * Consume pending early: restart toward mailbox intent (retarget).
 * Guarded by seqno, and by pendingEngine != nextEngine (no-op spam already handled anyway).
 *)
ConsumePendingEarly ==
  /\ HasPending
  /\ phase \in {"spawn","prime","prewarm"}
  /\ hasTicket = TRUE
  /\ pendingEngine # NoEngine
  /\ pendingEngine # nextEngine
  /\ swapsStarted' = swapsStarted + 1
  /\ phase' = "spawn"
  /\ nextEngine' = pendingEngine
  /\ preWarmBlocksRemaining' = pendingPrewarm
  /\ fadeFramesRemaining' = pendingFade
  /\ totalFadeFrames' = pendingFade
  /\ consumedSeq' = pendingSeq
  /\ pendingEngine' = NoEngine
  /\ pendingPrewarm' = 0
  /\ pendingFade' = 0
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED << writesEnabled, currentEngine, swapRequests, lastReqEngine,
                 pendingSeq, pendingOverwrites, pendingClears, noOpRequests, completedSwaps, hasTicket >>

(*
 * Abort crossfade to pending (optional “spam feel”), but gated to early fade only.
 * If not taken, convergence still happens via retire chain.
 *)
AbortCrossfadeToPending ==
  /\ HasPending
  /\ phase = "crossfade"
  /\ hasTicket = TRUE
  /\ pendingEngine # NoEngine
  /\ pendingEngine # nextEngine
  /\ fadeFramesRemaining > (totalFadeFrames \div 2)
  /\ swapsStarted' = swapsStarted + 1
  /\ phase' = "spawn"
  /\ nextEngine' = pendingEngine
  /\ preWarmBlocksRemaining' = pendingPrewarm
  /\ fadeFramesRemaining' = pendingFade
  /\ totalFadeFrames' = pendingFade
  /\ consumedSeq' = pendingSeq
  /\ pendingEngine' = NoEngine
  /\ pendingPrewarm' = 0
  /\ pendingFade' = 0
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED << writesEnabled, currentEngine, swapRequests, lastReqEngine,
                 pendingSeq, pendingOverwrites, pendingClears, noOpRequests, completedSwaps, hasTicket >>

\* Core RT steps
StepSpawn ==
  /\ phase = "spawn"
  /\ hasTicket = TRUE
  /\ phase' = "prime"
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED << writesEnabled, hasTicket, preWarmBlocksRemaining, fadeFramesRemaining, totalFadeFrames,
                 currentEngine, nextEngine,
                 pendingEngine, pendingPrewarm, pendingFade, pendingSeq, consumedSeq,
                 swapRequests, lastReqEngine,
                 swapsStarted, pendingOverwrites, pendingClears, noOpRequests, completedSwaps >>

StepPrime ==
  /\ phase = "prime"
  /\ hasTicket = TRUE
  /\ phase' = IF preWarmBlocksRemaining > 0 THEN "prewarm" ELSE "crossfade"
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED << writesEnabled, hasTicket, preWarmBlocksRemaining, fadeFramesRemaining, totalFadeFrames,
                 currentEngine, nextEngine,
                 pendingEngine, pendingPrewarm, pendingFade, pendingSeq, consumedSeq,
                 swapRequests, lastReqEngine,
                 swapsStarted, pendingOverwrites, pendingClears, noOpRequests, completedSwaps >>

StepPrewarm ==
  /\ phase = "prewarm"
  /\ hasTicket = TRUE
  /\ preWarmBlocksRemaining > 0
  /\ preWarmBlocksRemaining' = preWarmBlocksRemaining - 1
  /\ phase' = IF preWarmBlocksRemaining' = 0 THEN "crossfade" ELSE "prewarm"
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED << writesEnabled, hasTicket, fadeFramesRemaining, totalFadeFrames,
                 currentEngine, nextEngine,
                 pendingEngine, pendingPrewarm, pendingFade, pendingSeq, consumedSeq,
                 swapRequests, lastReqEngine,
                 swapsStarted, pendingOverwrites, pendingClears, noOpRequests, completedSwaps >>

StepCrossfade ==
  /\ phase = "crossfade"
  /\ hasTicket = TRUE
  /\ fadeFramesRemaining > 0
  /\ fadeFramesRemaining' =
       IF fadeFramesRemaining > BLOCK_FRAMES
       THEN fadeFramesRemaining - BLOCK_FRAMES
       ELSE 0
  /\ phase' = IF fadeFramesRemaining' = 0 THEN "retire" ELSE "crossfade"
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED << writesEnabled, hasTicket, preWarmBlocksRemaining, totalFadeFrames,
                 currentEngine, nextEngine,
                 pendingEngine, pendingPrewarm, pendingFade, pendingSeq, consumedSeq,
                 swapRequests, lastReqEngine,
                 swapsStarted, pendingOverwrites, pendingClears, noOpRequests, completedSwaps >>

(*
 * Retire and either:
 *  - chain immediately if pending exists (no idle gap),
 *  - or go idle.
 *)
StepRetireChain ==
  /\ phase = "retire"
  /\ hasTicket = TRUE
  /\ HasPending
  /\ pendingEngine # NoEngine
  /\ pendingEngine # nextEngine
  /\ currentEngine' = nextEngine
  /\ completedSwaps' = Append(completedSwaps, nextEngine)
  /\ nextEngine' = pendingEngine
  /\ phase' = "spawn"
  /\ hasTicket' = TRUE
  /\ preWarmBlocksRemaining' = pendingPrewarm
  /\ fadeFramesRemaining' = pendingFade
  /\ totalFadeFrames' = pendingFade
  /\ swapsStarted' = swapsStarted + 1
  /\ consumedSeq' = pendingSeq
  /\ pendingEngine' = NoEngine
  /\ pendingPrewarm' = 0
  /\ pendingFade' = 0
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED << writesEnabled, pendingSeq, swapRequests, lastReqEngine,
                 pendingOverwrites, pendingClears, noOpRequests >>

StepRetireToIdle ==
  /\ phase = "retire"
  /\ hasTicket = TRUE
  /\ phase' = "idle"
  /\ hasTicket' = FALSE
  /\ preWarmBlocksRemaining' = 0
  /\ fadeFramesRemaining' = 0
  /\ totalFadeFrames' = 0
  /\ currentEngine' = nextEngine
  /\ nextEngine' = NoEngine
  /\ completedSwaps' = Append(completedSwaps, nextEngine)
  /\ stepIndex' = stepIndex + 1
  \* Defensive: if a pending exists that matches nextEngine, consume & clear it.
  /\ IF HasPending /\ pendingEngine = nextEngine
     THEN
       /\ noOpRequests' = noOpRequests + 1
       /\ consumedSeq' = pendingSeq
       /\ pendingEngine' = NoEngine
       /\ pendingPrewarm' = 0
       /\ pendingFade' = 0
     ELSE
       /\ UNCHANGED << noOpRequests, consumedSeq, pendingEngine, pendingPrewarm, pendingFade >>
  /\ UNCHANGED << writesEnabled, pendingSeq, swapRequests, lastReqEngine,
                 swapsStarted, pendingOverwrites, pendingClears >>

StepIdle ==
  /\ phase = "idle"
  /\ hasTicket = FALSE
  /\ UNCHANGED vars

Next ==
  \/ \E e \in Engines, p \in 0..MAX_PREWARM_BLOCKS, f \in 1..MAX_FADE_FRAMES :
       RequestSwap(e, p, f)
  \/ DisableWrites
  \/ ConsumePendingEarly
  \/ AbortCrossfadeToPending
  \/ StepSpawn
  \/ StepPrime
  \/ StepPrewarm
  \/ StepCrossfade
  \/ StepRetireChain
  \/ StepRetireToIdle
  \/ StepIdle

\* Fairness: force the RT steps to progress when enabled.
Fairness ==
  /\ WF_vars(StepSpawn)
  /\ WF_vars(StepPrime)
  /\ WF_vars(StepPrewarm)
  /\ WF_vars(StepCrossfade)
  /\ WF_vars(StepRetireChain)
  /\ WF_vars(StepRetireToIdle)

Spec ==
  Init /\ [][Next]_vars /\ Fairness

(*
 * Liveness contract we actually care about:
 * Once the host stops writing, we eventually become idle on the last requested engine.
 *)
ConvergesToLastAfterDisable ==
  [](writesEnabled = FALSE /\ swapRequests > 0 =>
      <>(phase = "idle" /\ currentEngine = lastReqEngine))

THEOREM Spec => []TypeOK
THEOREM Spec => []TicketConsistency
THEOREM Spec => []AtMostTwoEngines
THEOREM Spec => []NoGapDuringCrossfade
THEOREM Spec => []CrossfadeEnginesDistinct
THEOREM Spec => []AccountingOK
THEOREM Spec => ConvergesToLastAfterDisable

====

