import { describe, expect, it } from "vitest";

import {
  ChunkedWavSource,
  ChunkedWavSourceError,
} from "../src/audio/chunked-wav-source";
import { SourcePrefetch } from "../src/audio/source-prefetch";
import { computeChunkedWaveformPeaks } from "../src/audio/waveform-peaks";

interface RangeRead {
  readonly end: number | undefined;
  readonly start: number | undefined;
}

interface VirtualWavOptions {
  readonly audioFormat?: 1 | 3;
  readonly bitsPerSample?: 8 | 16 | 24 | 32;
  readonly channelCount?: number;
  readonly dataBytesOverride?: number;
  readonly frameCount?: number;
  readonly includeData?: boolean;
  readonly includeFmt?: boolean;
  readonly invalidBlockAlign?: boolean;
  readonly invalidByteRate?: boolean;
  readonly name?: string;
  readonly sampleRate?: number;
  readonly unknownChunk?: boolean;
}

interface ResolvedVirtualWavOptions {
  readonly audioFormat: 1 | 3;
  readonly bitsPerSample: 8 | 16 | 24 | 32;
  readonly channelCount: number;
  readonly dataBytesOverride: number | undefined;
  readonly includeData: boolean | undefined;
  readonly includeFmt: boolean | undefined;
  readonly invalidBlockAlign: boolean | undefined;
  readonly invalidByteRate: boolean | undefined;
  readonly sampleRate: number;
  readonly unknownChunk: boolean | undefined;
}

class VirtualWavFile {
  readonly name: string;
  readonly ranges: RangeRead[] = [];
  readonly size: number;

  private readonly bytesPerSample: number;
  private readonly dataOffset: number;
  private readonly fmtOffset: number;
  private readonly frameCount: number;
  private readonly options: ResolvedVirtualWavOptions;

  constructor(options: VirtualWavOptions = {}) {
    this.name = options.name ?? "virtual.wav";
    this.options = {
      audioFormat: options.audioFormat ?? 1,
      bitsPerSample: options.bitsPerSample ?? 16,
      channelCount: options.channelCount ?? 1,
      dataBytesOverride: options.dataBytesOverride,
      includeData: options.includeData,
      includeFmt: options.includeFmt,
      invalidBlockAlign: options.invalidBlockAlign,
      invalidByteRate: options.invalidByteRate,
      sampleRate: options.sampleRate ?? 48_000,
      unknownChunk: options.unknownChunk,
    };
    this.bytesPerSample = this.options.bitsPerSample / 8;
    this.frameCount = options.frameCount ?? 1_000_000;
    this.fmtOffset =
      12 + (this.options.unknownChunk === true ? chunkByteLength(3) : 0);
    this.dataOffset =
      this.fmtOffset +
      (this.options.includeFmt === false ? 0 : chunkByteLength(16));
    const dataBytes =
      this.options.dataBytesOverride ??
      this.frameCount * this.options.channelCount * this.bytesPerSample;
    this.size =
      this.dataOffset +
      (this.options.includeData === false ? 0 : chunkByteLength(dataBytes));
  }

  get expectedDataOffset(): number {
    return this.dataOffset + 8;
  }

  get blockAlign(): number {
    return this.options.channelCount * this.bytesPerSample;
  }

  slice(start?: number, end?: number): Blob {
    this.ranges.push({ end, start });
    const bytes = this.bytesForRange(start ?? 0, end ?? this.size);
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return new Blob([copy]);
  }

  private bytesForRange(start: number, end: number): Uint8Array {
    const length = Math.max(0, end - start);
    const bytes = new Uint8Array(length);

    for (let absolute = start; absolute < end; absolute += 1) {
      bytes[absolute - start] = this.byteAt(absolute);
    }

    return bytes;
  }

  private byteAt(offset: number): number {
    const riffSize = this.size - 8;
    const dataBytes =
      this.options.dataBytesOverride ??
      this.frameCount * this.options.channelCount * this.bytesPerSample;

    if (offset < 12) {
      return riffHeaderByte(offset, riffSize);
    }

    if (this.options.unknownChunk === true && offset < this.fmtOffset) {
      return chunkByte(offset, 12, "JUNK", new Uint8Array([1, 2, 3]));
    }

    if (
      this.options.includeFmt !== false &&
      offset >= this.fmtOffset &&
      offset < this.fmtOffset + chunkByteLength(16)
    ) {
      return chunkByte(offset, this.fmtOffset, "fmt ", this.fmtPayload());
    }

    if (
      this.options.includeData !== false &&
      offset >= this.dataOffset &&
      offset < this.dataOffset + chunkByteLength(dataBytes)
    ) {
      if (offset < this.dataOffset + 8) {
        return chunkHeaderByte(offset, this.dataOffset, "data", dataBytes);
      }

      return this.dataByte(offset - (this.dataOffset + 8));
    }

    return 0;
  }

  private fmtPayload(): Uint8Array {
    const blockAlign =
      this.options.invalidBlockAlign === true
        ? this.blockAlign + 1
        : this.blockAlign;
    const byteRate =
      this.options.invalidByteRate === true
        ? this.options.sampleRate * this.blockAlign + 1
        : this.options.sampleRate * this.blockAlign;
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);

    view.setUint16(0, this.options.audioFormat, true);
    view.setUint16(2, this.options.channelCount, true);
    view.setUint32(4, this.options.sampleRate, true);
    view.setUint32(8, byteRate, true);
    view.setUint16(12, blockAlign, true);
    view.setUint16(14, this.options.bitsPerSample, true);

    return bytes;
  }

  private dataByte(offset: number): number {
    const frame = Math.floor(offset / this.blockAlign);
    const byteInSample = offset % this.bytesPerSample;
    const value = sampleValue(frame, this.options.bitsPerSample);

    if (this.options.audioFormat === 3) {
      const scratch = new ArrayBuffer(4);
      new DataView(scratch).setFloat32(0, frame / 100, true);
      return new Uint8Array(scratch)[byteInSample] ?? 0;
    }

    if (this.options.bitsPerSample === 8) {
      return value + 128;
    }

    return (value >> (8 * byteInSample)) & 0xff;
  }
}

describe("ChunkedWavSource", () => {
  it("opens a synthetic large WAV-like File without reading the whole file", async () => {
    const file = new VirtualWavFile({ frameCount: 60 * 60 * 48_000 });
    const source = await ChunkedWavSource.open(file as unknown as File);

    expect(source.info.frameCount).toBe(60 * 60 * 48_000);
    expect(
      file.ranges.some((range) => range.start === 0 && range.end === file.size),
    ).toBe(false);
  });

  it("readFrames reads only the expected byte range", async () => {
    const file = new VirtualWavFile({ channelCount: 2, frameCount: 10_000 });
    const source = await ChunkedWavSource.open(file as unknown as File);
    file.ranges.length = 0;

    await source.readFrames(1_000, 4);

    expect(file.ranges).toEqual([
      {
        end:
          file.expectedDataOffset +
          1_000 * file.blockAlign +
          4 * file.blockAlign,
        start: file.expectedDataOffset + 1_000 * file.blockAlign,
      },
    ]);
  });

  it("decodes a frame range from the middle of the file", async () => {
    const file = new VirtualWavFile({ channelCount: 1, frameCount: 10_000 });
    const source = await ChunkedWavSource.open(file as unknown as File);
    const chunk = await source.readFrames(123, 3);

    expect(chunk.startFrame).toBe(123);
    expect(Array.from(chunk.channels[0] ?? [])).toEqual([
      123 / 32_768,
      124 / 32_768,
      125 / 32_768,
    ]);
  });

  it("decodes a seek target without decoding earlier frames", async () => {
    const file = new VirtualWavFile({ frameCount: 20_000 });
    const source = await ChunkedWavSource.open(file as unknown as File);
    file.ranges.length = 0;

    const chunk = await source.readFrames(12_000, 2);

    expect(chunk.channels[0]?.[0]).toBeCloseTo(12_000 / 32_768);
    expect(file.ranges).toHaveLength(1);
    expect(file.ranges[0]?.start).toBe(
      file.expectedDataOffset + 12_000 * file.blockAlign,
    );
  });

  it("keeps host prefetch cache below the configured byte ceiling", async () => {
    const source = await ChunkedWavSource.open(
      new VirtualWavFile({ frameCount: 100_000 }) as unknown as File,
    );
    const prefetch = new SourcePrefetch(source, {
      maxCachedBytes: 32,
      windowFrames: 8,
    });

    await prefetch.prefetchAround(1_000);
    await prefetch.prefetchAround(20_000);
    await prefetch.prefetchAround(40_000);

    expect(prefetch.facts.cachedBytes).toBeLessThanOrEqual(32);
    expect(prefetch.facts.cachedFrameCount).toBeLessThanOrEqual(8);
  });

  it("keeps host prefetch ready after an EOF read", async () => {
    const source = await ChunkedWavSource.open(
      new VirtualWavFile({ frameCount: 96_000 }) as unknown as File,
    );
    const prefetch = new SourcePrefetch(source, { windowFrames: 8 });

    await prefetch.prefetchWindow(0, 8);
    await prefetch.prefetchWindow(source.info.frameCount, 8);

    expect(prefetch.facts.ready).toBe(true);
    expect(prefetch.facts.cachedFrameCount).toBe(8);
    expect(prefetch.facts.lastReadStartFrame).toBe(source.info.frameCount);
    expect(prefetch.facts.lastReadEndFrame).toBe(source.info.frameCount);
  });

  it("generates waveform peaks from actual bounded WAV chunks", async () => {
    const file = new VirtualWavFile({ frameCount: 128 });
    const source = await ChunkedWavSource.open(file as unknown as File);
    file.ranges.length = 0;

    const waveform = await computeChunkedWaveformPeaks(source, {
      binCount: 4,
      coarseFramesPerBin: 16,
      maxFramesPerRead: 16,
      yieldEveryReads: 64,
    });

    expect(waveform.mode).toBe("actual-complete");
    expect(Math.max(...waveform.peaks)).toBeCloseTo(127 / 32_768);
    expect(
      file.ranges.every(
        (range) =>
          (range.end ?? 0) - (range.start ?? 0) <= 16 * file.blockAlign,
      ),
    ).toBe(true);
  });

  it("generates large-file coarse waveform peaks without whole-file reads", async () => {
    const file = new VirtualWavFile({ frameCount: 60 * 60 * 48_000 });
    const source = await ChunkedWavSource.open(file as unknown as File);
    file.ranges.length = 0;

    const waveform = await computeChunkedWaveformPeaks(source, {
      binCount: 16,
      coarseFramesPerBin: 512,
      complete: false,
      maxFramesPerRead: 1_024,
      yieldEveryReads: 64,
    });

    expect(waveform.mode).toBe("actual-coarse");
    expect(
      file.ranges.some((range) => range.start === 0 && range.end === file.size),
    ).toBe(false);
    expect(
      file.ranges.every(
        (range) =>
          (range.end ?? 0) - (range.start ?? 0) <= 512 * file.blockAlign,
      ),
    ).toBe(true);
  });

  it("skips unknown chunks", async () => {
    const source = await ChunkedWavSource.open(
      new VirtualWavFile({ unknownChunk: true }) as unknown as File,
    );

    expect(source.info.dataOffset).toBeGreaterThan(12);
  });

  it("decodes mono and stereo 16-bit WAV ranges", async () => {
    const mono = await ChunkedWavSource.open(
      new VirtualWavFile({ channelCount: 1 }) as unknown as File,
    );
    const stereo = await ChunkedWavSource.open(
      new VirtualWavFile({ channelCount: 2 }) as unknown as File,
    );

    expect((await mono.readFrames(10, 1)).channels).toHaveLength(1);
    expect((await stereo.readFrames(10, 1)).channels).toHaveLength(2);
  });

  it("decodes 24-bit WAV ranges", async () => {
    const source = await ChunkedWavSource.open(
      new VirtualWavFile({ bitsPerSample: 24 }) as unknown as File,
    );

    expect((await source.readFrames(20, 1)).channels[0]?.[0]).toBeCloseTo(
      20 / 8_388_608,
    );
  });

  it("decodes 32-bit float WAV ranges", async () => {
    const source = await ChunkedWavSource.open(
      new VirtualWavFile({
        audioFormat: 3,
        bitsPerSample: 32,
      }) as unknown as File,
    );

    expect((await source.readFrames(25, 1)).channels[0]?.[0]).toBeCloseTo(0.25);
  });

  it("rejects unsupported channel counts", async () => {
    await expect(
      ChunkedWavSource.open(
        new VirtualWavFile({ channelCount: 3 }) as unknown as File,
      ),
    ).rejects.toThrow(ChunkedWavSourceError);
  });

  it("rejects missing fmt and data chunks", async () => {
    await expect(
      ChunkedWavSource.open(
        new VirtualWavFile({ includeFmt: false }) as unknown as File,
      ),
    ).rejects.toThrow(/Missing fmt/u);

    await expect(
      ChunkedWavSource.open(
        new VirtualWavFile({ includeData: false }) as unknown as File,
      ),
    ).rejects.toThrow(/Missing data/u);
  });

  it("rejects invalid blockAlign", async () => {
    await expect(
      ChunkedWavSource.open(
        new VirtualWavFile({ invalidBlockAlign: true }) as unknown as File,
      ),
    ).rejects.toThrow(/blockAlign/u);
  });

  it("handles sample-rate mismatch explicitly", async () => {
    await expect(
      ChunkedWavSource.open(new VirtualWavFile() as unknown as File, {
        expectedSampleRate: 44_100,
      }),
    ).rejects.toThrow(/sample rate/u);
  });
});

function riffHeaderByte(offset: number, riffSize: number): number {
  if (offset < 4) {
    return "RIFF".charCodeAt(offset);
  }
  if (offset < 8) {
    return (riffSize >> (8 * (offset - 4))) & 0xff;
  }
  return "WAVE".charCodeAt(offset - 8);
}

function chunkByte(
  absoluteOffset: number,
  chunkOffset: number,
  id: string,
  payload: Uint8Array,
): number {
  if (absoluteOffset < chunkOffset + 8) {
    return chunkHeaderByte(absoluteOffset, chunkOffset, id, payload.length);
  }

  return payload[absoluteOffset - chunkOffset - 8] ?? 0;
}

function chunkHeaderByte(
  absoluteOffset: number,
  chunkOffset: number,
  id: string,
  size: number,
): number {
  const local = absoluteOffset - chunkOffset;
  if (local < 4) {
    return id.charCodeAt(local);
  }

  return (size >> (8 * (local - 4))) & 0xff;
}

function chunkByteLength(size: number): number {
  return 8 + size + (size % 2);
}

function sampleValue(frame: number, bitsPerSample: number): number {
  if (bitsPerSample === 24) {
    return frame;
  }

  if (bitsPerSample === 32) {
    return frame;
  }

  return frame % 32_768;
}
