import type { ChunkedWavSource, PlanarFrameChunk } from "./chunked-wav-source";
import type { SimulatedSource } from "../types";

export type WaveformPeakMode =
  | "empty"
  | "synthetic"
  | "actual-coarse"
  | "actual-complete";

export interface WaveformPeaksState {
  readonly mode: WaveformPeakMode;
  readonly peaks: Float32Array;
}

export interface ChunkedWaveformPeaksOptions {
  readonly binCount?: number;
  readonly coarseFramesPerBin?: number;
  readonly complete?: boolean;
  readonly maxFramesPerRead?: number;
  readonly onProgress?: (state: WaveformPeaksState) => void;
  readonly signal?: AbortSignal;
  readonly yieldEveryReads?: number;
}

const DEFAULT_BIN_COUNT = 320;
const DEFAULT_COARSE_FRAMES_PER_BIN = 2_048;
const DEFAULT_MAX_FRAMES_PER_READ = 16_384;
const DEFAULT_YIELD_EVERY_READS = 8;

export function createEmptyWaveformPeaks(
  binCount = DEFAULT_BIN_COUNT,
): WaveformPeaksState {
  return { mode: "empty", peaks: new Float32Array(binCount) };
}

export function createSyntheticWaveformPeaks(
  source: SimulatedSource,
  binCount = DEFAULT_BIN_COUNT,
): WaveformPeaksState {
  const peaks = new Float32Array(binCount);
  const seed = hashSource(source.name, source.frames);

  for (let index = 0; index < peaks.length; index += 1) {
    const t = index / Math.max(1, peaks.length - 1);
    const carrier = Math.sin(index * 0.17 + seed * 0.013);
    const overtone = Math.sin(index * 0.047 + seed * 0.031);
    const envelope = 0.48 + 0.38 * Math.sin(Math.PI * t);
    peaks[index] = Math.max(
      0.08,
      Math.abs(carrier * 0.7 + overtone * 0.3) * envelope,
    );
  }

  return { mode: "synthetic", peaks };
}

export function computePlanarWaveformPeaks(
  channels: readonly Float32Array[],
  frameCount: number,
  binCount = DEFAULT_BIN_COUNT,
): WaveformPeaksState {
  const peaks = new Float32Array(Math.max(1, Math.floor(binCount)));
  const totalFrames = Math.max(0, Math.floor(frameCount));

  if (totalFrames === 0 || channels.length === 0) {
    return { mode: "actual-complete", peaks };
  }

  for (let bin = 0; bin < peaks.length; bin += 1) {
    const range = binRange(totalFrames, bin, peaks.length);
    const endFrame = range.startFrame + range.frameCount;
    let peak = 0;

    for (const channel of channels) {
      for (let frame = range.startFrame; frame < endFrame; frame += 1) {
        peak = Math.max(peak, Math.abs(channel[frame] ?? 0));
      }
    }

    peaks[bin] = peak;
  }

  return { mode: "actual-complete", peaks };
}

export async function computeChunkedWaveformPeaks(
  source: ChunkedWavSource,
  options: ChunkedWaveformPeaksOptions = {},
): Promise<WaveformPeaksState> {
  const binCount = Math.max(
    1,
    Math.floor(options.binCount ?? DEFAULT_BIN_COUNT),
  );
  const maxFramesPerRead = Math.max(
    1,
    Math.floor(options.maxFramesPerRead ?? DEFAULT_MAX_FRAMES_PER_READ),
  );
  const coarseFramesPerBin = Math.max(
    1,
    Math.floor(options.coarseFramesPerBin ?? DEFAULT_COARSE_FRAMES_PER_BIN),
  );
  const yieldEveryReads = Math.max(
    1,
    Math.floor(options.yieldEveryReads ?? DEFAULT_YIELD_EVERY_READS),
  );
  const coarse = new Float32Array(binCount);
  let reads = 0;

  for (let bin = 0; bin < binCount; bin += 1) {
    throwIfAborted(options.signal);

    const range = binRange(source.info.frameCount, bin, binCount);
    const frameCount = Math.min(
      maxFramesPerRead,
      coarseFramesPerBin,
      range.frameCount,
    );

    if (frameCount > 0) {
      const startFrame =
        range.startFrame + Math.floor((range.frameCount - frameCount) / 2);
      coarse[bin] = measureChunkPeak(
        await source.readFrames(startFrame, frameCount),
      );
      reads += 1;
    }

    if (reads % yieldEveryReads === 0) {
      options.onProgress?.({
        mode: "actual-coarse",
        peaks: new Float32Array(coarse),
      });
      await yieldToMain();
    }
  }

  const coarseState = {
    mode: "actual-coarse" as const,
    peaks: new Float32Array(coarse),
  };
  options.onProgress?.(coarseState);

  if (options.complete === false) {
    return coarseState;
  }

  const complete = new Float32Array(binCount);

  for (
    let startFrame = 0;
    startFrame < source.info.frameCount;
    startFrame += maxFramesPerRead
  ) {
    throwIfAborted(options.signal);

    const frameCount = Math.min(
      maxFramesPerRead,
      source.info.frameCount - startFrame,
    );
    mergeChunkPeaks(
      complete,
      await source.readFrames(startFrame, frameCount),
      source.info.frameCount,
    );
    reads += 1;

    if (reads % yieldEveryReads === 0) {
      await yieldToMain();
    }
  }

  const completeState = {
    mode: "actual-complete" as const,
    peaks: complete,
  };
  options.onProgress?.(completeState);
  return completeState;
}

function binRange(
  totalFrames: number,
  bin: number,
  binCount: number,
): { readonly frameCount: number; readonly startFrame: number } {
  const startFrame = Math.floor((bin * totalFrames) / binCount);
  const endFrame = Math.floor(((bin + 1) * totalFrames) / binCount);

  return {
    frameCount: Math.max(0, endFrame - startFrame),
    startFrame,
  };
}

function measureChunkPeak(chunk: PlanarFrameChunk): number {
  let peak = 0;

  for (const channel of chunk.channels) {
    for (let index = 0; index < chunk.frameCount; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    }
  }

  return peak;
}

function mergeChunkPeaks(
  peaks: Float32Array,
  chunk: PlanarFrameChunk,
  totalFrames: number,
): void {
  for (let frame = 0; frame < chunk.frameCount; frame += 1) {
    const absoluteFrame = chunk.startFrame + frame;
    const bin = Math.min(
      peaks.length - 1,
      Math.floor((absoluteFrame * peaks.length) / Math.max(1, totalFrames)),
    );

    for (const channel of chunk.channels) {
      peaks[bin] = Math.max(peaks[bin] ?? 0, Math.abs(channel[frame] ?? 0));
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException("Waveform peak generation aborted.", "AbortError");
  }
}

async function yieldToMain(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function hashSource(name: string, frames: number): number {
  let hash = frames >>> 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = Math.imul(hash ^ name.charCodeAt(index), 16_777_619);
  }
  return hash >>> 0;
}
