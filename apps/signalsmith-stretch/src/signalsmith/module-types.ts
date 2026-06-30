export const SIGNALSMITH_STRETCH_GENERATED_MODULE =
  "generated/signalsmith-stretch.module.js";

export const SIGNALSMITH_WASM_EXPORTS = [
  "_malloc",
  "_free",
  "_setBuffers",
  "_blockSamples",
  "_intervalSamples",
  "_inputLatency",
  "_outputLatency",
  "_reset",
  "_presetDefault",
  "_presetCheaper",
  "_configure",
  "_setTransposeFactor",
  "_setTransposeSemitones",
  "_setFormantFactor",
  "_setFormantSemitones",
  "_setFormantBase",
  "_seek",
  "_process",
  "_flush",
] as const;

export type SignalsmithWasmExport = (typeof SIGNALSMITH_WASM_EXPORTS)[number];

export interface SignalsmithStretchModule {
  readonly HEAPF32: Float32Array;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  _setBuffers(channels: number, length: number): number;
  _blockSamples(): number;
  _intervalSamples(): number;
  _inputLatency(): number;
  _outputLatency(): number;
  _reset(): void;
  _presetDefault(channels: number, sampleRate: number): void;
  _presetCheaper(channels: number, sampleRate: number): void;
  _configure(
    channels: number,
    blockSamples: number,
    intervalSamples: number,
    splitComputation: boolean | number,
  ): void;
  _setTransposeFactor(multiplier: number, tonalityLimit: number): void;
  _setTransposeSemitones(semitones: number, tonalityLimit: number): void;
  _setFormantFactor(multiplier: number, compensate: boolean | number): void;
  _setFormantSemitones(semitones: number, compensate: boolean | number): void;
  _setFormantBase(freq: number): void;
  _seek(inputSamples: number, playbackRate: number): void;
  _process(inputSamples: number, outputSamples: number): void;
  _flush(outputSamples: number): void;
}

export type SignalsmithStretchModuleFactory =
  () => Promise<SignalsmithStretchModule>;
