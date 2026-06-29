export interface AudioRuntimeSupport {
  readonly audioContext: boolean;
  readonly audioWorklet: boolean;
  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBuffer: boolean;
}

export function detectAudioRuntimeSupport(): AudioRuntimeSupport {
  return {
    audioContext: getAudioContextConstructor() !== null,
    audioWorklet: "AudioWorkletNode" in globalThis,
    crossOriginIsolated: globalThis.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
  };
}

export interface LabAudioContextOptions {
  readonly sampleRate?: number;
}

export function createLabAudioContext(
  options: LabAudioContextOptions = {},
): AudioContext {
  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) {
    throw new Error("AudioContext is unavailable in this browser context.");
  }

  return new AudioContextCtor(options);
}

export async function resumeAudioContext(
  audioContext: AudioContext,
): Promise<void> {
  if (audioContext.state !== "running") {
    await audioContext.resume();
  }
}

type AudioContextConstructor = new (
  options?: AudioContextOptions,
) => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if ("AudioContext" in globalThis) {
    return globalThis.AudioContext;
  }

  const legacy = globalThis as typeof globalThis & {
    readonly webkitAudioContext?: AudioContextConstructor;
  };

  return legacy.webkitAudioContext ?? null;
}
