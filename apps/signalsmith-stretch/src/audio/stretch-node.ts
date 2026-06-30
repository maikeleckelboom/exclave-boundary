import processorModuleUrl from "virtual:signalsmith-stretch/worklet-url";

import { STRETCH_PROCESSOR_NAME } from "../worklet/processor-name";

import type { PlanarFrameChunk } from "./chunked-wav-source";
import type { ChunkedWavPcmSource } from "./pcm-source";
import type {
  StretchCommand,
  StretchCommandTransport,
} from "../boundary/commands";
import type { StretchBoundarySession } from "../boundary/session";

export interface StretchWorkletRuntimeOptions {
  readonly audioContext: AudioContext;
  readonly commands: StretchCommandTransport;
  readonly generatedModuleUrl: string;
  readonly initialChunk: PlanarFrameChunk;
  readonly session: StretchBoundarySession;
  readonly source: ChunkedWavPcmSource;
}

export interface StretchWorkletRuntimeStatus {
  readonly failed: boolean;
  readonly lastError: string | null;
  readonly sourceAccepted: boolean;
  readonly sourceRevision: number;
  readonly workletReady: boolean;
}

type StretchWorkletMessage =
  | {
      readonly type: "failed";
      readonly errorCode: number;
      readonly message: string;
    }
  | {
      readonly type: "ready";
      readonly workletGeneration: number;
    }
  | {
      readonly loadSequence: number;
      readonly sourceRevision: number;
      readonly type: "sourceAccepted";
    };

type StretchWorkletHostMessage =
  | {
      readonly chunk: PlanarFrameChunk;
      readonly sourceRevision: number;
      readonly type: "sourceChunk";
    }
  | {
      readonly info: ChunkedWavPcmSource["source"]["info"];
      readonly loadSequence: number;
      readonly sourceRevision: number;
      readonly type: "sourceInfo";
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

export class StretchWorkletRuntime {
  private failed = false;
  private lastError: string | null = null;
  private sourceAccepted = false;
  private sourceRevision = 0;
  private workletReady = false;

  private constructor(
    private readonly audioContext: AudioContext,
    private readonly node: AudioWorkletNode,
    private readonly outputGain: GainNode,
  ) {
    this.node.port.onmessage = (event: MessageEvent<StretchWorkletMessage>) => {
      this.handleMessage(event.data);
    };
  }

  static async create(
    options: StretchWorkletRuntimeOptions,
  ): Promise<StretchWorkletRuntime> {
    await options.audioContext.audioWorklet.addModule(processorModuleUrl);

    const node = new AudioWorkletNode(
      options.audioContext,
      STRETCH_PROCESSOR_NAME,
      {
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          commandRing: options.commands.backing,
          handoff: options.session.stretch.handoff,
          initialChunk: options.initialChunk,
          loadSequence: options.source.loadSequence,
          moduleUrl: options.generatedModuleUrl,
          sourceInfo: options.source.source.info,
          sourceRevision: options.source.sourceRevision,
        },
      },
    );

    const outputGain = options.audioContext.createGain();
    node.connect(outputGain);
    outputGain.connect(options.audioContext.destination);

    return new StretchWorkletRuntime(options.audioContext, node, outputGain);
  }

  get status(): StretchWorkletRuntimeStatus {
    return {
      failed: this.failed,
      lastError: this.lastError,
      sourceAccepted: this.sourceAccepted,
      sourceRevision: this.sourceRevision,
      workletReady: this.workletReady,
    };
  }

  postSource(
    source: ChunkedWavPcmSource,
    initialChunk: PlanarFrameChunk,
  ): void {
    this.sourceAccepted = false;
    this.sourceRevision = source.sourceRevision;
    this.postMessage({
      info: source.source.info,
      loadSequence: source.loadSequence,
      sourceRevision: source.sourceRevision,
      type: "sourceInfo",
    });
    this.postChunk(source.sourceRevision, initialChunk);
  }

  postChunk(sourceRevision: number, chunk: PlanarFrameChunk): void {
    this.postMessage({
      chunk,
      sourceRevision,
      type: "sourceChunk",
    });
  }

  notifyCommandsAvailable(): void {
    this.postMessage({ type: "commandsAvailable" });
  }

  postCommand(command: StretchCommand): void {
    this.postMessage({ command, type: "command" });
  }

  dispose(): void {
    this.postMessage({ type: "destroy" });
    this.node.disconnect();
    this.outputGain.disconnect();
    this.node.port.close();
  }

  setOutputGain(value: number): void {
    const clamped = Math.min(1, Math.max(0, value));
    this.outputGain.gain.setTargetAtTime(
      clamped,
      this.audioContext.currentTime,
      0.015,
    );
  }

  async resume(): Promise<void> {
    if (this.audioContext.state !== "running") {
      await this.audioContext.resume();
    }
  }

  private postMessage(message: StretchWorkletHostMessage): void {
    this.node.port.postMessage(message);
  }

  private handleMessage(message: StretchWorkletMessage): void {
    switch (message.type) {
      case "failed":
        this.failed = true;
        this.lastError = `${message.errorCode.toString()}: ${message.message}`;
        break;
      case "ready":
        this.workletReady = true;
        this.failed = false;
        this.lastError = null;
        break;
      case "sourceAccepted":
        this.sourceAccepted = true;
        this.sourceRevision = message.sourceRevision;
        break;
    }
  }
}
