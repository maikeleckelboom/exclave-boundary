// Stub AudioWorkletProcessor for worklet-mount imports in Node.js test environment
class AudioWorkletProcessorStub {
  port = {
    postMessage: () => {},
    addEventListener: () => {},
    start: () => {},
  };

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    return true;
  }
}

// Add to global scope for test environment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).AudioWorkletProcessor = AudioWorkletProcessorStub;