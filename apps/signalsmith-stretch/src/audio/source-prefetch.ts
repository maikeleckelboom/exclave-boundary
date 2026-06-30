import type { ChunkedWavSource, PlanarFrameChunk } from "./chunked-wav-source";

export interface SourcePrefetchFacts {
  readonly cachedBytes: number;
  readonly cachedFrameCount: number;
  readonly lastReadEndFrame: number;
  readonly lastReadStartFrame: number;
  readonly ready: boolean;
  readonly underrunTotal: number;
}

export interface SourcePrefetchOptions {
  readonly maxCachedBytes?: number;
  readonly windowFrames?: number;
}

interface CachedChunk {
  readonly bytes: number;
  readonly chunk: PlanarFrameChunk;
  readonly key: string;
  readonly lastUsed: number;
}

export class SourcePrefetch {
  private readonly cache = new Map<string, CachedChunk>();
  private readonly maxCachedBytes: number;
  private readonly source: ChunkedWavSource;
  private readonly windowFrames: number;

  private cachedBytes = 0;
  private lastReadEndFrame = 0;
  private lastReadStartFrame = 0;
  private ready = false;
  private tick = 0;
  private underrunTotal = 0;

  constructor(source: ChunkedWavSource, options: SourcePrefetchOptions = {}) {
    this.source = source;
    this.windowFrames = Math.max(
      1,
      Math.floor(options.windowFrames ?? source.info.sampleRate * 2),
    );
    this.maxCachedBytes = Math.max(
      source.info.channelCount * Float32Array.BYTES_PER_ELEMENT,
      Math.floor(options.maxCachedBytes ?? 24 * 1024 * 1024),
    );
  }

  get facts(): SourcePrefetchFacts {
    return {
      cachedBytes: this.cachedBytes,
      cachedFrameCount: Math.floor(
        this.cachedBytes /
          (this.source.info.channelCount * Float32Array.BYTES_PER_ELEMENT),
      ),
      lastReadEndFrame: this.lastReadEndFrame,
      lastReadStartFrame: this.lastReadStartFrame,
      ready: this.ready,
      underrunTotal: this.underrunTotal,
    };
  }

  markUnderrun(): void {
    this.underrunTotal += 1;
  }

  async prefetchAround(frame: number): Promise<PlanarFrameChunk> {
    const halfWindow = Math.floor(this.windowFrames / 2);
    return this.prefetchWindow(
      Math.max(0, frame - halfWindow),
      this.windowFrames,
    );
  }

  async prefetchWindow(
    startFrame: number,
    frameCount: number,
  ): Promise<PlanarFrameChunk> {
    const clampedStart = clampFrame(startFrame, 0, this.source.info.frameCount);
    const clampedCount = clampFrame(
      frameCount,
      0,
      this.source.info.frameCount - clampedStart,
    );
    const key = `${clampedStart.toString()}:${clampedCount.toString()}`;
    const cached = this.cache.get(key);

    if (cached) {
      this.cache.set(key, {
        ...cached,
        lastUsed: this.nextTick(),
      });
      return cached.chunk;
    }

    const chunk = await this.source.readFrames(clampedStart, clampedCount);
    const bytes =
      chunk.frameCount *
      this.source.info.channelCount *
      Float32Array.BYTES_PER_ELEMENT;

    this.cache.set(key, {
      bytes,
      chunk,
      key,
      lastUsed: this.nextTick(),
    });
    this.cachedBytes += bytes;
    this.lastReadStartFrame = chunk.startFrame;
    this.lastReadEndFrame = chunk.startFrame + chunk.frameCount;
    this.ready = this.ready || chunk.frameCount > 0;
    this.evict();

    return chunk;
  }

  private evict(): void {
    while (this.cachedBytes > this.maxCachedBytes && this.cache.size > 1) {
      let oldest: CachedChunk | null = null;

      for (const chunk of this.cache.values()) {
        if (!oldest || chunk.lastUsed < oldest.lastUsed) {
          oldest = chunk;
        }
      }

      if (!oldest) {
        return;
      }

      this.cache.delete(oldest.key);
      this.cachedBytes -= oldest.bytes;
    }
  }

  private nextTick(): number {
    this.tick += 1;
    return this.tick;
  }
}

function clampFrame(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}
