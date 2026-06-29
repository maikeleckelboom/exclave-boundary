import { describe, expect, it } from "vitest";

import { WavDecodeError, WavDecoder } from "../src/audio/wav-decoder";

interface WavFixtureOptions {
  readonly audioFormat?: 1 | 3;
  readonly bitsPerSample?: 8 | 16 | 24 | 32;
  readonly channelCount?: number;
  readonly dataOverride?: Uint8Array;
  readonly includeData?: boolean;
  readonly includeFmt?: boolean;
  readonly invalidBlockAlign?: boolean;
  readonly invalidByteRate?: boolean;
  readonly sampleRate?: number;
  readonly samples?: readonly number[];
  readonly unknownChunk?: boolean;
}

describe("WavDecoder", () => {
  it("decodes mono 16-bit PCM WAV", () => {
    const decoded = new WavDecoder().decode(
      createWav({ channelCount: 1, samples: [0, 16_384, -16_384] }),
    );

    expect(decoded.kind).toBe("wav");
    expect(decoded.channelCount).toBe(1);
    expect(decoded.sampleRate).toBe(48_000);
    expect(decoded.frameCount).toBe(3);
    expect(Array.from(decoded.channels[0] ?? [])).toEqual([0, 0.5, -0.5]);
  });

  it("decodes stereo 16-bit PCM WAV", () => {
    const decoded = new WavDecoder().decode(
      createWav({
        channelCount: 2,
        samples: [0, 32_767, -32_768, 16_384],
      }),
    );

    expect(decoded.channelCount).toBe(2);
    expect(decoded.frameCount).toBe(2);
    expect(Array.from(decoded.channels[0] ?? [])).toEqual([0, -1]);
    expect(decoded.channels[1]?.[0]).toBeCloseTo(32_767 / 32_768);
    expect(decoded.channels[1]?.[1]).toBeCloseTo(0.5);
  });

  it("decodes 24-bit PCM WAV", () => {
    const decoded = new WavDecoder().decode(
      createWav({
        bitsPerSample: 24,
        channelCount: 1,
        samples: [0, 4_194_304, -4_194_304],
      }),
    );

    expect(Array.from(decoded.channels[0] ?? [])).toEqual([0, 0.5, -0.5]);
    expect(decoded.format.bitsPerSample).toBe(24);
  });

  it("decodes 32-bit float WAV", () => {
    const decoded = new WavDecoder().decode(
      createWav({
        audioFormat: 3,
        bitsPerSample: 32,
        channelCount: 1,
        samples: [0, 0.25, -0.75],
      }),
    );

    expect(Array.from(decoded.channels[0] ?? [])).toEqual([0, 0.25, -0.75]);
    expect(decoded.format.audioFormat).toBe(3);
  });

  it("ignores unknown chunks", () => {
    const decoded = new WavDecoder().decode(
      createWav({
        channelCount: 1,
        samples: [8_192],
        unknownChunk: true,
      }),
    );

    expect(decoded.frameCount).toBe(1);
    expect(decoded.channels[0]?.[0]).toBeCloseTo(0.25);
  });

  it("rejects more than 2 channels", () => {
    expect(() => {
      new WavDecoder().decode(
        createWav({ channelCount: 3, samples: [0, 0, 0] }),
      );
    }).toThrow(WavDecodeError);
  });

  it("rejects missing fmt chunk", () => {
    expect(() => {
      new WavDecoder().decode(createWav({ includeFmt: false }));
    }).toThrow(/Missing fmt/u);
  });

  it("rejects missing data chunk", () => {
    expect(() => {
      new WavDecoder().decode(createWav({ includeData: false }));
    }).toThrow(/Missing data/u);
  });

  it("rejects invalid blockAlign", () => {
    expect(() => {
      new WavDecoder().decode(createWav({ invalidBlockAlign: true }));
    }).toThrow(/blockAlign/u);
  });

  it("rejects truncated data chunk", () => {
    expect(() => {
      new WavDecoder().decode(
        createWav({
          bitsPerSample: 16,
          channelCount: 2,
          dataOverride: new Uint8Array([0, 0, 1]),
        }),
      );
    }).toThrow(/Truncated data/u);
  });
});

function createWav(options: WavFixtureOptions = {}): ArrayBuffer {
  const audioFormat = options.audioFormat ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const channelCount = options.channelCount ?? 1;
  const sampleRate = options.sampleRate ?? 48_000;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const sampleData =
    options.dataOverride ??
    encodeSamples(audioFormat, bitsPerSample, options.samples ?? [0]);

  const chunks: Uint8Array[] = [];

  if (options.includeFmt !== false) {
    const fmt = new Uint8Array(16);
    const view = new DataView(fmt.buffer);
    view.setUint16(0, audioFormat, true);
    view.setUint16(2, channelCount, true);
    view.setUint32(4, sampleRate, true);
    view.setUint32(
      8,
      options.invalidByteRate === true ? byteRate + 1 : byteRate,
      true,
    );
    view.setUint16(
      12,
      options.invalidBlockAlign === true ? blockAlign + 1 : blockAlign,
      true,
    );
    view.setUint16(14, bitsPerSample, true);
    chunks.push(chunk("fmt ", fmt));
  }

  if (options.unknownChunk === true) {
    chunks.push(chunk("JUNK", new Uint8Array([1, 2, 3])));
  }

  if (options.includeData !== false) {
    chunks.push(chunk("data", sampleData));
  }

  const riffSize = 4 + chunks.reduce((total, item) => total + item.length, 0);
  const bytes = new Uint8Array(8 + riffSize);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, riffSize, true);
  writeAscii(bytes, 8, "WAVE");

  let offset = 12;
  for (const item of chunks) {
    bytes.set(item, offset);
    offset += item.length;
  }

  return bytes.buffer;
}

function chunk(id: string, payload: Uint8Array): Uint8Array {
  const padding = payload.length % 2;
  const bytes = new Uint8Array(8 + payload.length + padding);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, id);
  view.setUint32(4, payload.length, true);
  bytes.set(payload, 8);
  return bytes;
}

function encodeSamples(
  audioFormat: 1 | 3,
  bitsPerSample: number,
  samples: readonly number[],
): Uint8Array {
  const bytes = new Uint8Array(samples.length * (bitsPerSample / 8));
  const view = new DataView(bytes.buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const offset = index * (bitsPerSample / 8);
    const sample = samples[index] ?? 0;

    if (audioFormat === 3) {
      view.setFloat32(offset, sample, true);
    } else if (bitsPerSample === 8) {
      view.setUint8(offset, sample);
    } else if (bitsPerSample === 16) {
      view.setInt16(offset, sample, true);
    } else if (bitsPerSample === 24) {
      writeInt24(bytes, offset, sample);
    } else if (bitsPerSample === 32) {
      view.setInt32(offset, sample, true);
    }
  }

  return bytes;
}

function writeInt24(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}
