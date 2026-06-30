import type {
  ChunkedWavSourceInfo,
  PlanarFrameChunk,
} from "../audio/chunked-wav-source";

interface StoredChunk {
  readonly bytes: number;
  readonly channels: readonly Float32Array[];
  readonly endFrame: number;
  readonly frameCount: number;
  lastUsed: number;
  readonly startFrame: number;
}

export interface SourceLoopWindow {
  readonly enabled: boolean;
  readonly endFrame: number;
  readonly startFrame: number;
}

export interface SourceWindowOptions {
  readonly maxCachedBytes?: number;
}

const DEFAULT_MAX_CACHED_BYTES = 24 * 1024 * 1024;

export class SourceWindow {
  private readonly maxCachedBytes: number;
  private readonly chunks: StoredChunk[] = [];

  private cachedBytesValue = 0;
  private droppedBufferTotalValue = 0;
  private infoValue: ChunkedWavSourceInfo | null = null;
  private tick = 0;

  constructor(options: SourceWindowOptions = {}) {
    this.maxCachedBytes = Math.max(
      1,
      Math.floor(options.maxCachedBytes ?? DEFAULT_MAX_CACHED_BYTES),
    );
  }

  get info(): ChunkedWavSourceInfo | null {
    return this.infoValue;
  }

  get bufferEndFrame(): number {
    let endFrame = 0;

    for (const chunk of this.chunks) {
      endFrame = Math.max(endFrame, chunk.endFrame);
    }

    return endFrame;
  }

  get bufferStartFrame(): number {
    let startFrame = Number.POSITIVE_INFINITY;

    for (const chunk of this.chunks) {
      startFrame = Math.min(startFrame, chunk.startFrame);
    }

    return Number.isFinite(startFrame) ? startFrame : 0;
  }

  get cachedBytes(): number {
    return this.cachedBytesValue;
  }

  get droppedBufferTotal(): number {
    return this.droppedBufferTotalValue;
  }

  get readyFrames(): number {
    let total = 0;
    for (const chunk of this.chunks) {
      total += chunk.frameCount;
    }
    return total;
  }

  setInfo(info: ChunkedWavSourceInfo): void {
    this.infoValue = info;
    this.chunks.length = 0;
    this.cachedBytesValue = 0;
    this.droppedBufferTotalValue = 0;
    this.tick = 0;
  }

  addChunk(chunk: PlanarFrameChunk): void {
    const bytes = chunkBytes(chunk);

    this.chunks.push({
      bytes,
      channels: chunk.channels,
      endFrame: chunk.startFrame + chunk.frameCount,
      frameCount: chunk.frameCount,
      lastUsed: this.nextTick(),
      startFrame: chunk.startFrame,
    });
    this.cachedBytesValue += bytes;

    this.chunks.sort((a, b) => a.startFrame - b.startFrame);
    this.evict();
  }

  fillInputWindow(
    targets: readonly Float32Array[],
    startFrame: number,
    frameCount: number,
    loop: SourceLoopWindow = {
      enabled: false,
      endFrame: 0,
      startFrame: 0,
    },
  ): {
    readonly copiedFrames: number;
    readonly missingFrames: number;
  } {
    for (const target of targets) {
      target.fill(0, 0, frameCount);
    }

    if (!this.infoValue || frameCount <= 0) {
      return { copiedFrames: 0, missingFrames: frameCount };
    }

    if (!isValidLoop(loop)) {
      const copiedFrames = this.copyLinearRange(
        targets,
        0,
        startFrame,
        frameCount,
      );

      return {
        copiedFrames,
        missingFrames: Math.max(0, frameCount - copiedFrames),
      };
    }

    let copiedFrames = 0;
    let remainingFrames = frameCount;
    let targetOffset = 0;
    let requestedFrame = startFrame;

    while (remainingFrames > 0) {
      const mappedFrame = mapLoopFrame(requestedFrame, loop);
      const framesUntilWrap =
        requestedFrame < loop.endFrame
          ? loop.endFrame - requestedFrame
          : loopLength(loop) -
            ((requestedFrame - loop.endFrame) % loopLength(loop));
      const count = Math.min(remainingFrames, Math.max(1, framesUntilWrap));

      copiedFrames += this.copyLinearRange(
        targets,
        targetOffset,
        mappedFrame,
        count,
      );
      targetOffset += count;
      requestedFrame += count;
      remainingFrames -= count;
    }

    return {
      copiedFrames,
      missingFrames: Math.max(0, frameCount - copiedFrames),
    };
  }

  private copyLinearRange(
    targets: readonly Float32Array[],
    targetBaseOffset: number,
    startFrame: number,
    frameCount: number,
  ): number {
    let copiedFrames = 0;
    const endFrame = startFrame + frameCount;

    for (const chunk of this.chunks) {
      const overlapStart = Math.max(startFrame, chunk.startFrame);
      const overlapEnd = Math.min(endFrame, chunk.endFrame);
      const count = overlapEnd - overlapStart;

      if (count <= 0) {
        continue;
      }

      const sourceOffset = overlapStart - chunk.startFrame;
      const targetOffset = targetBaseOffset + overlapStart - startFrame;
      chunk.lastUsed = this.nextTick();

      for (let channel = 0; channel < targets.length; channel += 1) {
        const target = targets[channel];
        const source =
          chunk.channels[channel % chunk.channels.length] ?? chunk.channels[0];

        if (!target || !source) {
          continue;
        }

        for (let index = 0; index < count; index += 1) {
          target[targetOffset + index] = source[sourceOffset + index] ?? 0;
        }
      }

      copiedFrames += count;
    }

    return copiedFrames;
  }

  private evict(): void {
    while (this.cachedBytesValue > this.maxCachedBytes) {
      const oldest = this.oldestChunk();

      if (!oldest) {
        return;
      }

      const index = this.chunks.indexOf(oldest);

      if (index < 0) {
        return;
      }

      this.chunks.splice(index, 1);
      this.cachedBytesValue -= oldest.bytes;
      this.droppedBufferTotalValue += 1;
    }
  }

  private oldestChunk(): StoredChunk | null {
    let oldest: StoredChunk | null = null;

    for (const chunk of this.chunks) {
      if (!oldest || chunk.lastUsed < oldest.lastUsed) {
        oldest = chunk;
      }
    }

    return oldest;
  }

  private nextTick(): number {
    this.tick += 1;
    return this.tick;
  }
}

function chunkBytes(chunk: PlanarFrameChunk): number {
  const channelCount = Math.max(1, chunk.channels.length);

  return chunk.frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT;
}

function isValidLoop(loop: SourceLoopWindow): boolean {
  return loop.enabled && loop.endFrame > loop.startFrame;
}

function loopLength(loop: SourceLoopWindow): number {
  return Math.max(1, loop.endFrame - loop.startFrame);
}

function mapLoopFrame(frame: number, loop: SourceLoopWindow): number {
  if (frame < loop.endFrame) {
    return frame;
  }

  return loop.startFrame + ((frame - loop.endFrame) % loopLength(loop));
}
