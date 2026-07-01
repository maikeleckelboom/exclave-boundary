import {
  acceptHandoff,
  allocatePacked,
  bindController,
  bindObserver,
  bindProcessor,
  BoundaryError,
  buildHandoff,
  isBoundaryError,
  planLayout,
  verifyHandoff,
  type ControllerBinding,
  type Handoff,
  type ObserverBinding,
  type ProcessorBinding,
  type SpecInput,
} from "@exclave/boundary";

import {
  ADAPTER_MODES,
  defaultDesiredControls,
  enumLabel,
  PROBE_STATES,
  RUNTIME_STATES,
  SOURCE_STATES,
  type DesiredStretchControls,
  type ProcessedLevelsSnapshot,
  type RuntimeStatusSnapshot,
  type SourceStatusSnapshot,
} from "../types";
import { signalsmithStretchSpec } from "./specs";

export interface BoundaryPlanSummary {
  readonly bytesTotal: number;
  readonly handoffPacking: "packed" | "partitioned";
  readonly handoffVersion: number;
  readonly hash: string;
  readonly id: string;
  readonly lockStrideBytes: number;
  readonly meterVersion: number;
  readonly paramVersion: number;
  readonly planes: BoundaryPlaneByteLengths;
}

export interface BoundaryPlaneByteLengths {
  readonly MF32: number;
  readonly MF64: number;
  readonly MU: number;
  readonly MU32: number;
  readonly PB: number;
  readonly PF32: number;
  readonly PI32: number;
  readonly PU: number;
}

interface AppBoundarySession<S extends SpecInput> {
  readonly controller: ControllerBinding<S>;
  readonly handoff: Handoff<S>;
  readonly observer: ObserverBinding<S>;
  readonly plan: ReturnType<typeof planLayout<S>>;
  readonly processor: ProcessorBinding<S>;
}

export interface StretchBoundarySession {
  readonly stretch: AppBoundarySession<typeof signalsmithStretchSpec>;
}

function createAppBoundarySession<const S extends SpecInput>(
  spec: S,
): AppBoundarySession<S> {
  const plan = planLayout(spec);
  const backing = allocatePacked(plan);
  const controller = bindController(spec, plan, backing, {
    params: { rangePolicy: "clamp" },
  });
  const handoff = buildHandoff(plan, backing);
  const accepted = acceptHandoff(handoff);

  verifyHandoff(plan, accepted.plan);

  const processor = bindProcessor(accepted);
  const observer = bindObserver(accepted);

  return { controller, handoff, observer, plan, processor };
}

export function createStretchBoundarySession(): StretchBoundarySession {
  return {
    stretch: createAppBoundarySession(signalsmithStretchSpec),
  };
}

export function disposeStretchBoundarySession(
  session: StretchBoundarySession,
): void {
  session.stretch.controller.dispose();
  session.stretch.processor.dispose();
  session.stretch.observer.dispose();
}

export function initializeDesiredControls(
  session: StretchBoundarySession,
  controls: DesiredStretchControls = defaultDesiredControls(),
): void {
  writeDesiredControls(session, controls);
}

export function writeDesiredControls(
  session: StretchBoundarySession,
  controls: DesiredStretchControls,
): void {
  session.stretch.controller.params.update({
    "config.blockMs": controls.blockMs,
    "config.configSequence": controls.configSequence,
    "config.intervalMs": controls.intervalMs,
    "config.preset": controls.preset,
    "config.splitComputation": controls.splitComputation,
    "control.active": controls.active,
    "control.desiredSequence": controls.desiredSequence,
    "control.formantBaseHz": controls.formantBaseHz,
    "control.formantCompensation": controls.formantCompensation,
    "control.formantSemitones": controls.formantSemitones,
    "control.pitchSemitones": controls.pitchSemitones,
    "control.rate": controls.rate,
    "control.tonalityEnabled": controls.tonalityEnabled,
    "control.tonalityHz": controls.tonalityHz,
    "control.transitionFrames": controls.transitionFrames,
  });
}

export function readDesiredControls(
  session: StretchBoundarySession,
): DesiredStretchControls {
  const snapshot = session.stretch.observer.params.snapshot();

  return {
    active: snapshot["control.active"],
    blockMs: snapshot["config.blockMs"],
    configSequence: snapshot["config.configSequence"],
    desiredSequence: snapshot["control.desiredSequence"],
    formantBaseHz: snapshot["control.formantBaseHz"],
    formantCompensation: snapshot["control.formantCompensation"],
    formantSemitones: snapshot["control.formantSemitones"],
    intervalMs: snapshot["config.intervalMs"],
    pitchSemitones: snapshot["control.pitchSemitones"],
    preset: snapshot["config.preset"],
    rate: snapshot["control.rate"],
    splitComputation: snapshot["config.splitComputation"],
    tonalityEnabled: snapshot["control.tonalityEnabled"],
    tonalityHz: snapshot["control.tonalityHz"],
    transitionFrames: snapshot["control.transitionFrames"],
  };
}

export function readRuntimeStatus(
  session: StretchBoundarySession,
): RuntimeStatusSnapshot {
  const snapshot = session.stretch.observer.meters.snapshot();
  const stateIndex = snapshot["runtime.state"];
  const adapterModeIndex = snapshot["runtime.adapterMode"];

  return {
    adapterMode: enumLabel(ADAPTER_MODES, adapterModeIndex, "fallback"),
    adapterModeIndex,
    audioWorkletFrameHi: snapshot["runtime.audioWorkletFrameHi"],
    audioWorkletFrameLo: snapshot["runtime.audioWorkletFrameLo"],
    audioWorkletTimeSeconds: snapshot["runtime.audioWorkletTimeSeconds"],
    blockSamples: snapshot["runtime.blockSamples"],
    bufferReadyFrames: snapshot["runtime.bufferReadyFrames"],
    bufferLengthFrames: snapshot["runtime.bufferLengthFrames"],
    commandDroppedTotal: snapshot["runtime.commandDroppedTotal"],
    durationFrames: snapshot["runtime.durationFrames"],
    durationSeconds: snapshot["runtime.durationSeconds"],
    effectiveRate: snapshot["runtime.effectiveRate"],
    heapGeneration: snapshot["runtime.heapGeneration"],
    inputLatencyFrames: snapshot["runtime.inputLatencyFrames"],
    inputLatencySeconds: snapshot["runtime.inputLatencySeconds"],
    inputWindowMissingFrames: snapshot["runtime.inputWindowMissingFrames"],
    intervalSamples: snapshot["runtime.intervalSamples"],
    invalidSampleTotal: snapshot["runtime.invalidSampleTotal"],
    invalidTransitionTotal: snapshot["runtime.invalidTransitionTotal"],
    lastAppliedConfigSequence: snapshot["runtime.lastAppliedConfigSequence"],
    lastAppliedCommandSequence: snapshot["runtime.lastAppliedCommandSequence"],
    lastAppliedDesiredSequence: snapshot["runtime.lastAppliedDesiredSequence"],
    lastErrorCode: snapshot["runtime.lastErrorCode"],
    loopEnabled: snapshot["runtime.loopEnabled"],
    loopEndFrame: snapshot["runtime.loopEndFrame"],
    loopEndMissingFrames: snapshot["runtime.loopEndMissingFrames"],
    loopRevision: snapshot["runtime.loopRevision"],
    loopSourceFrameInside: snapshot["runtime.loopSourceFrameInside"],
    loopStartFrame: snapshot["runtime.loopStartFrame"],
    loopStartMissingFrames: snapshot["runtime.loopStartMissingFrames"],
    maxObservedRenderQuantum: snapshot["runtime.maxObservedRenderQuantum"],
    outputLatencyFrames: snapshot["runtime.outputLatencyFrames"],
    outputLatencySeconds: snapshot["runtime.outputLatencySeconds"],
    outputFrame: snapshot["runtime.outputFrame"],
    processingCenterFrame: snapshot["runtime.processingCenterFrame"],
    sessionId: snapshot["runtime.sessionId"],
    sourceFrame: snapshot["runtime.sourceFrame"],
    staleReadTotal: snapshot["runtime.staleReadTotal"],
    state: enumLabel(RUNTIME_STATES, stateIndex, "idle"),
    stateIndex,
    scheduledCommandDroppedTotal:
      snapshot["runtime.scheduledCommandDroppedTotal"],
    scheduledCommandQueueSize: snapshot["runtime.scheduledCommandQueueSize"],
    underrunTotal: snapshot["runtime.underrunTotal"],
    workletGeneration: snapshot["runtime.workletGeneration"],
  };
}

export function readSourceStatus(
  session: StretchBoundarySession,
): SourceStatusSnapshot {
  const snapshot = session.stretch.observer.meters.snapshot();
  const stateIndex = snapshot["source.state"];

  return {
    appliedLoadSequence: snapshot["source.appliedLoadSequence"],
    bufferEndFrame: snapshot["source.bufferEndFrame"],
    bufferStartFrame: snapshot["source.bufferStartFrame"],
    channelCount: snapshot["source.channelCount"],
    decodeErrorCode: snapshot["source.decodeErrorCode"],
    droppedBufferTotal: snapshot["source.droppedBufferTotal"],
    durationFrames: snapshot["source.durationFrames"],
    durationSeconds: snapshot["source.durationSeconds"],
    loadSequence: snapshot["source.loadSequence"],
    memoryBytes: snapshot["source.memoryBytes"],
    sampleRate: snapshot["source.sampleRate"],
    sourceRevision: snapshot["source.sourceRevision"],
    state: enumLabel(SOURCE_STATES, stateIndex, "none"),
    stateIndex,
  };
}

export function readProcessedLevels(
  session: StretchBoundarySession,
): ProcessedLevelsSnapshot {
  const snapshot = session.stretch.observer.meters.snapshot();
  const probeStateIndex = snapshot["levels.probeState"];

  return {
    channelCount: snapshot["levels.channelCount"],
    clipLatched: snapshot["levels.clipLatched"],
    fullScaleLeftTotal: snapshot["levels.fullScaleLeftTotal"],
    fullScaleRightTotal: snapshot["levels.fullScaleRightTotal"],
    historyPeak: snapshot["levels.historyPeak"],
    historyRms: snapshot["levels.historyRms"],
    invalidSampleTotal: snapshot["levels.invalidSampleTotal"],
    lastErrorCode: snapshot["levels.lastErrorCode"],
    maxAbsWindow: snapshot["levels.maxAbsWindow"],
    outputBranchActive: snapshot["levels.outputBranchActive"],
    peakLeft: snapshot["levels.peakLeft"],
    peakRight: snapshot["levels.peakRight"],
    probeState: enumLabel(PROBE_STATES, probeStateIndex, "uninitialized"),
    probeStateIndex,
    referenceBranchActive: snapshot["levels.referenceBranchActive"],
    rmsLeft: snapshot["levels.rmsLeft"],
    rmsRight: snapshot["levels.rmsRight"],
    silent: snapshot["levels.silent"],
    unsupportedChannelBlockTotal:
      snapshot["levels.unsupportedChannelBlockTotal"],
    windowEndOutputFrame: snapshot["levels.windowEndOutputFrame"],
    windowFrames: snapshot["levels.windowFrames"],
  };
}

function summarizePlan<S extends SpecInput>(
  session: AppBoundarySession<S>,
): BoundaryPlanSummary {
  return {
    bytesTotal: session.plan.bytesTotal,
    handoffPacking: session.handoff.packing,
    handoffVersion: session.handoff.version,
    hash: session.plan.hash,
    id: session.plan.id,
    lockStrideBytes: session.plan.lockStrideBytes,
    meterVersion: session.observer.meters.version(),
    paramVersion: session.observer.params.version(),
    planes: {
      MF32: session.plan.planes.MF32,
      MF64: session.plan.planes.MF64,
      MU: session.plan.planes.MU,
      MU32: session.plan.planes.MU32,
      PB: session.plan.planes.PB,
      PF32: session.plan.planes.PF32,
      PI32: session.plan.planes.PI32,
      PU: session.plan.planes.PU,
    },
  };
}

export function readPlanSummaries(
  session: StretchBoundarySession,
): Readonly<Record<"stretch", BoundaryPlanSummary>> {
  return {
    stretch: summarizePlan(session.stretch),
  };
}

export function describeBoundaryError(error: unknown): string {
  if (error instanceof BoundaryError || isBoundaryError(error)) {
    return `${String(error.code)}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
