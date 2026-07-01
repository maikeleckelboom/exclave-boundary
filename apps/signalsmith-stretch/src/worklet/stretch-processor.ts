import { SWSR_HEADER_DROPPED, type SwsrRingBacking } from "@exclave/boundary";

import {
  normalizeSeekFrameIntoLoopRange,
  sourceFrameInsideLoopRange,
} from "../loop/loop-normalization";
import { validateLoopRange } from "../loop/loop-validation";
import {
  enumIndex,
  enumLabel,
  FORMANT_BASE_AUTO_HZ,
  FORMANT_SHIFT_DEFAULT_SEMITONES,
  SOURCE_STATES,
  STRETCH_PRESETS,
  TONALITY_LIMIT_DEFAULT_HZ,
  type RuntimeState,
  type StretchPreset,
} from "../types";
import {
  bindStretchWorkletBoundary,
  type StretchWorkletHandoff,
} from "./boundary-bindings";
import { bindWorkletCommandRing } from "./command-ring";
import { LevelProbe } from "./level-probe";
import { STRETCH_PROCESSOR_NAME } from "./processor-name";
import { publishRuntimeMeters } from "./runtime-meters";
import { ScheduledCommandQueue } from "./scheduled-commands";
import { loadSignalsmithStretchModule } from "./signalsmith-module";
import { SourceWindow } from "./source-window";
import {
  calculateSignalsmithSourceWindow,
  type SignalsmithSourceWindow,
} from "./source-window-position";

import type {
  ChunkedWavSourceInfo,
  PlanarFrameChunk,
} from "../audio/chunked-wav-source";
import type { StretchCommand } from "../boundary/commands";
import type { SignalsmithStretchModule } from "../signalsmith/module-types";

declare const currentFrame: number;
declare const currentTime: number;
declare const sampleRate: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}

type AudioWorkletProcessorConstructor = new (
  options: AudioWorkletNodeOptions,
) => AudioWorkletProcessor;

declare function registerProcessor(
  name: string,
  processorCtor: AudioWorkletProcessorConstructor,
): void;

interface StretchProcessorOptions {
  readonly commandRing: SwsrRingBacking;
  readonly handoff: StretchWorkletHandoff;
  readonly initialChunk?: PlanarFrameChunk;
  readonly loadSequence: number;
  readonly moduleUrl: string;
  readonly sourceInfo: ChunkedWavSourceInfo;
  readonly sourceRevision: number;
}

type HostMessage =
  | {
      readonly chunk: PlanarFrameChunk;
      readonly sourceRevision: number;
      readonly type: "sourceChunk";
    }
  | {
      readonly type: "commandsAvailable";
    }
  | {
      readonly command: StretchCommand;
      readonly type: "command";
    }
  | {
      readonly type: "destroy";
    };

class SignalsmithStretchProcessor extends AudioWorkletProcessor {
  private readonly binding: ReturnType<typeof bindStretchWorkletBoundary>;
  private readonly commandConsumer;
  private readonly commandRingBacking: SwsrRingBacking;
  private readonly levelProbe = new LevelProbe();
  private readonly scheduledCommands =
    new ScheduledCommandQueue<StretchCommand>();
  private readonly sourceWindow = new SourceWindow();

  private active = false;
  private blockMs = 120;
  private bufferBaseIndex = 0;
  private bufferLengthFrames = 0;
  private destroyed = false;
  private effectiveRate = 1;
  private failed = false;
  private formantBaseHz = FORMANT_BASE_AUTO_HZ;
  private formantCompensation = false;
  private formantSemitones = FORMANT_SHIFT_DEFAULT_SEMITONES;
  private heapGeneration = 0;
  private inputBuffers: Float32Array[] = [];
  private inputLatencyFrames = 0;
  private intervalMs = 30;
  private intervalSamples = 0;
  private invalidSampleTotal = 0;
  private invalidTransitionTotal = 0;
  private lastInputWindowMissingFrames = 0;
  private lastHeapBuffer: ArrayBufferLike | null = null;
  private lastAppliedCommandSequence = 0;
  private lastAppliedConfigSequence = 0;
  private lastAppliedDesiredSequence = 0;
  private lastErrorCode = 0;
  private loadSequence = 0;
  private loopEnabled = false;
  private loopEndFrame = 0;
  private loopEndMissingFrames = 0;
  private loopRevision = 0;
  private loopStartFrame = 0;
  private loopStartMissingFrames = 0;
  private maxObservedRenderQuantum = 0;
  private module: SignalsmithStretchModule | null = null;
  private outputBuffers: Float32Array[] = [];
  private outputFrame = 0;
  private outputLatencyFrames = 0;
  private pendingCommandDroppedTotal = 0;
  private pitchSemitones = 0;
  private preset: StretchPreset = "default";
  private runtimeState: RuntimeState = "idle";
  private sessionId = 1;
  private sourceFrame = 0;
  private sourceRevision = 0;
  private splitComputation = false;
  private staleReadTotal = 0;
  private tonalityEnabled = true;
  private tonalityHz = TONALITY_LIMIT_DEFAULT_HZ;
  private underrunTotal = 0;
  private unsupportedChannelBlockTotal = 0;
  private workletGeneration = 1;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);

    const processorOptions =
      options.processorOptions as StretchProcessorOptions;
    this.binding = bindStretchWorkletBoundary(processorOptions.handoff);
    this.commandRingBacking = processorOptions.commandRing;
    this.commandConsumer = bindWorkletCommandRing(processorOptions.commandRing);
    this.loadSequence = processorOptions.loadSequence;
    this.sourceRevision = processorOptions.sourceRevision;
    this.sourceWindow.setInfo(processorOptions.sourceInfo);

    if (processorOptions.initialChunk) {
      this.sourceWindow.addChunk(processorOptions.initialChunk);
    }

    this.port.onmessage = (event: MessageEvent<HostMessage>) => {
      this.handleMessage(event.data);
    };

    void this.initializeModule(processorOptions.moduleUrl);
  }

  process(
    _inputs: readonly Float32Array[][],
    outputs: readonly Float32Array[][],
    _parameters: Record<string, Float32Array>,
  ): boolean {
    const output = outputs[0] ?? [];
    const outputFrameCount = output[0]?.length ?? 0;

    if (this.destroyed) {
      silence(output);
      return false;
    }

    this.maxObservedRenderQuantum = Math.max(
      this.maxObservedRenderQuantum,
      outputFrameCount,
    );

    try {
      this.drainCommands();
      this.readDesiredParams();

      if (!this.module || this.failed || output.length === 0) {
        silence(output);
        this.publishAll(output, outputFrameCount, true);
        return true;
      }

      this.ensureConfigured();

      if (!this.active) {
        silence(output);
        this.runtimeState = "ready-paused";
        this.publishAll(output, outputFrameCount, true);
        return true;
      }

      this.runtimeState = "playing";
      this.renderQuantum(output, outputFrameCount);
      this.publishAll(output, outputFrameCount, false);
    } catch (error) {
      this.fail(5_001, error);
      silence(output);
      this.publishAll(output, outputFrameCount, true);
    }

    return true;
  }

  private async initializeModule(moduleUrl: string): Promise<void> {
    try {
      const module = await loadSignalsmithStretchModule(moduleUrl);
      this.module = module;
      module._presetDefault(this.channelCount(), sampleRate);
      this.updateBuffers();
      if (this.lastAppliedDesiredSequence !== 0) {
        this.applyDesiredControls();
      }
      if (this.lastAppliedConfigSequence !== 0) {
        this.applyConfigControls();
      }
      this.runtimeState = "ready-paused";
      this.port.postMessage({
        type: "ready",
        workletGeneration: this.workletGeneration,
      });
      this.acceptSource();
    } catch (error) {
      this.fail(5_000, error);
    }
  }

  private handleMessage(message: HostMessage): void {
    switch (message.type) {
      case "command":
        this.applyHostCommand(message.command);
        break;
      case "commandsAvailable":
        this.drainCommandsFromHost();
        break;
      case "destroy":
        this.destroyed = true;
        this.active = false;
        this.runtimeState = "idle";
        break;
      case "sourceChunk":
        if (message.sourceRevision === this.sourceRevision) {
          this.sourceWindow.addChunk(message.chunk);
          this.publishSourceStatus();
        }
        break;
    }
  }

  private applyHostCommand(command: StretchCommand): void {
    try {
      this.scheduleOrApplyCommand(command);
      this.readDesiredParams();
      this.publishAll([], 0, true);
    } catch (error) {
      this.fail(5_003, error);
    }
  }

  private drainCommandsFromHost(): void {
    try {
      this.drainCommands();
      this.readDesiredParams();
      this.publishAll([], 0, true);
    } catch (error) {
      this.fail(5_002, error);
    }
  }

  private renderQuantum(
    output: readonly Float32Array[],
    outputFrameCount: number,
  ): void {
    const module = this.module;
    const info = this.sourceWindow.info;

    if (!module || !info || outputFrameCount <= 0) {
      silence(output);
      return;
    }

    this.wrapLoopIfNeeded();
    this.checkHeapViews();

    const sourceWindow = this.sourceWindowForAudibleFrame(this.sourceFrame);
    const fill = this.sourceWindow.fillInputWindow(
      this.inputBuffers,
      sourceWindow.inputWindowStartFrame,
      this.bufferLengthFrames,
      {
        enabled: this.loopEnabled,
        endFrame: this.loopEndFrame,
        startFrame: this.loopStartFrame,
      },
    );

    if (fill.missingFrames > 0) {
      this.underrunTotal += 1;
    }
    this.lastInputWindowMissingFrames = fill.missingFrames;

    module._seek(this.bufferLengthFrames, this.effectiveRate);
    module._process(0, outputFrameCount);
    this.checkHeapViews();

    for (let channel = 0; channel < output.length; channel += 1) {
      const source = this.outputBuffers[channel % this.outputBuffers.length];
      const target = output[channel];

      if (!target) {
        continue;
      }

      if (!source) {
        target.fill(0);
        continue;
      }

      for (let index = 0; index < outputFrameCount; index += 1) {
        target[index] = source[index] ?? 0;
      }
    }

    this.outputFrame += outputFrameCount;
    this.sourceFrame += outputFrameCount * this.effectiveRate;

    if (!this.loopEnabled && this.sourceFrame >= info.frameCount) {
      this.sourceFrame = info.frameCount;
      this.runtimeState = "ended";
      this.active = false;
    }
  }

  private drainCommands(): void {
    this.applyReadyScheduledCommands();

    this.commandConsumer.drain((command: StretchCommand) => {
      this.scheduleOrApplyCommand(command);
    });

    this.applyReadyScheduledCommands();
  }

  private scheduleOrApplyCommand(command: StretchCommand): void {
    const result = this.scheduledCommands.schedule(command, this.outputFrame);

    if (result === "ready") {
      this.applyCommand(command);
      return;
    }

    if (result === "dropped") {
      this.pendingCommandDroppedTotal += 1;
      this.invalidTransitionTotal += 1;
    }
  }

  private applyReadyScheduledCommands(): void {
    this.scheduledCommands.drainReady(this.outputFrame, (command) => {
      this.applyCommand(command);
    });
  }

  private applyCommand(command: StretchCommand): void {
    if (command.sequence <= this.lastAppliedCommandSequence) {
      return;
    }

    this.lastAppliedCommandSequence = command.sequence;

    switch (command.name) {
      case "clearLoop":
        this.loopEnabled = false;
        this.loopStartMissingFrames = 0;
        this.loopEndMissingFrames = 0;
        this.loopRevision = command.sequence;
        break;
      case "configure":
        this.blockMs = command.blockMs || this.blockMs;
        this.intervalMs = command.intervalMs || this.intervalMs;
        this.splitComputation = command.splitComputation;
        this.lastAppliedConfigSequence = command.configSequence;
        this.preset = "custom";
        this.applyConfigControls();
        break;
      case "destroy":
        this.destroyed = true;
        this.runtimeState = "idle";
        this.active = false;
        break;
      case "flush":
        this.module?._flush(Math.max(0, Math.floor(command.flushOutputFrames)));
        this.runtimeState = "flushing";
        break;
      case "loadSource":
        if (command.sourceRevision !== this.sourceRevision) {
          this.sourceRevision = command.sourceRevision;
          this.acceptSource();
        }
        break;
      case "pause":
        this.active = false;
        this.runtimeState = "ready-paused";
        break;
      case "play":
        this.play();
        break;
      case "presetCheaper":
        this.preset = "cheaper";
        this.applyConfigControls();
        break;
      case "presetDefault":
        this.preset = "default";
        this.applyConfigControls();
        break;
      case "reset":
      case "resetFault":
        this.failed = false;
        this.lastErrorCode = 0;
        this.module?._reset();
        this.repositionToSourceFrame(0);
        this.runtimeState = "ready-paused";
        break;
      case "seek":
        this.repositionToSourceFrame(command.targetSourceFrame);
        this.runtimeState = "seeking";
        break;
      case "setLoop":
        if (!this.applyLoop(command.loopStartFrame, command.loopEndFrame)) {
          this.invalidTransitionTotal += 1;
        } else {
          this.loopRevision = command.sequence;
        }
        break;
      case "stop":
        this.active = false;
        this.repositionToSourceFrame(0);
        this.runtimeState = "ready-paused";
        break;
    }
  }

  private readDesiredParams(): void {
    this.binding.params.within((params) => {
      if (params.control.desiredSequence !== this.lastAppliedDesiredSequence) {
        this.active = params.control.active;
        this.effectiveRate = Math.max(0.05, params.control.rate);
        this.formantBaseHz = params.control.formantBaseHz;
        this.formantCompensation = params.control.formantCompensation;
        this.formantSemitones = params.control.formantSemitones;
        this.pitchSemitones = params.control.pitchSemitones;
        this.tonalityEnabled = params.control.tonalityEnabled;
        this.tonalityHz = params.control.tonalityHz;
        this.lastAppliedDesiredSequence = params.control.desiredSequence;
        this.applyDesiredControls();
      }

      if (params.config.configSequence !== this.lastAppliedConfigSequence) {
        this.blockMs = params.config.blockMs;
        this.intervalMs = params.config.intervalMs;
        this.preset = enumLabel(
          STRETCH_PRESETS,
          params.config.preset,
          "default",
        );
        this.splitComputation = params.config.splitComputation;
        this.lastAppliedConfigSequence = params.config.configSequence;
        this.applyConfigControls();
      }
    });
  }

  private applyDesiredControls(): void {
    const module = this.module;
    if (!module) {
      return;
    }

    module._setTransposeSemitones(
      this.pitchSemitones,
      this.tonalityEnabled ? this.tonalityHz / sampleRate : 0,
    );
    module._setFormantSemitones(
      this.formantSemitones,
      this.formantCompensation ? 1 : 0,
    );
    module._setFormantBase(this.formantBaseHz / sampleRate);
  }

  private applyConfigControls(): void {
    this.configureModule(this.preset);
    this.module?._reset();
  }

  private play(): void {
    const durationFrames = this.durationFrames();

    if (this.loopEnabled && this.loopEndFrame > this.loopStartFrame) {
      this.repositionToSourceFrame(this.sourceFrame);
    } else if (this.sourceFrame >= durationFrames) {
      this.repositionToSourceFrame(0);
    }

    this.active = true;
    this.runtimeState = "playing";
  }

  private repositionToSourceFrame(sourceFrame: number): void {
    const durationFrames = this.durationFrames();
    const clampedFrame = clamp(sourceFrame, 0, durationFrames);
    this.sourceFrame = this.loopEnabled
      ? normalizeSeekFrameIntoLoopRange(clampedFrame, {
          endFrame: this.loopEndFrame,
          startFrame: this.loopStartFrame,
        })
      : clampedFrame;
    this.outputFrame = this.sourceFrame / Math.max(0.05, this.effectiveRate);
  }

  private applyLoop(startFrame: number, endFrame: number): boolean {
    const durationFrames = this.durationFrames();
    const start = clamp(startFrame, 0, durationFrames);
    const end = clamp(endFrame, 0, durationFrames);
    const validation = validateLoopRange(
      { endFrame: end, startFrame: start },
      {
        blockSamples: this.module?._blockSamples() ?? 0,
        intervalSamples: this.intervalSamples,
      },
    );

    if (!validation.valid) {
      return false;
    }

    this.loopEnabled = true;
    this.loopStartFrame = validation.range.startFrame;
    this.loopEndFrame = validation.range.endFrame;
    this.repositionToSourceFrame(this.sourceFrame);
    this.loopStartMissingFrames = 0;
    this.loopEndMissingFrames = 0;
    return true;
  }

  private configureModule(preset: StretchPreset): void {
    const module = this.module;
    if (!module) {
      return;
    }

    if (preset === "cheaper") {
      module._presetCheaper(this.channelCount(), sampleRate);
    } else if (preset === "default") {
      module._presetDefault(this.channelCount(), sampleRate);
    } else {
      const blockSamples = Math.max(
        0,
        Math.round((sampleRate * this.blockMs) / 1_000),
      );
      const intervalSamples = Math.max(
        0,
        Math.round((sampleRate * this.intervalMs) / 1_000),
      );
      module._configure(
        this.channelCount(),
        blockSamples,
        intervalSamples,
        this.splitComputation ? 1 : 0,
      );
    }

    this.updateBuffers();
  }

  private ensureConfigured(): void {
    if (this.bufferLengthFrames <= 0) {
      this.configureModule(this.preset);
    }
  }

  private updateBuffers(): void {
    const module = this.module;
    if (!module) {
      return;
    }

    this.inputLatencyFrames = Math.max(0, module._inputLatency());
    this.outputLatencyFrames = Math.max(0, module._outputLatency());
    this.intervalSamples = Math.max(0, module._intervalSamples());
    this.bufferLengthFrames = Math.max(
      128,
      this.inputLatencyFrames + this.outputLatencyFrames,
    );

    const channelCount = this.channelCount();
    const pointer = module._setBuffers(channelCount, this.bufferLengthFrames);
    this.bufferBaseIndex = pointer / Float32Array.BYTES_PER_ELEMENT;
    this.bindHeapViews(module);
    this.heapGeneration += 1;
  }

  private checkHeapViews(): void {
    const module = this.module;

    if (
      !module ||
      this.bufferLengthFrames <= 0 ||
      this.lastHeapBuffer === module.HEAPF32.buffer
    ) {
      return;
    }

    this.bindHeapViews(module);
    this.heapGeneration += 1;
  }

  private bindHeapViews(module: SignalsmithStretchModule): void {
    const base = this.bufferBaseIndex;
    const channelCount = this.channelCount();
    this.inputBuffers = [];
    this.outputBuffers = [];

    for (let channel = 0; channel < channelCount; channel += 1) {
      this.inputBuffers.push(
        module.HEAPF32.subarray(
          base + this.bufferLengthFrames * channel,
          base + this.bufferLengthFrames * (channel + 1),
        ),
      );
      this.outputBuffers.push(
        module.HEAPF32.subarray(
          base + this.bufferLengthFrames * (channel + channelCount),
          base + this.bufferLengthFrames * (channel + channelCount + 1),
        ),
      );
    }

    this.lastHeapBuffer = module.HEAPF32.buffer;
  }

  private publishAll(
    output: readonly Float32Array[],
    outputFrameCount: number,
    silentOutput: boolean,
  ): void {
    const info = this.sourceWindow.info;
    const durationFrames = this.durationFrames();
    const durationSeconds = info?.durationSeconds ?? 0;
    const blockSamples = this.module?._blockSamples() ?? 0;

    publishRuntimeMeters(this.binding, {
      audioWorkletFrame: currentFrame,
      audioWorkletTimeSeconds: currentTime,
      blockSamples,
      bufferLengthFrames: this.bufferLengthFrames,
      bufferReadyFrames: this.sourceWindow.readyFrames,
      commandDroppedTotal:
        Atomics.load(this.commandRingBacking.header, SWSR_HEADER_DROPPED) +
        this.pendingCommandDroppedTotal,
      durationFrames,
      durationSeconds,
      effectiveRate: this.effectiveRate,
      heapGeneration: this.heapGeneration,
      inputLatencyFrames: this.inputLatencyFrames,
      inputWindowMissingFrames: this.lastInputWindowMissingFrames,
      intervalSamples: this.intervalSamples,
      invalidSampleTotal: this.invalidSampleTotal,
      invalidTransitionTotal: this.invalidTransitionTotal,
      lastAppliedCommandSequence: this.lastAppliedCommandSequence,
      lastAppliedConfigSequence: this.lastAppliedConfigSequence,
      lastAppliedDesiredSequence: this.lastAppliedDesiredSequence,
      lastErrorCode: this.lastErrorCode,
      loopEnabled: this.loopEnabled,
      loopEndFrame: this.loopEndFrame,
      loopEndMissingFrames: this.loopEndMissingFrames,
      loopRevision: this.loopRevision,
      loopSourceFrameInside: this.sourceFrameInsideLoopForPublish(),
      loopStartFrame: this.loopStartFrame,
      loopStartMissingFrames: this.loopStartMissingFrames,
      maxObservedRenderQuantum: this.maxObservedRenderQuantum,
      outputFrame: this.outputFrame,
      outputLatencyFrames: this.outputLatencyFrames,
      processingCenterFrame: this.processingCenterFrameForPublish(),
      scheduledCommandDroppedTotal: this.scheduledCommands.dropped,
      scheduledCommandQueueSize: this.scheduledCommands.size,
      sessionId: this.sessionId,
      sourceFrame: this.sourceFrame,
      staleReadTotal: this.staleReadTotal,
      state: this.failed ? "failed-recoverable" : this.runtimeState,
      underrunTotal: this.underrunTotal,
      workletGeneration: this.workletGeneration,
    });

    this.levelProbe.publish(this.binding, output, {
      active: this.active && !silentOutput,
      channelCount: this.channelCount(),
      failed: this.failed,
      lastErrorCode: this.lastErrorCode,
      outputFrame: this.outputFrame,
      silent: silentOutput,
      unsupportedChannelBlockTotal: this.unsupportedChannelBlockTotal,
      windowFrames: outputFrameCount,
    });
  }

  private acceptSource(): void {
    this.publishSourceStatus();
    this.port.postMessage({
      loadSequence: this.loadSequence,
      sourceRevision: this.sourceRevision,
      type: "sourceAccepted",
    });
  }

  private publishSourceStatus(): void {
    const info = this.sourceWindow.info;

    this.binding.meters.publish((writer) => {
      writer.set("source.appliedLoadSequence", this.loadSequence);
      writer.set("source.bufferEndFrame", this.sourceWindow.bufferEndFrame);
      writer.set("source.bufferStartFrame", this.sourceWindow.bufferStartFrame);
      writer.set("source.channelCount", info?.channelCount ?? 0);
      writer.set("source.decodeErrorCode", 0);
      writer.set(
        "source.droppedBufferTotal",
        this.sourceWindow.droppedBufferTotal,
      );
      writer.set("source.durationFrames", info?.frameCount ?? 0);
      writer.set("source.durationSeconds", info?.durationSeconds ?? 0);
      writer.set("source.loadSequence", this.loadSequence);
      writer.set("source.memoryBytes", this.sourceWindow.cachedBytes);
      writer.set("source.sampleRate", info?.sampleRate ?? 0);
      writer.set("source.sourceRevision", this.sourceRevision);
      writer.set("source.state", enumIndex(SOURCE_STATES, "accepted"));
    });
  }

  private sourceWindowForAudibleFrame(
    audibleSourceFrame: number,
  ): SignalsmithSourceWindow {
    return calculateSignalsmithSourceWindow({
      audibleSourceFrame,
      bufferLengthFrames: this.bufferLengthFrames,
      effectiveRate: this.effectiveRate,
      inputLatencyFrames: this.inputLatencyFrames,
      outputLatencyFrames: this.outputLatencyFrames,
    });
  }

  private processingCenterFrameForPublish(): number {
    return this.sourceWindowForAudibleFrame(this.sourceFrame)
      .processingCenterFrame;
  }

  private wrapLoopIfNeeded(): void {
    if (
      !this.loopEnabled ||
      sourceFrameInsideLoopRange(this.sourceFrame, {
        endFrame: this.loopEndFrame,
        startFrame: this.loopStartFrame,
      })
    ) {
      return;
    }

    this.repositionToSourceFrame(this.sourceFrame);
  }

  private sourceFrameInsideLoopForPublish(): boolean {
    return sourceFrameInsideLoopRange(this.sourceFrame, {
      endFrame: this.loopEndFrame,
      startFrame: this.loopStartFrame,
    });
  }

  private channelCount(): 1 | 2 {
    return this.sourceWindow.info?.channelCount ?? 2;
  }

  private durationFrames(): number {
    return this.sourceWindow.info?.frameCount ?? 0;
  }

  private fail(errorCode: number, error: unknown): void {
    this.failed = true;
    this.lastErrorCode = errorCode;
    this.runtimeState = "failed-recoverable";
    this.port.postMessage({
      errorCode,
      message: error instanceof Error ? error.message : String(error),
      type: "failed",
    });
  }
}

function silence(output: readonly Float32Array[]): void {
  for (const channel of output) {
    channel.fill(0);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

registerProcessor(STRETCH_PROCESSOR_NAME, SignalsmithStretchProcessor);
