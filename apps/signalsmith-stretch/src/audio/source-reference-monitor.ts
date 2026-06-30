import type { ChunkedWavPcmSource } from "./pcm-source";

export interface SourceReferenceMonitorStatus {
  readonly active: boolean;
  readonly lastFrame: number;
  readonly lastRevision: number;
  readonly pending: boolean;
}

const DEFAULT_PREVIEW_SECONDS = 0.45;
const MIN_RESTART_SECONDS = 0.16;

export class SourceReferenceMonitor {
  private readonly gain: GainNode;

  private activeSource: AudioBufferSourceNode | null = null;
  private lastFrame = -1;
  private lastRevision = 0;
  private pending = false;
  private requestId = 0;

  constructor(private readonly audioContext: AudioContext) {
    this.gain = audioContext.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(audioContext.destination);
  }

  get status(): SourceReferenceMonitorStatus {
    return {
      active: this.activeSource !== null,
      lastFrame: this.lastFrame,
      lastRevision: this.lastRevision,
      pending: this.pending,
    };
  }

  dispose(): void {
    this.stop();
    this.gain.disconnect();
  }

  setGain(value: number): void {
    const clamped = Math.min(1, Math.max(0, value));
    this.gain.gain.setTargetAtTime(
      clamped,
      this.audioContext.currentTime,
      0.015,
    );
  }

  stop(): void {
    this.requestId += 1;
    this.pending = false;
    this.stopActiveSource();
  }

  async previewAt(
    source: ChunkedWavPcmSource,
    audibleSourceFrame: number,
  ): Promise<void> {
    const startFrame = clampFrame(
      audibleSourceFrame,
      0,
      Math.max(0, source.durationFrames - 1),
    );
    const minRestartFrames = Math.floor(
      source.sampleRate * MIN_RESTART_SECONDS,
    );

    if (
      this.pending ||
      (this.lastRevision === source.sourceRevision &&
        Math.abs(startFrame - this.lastFrame) < minRestartFrames)
    ) {
      return;
    }

    this.pending = true;
    const requestId = this.requestId + 1;
    this.requestId = requestId;

    try {
      const frameCount = Math.min(
        Math.floor(source.sampleRate * DEFAULT_PREVIEW_SECONDS),
        Math.max(0, source.durationFrames - startFrame),
      );
      const chunk = await source.source.readFrames(startFrame, frameCount);

      if (requestId !== this.requestId || chunk.frameCount === 0) {
        return;
      }

      const buffer = this.audioContext.createBuffer(
        source.channels,
        chunk.frameCount,
        source.sampleRate,
      );

      for (let channel = 0; channel < source.channels; channel += 1) {
        buffer
          .getChannelData(channel)
          .set(
            chunk.channels[channel % chunk.channels.length] ??
              new Float32Array(),
          );
      }

      const next = this.audioContext.createBufferSource();
      next.buffer = buffer;
      next.connect(this.gain);
      next.onended = () => {
        if (this.activeSource === next) {
          this.activeSource = null;
        }
      };

      this.stopActiveSource();
      this.activeSource = next;
      this.lastFrame = startFrame;
      this.lastRevision = source.sourceRevision;
      next.start();
    } finally {
      if (requestId === this.requestId) {
        this.pending = false;
      }
    }
  }

  private stopActiveSource(): void {
    if (!this.activeSource) {
      return;
    }

    try {
      this.activeSource.stop();
    } catch {
      // A source node can only be stopped after it has been started.
    }
    this.activeSource.disconnect();
    this.activeSource = null;
  }
}

function clampFrame(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}
