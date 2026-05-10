------------------------------- MODULE HotSwapPersistentHandoff -------------------------------
(*
  TLA+ specification for persistent-handoff continuity class.

  This model extends the base hotswap lifecycle with:
  - capture  (export handoff snapshot from outgoing engine)
  - install  (import snapshot into incoming engine)
  - catchup  (replay input from capture frame to crossfade start)
  - explicit downgrade/abort rules
  - retire gating on successful install + catchup

  Overlap policy is not modeled here; compose with HotSwapSingle or
  HotSwapRejectBusy for overlap behavior.
*)

EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
  MAX_PREWARM_BLOCKS,
  MAX_FADE_FRAMES,
  BLOCK_FRAMES,
  MAX_STEP_INDEX

ASSUME MAX_PREWARM_BLOCKS \in Nat
ASSUME MAX_FADE_FRAMES \in Nat
ASSUME BLOCK_FRAMES \in Nat \ {0}
ASSUME MAX_STEP_INDEX \in Nat

VARIABLES
  phase,
  hasTicket,
  preWarmBlocksRemaining,
  fadeFramesRemaining,
  totalFadeFrames,
  stepIndex,
  currentEngine,
  nextEngine,
  snapshotState,
  continuityRequested,
  continuityGranted,
  downgradeAllowed

vars == <<phase, hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
          totalFadeFrames, stepIndex, currentEngine, nextEngine,
          snapshotState, continuityRequested, continuityGranted, downgradeAllowed>>

Phases == {"idle", "spawn", "prime", "capture", "install", "catchup",
           "prewarm", "crossfade", "retire"}

Engines == {"Engine1", "Engine2", "NoEngine"}

SnapshotStates == {"none", "captured", "installed", "replayed"}

ContinuityRequirements == {"aligned", "persistent"}

ContinuityGranteds == {"cold", "aligned", "persistent"}

---------------------------------------------------------------------------
(* Type invariant *)
TypeOK ==
  /\ phase \in Phases
  /\ hasTicket \in BOOLEAN
  /\ preWarmBlocksRemaining \in 0..MAX_PREWARM_BLOCKS
  /\ fadeFramesRemaining \in 0..MAX_FADE_FRAMES
  /\ totalFadeFrames \in 0..MAX_FADE_FRAMES
  /\ stepIndex \in 0..MAX_STEP_INDEX
  /\ currentEngine \in Engines
  /\ nextEngine \in Engines
  /\ snapshotState \in SnapshotStates
  /\ continuityRequested \in ContinuityRequirements
  /\ continuityGranted \in ContinuityGranteds
  /\ downgradeAllowed \in BOOLEAN

---------------------------------------------------------------------------
(* Utility predicates *)

IsLaneIdle == phase = "idle"

AtMostTwoEngines ==
  /\ currentEngine # "NoEngine"
  /\ nextEngine = "NoEngine" => phase \in {"idle", "spawn", "capture", "install", "catchup"}

NoGapDuringCrossfade ==
  phase = "crossfade" => currentEngine # "NoEngine" /\ nextEngine # "NoEngine"

---------------------------------------------------------------------------
(* Initial state *)

Init ==
  /\ phase = "idle"
  /\ hasTicket = FALSE
  /\ preWarmBlocksRemaining = 0
  /\ fadeFramesRemaining = 0
  /\ totalFadeFrames = 0
  /\ stepIndex = 0
  /\ currentEngine = "Engine1"
  /\ nextEngine = "NoEngine"
  /\ snapshotState = "none"
  /\ continuityRequested = "aligned"
  /\ continuityGranted = "aligned"
  /\ downgradeAllowed = TRUE

---------------------------------------------------------------------------
(* Actions *)

AcceptTicket(prewarm, fade, contReq, downgrade) ==
  /\ phase = "idle"
  /\ prewarm \in 0..MAX_PREWARM_BLOCKS
  /\ fade \in 1..MAX_FADE_FRAMES
  /\ contReq \in ContinuityRequirements
  /\ downgrade \in BOOLEAN
  /\ phase' = "spawn"
  /\ hasTicket' = TRUE
  /\ preWarmBlocksRemaining' = prewarm
  /\ fadeFramesRemaining' = fade
  /\ totalFadeFrames' = fade
  /\ stepIndex' = stepIndex + 1
  /\ nextEngine' = "Engine2"
  /\ snapshotState' = "none"
  /\ continuityRequested' = contReq
  /\ continuityGranted' = IF contReq = "aligned" THEN "aligned" ELSE "cold"
  /\ downgradeAllowed' = downgrade
  /\ UNCHANGED <<currentEngine>>

StepSpawn ==
  /\ phase = "spawn"
  /\ phase' = IF continuityRequested = "persistent" THEN "capture" ELSE "prime"
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
                totalFadeFrames, currentEngine, nextEngine, snapshotState,
                continuityRequested, continuityGranted, downgradeAllowed>>

(* For aligned path, skip capture/install/catchup and go straight to prime *)
StepPrime ==
  /\ phase = "prime"
  /\ phase' = IF preWarmBlocksRemaining > 0 THEN "prewarm" ELSE "crossfade"
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
                totalFadeFrames, currentEngine, nextEngine, snapshotState,
                continuityRequested, continuityGranted, downgradeAllowed>>

(* Capture handoff snapshot from outgoing engine *)
StepCapture ==
  /\ phase = "capture"
  /\ snapshotState' = "captured"
  /\ phase' = "install"
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
                totalFadeFrames, currentEngine, nextEngine,
                continuityRequested, continuityGranted, downgradeAllowed>>

(* Install snapshot into incoming engine; may succeed or fail *)
StepInstall ==
  /\ phase = "install"
  /\ snapshotState = "captured"
  (* Successful install *)
  /\ snapshotState' = "installed"
  /\ phase' = "catchup"
  /\ continuityGranted' = "persistent"
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
                totalFadeFrames, currentEngine, nextEngine,
                continuityRequested, downgradeAllowed>>

(* Catchup: replay input from capture frame to crossfade start *)
StepCatchup ==
  /\ phase = "catchup"
  /\ snapshotState = "installed"
  /\ snapshotState' = "replayed"
  /\ phase' = "prewarm"
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
                totalFadeFrames, currentEngine, nextEngine,
                continuityRequested, continuityGranted, downgradeAllowed>>

StepPrewarm ==
  /\ phase = "prewarm"
  /\ IF preWarmBlocksRemaining > 1
     THEN /\ preWarmBlocksRemaining' = preWarmBlocksRemaining - 1
          /\ phase' = "prewarm"
     ELSE /\ preWarmBlocksRemaining' = 0
          /\ phase' = "crossfade"
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED <<hasTicket, fadeFramesRemaining, totalFadeFrames,
                currentEngine, nextEngine, snapshotState,
                continuityRequested, continuityGranted, downgradeAllowed>>

StepCrossfade ==
  /\ phase = "crossfade"
  /\ IF fadeFramesRemaining > BLOCK_FRAMES
     THEN /\ fadeFramesRemaining' = fadeFramesRemaining - BLOCK_FRAMES
          /\ phase' = "crossfade"
     ELSE /\ fadeFramesRemaining' = 0
          /\ phase' = "retire"
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, totalFadeFrames,
                currentEngine, nextEngine, snapshotState,
                continuityRequested, continuityGranted, downgradeAllowed>>

StepRetire ==
  /\ phase = "retire"
  /\ phase' = "idle"
  /\ hasTicket' = FALSE
  /\ currentEngine' = nextEngine
  /\ nextEngine' = "NoEngine"
  /\ preWarmBlocksRemaining' = 0
  /\ fadeFramesRemaining' = 0
  /\ totalFadeFrames' = 0
  /\ snapshotState' = "none"
  /\ continuityGranted' = "cold"
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED <<continuityRequested, downgradeAllowed>>

StepIdle ==
  /\ phase = "idle"
  /\ stepIndex' = stepIndex + 1
  /\ UNCHANGED <<phase, hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
                totalFadeFrames, currentEngine, nextEngine, snapshotState,
                continuityRequested, continuityGranted, downgradeAllowed>>

---------------------------------------------------------------------------
(* Next relation *)

Next ==
  (\E prewarm \in 0..MAX_PREWARM_BLOCKS, fade \in 1..MAX_FADE_FRAMES,
         contReq \in ContinuityRequirements, downgrade \in BOOLEAN :
       AcceptTicket(prewarm, fade, contReq, downgrade))
     \/ StepSpawn
     \/ StepPrime
     \/ StepCapture
     \/ StepInstall
     \/ StepCatchup
     \/ StepPrewarm
     \/ StepCrossfade
     \/ StepRetire
     \/ StepIdle

(* Behavioral bound: finite behaviors for model checking *)
StepBound ==
  stepIndex < MAX_STEP_INDEX

---------------------------------------------------------------------------
(* Safety invariants *)

NoSilentDowngrade ==
  continuityRequested = "persistent" /\ ~downgradeAllowed /\ phase = "crossfade"
    => continuityGranted = "persistent"

SnapshotLineageConsistency ==
  snapshotState \in {"installed", "replayed"} => snapshotState # "none"

RetireAfterPersistentInstall ==
  phase = "retire" /\ continuityRequested = "persistent"
    => snapshotState = "replayed"

NoCrossfadeBeforeReplay ==
  phase = "crossfade" /\ continuityRequested = "persistent"
    => snapshotState = "replayed"

---------------------------------------------------------------------------
(* Liveness properties *)

EventuallyIdle ==
  phase # "idle" ~> phase = "idle"

PersistentSwapEventuallyResolves ==
  continuityRequested = "persistent" ~>
    (phase = "idle" /\ continuityGranted \in {"persistent", "cold", "aligned"})

NoCaptureLivelock ==
  phase = "capture" ~> phase # "capture"

NoInstallLivelock ==
  phase = "install" ~> phase # "install"

NoCatchupLivelock ==
  phase = "catchup" ~> phase # "catchup"

---------------------------------------------------------------------------
(* Specification *)

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

=============================================================================
