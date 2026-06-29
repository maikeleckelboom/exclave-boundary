import type {
  ChunkedWavSourceInfo,
  PlanarFrameChunk,
} from "../audio/chunked-wav-source";

interface StoredChunk {
  readonly channels: readonly Float32Array[];
  readonly endFrame: number;
  readonly frameCount: number;
  readonly startFrame: number;
}

export class SourceWindow {
  private readonly chunks: StoredChunk[] = [];
  private infoValue: ChunkedWavSourceInfo | null = null;
  private maxChunks = 8;

  get info(): ChunkedWavSourceInfo | null {
    return this.infoValue;
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
  }

  addChunk(chunk: PlanarFrameChunk): void {
    this.chunks.push({
      channels: chunk.channels,
      endFrame: chunk.startFrame + chunk.frameCount,
      frameCount: chunk.frameCount,
      startFrame: chunk.startFrame,
    });

    this.chunks.sort((a, b) => a.startFrame - b.startFrame);

    while (this.chunks.length > this.maxChunks) {
      this.chunks.shift();
    }
  }

  fillInputWindow(
    targets: readonly Float32Array[],
    startFrame: number,
    frameCount: number,
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
      const targetOffset = overlapStart - startFrame;

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

    return {
      copiedFrames,
      missingFrames: Math.max(0, frameCount - copiedFrames),
    };
  }
}
