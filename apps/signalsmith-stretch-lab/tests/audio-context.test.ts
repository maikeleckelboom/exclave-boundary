import { afterEach, describe, expect, it } from "vitest";

import { createLabAudioContext } from "../src/audio/audio-context";

const audioContextGlobal = globalThis as Record<string, unknown>;
const originalAudioContext = audioContextGlobal.AudioContext;

describe("createLabAudioContext", () => {
  afterEach(() => {
    Reflect.deleteProperty(audioContextGlobal, "AudioContext");

    if (originalAudioContext !== undefined) {
      Object.defineProperty(audioContextGlobal, "AudioContext", {
        configurable: true,
        value: originalAudioContext,
      });
    }
  });

  it("passes a requested WAV sample rate into the AudioContext constructor", () => {
    const optionsSeen: AudioContextOptions[] = [];

    class MockAudioContext {
      readonly sampleRate: number;
      readonly state = "running";

      constructor(options: AudioContextOptions = {}) {
        optionsSeen.push(options);
        this.sampleRate = options.sampleRate ?? 48_000;
      }

      close(): Promise<void> {
        return Promise.resolve();
      }

      resume(): Promise<void> {
        return Promise.resolve();
      }
    }

    Object.defineProperty(audioContextGlobal, "AudioContext", {
      configurable: true,
      value: MockAudioContext,
    });

    const context = createLabAudioContext({ sampleRate: 44_100 });

    expect(context.sampleRate).toBe(44_100);
    expect(optionsSeen).toEqual([{ sampleRate: 44_100 }]);
  });
});
