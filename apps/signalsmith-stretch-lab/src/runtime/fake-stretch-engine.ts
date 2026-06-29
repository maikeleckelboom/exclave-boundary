import {
  readProcessedLevels,
  readRuntimeStatus,
  readSourceStatus,
  type StretchBoundarySession,
} from "../boundary/session";
import {
  ADAPTER_MODES,
  defaultDesiredControls,
  defaultSimulatedSource,
  enumIndex,
  enumLabel,
  PROBE_STATES,
  RUNTIME_STATES,
  SOURCE_STATES,
  STRETCH_PRESETS,
  type DesiredStretchControls,
  type ProcessedLevelsSnapshot,
  type RuntimeState,
  type RuntimeStatusSnapshot,
  type SimulatedSource,
  type SourceState,
  type SourceStatusSnapshot,
} from "../types";

import type {
  StretchCommand,
  StretchCommandTransport,
} from "../boundary/commands";

export interface FakeStretchEngineOptions {
  readonly applyDelayTicks?: number;
  readonly sessionId?: number;
  readonly source?: SimulatedSource;
}

export interface TickOptions {
  readonly renderQuantum?: number;
}

export interface FakeStretchTickResult {
  readonly levels: ProcessedLevelsSnapshot;
  readonly pendingDesiredSequence: number | null;
  readonly runtime: RuntimeStatusSnapshot;
  readonly source: SourceStatusSnapshot;
}

export class FakeStretchEngine {
  private readonly applyDelayTicks: number;
  private readonly historyPeak = new Float32Array(64);
  private readonly historyRms = new Float32Array(64);
  private readonly session: StretchBoundarySession;
  private readonly sessionId: number;
  private readonly transport: StretchCommandTransport;

  private appliedControls: DesiredStretchControls = defaultDesiredControls();
  private fullScaleLeftTotal = 0;
  private fullScaleRightTotal = 0;
  private historyCursor = 0;
  private invalidSampleTotal = 0;
  private invalidTransitionTotal = 0;
  private appliedLoadSequence = 1;
  private decodeErrorCode = 0;
  private droppedBufferTotal = 0;
  private lastAppliedCommandSequence = 0;
  private lastErrorCode = 0;
  private loadSequence = 1;
  private loopEnabled = false;
  private loopEndFrame = 0;
  private loopRevision = 0;
  private loopStartFrame = 0;
  private maxObservedRenderQuantum = 0;
  private outputFrame = 0;
  private pendingControls: DesiredStretchControls | null = null;
  private pendingTicks = 0;
  private runtimeState: RuntimeState = "ready-paused";
  private seekStateTicks = 0;
  private source: SimulatedSource;
  private sourceFrame = 0;
  private sourceRevision = 1;
  private sourceState: SourceState = "accepted";
  private staleReadBursts = 0;
  private staleReadTotal = 0;
  private underrunTotal = 0;
  private unsupportedChannelBlockTotal = 0;

  constructor(
    session: StretchBoundarySession,
    transport: StretchCommandTransport,
    options: FakeStretchEngineOptions = {},
  ) {
    this.session = session;
    this.transport = transport;
    this.applyDelayTicks = options.applyDelayTicks ?? 2;
    this.sessionId = options.sessionId ?? 1;
    this.source = options.source ?? defaultSimulatedSource();
  }

  get currentSource(): SimulatedSource {
    return this.source;
  }

  get lastAppliedDesiredSequence(): number {
    return this.appliedControls.desiredSequence;
  }

  get pendingDesiredSequence(): number | null {
    return this.pendingControls?.desiredSequence ?? null;
  }

  loadSource(source: SimulatedSource): void {
    this.source = source;
    this.loadSequence = (this.loadSequence + 1) >>> 0;
    this.appliedLoadSequence = this.loadSequence;
    this.sourceRevision = (this.sourceRevision + 1) >>> 0;
    this.decodeErrorCode = 0;
    this.outputFrame = 0;
    this.sourceFrame = 0;
    this.loopEnabled = false;
    this.loopStartFrame = 0;
    this.loopEndFrame = 0;
    this.loopRevision = 0;
    this.runtimeState = "ready-paused";
    this.lastErrorCode = 0;
    this.historyPeak.fill(0);
    this.historyRms.fill(0);
    this.sourceState = "accepted";
  }

  publishSourceAttempt(
    state: Exclude<SourceState, "accepted">,
    loadSequence: number,
    errorCode = 0,
  ): void {
    this.loadSequence = loadSequence >>> 0;
    this.decodeErrorCode = errorCode >>> 0;
    this.sourceState = state;
  }

  resetTransportPosition(): void {
    this.outputFrame = 0;
    this.sourceFrame = 0;
    this.runtimeState = "ready-paused";
    this.seekStateTicks = 0;
  }

  simulateStaleRead(count = 1): void {
    this.staleReadBursts += Math.max(1, Math.floor(count));
  }

  setFault(errorCode = 9_001): void {
    this.lastErrorCode = errorCode >>> 0;
    this.runtimeState = "failed-recoverable";
  }

  tick(options: TickOptions = {}): FakeStretchTickResult {
    const renderQuantum = Math.max(1, Math.floor(options.renderQuantum ?? 256));
    this.maxObservedRenderQuantum = Math.max(
      this.maxObservedRenderQuantum,
      renderQuantum,
    );

    this.drainCommands();

    if (this.runtimeState !== "failed-recoverable") {
      this.readDesiredControls();
      this.applyPendingDesired();
      this.advanceTransport(renderQuantum);
    }

    this.publishRuntime(renderQuantum);
    this.publishSourceStatus();
    this.publishLevels(renderQuantum);

    return {
      levels: readProcessedLevels(this.session),
      pendingDesiredSequence: this.pendingDesiredSequence,
      runtime: readRuntimeStatus(this.session),
      source: readSourceStatus(this.session),
    };
  }

  private readDesiredControls(): void {
    if (this.staleReadBursts > 0) {
      this.staleReadBursts -= 1;
      this.staleReadTotal += 1;
      return;
    }

    let nextControls = this.appliedControls;

    this.session.desired.processor.params.within((params) => {
      nextControls = {
        active: params.active,
        blockMs: params.blockMs,
        configSequence: params.configSequence,
        desiredSequence: params.desiredSequence,
        formantBaseHz: params.formantBaseHz,
        formantCompensation: params.formantCompensation,
        formantSemitones: params.formantSemitones,
        intervalMs: params.intervalMs,
        pitchSemitones: params.pitchSemitones,
        preset: enumLabel(STRETCH_PRESETS, params.preset, "default"),
        rate: params.rate,
        splitComputation: params.splitComputation,
        tonalityEnabled: params.tonalityEnabled,
        tonalityHz: params.tonalityHz,
        transitionFrames: params.transitionFrames,
      };
    });

    const desiredChanged =
      nextControls.desiredSequence !== this.appliedControls.desiredSequence;
    const configChanged =
      nextControls.configSequence !== this.appliedControls.configSequence;
    const alreadyPending =
      this.pendingControls?.desiredSequence === nextControls.desiredSequence &&
      this.pendingControls.configSequence === nextControls.configSequence;

    if ((desiredChanged || configChanged) && !alreadyPending) {
      this.pendingControls = nextControls;
      this.pendingTicks = this.applyDelayTicks;
    }
  }

  private applyPendingDesired(): void {
    if (!this.pendingControls) {
      return;
    }

    this.pendingTicks -= 1;
    if (this.pendingTicks > 0) {
      return;
    }

    this.appliedControls = this.pendingControls;
    this.pendingControls = null;
    this.pendingTicks = 0;
  }

  private drainCommands(): void {
    this.transport.drain((command) => {
      this.applyCommand(command);
    });
  }

  private applyCommand(command: StretchCommand): void {
    this.lastAppliedCommandSequence = command.sequence;

    if (this.runtimeState === "failed-recoverable") {
      if (command.name === "resetFault") {
        this.lastErrorCode = 0;
        this.runtimeState = "ready-paused";
      }
      return;
    }

    switch (command.name) {
      case "clearLoop":
        this.loopEnabled = false;
        this.loopRevision += 1;
        break;
      case "configure":
      case "presetCheaper":
      case "presetDefault":
        this.lastAppliedCommandSequence = command.sequence;
        break;
      case "destroy":
        this.runtimeState = "idle";
        break;
      case "flush":
        this.runtimeState = "flushing";
        this.outputFrame += Math.max(0, Math.floor(command.flushOutputFrames));
        break;
      case "loadSource":
        this.sourceRevision = Math.max(
          this.sourceRevision,
          command.sourceRevision >>> 0,
        );
        this.appliedLoadSequence = this.loadSequence;
        this.sourceState = "accepted";
        break;
      case "pause":
        this.runtimeState = "ready-paused";
        break;
      case "play":
        this.runtimeState = "playing";
        break;
      case "reset":
        this.resetTransportPosition();
        this.lastErrorCode = 0;
        break;
      case "resetFault":
        this.lastErrorCode = 0;
        this.runtimeState = "ready-paused";
        break;
      case "seek":
        this.seekToFrame(command.targetSourceFrame);
        break;
      case "setLoop":
        this.setLoop(
          command.loopStartFrame,
          command.loopEndFrame,
          command.sequence,
        );
        break;
      case "stop":
        this.resetTransportPosition();
        break;
    }
  }

  private seekToFrame(frame: number): void {
    const target = clamp(frame, 0, this.source.frames);
    this.sourceFrame = target;
    this.outputFrame = target / Math.max(0.05, this.appliedControls.rate);
    this.seekStateTicks = 2;
  }

  private setLoop(
    startFrame: number,
    endFrame: number,
    revision: number,
  ): void {
    const start = clamp(startFrame, 0, this.source.frames);
    const end = clamp(endFrame, 0, this.source.frames);

    if (end <= start) {
      this.invalidTransitionTotal += 1;
      return;
    }

    this.loopEnabled = true;
    this.loopStartFrame = start;
    this.loopEndFrame = end;
    this.loopRevision = revision >>> 0;
  }

  private advanceTransport(renderQuantum: number): void {
    if (this.seekStateTicks > 0) {
      this.seekStateTicks -= 1;
      return;
    }

    if (this.runtimeState !== "playing") {
      return;
    }

    this.outputFrame += renderQuantum;
    this.sourceFrame +=
      renderQuantum * Math.max(0.05, this.appliedControls.rate);

    if (this.loopEnabled && this.sourceFrame >= this.loopEndFrame) {
      const loopLength = Math.max(1, this.loopEndFrame - this.loopStartFrame);
      const loopOffset = (this.sourceFrame - this.loopStartFrame) % loopLength;
      this.sourceFrame = this.loopStartFrame + loopOffset;
    }

    if (!this.loopEnabled && this.sourceFrame >= this.source.frames) {
      this.sourceFrame = this.source.frames;
      this.runtimeState = "ended";
    }
  }

  private publishRuntime(renderQuantum: number): void {
    const state = this.stateForPublish();
    const config = resolveSimulatorConfig(this.appliedControls, this.source);
    const effectiveRate = Math.max(0.05, this.appliedControls.rate);
    const audioWorkletFrame = splitU64(this.outputFrame);
    const bufferReadyFrames = clamp(
      this.source.frames - Math.floor(this.sourceFrame),
      0,
      0xffffffff,
    );

    this.session.runtime.processor.meters.publish((writer) => {
      writer.set("adapterMode", enumIndex(ADAPTER_MODES, "simulator"));
      writer.set("audioWorkletFrameHi", audioWorkletFrame.hi);
      writer.set("audioWorkletFrameLo", audioWorkletFrame.lo);
      writer.set(
        "audioWorkletTimeSeconds",
        this.outputFrame / this.source.sampleRate,
      );
      writer.set("blockSamples", config.blockSamples);
      writer.set("bufferReadyFrames", bufferReadyFrames);
      writer.set("bufferLengthFrames", config.bufferLengthFrames);
      writer.set("commandDroppedTotal", this.transport.stats().dropped);
      writer.set("durationFrames", this.source.frames);
      writer.set("durationSeconds", this.source.durationSeconds);
      writer.set("effectiveRate", effectiveRate);
      writer.set("heapGeneration", 0);
      writer.set("inputLatencyFrames", config.inputLatencyFrames);
      writer.set("inputLatencySeconds", config.inputLatencySeconds);
      writer.set("intervalSamples", config.intervalSamples);
      writer.set("invalidSampleTotal", this.invalidSampleTotal);
      writer.set("invalidTransitionTotal", this.invalidTransitionTotal);
      writer.set("lastAppliedCommandSequence", this.lastAppliedCommandSequence);
      writer.set(
        "lastAppliedConfigSequence",
        this.appliedControls.configSequence,
      );
      writer.set(
        "lastAppliedDesiredSequence",
        this.appliedControls.desiredSequence,
      );
      writer.set("lastErrorCode", this.lastErrorCode);
      writer.set("loopEnabled", this.loopEnabled);
      writer.set("loopEndFrame", this.loopEndFrame);
      writer.set("loopRevision", this.loopRevision);
      writer.set("loopStartFrame", this.loopStartFrame);
      writer.set("maxObservedRenderQuantum", this.maxObservedRenderQuantum);
      writer.set("outputFrame", this.outputFrame);
      writer.set("outputLatencyFrames", config.outputLatencyFrames);
      writer.set("outputLatencySeconds", config.outputLatencySeconds);
      writer.set(
        "processingCenterFrame",
        this.sourceFrame + (renderQuantum * effectiveRate) / 2,
      );
      writer.set("sessionId", this.sessionId);
      writer.set("sourceFrame", this.sourceFrame);
      writer.set("staleReadTotal", this.staleReadTotal);
      writer.set("state", enumIndex(RUNTIME_STATES, state));
      writer.set("underrunTotal", this.underrunTotal);
      writer.set("workletGeneration", 0);
    });
  }

  private publishSourceStatus(): void {
    this.session.source.processor.meters.publish((writer) => {
      writer.set("appliedLoadSequence", this.appliedLoadSequence);
      writer.set("bufferEndFrame", this.source.frames);
      writer.set("bufferStartFrame", 0);
      writer.set("channelCount", this.source.channels);
      writer.set("decodeErrorCode", this.decodeErrorCode);
      writer.set("droppedBufferTotal", this.droppedBufferTotal);
      writer.set("durationFrames", this.source.frames);
      writer.set("durationSeconds", this.source.durationSeconds);
      writer.set("loadSequence", this.loadSequence);
      writer.set("memoryBytes", this.source.memoryBytes);
      writer.set("sampleRate", this.source.sampleRate);
      writer.set("sourceRevision", this.sourceRevision);
      writer.set("state", enumIndex(SOURCE_STATES, this.sourceState));
    });
  }

  private publishLevels(renderQuantum: number): void {
    const state = this.stateForPublish();
    const active = state === "playing" || state === "seeking";
    const failed =
      state === "failed-recoverable" || state === "failed-terminal";
    const phase = (this.sourceFrame / this.source.sampleRate) * Math.PI * 2;
    const motion = Math.abs(Math.sin(phase * 0.77));
    const pitchLift = Math.min(
      0.18,
      Math.abs(this.appliedControls.pitchSemitones) / 48,
    );
    const formantLift = Math.min(
      0.1,
      Math.abs(this.appliedControls.formantSemitones) / 96,
    );
    const clipNow =
      active &&
      this.outputFrame > 0 &&
      Math.floor(this.outputFrame / 4_096) % 17 === 8;
    const peakLeft = active
      ? Math.min(clipNow ? 1.04 : 0.98, 0.18 + motion * 0.62 + pitchLift)
      : 0;
    const peakRight =
      this.source.channels === 2
        ? Math.min(clipNow ? 1.02 : 0.95, peakLeft * 0.92 + formantLift)
        : 0;
    const rmsLeft = active ? peakLeft * 0.58 : 0;
    const rmsRight = this.source.channels === 2 ? peakRight * 0.56 : 0;

    if (clipNow) {
      this.fullScaleLeftTotal += 1;
      if (this.source.channels === 2) {
        this.fullScaleRightTotal += 1;
      }
    }

    this.historyRms[this.historyCursor] = rmsLeft;
    this.historyPeak[this.historyCursor] = Math.max(peakLeft, peakRight);
    this.historyCursor = (this.historyCursor + 1) % this.historyRms.length;

    this.session.levels.processor.meters.publish((writer) => {
      writer.set("channelCount", this.source.channels);
      writer.set("clipLatched", this.fullScaleLeftTotal > 0);
      writer.set("fullScaleLeftTotal", this.fullScaleLeftTotal);
      writer.set("fullScaleRightTotal", this.fullScaleRightTotal);
      writer.set("invalidSampleTotal", this.invalidSampleTotal);
      writer.set("lastErrorCode", failed ? this.lastErrorCode : 0);
      writer.set("maxAbsWindow", Math.max(peakLeft, peakRight));
      writer.set("outputBranchActive", active);
      writer.set("peakLeft", peakLeft);
      writer.set("peakRight", peakRight);
      writer.set(
        "probeState",
        enumIndex(
          PROBE_STATES,
          failed ? "failed" : active ? "active" : "ready",
        ),
      );
      writer.set("rmsLeft", rmsLeft);
      writer.set("rmsRight", rmsRight);
      writer.set("referenceBranchActive", active);
      writer.set("silent", !active || rmsLeft < 0.001);
      writer.set(
        "unsupportedChannelBlockTotal",
        this.unsupportedChannelBlockTotal,
      );
      writer.set("windowEndOutputFrame", this.outputFrame);
      writer.set("windowFrames", renderQuantum);
      writer.stage("historyPeak", (history) => {
        history.set(this.historyPeak);
      });
      writer.stage("historyRms", (history) => {
        history.set(this.historyRms);
      });
    });
  }

  private stateForPublish(): RuntimeState {
    if (this.runtimeState === "failed-recoverable") {
      return "failed-recoverable";
    }

    if (this.seekStateTicks > 0) {
      return "seeking";
    }

    return this.runtimeState;
  }
}

interface SimulatorConfig {
  readonly blockSamples: number;
  readonly bufferLengthFrames: number;
  readonly inputLatencyFrames: number;
  readonly inputLatencySeconds: number;
  readonly intervalSamples: number;
  readonly outputLatencyFrames: number;
  readonly outputLatencySeconds: number;
}

function resolveSimulatorConfig(
  controls: DesiredStretchControls,
  source: SimulatedSource,
): SimulatorConfig {
  const sampleRate = Math.max(1, source.sampleRate);
  const presetBlockMs = controls.preset === "cheaper" ? 240 : 120;
  const blockMs =
    controls.blockMs > 0
      ? controls.blockMs
      : controls.preset === "custom"
        ? 0
        : presetBlockMs;
  const intervalMs =
    controls.intervalMs > 0
      ? controls.intervalMs
      : blockMs > 0
        ? blockMs / 4
        : 0;
  const blockSamples = clamp(
    Math.round((sampleRate * blockMs) / 1_000),
    0,
    0xffffffff,
  );
  const intervalSamples = clamp(
    Math.round((sampleRate * intervalMs) / 1_000),
    0,
    0xffffffff,
  );
  const inputLatencyFrames = blockSamples;
  const outputLatencyFrames = intervalSamples;

  return {
    blockSamples,
    bufferLengthFrames: clamp(
      inputLatencyFrames + outputLatencyFrames,
      0,
      0xffffffff,
    ),
    inputLatencyFrames,
    inputLatencySeconds: inputLatencyFrames / sampleRate,
    intervalSamples,
    outputLatencyFrames,
    outputLatencySeconds: outputLatencyFrames / sampleRate,
  };
}

function splitU64(value: number): { readonly hi: number; readonly lo: number } {
  const whole = Math.max(0, Math.floor(value));

  return {
    hi: Math.floor(whole / 0x100000000) >>> 0,
    lo: whole >>> 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}
