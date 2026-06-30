export interface PlanarFrameChunk {
  readonly startFrame: number;
  readonly frameCount: number;
  readonly channels: readonly Float32Array[];
}

export interface ChunkedWavSourceInfo {
  readonly kind: "wav";
  readonly sampleRate: number;
  readonly channelCount: 1 | 2;
  readonly frameCount: number;
  readonly durationSeconds: number;
  readonly memoryBytes: number;
  readonly dataOffset: number;
  readonly dataBytes: number;
  readonly blockAlign: number;
  readonly byteRate: number;
  readonly bitsPerSample: 8 | 16 | 24 | 32;
  readonly audioFormat: 1 | 3;
}

export interface ChunkedWavSourceOpenOptions {
  readonly expectedSampleRate?: number;
}

export class ChunkedWavSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChunkedWavSourceError";
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

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const FMT_MIN_BYTES = 16;

export class ChunkedWavSource {
  private constructor(
    private readonly file: File,
    readonly info: ChunkedWavSourceInfo,
  ) {}

  static async open(
    file: File,
    options: ChunkedWavSourceOpenOptions = {},
  ): Promise<ChunkedWavSource> {
    const header = await readRange(file, 0, RIFF_HEADER_BYTES);
    const headerView = viewFor(header);

    if (
      readAscii(headerView, 0, 4) !== "RIFF" ||
      readAscii(headerView, 8, 4) !== "WAVE"
    ) {
      throw new ChunkedWavSourceError("Input is not a RIFF/WAVE file.");
    }

    const riffSize = headerView.getUint32(4, true);
    if (riffSize + 8 > file.size) {
      throw new ChunkedWavSourceError("Truncated RIFF/WAVE payload.");
    }

    let offset = RIFF_HEADER_BYTES;
    let format: FormatChunk | null = null;
    let dataOffset = 0;
    let dataBytes = 0;

    while (offset + CHUNK_HEADER_BYTES <= file.size) {
      const chunkHeader = await readRange(file, offset, CHUNK_HEADER_BYTES);
      const chunkView = viewFor(chunkHeader);
      const chunkId = readAscii(chunkView, 0, 4);
      const chunkSize = chunkView.getUint32(4, true);
      const chunkDataOffset = offset + CHUNK_HEADER_BYTES;
      const paddedChunkSize = chunkSize + (chunkSize % 2);
      const nextOffset = chunkDataOffset + paddedChunkSize;

      if (chunkDataOffset + chunkSize > file.size) {
        throw new ChunkedWavSourceError(`Truncated ${chunkId} chunk.`);
      }

      if (chunkId === "fmt ") {
        const fmtBytes = await readRange(file, chunkDataOffset, chunkSize);
        format = parseFormatChunk(viewFor(fmtBytes), 0, chunkSize);
      } else if (chunkId === "data") {
        if (!format) {
          throw new ChunkedWavSourceError("Missing fmt chunk.");
        }
        dataOffset = chunkDataOffset;
        dataBytes = chunkSize;
        break;
      }

      offset = nextOffset;
    }

    if (!format) {
      throw new ChunkedWavSourceError("Missing fmt chunk.");
    }

    if (dataBytes === 0) {
      throw new ChunkedWavSourceError("Missing data chunk.");
    }

    if (dataBytes % format.blockAlign !== 0) {
      throw new ChunkedWavSourceError("Truncated data chunk.");
    }

    if (
      options.expectedSampleRate !== undefined &&
      options.expectedSampleRate !== format.sampleRate
    ) {
      throw new ChunkedWavSourceError(
        `WAV sample rate ${format.sampleRate.toString()} does not match active AudioContext sample rate ${options.expectedSampleRate.toString()}.`,
      );
    }

    const frameCount = dataBytes / format.blockAlign;
    const info: ChunkedWavSourceInfo = {
      audioFormat: format.audioFormat,
      bitsPerSample: format.bitsPerSample,
      blockAlign: format.blockAlign,
      byteRate: format.byteRate,
      channelCount: format.channelCount,
      dataBytes,
      dataOffset,
      durationSeconds: frameCount / format.sampleRate,
      frameCount,
      kind: "wav",
      memoryBytes:
        frameCount * format.channelCount * Float32Array.BYTES_PER_ELEMENT,
      sampleRate: format.sampleRate,
    };

    return new ChunkedWavSource(file, info);
  }

  async readFrames(
    startFrame: number,
    frameCount: number,
  ): Promise<PlanarFrameChunk> {
    const clampedStart = clampFrame(startFrame, 0, this.info.frameCount);
    const availableFrames = Math.max(0, this.info.frameCount - clampedStart);
    const clampedFrameCount = clampFrame(frameCount, 0, availableFrames);
    const byteStart =
      this.info.dataOffset + clampedStart * this.info.blockAlign;
    const byteCount = clampedFrameCount * this.info.blockAlign;

    const bytes =
      byteCount === 0
        ? new Uint8Array()
        : await readRange(this.file, byteStart, byteCount);

    if (bytes.byteLength !== byteCount) {
      throw new ChunkedWavSourceError("Truncated requested frame data.");
    }

    return {
      channels: decodeFrameRange(viewFor(bytes), clampedFrameCount, this.info),
      frameCount: clampedFrameCount,
      startFrame: clampedStart,
    };
  }
}

function parseFormatChunk(
  view: DataView,
  offset: number,
  size: number,
): FormatChunk {
  if (size < FMT_MIN_BYTES) {
    throw new ChunkedWavSourceError("Truncated fmt chunk.");
  }

  const rawFormat = view.getUint16(offset, true);
  if (rawFormat !== 1 && rawFormat !== 3) {
    throw new ChunkedWavSourceError("Unsupported compressed WAV format.");
  }

  const rawChannels = view.getUint16(offset + 2, true);
  if (rawChannels < 1 || rawChannels > 2) {
    throw new ChunkedWavSourceError("Unsupported WAV channel count; max is 2.");
  }

  const sampleRate = view.getUint32(offset + 4, true);
  const byteRate = view.getUint32(offset + 8, true);
  const blockAlign = view.getUint16(offset + 12, true);
  const rawBitsPerSample = view.getUint16(offset + 14, true);

  if (!isSupportedBits(rawBitsPerSample)) {
    throw new ChunkedWavSourceError("Unsupported WAV bitsPerSample.");
  }

  if (rawFormat === 3 && rawBitsPerSample !== 32) {
    throw new ChunkedWavSourceError("Unsupported IEEE float WAV bit depth.");
  }

  const expectedBlockAlign = rawChannels * (rawBitsPerSample / 8);
  if (blockAlign !== expectedBlockAlign) {
    throw new ChunkedWavSourceError("Invalid WAV blockAlign.");
  }

  const expectedByteRate = sampleRate * blockAlign;
  if (byteRate !== expectedByteRate) {
    throw new ChunkedWavSourceError("Invalid WAV byteRate.");
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

function decodeFrameRange(
  view: DataView,
  frameCount: number,
  info: ChunkedWavSourceInfo,
): readonly Float32Array[] {
  const channels = Array.from(
    { length: info.channelCount },
    () => new Float32Array(frameCount),
  );
  const bytesPerSample = info.bitsPerSample / 8;
  let cursor = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < info.channelCount; channel += 1) {
      const channelSamples = channels[channel] as Float32Array;
      channelSamples[frame] = readSample(view, cursor, info);
      cursor += bytesPerSample;
    }
  }

  return channels;
}

function readSample(
  view: DataView,
  offset: number,
  info: Pick<ChunkedWavSourceInfo, "audioFormat" | "bitsPerSample">,
): number {
  if (info.audioFormat === 3) {
    return view.getFloat32(offset, true);
  }

  switch (info.bitsPerSample) {
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

async function readRange(
  file: File,
  start: number,
  byteCount: number,
): Promise<Uint8Array> {
  const blob = file.slice(start, start + byteCount);
  return new Uint8Array(await blob.arrayBuffer());
}

function viewFor(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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

function clampFrame(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}
