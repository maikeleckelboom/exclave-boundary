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

export const LISTENING_PRESETS = [
  "music-default",
  "voice-formant-experiment",
] as const;

export const TONALITY_LIMIT_DEFAULT_HZ = 8_000;
export const TONALITY_LIMIT_MIN_HZ = 2_000;
export const TONALITY_LIMIT_MAX_HZ = 20_000;
export const FORMANT_SHIFT_DEFAULT_SEMITONES = 0;
export const FORMANT_SHIFT_MIN_SEMITONES = -12;
export const FORMANT_SHIFT_MAX_SEMITONES = 12;
export const FORMANT_BASE_AUTO_HZ = 0;
export const FORMANT_BASE_MANUAL_DEFAULT_HZ = 120;
export const FORMANT_BASE_MIN_HZ = 50;
export const FORMANT_BASE_MAX_HZ = 500;

export type RuntimeState = (typeof RUNTIME_STATES)[number];
export type AdapterMode = (typeof ADAPTER_MODES)[number];
export type ProbeState = (typeof PROBE_STATES)[number];
export type SourceState = (typeof SOURCE_STATES)[number];
export type StretchPreset = (typeof STRETCH_PRESETS)[number];
export type ListeningPreset = (typeof LISTENING_PRESETS)[number];

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

export interface ListeningPresetControls {
  readonly formantBaseHz: number;
  readonly formantCompensation: boolean;
  readonly formantSemitones: number;
  readonly tonalityEnabled: boolean;
  readonly tonalityHz: number;
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
  readonly scheduledCommandDroppedTotal: number;
  readonly scheduledCommandQueueSize: number;
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
    formantBaseHz: FORMANT_BASE_AUTO_HZ,
    formantCompensation: false,
    formantSemitones: FORMANT_SHIFT_DEFAULT_SEMITONES,
    intervalMs: 30,
    pitchSemitones: 0,
    preset: "custom",
    rate: 1,
    splitComputation: true,
    tonalityEnabled: true,
    tonalityHz: TONALITY_LIMIT_DEFAULT_HZ,
    transitionFrames: 2_048,
  };
}

export const LISTENING_PRESET_CONTROLS: Record<
  ListeningPreset,
  ListeningPresetControls
> = {
  "music-default": {
    formantBaseHz: FORMANT_BASE_AUTO_HZ,
    formantCompensation: false,
    formantSemitones: FORMANT_SHIFT_DEFAULT_SEMITONES,
    tonalityEnabled: true,
    tonalityHz: TONALITY_LIMIT_DEFAULT_HZ,
  },
  "voice-formant-experiment": {
    formantBaseHz: FORMANT_BASE_MANUAL_DEFAULT_HZ,
    formantCompensation: false,
    formantSemitones: FORMANT_SHIFT_DEFAULT_SEMITONES,
    tonalityEnabled: true,
    tonalityHz: TONALITY_LIMIT_DEFAULT_HZ,
  },
};

export function clampTonalityLimitHz(value: number): number {
  return clampFinite(value, TONALITY_LIMIT_MIN_HZ, TONALITY_LIMIT_MAX_HZ);
}

export function clampFormantShiftSemitones(value: number): number {
  return clampFinite(
    value,
    FORMANT_SHIFT_MIN_SEMITONES,
    FORMANT_SHIFT_MAX_SEMITONES,
  );
}

export function clampManualFormantBaseHz(value: number): number {
  return clampFinite(value, FORMANT_BASE_MIN_HZ, FORMANT_BASE_MAX_HZ);
}

export function resolveFormantBaseHz(
  mode: "auto" | "manual",
  manualValue: number,
): number {
  return mode === "auto"
    ? FORMANT_BASE_AUTO_HZ
    : clampManualFormantBaseHz(manualValue);
}

export function applyListeningPreset(
  controls: DesiredStretchControls,
  preset: ListeningPreset,
): DesiredStretchControls {
  return {
    ...controls,
    ...LISTENING_PRESET_CONTROLS[preset],
  };
}

export function matchingListeningPreset(
  controls: ListeningPresetControls,
): ListeningPreset | "custom" {
  for (const preset of LISTENING_PRESETS) {
    const candidate = LISTENING_PRESET_CONTROLS[preset];

    if (
      controls.formantBaseHz === candidate.formantBaseHz &&
      controls.formantCompensation === candidate.formantCompensation &&
      controls.formantSemitones === candidate.formantSemitones &&
      controls.tonalityEnabled === candidate.tonalityEnabled &&
      controls.tonalityHz === candidate.tonalityHz
    ) {
      return preset;
    }
  }

  return "custom";
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

function clampFinite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
