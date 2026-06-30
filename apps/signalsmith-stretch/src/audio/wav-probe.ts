export interface WavProbe {
  readonly audioFormat: number | null;
  readonly bitsPerSample: number | null;
  readonly channelCount: number | null;
  readonly dataBytes: number | null;
  readonly dataOffset: number | null;
  readonly durationFrames: number | null;
  readonly durationSeconds: number | null;
  readonly isWav: true;
  readonly sampleRate: number | null;
}

export interface NonWavProbe {
  readonly isWav: false;
}

export type WavProbeResult = NonWavProbe | WavProbe;

export class WavProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WavProbeError";
  }
}

interface ProbeFormat {
  readonly audioFormat: number;
  readonly bitsPerSample: number;
  readonly blockAlign: number;
  readonly channelCount: number;
  readonly sampleRate: number;
}

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const FMT_PROBE_BYTES = 16;

export async function probeWavFile(file: File): Promise<WavProbeResult> {
  const header = await readRange(file, 0, RIFF_HEADER_BYTES);
  if (header.byteLength < RIFF_HEADER_BYTES) {
    return { isWav: false };
  }

  const headerView = viewFor(header);
  if (
    readAscii(headerView, 0, 4) !== "RIFF" ||
    readAscii(headerView, 8, 4) !== "WAVE"
  ) {
    return { isWav: false };
  }

  const riffSize = headerView.getUint32(4, true);
  if (riffSize + 8 > file.size) {
    throw new WavProbeError("Truncated RIFF/WAVE payload.");
  }

  let offset = RIFF_HEADER_BYTES;
  let format: ProbeFormat | null = null;
  let dataOffset: number | null = null;
  let dataBytes: number | null = null;

  while (offset + CHUNK_HEADER_BYTES <= file.size) {
    const chunkHeader = await readRange(file, offset, CHUNK_HEADER_BYTES);
    const chunkView = viewFor(chunkHeader);
    const chunkId = readAscii(chunkView, 0, 4);
    const chunkSize = chunkView.getUint32(4, true);
    const chunkDataOffset = offset + CHUNK_HEADER_BYTES;
    const nextOffset = chunkDataOffset + chunkSize + (chunkSize % 2);

    if (chunkDataOffset + chunkSize > file.size) {
      throw new WavProbeError(`Truncated ${chunkId} chunk.`);
    }

    if (chunkId === "fmt ") {
      if (chunkSize < FMT_PROBE_BYTES) {
        throw new WavProbeError("Truncated fmt chunk.");
      }
      const fmtBytes = await readRange(file, chunkDataOffset, FMT_PROBE_BYTES);
      format = parseFormatProbe(viewFor(fmtBytes));
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataBytes = chunkSize;
      if (format) {
        break;
      }
    }

    offset = nextOffset;
  }

  const durationFrames =
    format && dataBytes !== null && dataBytes % format.blockAlign === 0
      ? dataBytes / format.blockAlign
      : null;

  return {
    audioFormat: format?.audioFormat ?? null,
    bitsPerSample: format?.bitsPerSample ?? null,
    channelCount: format?.channelCount ?? null,
    dataBytes,
    dataOffset,
    durationFrames,
    durationSeconds:
      durationFrames !== null && format
        ? durationFrames / format.sampleRate
        : null,
    isWav: true,
    sampleRate: format?.sampleRate ?? null,
  };
}

function parseFormatProbe(view: DataView): ProbeFormat {
  const audioFormat = view.getUint16(0, true);
  const channelCount = view.getUint16(2, true);
  const sampleRate = view.getUint32(4, true);
  const blockAlign = view.getUint16(12, true);
  const bitsPerSample = view.getUint16(14, true);

  return {
    audioFormat,
    bitsPerSample,
    blockAlign,
    channelCount,
    sampleRate,
  };
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
