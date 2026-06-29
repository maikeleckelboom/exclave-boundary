export const RUNTIME_STATES = [
  "unsupported",
  "idle",
  "ready-paused",
  "playing",
  "seeking",
  "flushing",
  "ended",
  "failed-recoverable",
  "failed-terminal",
] as const;

export const ADAPTER_MODES = ["simulator", "real-worklet", "fallback"] as const;

export const PROBE_STATES = [
  "uninitialized",
  "ready",
  "active",
  "no-input",
  "failed",
] as const;

export const SOURCE_STATES = [
  "none",
  "reading",
  "decoding",
  "decoded",
  "published",
  "accepted",
  "failed",
] as const;

export const STRETCH_PRESETS = ["custom", "default", "cheaper"] as const;

export type RuntimeState = (typeof RUNTIME_STATES)[number];
export type AdapterMode = (typeof ADAPTER_MODES)[number];
export type ProbeState = (typeof PROBE_STATES)[number];
export type SourceState = (typeof SOURCE_STATES)[number];
export type StretchPreset = (typeof STRETCH_PRESETS)[number];

export interface DesiredStretchControls {
  readonly active: boolean;
  readonly blockMs: number;
  readonly configSequence: number;
  readonly desiredSequence: number;
  readonly formantBaseHz: number;
  readonly formantCompensation: boolean;
  readonly formantSemitones: number;
  readonly intervalMs: number;
  readonly pitchSemitones: number;
  readonly preset: StretchPreset;
  readonly rate: number;
  readonly splitComputation: boolean;
  readonly tonalityEnabled: boolean;
  readonly tonalityHz: number;
  readonly transitionFrames: number;
}

export interface SimulatedSource {
  readonly channels: 1 | 2;
  readonly durationSeconds: number;
  readonly frames: number;
  readonly memoryBytes: number;
  readonly name: string;
  readonly sampleRate: number;
  readonly status: "decoded-file" | "deterministic" | "file-metadata";
}

export interface RuntimeStatusSnapshot {
  readonly adapterMode: AdapterMode;
  readonly adapterModeIndex: number;
  readonly audioWorkletFrameHi: number;
  readonly audioWorkletFrameLo: number;
  readonly audioWorkletTimeSeconds: number;
  readonly bufferReadyFrames: number;
  readonly blockSamples: number;
  readonly bufferLengthFrames: number;
  readonly commandDroppedTotal: number;
  readonly durationFrames: number;
  readonly durationSeconds: number;
  readonly effectiveRate: number;
  readonly heapGeneration: number;
  readonly inputLatencyFrames: number;
  readonly inputLatencySeconds: number;
  readonly intervalSamples: number;
  readonly invalidSampleTotal: number;
  readonly invalidTransitionTotal: number;
  readonly lastAppliedCommandSequence: number;
  readonly lastAppliedConfigSequence: number;
  readonly lastAppliedDesiredSequence: number;
  readonly lastErrorCode: number;
  readonly loopEnabled: boolean;
  readonly loopEndFrame: number;
  readonly loopRevision: number;
  readonly loopStartFrame: number;
  readonly maxObservedRenderQuantum: number;
  readonly outputLatencyFrames: number;
  readonly outputLatencySeconds: number;
  readonly outputFrame: number;
  readonly processingCenterFrame: number;
  readonly sessionId: number;
  readonly sourceFrame: number;
  readonly staleReadTotal: number;
  readonly state: RuntimeState;
  readonly stateIndex: number;
  readonly underrunTotal: number;
  readonly workletGeneration: number;
}

export interface SourceStatusSnapshot {
  readonly appliedLoadSequence: number;
  readonly bufferEndFrame: number;
  readonly bufferStartFrame: number;
  readonly channelCount: number;
  readonly decodeErrorCode: number;
  readonly droppedBufferTotal: number;
  readonly durationFrames: number;
  readonly durationSeconds: number;
  readonly loadSequence: number;
  readonly memoryBytes: number;
  readonly sampleRate: number;
  readonly sourceRevision: number;
  readonly state: SourceState;
  readonly stateIndex: number;
}

export interface ProcessedLevelsSnapshot {
  readonly channelCount: number;
  readonly clipLatched: boolean;
  readonly fullScaleLeftTotal: number;
  readonly fullScaleRightTotal: number;
  readonly historyPeak: Readonly<Float32Array>;
  readonly historyRms: Readonly<Float32Array>;
  readonly invalidSampleTotal: number;
  readonly lastErrorCode: number;
  readonly maxAbsWindow: number;
  readonly outputBranchActive: boolean;
  readonly peakLeft: number;
  readonly peakRight: number;
  readonly probeState: ProbeState;
  readonly probeStateIndex: number;
  readonly referenceBranchActive: boolean;
  readonly rmsLeft: number;
  readonly rmsRight: number;
  readonly silent: boolean;
  readonly unsupportedChannelBlockTotal: number;
  readonly windowEndOutputFrame: number;
  readonly windowFrames: number;
}

export interface LoopPreview {
  readonly enabled: boolean;
  readonly endFrame: number;
  readonly revision: number;
  readonly startFrame: number;
}

export function defaultDesiredControls(): DesiredStretchControls {
  return {
    active: false,
    blockMs: 120,
    configSequence: 1,
    desiredSequence: 1,
    formantBaseHz: 0,
    formantCompensation: true,
    formantSemitones: 0,
    intervalMs: 30,
    pitchSemitones: 0,
    preset: "default",
    rate: 1,
    splitComputation: false,
    tonalityEnabled: true,
    tonalityHz: 440,
    transitionFrames: 2_048,
  };
}

export function defaultSimulatedSource(): SimulatedSource {
  const sampleRate = 48_000;
  const durationSeconds = 94;
  const channels = 2;
  const frames = sampleRate * durationSeconds;

  return {
    channels,
    durationSeconds,
    frames,
    memoryBytes: frames * channels * Float32Array.BYTES_PER_ELEMENT,
    name: "Deterministic simulator source",
    sampleRate,
    status: "deterministic",
  };
}

export function enumIndex<const T extends readonly string[]>(
  values: T,
  value: T[number],
): number {
  return values.indexOf(value);
}

export function enumLabel<const T extends readonly string[]>(
  values: T,
  index: number,
  fallback: T[number],
): T[number] {
  return values[index] ?? fallback;
}
