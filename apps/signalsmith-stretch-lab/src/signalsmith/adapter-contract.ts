import {
  SIGNALSMITH_STRETCH_GENERATED_MODULE,
  SIGNALSMITH_WASM_EXPORTS,
} from "./module-types";
import {
  desiredStretchSpec,
  processedOutputLevelsSpec,
  runtimeStatusSpec,
  sourceStatusSpec,
} from "../boundary/specs";

export const SIGNALSMITH_ADAPTER_CONTRACT = {
  desiredControls: {
    reader: "future AudioWorklet processor",
    specId: desiredStretchSpec.id,
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
    specId: processedOutputLevelsSpec.id,
    writer: "AudioWorklet processor output-level probe",
  },
  runtimeStatus: {
    reader: "host observer",
    specId: runtimeStatusSpec.id,
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
    specId: sourceStatusSpec.id,
    writer: "source loader and AudioWorklet acceptance path",
  },
} as const;
