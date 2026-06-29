import { describe, expect, it } from "vitest";

import {
  createStretchCommandTransport,
  decodeF64FromU32Words,
  encodeF64ToU32Words,
  STRETCH_COMMAND_WORDS_PER_SLOT,
  type StretchCommand,
} from "../src/boundary/commands";

function drainOne(command: StretchCommand): StretchCommand {
  const transport = createStretchCommandTransport(4);
  expect(transport.enqueue(command.name, command).accepted).toBe(true);

  const drained: StretchCommand[] = [];
  transport.drain((item) => {
    drained.push(item);
  });

  expect(drained).toHaveLength(1);
  return drained.pop() ?? failExpectedCommand();
}

function failExpectedCommand(): never {
  throw new Error("Expected one drained command.");
}

describe("stretch command ABI", () => {
  it("uses the fixed 24-word app-private command slot", () => {
    expect(STRETCH_COMMAND_WORDS_PER_SLOT).toBe(24);
  });

  it("roundtrips f64 payload words", () => {
    for (const value of [0, -0, 1, -1, 0.5, 48_000.25, 2 ** 32, Math.PI]) {
      const words = encodeF64ToU32Words(value);
      expect(decodeF64FromU32Words(words.lo, words.hi)).toBe(value);
    }
  });

  it("roundtrips seek target source frame payloads", () => {
    const command = drainOne({
      blockMs: 0,
      configSequence: 0,
      desiredSequence: 0,
      flags: 0,
      flushOutputFrames: 0,
      id: 0,
      intervalMs: 0,
      loopEndFrame: 0,
      loopStartFrame: 0,
      name: "seek",
      presetIndex: 0,
      reserved0: 0,
      reserved1: 0,
      scheduledOutputFrame: 0,
      sequence: 0,
      sourceRevision: 0,
      splitComputation: false,
      targetSourceFrame: 123_456.75,
    });

    expect(command.name).toBe("seek");
    expect(command.targetSourceFrame).toBe(123_456.75);
  });

  it("roundtrips loop start and end frames", () => {
    const command = drainOne({
      blockMs: 0,
      configSequence: 0,
      desiredSequence: 0,
      flags: 0,
      flushOutputFrames: 0,
      id: 0,
      intervalMs: 0,
      loopEndFrame: 24_000.5,
      loopStartFrame: 12_000.25,
      name: "setLoop",
      presetIndex: 0,
      reserved0: 0,
      reserved1: 0,
      scheduledOutputFrame: 0,
      sequence: 0,
      sourceRevision: 0,
      splitComputation: false,
      targetSourceFrame: 0,
    });

    expect(command.name).toBe("setLoop");
    expect(command.loopStartFrame).toBe(12_000.25);
    expect(command.loopEndFrame).toBe(24_000.5);
  });

  it("roundtrips configure command payloads", () => {
    const command = drainOne({
      blockMs: 120.5,
      configSequence: 9,
      desiredSequence: 8,
      flags: 3,
      flushOutputFrames: 0,
      id: 0,
      intervalMs: 30.25,
      loopEndFrame: 0,
      loopStartFrame: 0,
      name: "configure",
      presetIndex: 2,
      reserved0: 0,
      reserved1: 0,
      scheduledOutputFrame: 512,
      sequence: 0,
      sourceRevision: 4,
      splitComputation: true,
      targetSourceFrame: 0,
    });

    expect(command.name).toBe("configure");
    expect(command.flags).toBe(3);
    expect(command.sourceRevision).toBe(4);
    expect(command.desiredSequence).toBe(8);
    expect(command.configSequence).toBe(9);
    expect(command.blockMs).toBe(120.5);
    expect(command.intervalMs).toBe(30.25);
    expect(command.presetIndex).toBe(2);
    expect(command.splitComputation).toBe(true);
    expect(command.scheduledOutputFrame).toBe(512);
  });

  it("keeps newest-command drop accounting on overflow", () => {
    const transport = createStretchCommandTransport(2);

    expect(transport.enqueue("play").accepted).toBe(true);
    expect(transport.enqueue("pause").accepted).toBe(false);
    expect(transport.stats().dropped).toBe(1);
  });
});
