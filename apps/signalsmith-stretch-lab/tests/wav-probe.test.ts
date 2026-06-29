import { describe, expect, it } from "vitest";

import { probeWavFile } from "../src/audio/wav-probe";

interface RangeRead {
  readonly end: number | undefined;
  readonly start: number | undefined;
}

class VirtualProbeWavFile {
  readonly name = "probe.wav";
  readonly ranges: RangeRead[] = [];
  readonly size: number;

  private readonly bitsPerSample = 16;
  private readonly channelCount = 2;
  private readonly dataOffset = 36;
  private readonly frameCount = 60 * 60 * 44_100;
  private readonly sampleRate = 44_100;

  constructor() {
    this.size = this.dataOffset + 8 + this.frameCount * this.blockAlign;
  }

  get blockAlign(): number {
    return this.channelCount * (this.bitsPerSample / 8);
  }

  slice(start?: number, end?: number): Blob {
    this.ranges.push({ end, start });
    const bytes = this.bytesForRange(start ?? 0, end ?? this.size);
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return new Blob([copy]);
  }

  private bytesForRange(start: number, end: number): Uint8Array {
    const bytes = new Uint8Array(Math.max(0, end - start));

    for (let offset = start; offset < end; offset += 1) {
      bytes[offset - start] = this.byteAt(offset);
    }

    return bytes;
  }

  private byteAt(offset: number): number {
    const dataBytes = this.frameCount * this.blockAlign;

    if (offset < 12) {
      return riffHeaderByte(offset, this.size - 8);
    }

    if (offset < this.dataOffset) {
      return chunkByte(offset, 12, "fmt ", this.fmtPayload());
    }

    if (offset < this.dataOffset + 8) {
      return chunkHeaderByte(offset, this.dataOffset, "data", dataBytes);
    }

    return 0;
  }

  private fmtPayload(): Uint8Array {
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);

    view.setUint16(0, 1, true);
    view.setUint16(2, this.channelCount, true);
    view.setUint32(4, this.sampleRate, true);
    view.setUint32(8, this.sampleRate * this.blockAlign, true);
    view.setUint16(12, this.blockAlign, true);
    view.setUint16(14, this.bitsPerSample, true);

    return bytes;
  }
}

describe("probeWavFile", () => {
  it("reads only header and chunk ranges for a large WAV", async () => {
    const file = new VirtualProbeWavFile();
    const probe = await probeWavFile(file as unknown as File);

    expect(probe).toMatchObject({
      audioFormat: 1,
      bitsPerSample: 16,
      channelCount: 2,
      durationFrames: 60 * 60 * 44_100,
      isWav: true,
      sampleRate: 44_100,
    });
    expect(file.ranges).toEqual([
      { end: 12, start: 0 },
      { end: 20, start: 12 },
      { end: 36, start: 20 },
      { end: 44, start: 36 },
    ]);
    expect(
      file.ranges.some((range) => range.start === 0 && range.end === file.size),
    ).toBe(false);
  });

  it("stops after the RIFF probe for non-WAV input", async () => {
    const file = {
      name: "source.mp3",
      ranges: [] as RangeRead[],
      size: 128,
      slice(start?: number, end?: number): Blob {
        this.ranges.push({ end, start });
        return new Blob([
          new ArrayBuffer(Math.max(0, (end ?? 0) - (start ?? 0))),
        ]);
      },
    };

    await expect(probeWavFile(file as unknown as File)).resolves.toEqual({
      isWav: false,
    });
    expect(file.ranges).toEqual([{ end: 12, start: 0 }]);
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
