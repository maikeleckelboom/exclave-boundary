import {
  SIGNALSMITH_STRETCH_GENERATED_MODULE,
  SIGNALSMITH_WASM_EXPORTS,
} from "./module-types";
import { signalsmithStretchSpec } from "../boundary/specs";

export const SIGNALSMITH_ADAPTER_CONTRACT = {
  stretchBoundary: {
    handoffs: 1,
    reader: "AudioWorklet processor and host observer",
    specId: signalsmithStretchSpec.id,
    writer: "host controller, source loader, and AudioWorklet processor",
  },
  desiredControls: {
    reader: "future AudioWorklet processor",
    specId: signalsmithStretchSpec.id,
    wrapperCalls: [
      "_setTransposeSemitones",
      "_setFormantSemitones",
      "_setFormantBase",
      "_configure",
      "_presetDefault",
      "_presetCheaper",
    ],
    writer: "host controller",
  },
  generatedModule: {
    exports: SIGNALSMITH_WASM_EXPORTS,
    input: "vendor/signalsmith-stretch/web/emscripten/main.cpp",
    output: SIGNALSMITH_STRETCH_GENERATED_MODULE,
  },
  processedOutputLevels: {
    reader: "host observer",
    specId: signalsmithStretchSpec.id,
    writer: "AudioWorklet processor output-level probe",
  },
  runtimeStatus: {
    reader: "host observer",
    specId: signalsmithStretchSpec.id,
    writer: "AudioWorklet processor",
    wrapperCalls: [
      "_blockSamples",
      "_intervalSamples",
      "_inputLatency",
      "_outputLatency",
      "_seek",
      "_process",
      "_flush",
    ],
  },
  sourceStatus: {
    reader: "host observer",
    specId: signalsmithStretchSpec.id,
    writer: "source loader and AudioWorklet acceptance path",
  },
} as const;
