import generatedModuleUrl from "virtual:signalsmith-stretch/generated-module-url";

const STRETCH_META_PATH = "../../vendor/signalsmith-stretch/.vendor-meta.json";
const LINEAR_META_PATH = "../../vendor/signalsmith-linear/.vendor-meta.json";
export const SIGNALSMITH_STRETCH_MODULE_PATH =
  "../../generated/signalsmith-stretch.module.js";

interface VendorMeta {
  readonly name: string;
  readonly source: string;
  readonly requestedRef: string;
  readonly sourceBranch?: string;
  readonly sourceTag?: string;
}

export type SignalsmithRuntimeMode = "real-adapter" | "simulator-fallback";

export interface SignalsmithWorkletAssetFacts {
  readonly generatedModuleExists: boolean;
  readonly generatedModuleUrl: string | null;
  readonly linearVendorMeta: VendorMeta | null;
  readonly realAdapterAvailable: boolean;
  readonly realAdapterStatus: string;
  readonly runtimeMode: SignalsmithRuntimeMode;
  readonly stretchVendorMeta: VendorMeta | null;
}

const vendorMetaModules = import.meta.glob<VendorMeta>(
  "../../vendor/**/.vendor-meta.json",
  {
    eager: true,
    import: "default",
  },
);

export function readSignalsmithWorkletAssets(): SignalsmithWorkletAssetFacts {
  const stretchVendorMeta = vendorMetaModules[STRETCH_META_PATH] ?? null;
  const linearVendorMeta = vendorMetaModules[LINEAR_META_PATH] ?? null;
  const missing: string[] = [];

  if (!stretchVendorMeta) {
    missing.push("vendored Stretch source missing");
  }
  if (!linearVendorMeta) {
    missing.push("vendored Linear source missing");
  }
  if (!generatedModuleUrl) {
    missing.push("generated module missing");
  }

  const generatedModuleExists = generatedModuleUrl !== null;
  const sourceAssetsPresent =
    stretchVendorMeta !== null &&
    linearVendorMeta !== null &&
    generatedModuleExists;

  return {
    generatedModuleExists,
    generatedModuleUrl,
    linearVendorMeta,
    realAdapterAvailable: sourceAssetsPresent,
    realAdapterStatus: sourceAssetsPresent
      ? "Real adapter assets available; waiting for decoded source and AudioWorklet acceptance."
      : `Real adapter unavailable: ${missing.join(", ")}.`,
    runtimeMode: sourceAssetsPresent ? "real-adapter" : "simulator-fallback",
    stretchVendorMeta,
  };
}
