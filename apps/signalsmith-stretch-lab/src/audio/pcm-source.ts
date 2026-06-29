import type { SimulatedSource } from "../types";
import type { ChunkedWavSource } from "./chunked-wav-source";

export interface PcmSourceFacts {
  readonly channels: 1 | 2;
  readonly durationFrames: number;
  readonly durationSeconds: number;
  readonly formatSummary: string;
  readonly memoryBytes: number;
  readonly name: string;
  readonly sampleRate: number;
}

export interface DecodedPcmSource extends PcmSourceFacts {
  readonly kind: "decoded-pcm";
  readonly loadSequence: number;
  readonly planar: readonly Float32Array[];
  readonly sourceRevision: number;
}

export interface ChunkedWavPcmSource extends PcmSourceFacts {
  readonly kind: "chunked-wav";
  readonly loadSequence: number;
  readonly source: ChunkedWavSource;
  readonly sourceRevision: number;
}

export type LabPcmSource = ChunkedWavPcmSource | DecodedPcmSource;

export function createDecodedPcmSource(
  facts: PcmSourceFacts,
  planar: readonly Float32Array[],
  loadSequence: number,
  sourceRevision: number,
): DecodedPcmSource {
  return {
    ...facts,
    kind: "decoded-pcm",
    loadSequence,
    planar,
    sourceRevision,
  };
}

export function createChunkedWavPcmSource(
  source: ChunkedWavSource,
  facts: PcmSourceFacts,
  loadSequence: number,
  sourceRevision: number,
): ChunkedWavPcmSource {
  return {
    ...facts,
    kind: "chunked-wav",
    loadSequence,
    source,
    sourceRevision,
  };
}

export function simulatedSourceFromPcm(source: LabPcmSource): SimulatedSource {
  return {
    channels: source.channels,
    durationSeconds: source.durationSeconds,
    frames: source.durationFrames,
    memoryBytes: source.memoryBytes,
    name: source.name,
    sampleRate: source.sampleRate,
    status: "decoded-file",
  };
}
