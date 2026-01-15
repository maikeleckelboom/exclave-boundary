// src/types/audioworklet.d.ts

/**
 * Global Environment Variables
 * These are available globally within the AudioWorkletGlobalScope.
 */
declare const currentFrame: number;
declare const currentTime: number;
declare const sampleRate: number;

/**
 * AudioWorkletProcessor
 * * Defined as an abstract class to support strict extension.
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor
 */
declare abstract class AudioWorkletProcessor {
  /**
   * The MessagePort used to communicate with the AudioWorkletNode in the main thread.
   */
  readonly port: MessagePort;

  /**
   * Returns a list of AudioParamDescriptor objects used to define the
   * custom AudioParams for this processor.
   */
  static get parameterDescriptors(): AudioParamDescriptor[] | undefined;

  /**
   * Constructor matches the signature required by the AudioWorklet system.
   * We use 'AudioWorkletNodeOptions' (from lib.dom) instead of 'unknown' for type safety.
   */
  protected constructor(options?: AudioWorkletNodeOptions);

  /**
   * The processing algorithm.
   * * @param inputs  - An array of inputs, where each input is an array of channels (Float32Array).
   * @param inputs
   * @param outputs - An array of outputs, similar structure to inputs.
   * @param parameters - A dictionary of AudioParams calculated for this render quantum.
   * @returns boolean - Whether to keep the processor alive (true) or allow garbage collection (false).
   */
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

/**
 * Registers the class constructor with the AudioWorklet system.
 * * @param name - The name associated with the processor (must match createNode in main thread).
 * @param name
 * @param processorCtor - The constructor of the class extending AudioWorkletProcessor.
 */
declare function registerProcessor(
  name: string,
  processorCtor: new (
    options?: AudioWorkletNodeOptions,
  ) => AudioWorkletProcessor,
): void;
