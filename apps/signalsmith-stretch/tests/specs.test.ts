import {
  acceptHandoff,
  allocatePacked,
  buildHandoff,
  planLayout,
  verifyHandoff,
} from "@exclave/boundary";
import { describe, expect, it } from "vitest";

import {
  createStretchBoundarySession,
  disposeStretchBoundarySession,
  initializeDesiredControls,
  writeDesiredControls,
} from "../src/boundary/session";
import { signalsmithStretchSpec } from "../src/boundary/specs";
import {
  FORMANT_BASE_AUTO_HZ,
  FORMANT_BASE_MAX_HZ,
  FORMANT_BASE_MIN_HZ,
  FORMANT_SHIFT_MAX_SEMITONES,
  FORMANT_SHIFT_MIN_SEMITONES,
  TONALITY_LIMIT_DEFAULT_HZ,
  TONALITY_LIMIT_MAX_HZ,
  TONALITY_LIMIT_MIN_HZ,
  clampManualFormantBaseHz,
  defaultDesiredControls,
  resolveFormantBaseHz,
} from "../src/types";

const PARAM_KEYS = [
  "config.blockMs",
  "config.configSequence",
  "config.intervalMs",
  "config.preset",
  "config.splitComputation",
  "control.active",
  "control.desiredSequence",
  "control.formantBaseHz",
  "control.formantCompensation",
  "control.formantSemitones",
  "control.pitchSemitones",
  "control.rate",
  "control.tonalityEnabled",
  "control.tonalityHz",
  "control.transitionFrames",
] as const;

const RUNTIME_METER_KEYS = [
  "runtime.adapterMode",
  "runtime.audioWorkletFrameHi",
  "runtime.audioWorkletFrameLo",
  "runtime.audioWorkletTimeSeconds",
  "runtime.blockSamples",
  "runtime.bufferLengthFrames",
  "runtime.bufferReadyFrames",
  "runtime.commandDroppedTotal",
  "runtime.durationFrames",
  "runtime.durationSeconds",
  "runtime.effectiveRate",
  "runtime.heapGeneration",
  "runtime.inputLatencyFrames",
  "runtime.inputLatencySeconds",
  "runtime.inputWindowMissingFrames",
  "runtime.intervalSamples",
  "runtime.invalidSampleTotal",
  "runtime.invalidTransitionTotal",
  "runtime.lastAppliedCommandSequence",
  "runtime.lastAppliedConfigSequence",
  "runtime.lastAppliedDesiredSequence",
  "runtime.lastErrorCode",
  "runtime.loopEnabled",
  "runtime.loopEndFrame",
  "runtime.loopEndMissingFrames",
  "runtime.loopRevision",
  "runtime.loopSourceFrameInside",
  "runtime.loopStartFrame",
  "runtime.loopStartMissingFrames",
  "runtime.maxObservedRenderQuantum",
  "runtime.outputFrame",
  "runtime.outputLatencyFrames",
  "runtime.outputLatencySeconds",
  "runtime.processingCenterFrame",
  "runtime.scheduledCommandDroppedTotal",
  "runtime.scheduledCommandQueueSize",
  "runtime.sessionId",
  "runtime.sourceFrame",
  "runtime.staleReadTotal",
  "runtime.state",
  "runtime.underrunTotal",
  "runtime.workletGeneration",
] as const;

const SOURCE_METER_KEYS = [
  "source.appliedLoadSequence",
  "source.bufferEndFrame",
  "source.bufferStartFrame",
  "source.channelCount",
  "source.decodeErrorCode",
  "source.droppedBufferTotal",
  "source.durationFrames",
  "source.durationSeconds",
  "source.loadSequence",
  "source.memoryBytes",
  "source.sampleRate",
  "source.sourceRevision",
  "source.state",
] as const;

const LEVEL_METER_KEYS = [
  "levels.channelCount",
  "levels.clipLatched",
  "levels.fullScaleLeftTotal",
  "levels.fullScaleRightTotal",
  "levels.historyPeak",
  "levels.historyRms",
  "levels.invalidSampleTotal",
  "levels.lastErrorCode",
  "levels.maxAbsWindow",
  "levels.outputBranchActive",
  "levels.peakLeft",
  "levels.peakRight",
  "levels.probeState",
  "levels.referenceBranchActive",
  "levels.rmsLeft",
  "levels.rmsRight",
  "levels.silent",
  "levels.unsupportedChannelBlockTotal",
  "levels.windowEndOutputFrame",
  "levels.windowFrames",
] as const;

describe("Signalsmith Stretch boundary spec", () => {
  it("defines one exact app-private spec id", () => {
    expect(signalsmithStretchSpec.id).toBe(
      "signalsmith-stretch/runtime",
    );
  });

  it("defines the required canonical dot keys", () => {
    expect(Object.keys(signalsmithStretchSpec.params).sort()).toEqual([
      ...PARAM_KEYS,
    ]);
    expect(Object.keys(signalsmithStretchSpec.meters).sort()).toEqual(
      [...LEVEL_METER_KEYS, ...RUNTIME_METER_KEYS, ...SOURCE_METER_KEYS].sort(),
    );
  });

  it("keeps control/config/runtime/source/levels as app-private namespaces", () => {
    const paramKeys = Object.keys(signalsmithStretchSpec.params);
    const meterKeys = Object.keys(signalsmithStretchSpec.meters);

    expect(paramKeys.every((key) => /^(control|config)\./u.test(key))).toBe(
      true,
    );
    expect(
      meterKeys.every((key) => /^(runtime|source|levels)\./u.test(key)),
    ).toBe(true);
  });

  it("maps active audio controls and keeps transition reserved in the spec", () => {
    expect(signalsmithStretchSpec.params["control.rate"]).toMatchObject({
      kind: "f32",
      max: 8,
      min: 0.05,
    });
    expect(
      signalsmithStretchSpec.params["control.pitchSemitones"],
    ).toMatchObject({
      kind: "f32",
      max: 48,
      min: -48,
    });
    expect(
      signalsmithStretchSpec.params["control.tonalityHz"],
    ).toMatchObject({
      kind: "f32",
      max: TONALITY_LIMIT_MAX_HZ,
      min: TONALITY_LIMIT_MIN_HZ,
    });
    expect(
      signalsmithStretchSpec.params["control.formantSemitones"],
    ).toMatchObject({
      kind: "f32",
      max: FORMANT_SHIFT_MAX_SEMITONES,
      min: FORMANT_SHIFT_MIN_SEMITONES,
    });
    expect(
      signalsmithStretchSpec.params["control.formantBaseHz"],
    ).toMatchObject({
      kind: "f32",
      max: FORMANT_BASE_MAX_HZ,
      min: 0,
    });
    expect(signalsmithStretchSpec.params["config.preset"]).toMatchObject({
      kind: "enum",
      values: ["custom", "default", "cheaper"],
    });
    expect(
      signalsmithStretchSpec.params["control.transitionFrames"],
    ).toMatchObject({
      kind: "u32",
      max: 48_000,
      min: 0,
    });

    expect(Object.keys(signalsmithStretchSpec.params)).not.toEqual(
      expect.arrayContaining(["input", "output", "loopStart", "loopEnd"]),
    );

    for (const def of Object.values(signalsmithStretchSpec.params)) {
      expect(def.kind).not.toBe("f64");
    }
  });

  it("uses music-safe desired control defaults", () => {
    expect(defaultDesiredControls()).toMatchObject({
      formantBaseHz: FORMANT_BASE_AUTO_HZ,
      formantCompensation: false,
      formantSemitones: 0,
      tonalityHz: TONALITY_LIMIT_DEFAULT_HZ,
    });
  });

  it("keeps formant base Auto at 0 and clamps manual voice base values", () => {
    expect(resolveFormantBaseHz("auto", 125)).toBe(FORMANT_BASE_AUTO_HZ);
    expect(resolveFormantBaseHz("manual", 10)).toBe(FORMANT_BASE_MIN_HZ);
    expect(resolveFormantBaseHz("manual", 250)).toBe(250);
    expect(resolveFormantBaseHz("manual", 1_000)).toBe(FORMANT_BASE_MAX_HZ);
    expect(clampManualFormantBaseHz(Number.NaN)).toBe(FORMANT_BASE_MIN_HZ);
  });

  it("plans one non-zero backing and plane metadata block", () => {
    const plan = planLayout(signalsmithStretchSpec);

    expect(plan.bytesTotal).toBeGreaterThan(0);
    expect(plan.lockStrideBytes).toBeGreaterThan(0);
    expect(plan.planes.PU).toBeGreaterThan(0);
    expect(plan.planes.MU).toBeGreaterThan(0);
    expect(Object.values(plan.planes).some((bytes) => bytes > 0)).toBe(true);
  });

  it("builds, verifies, and accepts one handoff metadata path", () => {
    const plan = planLayout(signalsmithStretchSpec);
    const backing = allocatePacked(plan);
    const handoff = buildHandoff(plan, backing);
    const accepted = acceptHandoff(handoff);

    expect(handoff.version).toBe(1);
    expect(handoff.packing).toBe("packed");
    expect(accepted.plan.id).toBe(signalsmithStretchSpec.id);
    expect(() => {
      verifyHandoff(plan, accepted.plan);
    }).not.toThrow();
  });

  it("creates one app-private stretch session surface", () => {
    const session = createStretchBoundarySession();

    try {
      expect(Object.keys(session)).toEqual(["stretch"]);
    } finally {
      disposeStretchBoundarySession(session);
    }
  });

  it("lets the controller write params and the processor read nested aliases", () => {
    const session = createStretchBoundarySession();

    try {
      initializeDesiredControls(session);
      writeDesiredControls(session, {
        ...defaultDesiredControls(),
        active: true,
        configSequence: 2,
        desiredSequence: 2,
        intervalMs: 15,
        pitchSemitones: -3,
        preset: "cheaper",
        rate: 1.5,
      });

      let observedActive = false;
      let observedConfigSequence = 0;
      let observedIntervalMs = 0;
      let observedPreset = 0;
      let observedRate = 0;
      let observedPitch = 0;
      let observedSequence = 0;

      session.stretch.processor.params.within((params) => {
        observedActive = params.control.active;
        observedConfigSequence = params.config.configSequence;
        observedIntervalMs = params.config.intervalMs;
        observedPreset = params.config.preset;
        observedRate = params.control.rate;
        observedPitch = params.control.pitchSemitones;
        observedSequence = params.control.desiredSequence;
      });

      expect(observedActive).toBe(true);
      expect(observedConfigSequence).toBe(2);
      expect(observedIntervalMs).toBeCloseTo(15);
      expect(observedPreset).toBe(2);
      expect(observedSequence).toBe(2);
      expect(observedRate).toBeCloseTo(1.5);
      expect(observedPitch).toBeCloseTo(-3);
    } finally {
      disposeStretchBoundarySession(session);
    }
  });
});
