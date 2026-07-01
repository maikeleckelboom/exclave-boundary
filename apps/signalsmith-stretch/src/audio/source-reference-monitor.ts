import type { PlanarFrameChunk } from "./chunked-wav-source";
import type { ChunkedWavPcmSource } from "./pcm-source";

export interface SourceReferenceMonitorStatus {
  readonly active: boolean;
  readonly currentTimeSeconds: number;
  readonly driftFrames: number;
  readonly lastFrame: number;
  readonly lastRevision: number;
  readonly pending: boolean;
  readonly playbackRate: number;
  readonly predictedFrame: number;
  readonly resyncTotal: number;
  readonly scheduledSourceCount: number;
  readonly scheduledUntilFrame: number;
}

export type ReferencePreviewSyncAction = "continue" | "resync" | "start";

export interface ReferencePreviewSyncInput {
  readonly active: boolean;
  readonly driftToleranceFrames: number;
  readonly lastRevision: number;
  readonly playbackRate: number;
  readonly predictedFrame: number;
  readonly scheduledPlaybackRate: number;
  readonly sourceRevision: number;
  readonly targetFrame: number;
}

const MAX_PREVIEW_AHEAD_SECONDS = 6;
const PREVIEW_CHUNK_WALL_SECONDS = 0.75;
const PREVIEW_DRIFT_TOLERANCE_SECONDS = 0.08;
const PREVIEW_RATE_TOLERANCE = 0.005;
const PREVIEW_START_DELAY_SECONDS = 0.04;

export class SourceReferenceMonitor {
  private readonly gain: GainNode;

  private readonly scheduledSources: AudioBufferSourceNode[] = [];

  private anchorContextTime = 0;
  private anchorFrame = 0;
  private driftFrames = 0;
  private lastFrame = -1;
  private lastRevision = 0;
  private pending = false;
  private playbackRate = 1;
  private resyncTotal = 0;
  private requestId = 0;
  private scheduledUntilFrame = 0;

  constructor(private readonly audioContext: AudioContext) {
    this.gain = audioContext.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(audioContext.destination);
  }

  get status(): SourceReferenceMonitorStatus {
    return {
      active: this.scheduledSources.length > 0,
      currentTimeSeconds: this.audioContext.currentTime,
      driftFrames: this.driftFrames,
      lastFrame: this.lastFrame,
      lastRevision: this.lastRevision,
      pending: this.pending,
      playbackRate: this.playbackRate,
      predictedFrame: this.predictedFrameAt(this.audioContext.currentTime),
      resyncTotal: this.resyncTotal,
      scheduledSourceCount: this.scheduledSources.length,
      scheduledUntilFrame: this.scheduledUntilFrame,
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
    this.stopScheduledSources();
    this.scheduledUntilFrame = 0;
  }

  sync(
    source: ChunkedWavPcmSource,
    audibleSourceFrame: number,
    rate: number,
  ): void {
    const startFrame = clampFrame(
      audibleSourceFrame,
      0,
      Math.max(0, source.durationFrames - 1),
    );
    const playbackRate = clampPlaybackRate(rate);
    const predictedFrame = this.predictedFrameAt(this.audioContext.currentTime);
    const action = chooseReferencePreviewSyncAction({
      active: this.scheduledSources.length > 0,
      driftToleranceFrames: Math.max(
        1_024,
        Math.floor(source.sampleRate * PREVIEW_DRIFT_TOLERANCE_SECONDS),
      ),
      lastRevision: this.lastRevision,
      playbackRate,
      predictedFrame,
      scheduledPlaybackRate: this.playbackRate,
      sourceRevision: source.sourceRevision,
      targetFrame: startFrame,
    });

    this.driftFrames = startFrame - predictedFrame;
    this.lastFrame = startFrame;

    if (action === "continue") {
      this.scheduleAhead(source);
      return;
    }

    this.resetTimeline(source, startFrame, playbackRate);
  }

  private resetTimeline(
    source: ChunkedWavPcmSource,
    startFrame: number,
    playbackRate: number,
  ): void {
    const hadScheduledSource = this.scheduledSources.length > 0;
    const requestId = this.requestId + 1;

    this.requestId = requestId;
    this.pending = false;
    this.stopScheduledSources();
    this.anchorFrame = startFrame;
    this.anchorContextTime =
      this.audioContext.currentTime + PREVIEW_START_DELAY_SECONDS;
    this.lastFrame = startFrame;
    this.lastRevision = source.sourceRevision;
    this.playbackRate = playbackRate;
    this.scheduledUntilFrame = startFrame;

    if (hadScheduledSource) {
      this.resyncTotal += 1;
    }

    this.scheduleAhead(source, requestId);
  }

  private scheduleAhead(
    source: ChunkedWavPcmSource,
    requestId = this.requestId,
  ): void {
    if (this.pending || requestId !== this.requestId) {
      return;
    }

    this.pending = true;
    void this.fillAhead(source, requestId).finally(() => {
      if (requestId === this.requestId) {
        this.pending = false;
      }
    });
  }

  private async fillAhead(
    source: ChunkedWavPcmSource,
    requestId: number,
  ): Promise<void> {
    while (requestId === this.requestId && this.needsMoreAhead(source)) {
      const startFrame = this.scheduledUntilFrame;
      const frameCount = Math.min(
        Math.max(
          1,
          Math.floor(
            source.sampleRate *
              PREVIEW_CHUNK_WALL_SECONDS *
              this.playbackRate,
          ),
        ),
        source.durationFrames - startFrame,
      );

      if (frameCount <= 0) {
        return;
      }

      const chunk = await source.source.readFrames(startFrame, frameCount);

      if (requestId !== this.requestId || chunk.frameCount === 0) {
        return;
      }

      this.scheduleChunk(source, chunk);
      this.scheduledUntilFrame = chunk.startFrame + chunk.frameCount;
    }
  }

  private needsMoreAhead(source: ChunkedWavPcmSource): boolean {
    if (this.scheduledUntilFrame >= source.durationFrames) {
      return false;
    }

    const predictedFrame = this.predictedFrameAt(this.audioContext.currentTime);
    const scheduledAheadFrames = this.scheduledUntilFrame - predictedFrame;
    const scheduledAheadSeconds =
      scheduledAheadFrames / (source.sampleRate * this.playbackRate);

    return scheduledAheadSeconds < MAX_PREVIEW_AHEAD_SECONDS;
  }

  private scheduleChunk(
    source: ChunkedWavPcmSource,
    chunk: PlanarFrameChunk,
  ): void {
    const buffer = this.audioContext.createBuffer(
      source.channels,
      chunk.frameCount,
      source.sampleRate,
    );

    for (let channel = 0; channel < source.channels; channel += 1) {
      const samples = chunk.channels[channel % chunk.channels.length];

      if (samples) {
        buffer.getChannelData(channel).set(samples);
      }
    }

    const next = this.audioContext.createBufferSource();
    const scheduledStartTime =
      this.anchorContextTime +
      (chunk.startFrame - this.anchorFrame) /
        (source.sampleRate * this.playbackRate);
    const safeStartTime = Math.max(
      scheduledStartTime,
      this.audioContext.currentTime + PREVIEW_START_DELAY_SECONDS,
    );

    if (
      chunk.startFrame === this.anchorFrame &&
      safeStartTime !== scheduledStartTime
    ) {
      this.anchorContextTime = safeStartTime;
    }

    next.buffer = buffer;
    next.playbackRate.setValueAtTime(
      this.playbackRate,
      this.audioContext.currentTime,
    );
    next.connect(this.gain);
    next.onended = () => {
      this.removeScheduledSource(next);
    };

    this.scheduledSources.push(next);
    next.start(safeStartTime);
  }

  private predictedFrameAt(contextTime: number): number {
    if (this.scheduledSources.length === 0 && this.scheduledUntilFrame === 0) {
      return this.lastFrame;
    }

    return (
      this.anchorFrame +
      Math.max(0, contextTime - this.anchorContextTime) *
        this.playbackRate *
        Math.max(1, this.audioContext.sampleRate)
    );
  }

  private removeScheduledSource(source: AudioBufferSourceNode): void {
    const index = this.scheduledSources.indexOf(source);

    if (index >= 0) {
      this.scheduledSources.splice(index, 1);
    }
  }

  private stopScheduledSources(): void {
    if (this.scheduledSources.length === 0) {
      return;
    }

    for (const source of this.scheduledSources) {
      try {
        source.stop();
      } catch {
        // A source node can only be stopped after it has been started.
      }
      source.disconnect();
    }

    this.scheduledSources.length = 0;
  }
}

export function chooseReferencePreviewSyncAction(
  input: ReferencePreviewSyncInput,
): ReferencePreviewSyncAction {
  if (!input.active || input.lastRevision !== input.sourceRevision) {
    return "start";
  }

  if (
    Math.abs(input.playbackRate - input.scheduledPlaybackRate) >
    PREVIEW_RATE_TOLERANCE
  ) {
    return "resync";
  }

  if (
    Math.abs(input.targetFrame - input.predictedFrame) >
    input.driftToleranceFrames
  ) {
    return "resync";
  }

  return "continue";
}

function clampPlaybackRate(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(8, Math.max(0.05, value));
}

function clampFrame(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}
