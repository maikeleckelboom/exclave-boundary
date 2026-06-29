import {
  readProcessedLevels,
  readRuntimeStatus,
  readSourceStatus,
  type StretchBoundarySession,
} from "../boundary/session";
import { validateLoopRange } from "../loop/loop-validation";
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

    this.session.lab.processor.params.within((params) => {
      nextControls = {
        active: params.control.active,
        blockMs: params.config.blockMs,
        configSequence: params.config.configSequence,
        desiredSequence: params.control.desiredSequence,
        formantBaseHz: params.control.formantBaseHz,
        formantCompensation: params.control.formantCompensation,
        formantSemitones: params.control.formantSemitones,
        intervalMs: params.config.intervalMs,
        pitchSemitones: params.control.pitchSemitones,
        preset: enumLabel(STRETCH_PRESETS, params.config.preset, "default"),
        rate: params.control.rate,
        splitComputation: params.config.splitComputation,
        tonalityEnabled: params.control.tonalityEnabled,
        tonalityHz: params.control.tonalityHz,
        transitionFrames: params.control.transitionFrames,
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
        this.play();
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

  private play(): void {
    if (this.loopEnabled && this.loopEndFrame > this.loopStartFrame) {
      if (
        this.sourceFrame >= this.loopEndFrame ||
        this.sourceFrame >= this.source.frames
      ) {
        this.repositionToFrame(this.loopStartFrame);
      }
    } else if (this.sourceFrame >= this.source.frames) {
      this.repositionToFrame(0);
    }

    this.seekStateTicks = 0;
    this.runtimeState = "playing";
  }

  private repositionToFrame(frame: number): void {
    const target = clamp(frame, 0, this.source.frames);
    this.sourceFrame = target;
    this.outputFrame = target / Math.max(0.05, this.appliedControls.rate);
  }

  private seekToFrame(frame: number): void {
    this.repositionToFrame(frame);
    this.seekStateTicks = 2;
  }

  private setLoop(
    startFrame: number,
    endFrame: number,
    revision: number,
  ): void {
    const start = clamp(startFrame, 0, this.source.frames);
    const end = clamp(endFrame, 0, this.source.frames);
    const validation = validateLoopRange(
      { endFrame: end, startFrame: start },
      resolveSimulatorConfig(this.appliedControls, this.source),
    );

    if (!validation.valid) {
      this.invalidTransitionTotal += 1;
      return;
    }

    this.loopEnabled = true;
    this.loopStartFrame = validation.range.startFrame;
    this.loopEndFrame = validation.range.endFrame;
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

    this.session.lab.processor.meters.publish((writer) => {
      writer.set("runtime.adapterMode", enumIndex(ADAPTER_MODES, "simulator"));
      writer.set("runtime.audioWorkletFrameHi", audioWorkletFrame.hi);
      writer.set("runtime.audioWorkletFrameLo", audioWorkletFrame.lo);
      writer.set(
        "runtime.audioWorkletTimeSeconds",
        this.outputFrame / this.source.sampleRate,
      );
      writer.set("runtime.blockSamples", config.blockSamples);
      writer.set("runtime.bufferReadyFrames", bufferReadyFrames);
      writer.set("runtime.bufferLengthFrames", config.bufferLengthFrames);
      writer.set("runtime.commandDroppedTotal", this.transport.stats().dropped);
      writer.set("runtime.durationFrames", this.source.frames);
      writer.set("runtime.durationSeconds", this.source.durationSeconds);
      writer.set("runtime.effectiveRate", effectiveRate);
      writer.set("runtime.heapGeneration", 0);
      writer.set("runtime.inputLatencyFrames", config.inputLatencyFrames);
      writer.set("runtime.inputLatencySeconds", config.inputLatencySeconds);
      writer.set("runtime.intervalSamples", config.intervalSamples);
      writer.set("runtime.invalidSampleTotal", this.invalidSampleTotal);
      writer.set("runtime.invalidTransitionTotal", this.invalidTransitionTotal);
      writer.set(
        "runtime.lastAppliedCommandSequence",
        this.lastAppliedCommandSequence,
      );
      writer.set(
        "runtime.lastAppliedConfigSequence",
        this.appliedControls.configSequence,
      );
      writer.set(
        "runtime.lastAppliedDesiredSequence",
        this.appliedControls.desiredSequence,
      );
      writer.set("runtime.lastErrorCode", this.lastErrorCode);
      writer.set("runtime.loopEnabled", this.loopEnabled);
      writer.set("runtime.loopEndFrame", this.loopEndFrame);
      writer.set("runtime.loopRevision", this.loopRevision);
      writer.set("runtime.loopStartFrame", this.loopStartFrame);
      writer.set(
        "runtime.maxObservedRenderQuantum",
        this.maxObservedRenderQuantum,
      );
      writer.set("runtime.outputFrame", this.outputFrame);
      writer.set("runtime.outputLatencyFrames", config.outputLatencyFrames);
      writer.set("runtime.outputLatencySeconds", config.outputLatencySeconds);
      writer.set(
        "runtime.processingCenterFrame",
        this.sourceFrame + (renderQuantum * effectiveRate) / 2,
      );
      writer.set("runtime.scheduledCommandDroppedTotal", 0);
      writer.set("runtime.scheduledCommandQueueSize", 0);
      writer.set("runtime.sessionId", this.sessionId);
      writer.set("runtime.sourceFrame", this.sourceFrame);
      writer.set("runtime.staleReadTotal", this.staleReadTotal);
      writer.set("runtime.state", enumIndex(RUNTIME_STATES, state));
      writer.set("runtime.underrunTotal", this.underrunTotal);
      writer.set("runtime.workletGeneration", 0);
    });
  }

  private publishSourceStatus(): void {
    this.session.lab.processor.meters.publish((writer) => {
      writer.set("source.appliedLoadSequence", this.appliedLoadSequence);
      writer.set("source.bufferEndFrame", this.source.frames);
      writer.set("source.bufferStartFrame", 0);
      writer.set("source.channelCount", this.source.channels);
      writer.set("source.decodeErrorCode", this.decodeErrorCode);
      writer.set("source.droppedBufferTotal", this.droppedBufferTotal);
      writer.set("source.durationFrames", this.source.frames);
      writer.set("source.durationSeconds", this.source.durationSeconds);
      writer.set("source.loadSequence", this.loadSequence);
      writer.set("source.memoryBytes", this.source.memoryBytes);
      writer.set("source.sampleRate", this.source.sampleRate);
      writer.set("source.sourceRevision", this.sourceRevision);
      writer.set("source.state", enumIndex(SOURCE_STATES, this.sourceState));
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

    this.session.lab.processor.meters.publish((writer) => {
      writer.set("levels.channelCount", this.source.channels);
      writer.set("levels.clipLatched", this.fullScaleLeftTotal > 0);
      writer.set("levels.fullScaleLeftTotal", this.fullScaleLeftTotal);
      writer.set("levels.fullScaleRightTotal", this.fullScaleRightTotal);
      writer.set("levels.invalidSampleTotal", this.invalidSampleTotal);
      writer.set("levels.lastErrorCode", failed ? this.lastErrorCode : 0);
      writer.set("levels.maxAbsWindow", Math.max(peakLeft, peakRight));
      writer.set("levels.outputBranchActive", active);
      writer.set("levels.peakLeft", peakLeft);
      writer.set("levels.peakRight", peakRight);
      writer.set(
        "levels.probeState",
        enumIndex(
          PROBE_STATES,
          failed ? "failed" : active ? "active" : "ready",
        ),
      );
      writer.set("levels.rmsLeft", rmsLeft);
      writer.set("levels.rmsRight", rmsRight);
      writer.set("levels.referenceBranchActive", active);
      writer.set("levels.silent", !active || rmsLeft < 0.001);
      writer.set(
        "levels.unsupportedChannelBlockTotal",
        this.unsupportedChannelBlockTotal,
      );
      writer.set("levels.windowEndOutputFrame", this.outputFrame);
      writer.set("levels.windowFrames", renderQuantum);
      writer.stage("levels.historyPeak", (history) => {
        history.set(this.historyPeak);
      });
      writer.stage("levels.historyRms", (history) => {
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
