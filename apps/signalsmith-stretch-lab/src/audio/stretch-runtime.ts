export type StretchRuntimeMode = "real-worklet" | "simulator";

export interface RuntimeSelectionInput {
  readonly audioWorkletAvailable: boolean;
  readonly crossOriginIsolated: boolean;
  readonly generatedModuleUrl: string | null;
  readonly sharedArrayBufferAvailable: boolean;
  readonly sourceDecoded: boolean;
  readonly sourceAccepted: boolean;
  readonly workletReady: boolean;
}

export interface RuntimeSelection {
  readonly mode: StretchRuntimeMode;
  readonly reason: string;
}

export function selectStretchRuntimeMode(
  input: RuntimeSelectionInput,
): RuntimeSelection {
  if (!input.sharedArrayBufferAvailable) {
    return { mode: "simulator", reason: "SharedArrayBuffer unavailable" };
  }

  if (!input.crossOriginIsolated) {
    return { mode: "simulator", reason: "crossOriginIsolated is false" };
  }

  if (!input.generatedModuleUrl) {
    return { mode: "simulator", reason: "generated module missing" };
  }

  if (!input.audioWorkletAvailable) {
    return { mode: "simulator", reason: "AudioWorklet unavailable" };
  }

  if (!input.sourceDecoded) {
    return { mode: "simulator", reason: "decoded source missing" };
  }

  if (!input.workletReady || !input.sourceAccepted) {
    return {
      mode: "simulator",
      reason: "waiting for AudioWorklet ready and source accepted",
    };
  }

  return { mode: "real-worklet", reason: "real AudioWorklet accepted" };
}
