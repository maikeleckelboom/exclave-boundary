export interface DecodedWavSource {
  readonly kind: "wav";
  readonly sampleRate: number;
  readonly channelCount: 1 | 2;
  readonly frameCount: number;
  readonly durationSeconds: number;
  readonly memoryBytes: number;
  readonly format: {
    readonly audioFormat: 1 | 3;
    readonly bitsPerSample: 8 | 16 | 24 | 32;
    readonly blockAlign: number;
    readonly byteRate: number;
  };
  readonly channels: readonly Float32Array[];
}

export class WavDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WavDecodeError";
  }
}

interface FormatChunk {
  readonly audioFormat: 1 | 3;
  readonly bitsPerSample: 8 | 16 | 24 | 32;
  readonly blockAlign: number;
  readonly byteRate: number;
  readonly channelCount: 1 | 2;
  readonly sampleRate: number;
}

interface DataChunk {
  readonly offset: number;
  readonly size: number;
}

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const FMT_MIN_BYTES = 16;

export class WavDecoder {
  decode(input: ArrayBuffer | Uint8Array): DecodedWavSource {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (bytes.byteLength < RIFF_HEADER_BYTES) {
      throw new WavDecodeError("Truncated RIFF/WAVE header.");
    }

    if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
      throw new WavDecodeError("Input is not a RIFF/WAVE file.");
    }

    const riffSize = view.getUint32(4, true);
    if (riffSize + 8 > bytes.byteLength) {
      throw new WavDecodeError("Truncated RIFF/WAVE payload.");
    }

    let offset = RIFF_HEADER_BYTES;
    let format: FormatChunk | null = null;
    let data: DataChunk | null = null;

    while (offset + CHUNK_HEADER_BYTES <= bytes.byteLength) {
      const chunkId = readAscii(view, offset, 4);
      const chunkSize = view.getUint32(offset + 4, true);
      const dataOffset = offset + CHUNK_HEADER_BYTES;
      const nextOffset = dataOffset + chunkSize + (chunkSize % 2);

      if (dataOffset + chunkSize > bytes.byteLength) {
        throw new WavDecodeError(`Truncated ${chunkId} chunk.`);
      }

      if (chunkId === "fmt ") {
        format = parseFormatChunk(view, dataOffset, chunkSize);
      } else if (chunkId === "data") {
        if (!format) {
          throw new WavDecodeError("Missing fmt chunk.");
        }
        data = { offset: dataOffset, size: chunkSize };
        break;
      }

      offset = nextOffset;
    }

    if (!format) {
      throw new WavDecodeError("Missing fmt chunk.");
    }

    if (!data) {
      throw new WavDecodeError("Missing data chunk.");
    }

    if (data.size % format.blockAlign !== 0) {
      throw new WavDecodeError("Truncated data chunk.");
    }

    const frameCount = data.size / format.blockAlign;
    const channels = Array.from(
      { length: format.channelCount },
      () => new Float32Array(frameCount),
    );

    decodeFrames(view, data.offset, frameCount, format, channels);

    return {
      channelCount: format.channelCount,
      channels,
      durationSeconds: frameCount / format.sampleRate,
      format: {
        audioFormat: format.audioFormat,
        bitsPerSample: format.bitsPerSample,
        blockAlign: format.blockAlign,
        byteRate: format.byteRate,
      },
      frameCount,
      kind: "wav",
      memoryBytes:
        frameCount * format.channelCount * Float32Array.BYTES_PER_ELEMENT,
      sampleRate: format.sampleRate,
    };
  }
}

function parseFormatChunk(
  view: DataView,
  offset: number,
  size: number,
): FormatChunk {
  if (size < FMT_MIN_BYTES) {
    throw new WavDecodeError("Truncated fmt chunk.");
  }

  const rawFormat = view.getUint16(offset, true);
  if (rawFormat !== 1 && rawFormat !== 3) {
    throw new WavDecodeError("Unsupported compressed WAV format.");
  }

  const rawChannels = view.getUint16(offset + 2, true);
  if (rawChannels < 1 || rawChannels > 2) {
    throw new WavDecodeError("Unsupported WAV channel count; max is 2.");
  }

  const sampleRate = view.getUint32(offset + 4, true);
  const byteRate = view.getUint32(offset + 8, true);
  const blockAlign = view.getUint16(offset + 12, true);
  const rawBitsPerSample = view.getUint16(offset + 14, true);

  if (!isSupportedBits(rawBitsPerSample)) {
    throw new WavDecodeError("Unsupported WAV bitsPerSample.");
  }

  if (rawFormat === 3 && rawBitsPerSample !== 32) {
    throw new WavDecodeError("Unsupported IEEE float WAV bit depth.");
  }

  const bytesPerSample = rawBitsPerSample / 8;
  const expectedBlockAlign = rawChannels * bytesPerSample;
  if (blockAlign !== expectedBlockAlign) {
    throw new WavDecodeError("Invalid WAV blockAlign.");
  }

  const expectedByteRate = sampleRate * blockAlign;
  if (byteRate !== expectedByteRate) {
    throw new WavDecodeError("Invalid WAV byteRate.");
  }

  return {
    audioFormat: rawFormat,
    bitsPerSample: rawBitsPerSample,
    blockAlign,
    byteRate,
    channelCount: rawChannels as 1 | 2,
    sampleRate,
  };
}

function decodeFrames(
  view: DataView,
  offset: number,
  frameCount: number,
  format: FormatChunk,
  channels: Float32Array[],
): void {
  let cursor = offset;
  const bytesPerSample = format.bitsPerSample / 8;

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < format.channelCount; channel += 1) {
      const channelSamples = channels[channel];
      if (!channelSamples) {
        throw new WavDecodeError("Missing decoded channel buffer.");
      }
      channelSamples[frame] = readSample(view, cursor, format);
      cursor += bytesPerSample;
    }
  }
}

function readSample(
  view: DataView,
  offset: number,
  format: FormatChunk,
): number {
  if (format.audioFormat === 3) {
    return view.getFloat32(offset, true);
  }

  switch (format.bitsPerSample) {
    case 8:
      return (view.getUint8(offset) - 128) / 128;
    case 16:
      return view.getInt16(offset, true) / 32768;
    case 24:
      return readSigned24(view, offset) / 8388608;
    case 32:
      return view.getInt32(offset, true) / 2147483648;
  }
}

function readSigned24(view: DataView, offset: number): number {
  const unsigned =
    view.getUint8(offset) |
    (view.getUint8(offset + 1) << 8) |
    (view.getUint8(offset + 2) << 16);

  return unsigned & 0x800000 ? unsigned | 0xff000000 : unsigned;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}

function isSupportedBits(value: number): value is 8 | 16 | 24 | 32 {
  return value === 8 || value === 16 || value === 24 || value === 32;
}
