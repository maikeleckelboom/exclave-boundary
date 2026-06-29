import { enumIndex, SOURCE_STATES, type SourceState } from "../types";
import { ChunkedWavSource, ChunkedWavSourceError } from "./chunked-wav-source";
import {
  createChunkedWavPcmSource,
  createDecodedPcmSource,
  type DecodedPcmSource,
  type LabPcmSource,
  type PcmSourceFacts,
} from "./pcm-source";
import {
  WavDecodeError,
  WavDecoder,
  type DecodedWavSource,
} from "./wav-decoder";

import type { StretchBoundarySession } from "../boundary/session";

export const SOURCE_ERROR_CODES = {
  decodeFailed: 1_002,
  readFailed: 1_001,
  unsupportedChannelCount: 1_003,
  wavDecodeFailed: 1_004,
} as const;

export class UnsupportedChannelCountError extends Error {
  readonly code = SOURCE_ERROR_CODES.unsupportedChannelCount;

  constructor(readonly channels: number) {
    super(
      `Unsupported decoded channel count ${channels.toString()}; max is 2.`,
    );
  }
}

export interface DecodedAudioBufferLike {
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  copyFromChannel(
    destination: Float32Array,
    channelNumber: number,
    startInChannel?: number,
  ): void;
}

export interface DecodeFileSourceOptions {
  readonly expectedSampleRate?: number;
  readonly file: File;
  readonly loadSequence: number;
  readonly previousFacts: PcmSourceFacts | null;
  readonly session: StretchBoundarySession;
  readonly sourceRevision: number;
}

export async function decodeFileSource(
  audioContext: AudioContext,
  options: DecodeFileSourceOptions,
): Promise<LabPcmSource> {
  const {
    expectedSampleRate,
    file,
    loadSequence,
    previousFacts,
    session,
    sourceRevision,
  } = options;

  try {
    publishSourceStatus(session, "reading", loadSequence, sourceRevision, {
      facts: previousFacts,
    });

    publishSourceStatus(session, "decoding", loadSequence, sourceRevision, {
      facts: previousFacts,
    });
    const source = await decodeFileByType(audioContext, file, {
      ...(expectedSampleRate === undefined ? {} : { expectedSampleRate }),
      loadSequence,
      sourceRevision,
    });

    publishSourceStatus(session, "decoded", loadSequence, sourceRevision, {
      facts: source,
    });
    publishSourceStatus(session, "published", loadSequence, sourceRevision, {
      facts: source,
    });

    return source;
  } catch (error) {
    publishSourceStatus(session, "failed", loadSequence, sourceRevision, {
      errorCode: sourceErrorCode(error),
      facts: previousFacts,
    });
    throw error;
  }
}

export function copyDecodedAudioBuffer(
  decoded: DecodedAudioBufferLike,
  name: string,
  loadSequence: number,
  sourceRevision: number,
): DecodedPcmSource {
  const channelCount = decoded.numberOfChannels;

  if (channelCount < 1 || channelCount > 2) {
    throw new UnsupportedChannelCountError(channelCount);
  }

  const channels = channelCount as 1 | 2;
  const durationFrames = decoded.length;
  const planar: Float32Array[] = [];

  for (let channel = 0; channel < channels; channel += 1) {
    const copy = new Float32Array(durationFrames);
    decoded.copyFromChannel(copy, channel);
    planar.push(copy);
  }

  return createDecodedPcmSource(
    {
      channels,
      durationFrames,
      durationSeconds: decoded.duration,
      formatSummary: "browser decodeAudioData",
      memoryBytes: durationFrames * channels * Float32Array.BYTES_PER_ELEMENT,
      name,
      sampleRate: decoded.sampleRate,
    },
    planar,
    loadSequence,
    sourceRevision,
  );
}

export async function decodeArrayBufferSource(
  audioContext: AudioContext,
  arrayBuffer: ArrayBuffer,
  fileName: string,
  loadSequence: number,
  sourceRevision: number,
): Promise<DecodedPcmSource> {
  if (shouldUseWavDecoder(fileName, arrayBuffer)) {
    const wav = new WavDecoder().decode(arrayBuffer);
    return pcmSourceFromWav(wav, fileName, loadSequence, sourceRevision);
  }

  const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  return copyDecodedAudioBuffer(
    decoded,
    fileName,
    loadSequence,
    sourceRevision,
  );
}

export async function decodeFileByType(
  audioContext: AudioContext,
  file: File,
  options: {
    readonly expectedSampleRate?: number;
    readonly loadSequence: number;
    readonly sourceRevision: number;
  },
): Promise<LabPcmSource> {
  if (await shouldUseChunkedWavSource(file)) {
    const source = await ChunkedWavSource.open(file, {
      ...(options.expectedSampleRate === undefined
        ? {}
        : { expectedSampleRate: options.expectedSampleRate }),
    });
    return createChunkedWavPcmSource(
      source,
      factsFromChunkedWavSource(source, file.name),
      options.loadSequence,
      options.sourceRevision,
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  return decodeArrayBufferSource(
    audioContext,
    arrayBuffer,
    file.name,
    options.loadSequence,
    options.sourceRevision,
  );
}

export function pcmSourceFromWav(
  wav: DecodedWavSource,
  name: string,
  loadSequence: number,
  sourceRevision: number,
): DecodedPcmSource {
  return createDecodedPcmSource(
    {
      channels: wav.channelCount,
      durationFrames: wav.frameCount,
      durationSeconds: wav.durationSeconds,
      formatSummary: [
        "WAV",
        wav.format.audioFormat === 1 ? "PCM" : "float",
        `${wav.format.bitsPerSample.toString()}-bit`,
        `${wav.sampleRate.toString()} Hz`,
        wav.channelCount === 1 ? "mono" : "stereo",
      ].join(" "),
      memoryBytes: wav.memoryBytes,
      name,
      sampleRate: wav.sampleRate,
    },
    wav.channels,
    loadSequence,
    sourceRevision,
  );
}

export function publishSourceStatus(
  session: StretchBoundarySession,
  state: SourceState,
  loadSequence: number,
  sourceRevision: number,
  options: {
    readonly errorCode?: number;
    readonly facts?: PcmSourceFacts | null;
  } = {},
): void {
  const facts = options.facts;

  session.source.processor.meters.publish((writer) => {
    writer.set("appliedLoadSequence", state === "accepted" ? loadSequence : 0);
    writer.set("bufferEndFrame", facts?.durationFrames ?? 0);
    writer.set("bufferStartFrame", 0);
    writer.set("channelCount", facts?.channels ?? 0);
    writer.set("decodeErrorCode", options.errorCode ?? 0);
    writer.set("droppedBufferTotal", 0);
    writer.set("durationFrames", facts?.durationFrames ?? 0);
    writer.set("durationSeconds", facts?.durationSeconds ?? 0);
    writer.set("loadSequence", loadSequence);
    writer.set("memoryBytes", facts?.memoryBytes ?? 0);
    writer.set("sampleRate", facts?.sampleRate ?? 0);
    writer.set("sourceRevision", sourceRevision);
    writer.set("state", enumIndex(SOURCE_STATES, state));
  });
}

function sourceErrorCode(error: unknown): number {
  if (error instanceof ChunkedWavSourceError) {
    return SOURCE_ERROR_CODES.wavDecodeFailed;
  }

  if (error instanceof WavDecodeError) {
    return SOURCE_ERROR_CODES.wavDecodeFailed;
  }

  if (error instanceof UnsupportedChannelCountError) {
    return error.code;
  }

  if (error instanceof DOMException && error.name === "EncodingError") {
    return SOURCE_ERROR_CODES.decodeFailed;
  }

  return SOURCE_ERROR_CODES.readFailed;
}

function shouldUseWavDecoder(
  fileName: string,
  arrayBuffer: ArrayBuffer,
): boolean {
  if (/\.wav$/iu.test(fileName)) {
    return true;
  }

  if (arrayBuffer.byteLength < 12) {
    return false;
  }

  const view = new DataView(arrayBuffer);
  return readAscii(view, 0, 4) === "RIFF" && readAscii(view, 8, 4) === "WAVE";
}

async function shouldUseChunkedWavSource(file: File): Promise<boolean> {
  if (/\.wav$/iu.test(file.name)) {
    return true;
  }

  const header = await file.slice(0, 12).arrayBuffer();
  if (header.byteLength < 12) {
    return false;
  }

  const view = new DataView(header);
  return readAscii(view, 0, 4) === "RIFF" && readAscii(view, 8, 4) === "WAVE";
}

function factsFromChunkedWavSource(
  source: ChunkedWavSource,
  name: string,
): PcmSourceFacts {
  return {
    channels: source.info.channelCount,
    durationFrames: source.info.frameCount,
    durationSeconds: source.info.durationSeconds,
    formatSummary: [
      "WAV chunked",
      source.info.audioFormat === 1 ? "PCM" : "float",
      `${source.info.bitsPerSample.toString()}-bit`,
      `${source.info.sampleRate.toString()} Hz`,
      source.info.channelCount === 1 ? "mono" : "stereo",
    ].join(" "),
    memoryBytes: source.info.memoryBytes,
    name,
    sampleRate: source.info.sampleRate,
  };
}

function readAscii(view: DataView, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}
