import { describe, expect, it } from "vitest";

import { chooseReferencePreviewSyncAction } from "../src/audio/source-reference-monitor";
import {
  chooseTransportRefill,
  emptyTransportBufferExpectation,
  noteTransportChunkPosted,
  reconcileTransportBufferExpectation,
  speculativeTransportBufferEndFrame,
} from "../src/audio/transport-refill";

import type {
  RuntimeStatusSnapshot,
  SourceStatusSnapshot,
} from "../src/types";

const SAMPLE_RATE = 48_000;

describe("audio transport scheduling", () => {
  it("requests contiguous Worklet source data when buffered-ahead frames are low", () => {
    const decision = chooseTransportRefill({
      active: true,
      runtime: runtimeStatus({
        sourceFrame: SAMPLE_RATE,
      }),
      sourceFrameCount: SAMPLE_RATE * 120,
      sourceSampleRate: SAMPLE_RATE,
      sourceStatus: sourceStatus({
        bufferEndFrame: SAMPLE_RATE * 4,
      }),
    });

    expect(decision).toMatchObject({
      reason: "ahead-low",
      startFrame: SAMPLE_RATE * 4,
    });
    expect(decision?.frameCount).toBe(SAMPLE_RATE * 4);
  });

  it("does not request source data when the Worklet cache is above target ahead", () => {
    const decision = chooseTransportRefill({
      active: true,
      runtime: runtimeStatus({
        sourceFrame: SAMPLE_RATE,
      }),
      sourceFrameCount: SAMPLE_RATE * 120,
      sourceSampleRate: SAMPLE_RATE,
      sourceStatus: sourceStatus({
        bufferEndFrame: SAMPLE_RATE * 40,
      }),
    });

    expect(decision).toBeNull();
  });

  it("repairs the current Worklet input window after a seek beyond cached frames", () => {
    const decision = chooseTransportRefill({
      active: true,
      runtime: runtimeStatus({
        sourceFrame: SAMPLE_RATE * 30,
      }),
      sourceFrameCount: SAMPLE_RATE * 120,
      sourceSampleRate: SAMPLE_RATE,
      sourceStatus: sourceStatus({
        bufferEndFrame: SAMPLE_RATE * 5,
      }),
    });

    expect(decision?.reason).toBe("current-window-missing");
    expect(decision?.startFrame).toBeGreaterThan(SAMPLE_RATE * 29);
    expect(decision?.startFrame).toBeLessThan(SAMPLE_RATE * 31);
  });

  it("repairs the current Worklet input window even with an optimistic expected buffer end", () => {
    const decision = chooseTransportRefill({
      active: true,
      expectedBufferEndFrame: SAMPLE_RATE * 80,
      runtime: runtimeStatus({
        sourceFrame: SAMPLE_RATE * 30,
      }),
      sourceFrameCount: SAMPLE_RATE * 120,
      sourceSampleRate: SAMPLE_RATE,
      sourceStatus: sourceStatus({
        bufferEndFrame: SAMPLE_RATE * 5,
      }),
    });

    expect(decision?.reason).toBe("current-window-missing");
    expect(decision?.startFrame).toBeGreaterThan(SAMPLE_RATE * 29);
    expect(decision?.startFrame).toBeLessThan(SAMPLE_RATE * 31);
  });

  it("repairs active-loop input windows from actual coverage misses", () => {
    const decision = chooseTransportRefill({
      active: true,
      runtime: runtimeStatus({
        inputWindowMissingFrames: 512,
        loopEnabled: true,
        loopEndFrame: SAMPLE_RATE * 4,
        loopSourceFrameInside: true,
        loopStartFrame: SAMPLE_RATE,
        sourceFrame: SAMPLE_RATE * 2,
      }),
      sourceFrameCount: SAMPLE_RATE * 120,
      sourceSampleRate: SAMPLE_RATE,
      sourceStatus: sourceStatus({
        bufferEndFrame: SAMPLE_RATE * 4,
        bufferStartFrame: SAMPLE_RATE,
      }),
    });

    expect(decision?.reason).toBe("current-window-missing");
    expect(decision?.startFrame).toBeGreaterThan(SAMPLE_RATE * 1.9);
    expect(decision?.startFrame).toBeLessThan(SAMPLE_RATE * 2.1);
  });

  it("keeps the loop-start cache window warm during active loop playback", () => {
    const decision = chooseTransportRefill({
      active: true,
      runtime: runtimeStatus({
        loopEnabled: true,
        loopEndFrame: SAMPLE_RATE * 4,
        loopSourceFrameInside: true,
        loopStartFrame: SAMPLE_RATE,
        loopStartMissingFrames: 1_024,
        sourceFrame: SAMPLE_RATE * 2,
      }),
      sourceFrameCount: SAMPLE_RATE * 120,
      sourceSampleRate: SAMPLE_RATE,
      sourceStatus: sourceStatus({
        bufferEndFrame: SAMPLE_RATE * 4,
        bufferStartFrame: SAMPLE_RATE,
      }),
    });

    expect(decision).toMatchObject({
      reason: "loop-boundary-missing",
      startFrame: SAMPLE_RATE,
    });
  });

  it("keeps the loop-end cache window warm during active loop playback", () => {
    const decision = chooseTransportRefill({
      active: true,
      runtime: runtimeStatus({
        loopEnabled: true,
        loopEndFrame: SAMPLE_RATE * 4,
        loopEndMissingFrames: 1_024,
        loopSourceFrameInside: true,
        loopStartFrame: SAMPLE_RATE,
        sourceFrame: SAMPLE_RATE * 2,
      }),
      sourceFrameCount: SAMPLE_RATE * 120,
      sourceSampleRate: SAMPLE_RATE,
      sourceStatus: sourceStatus({
        bufferEndFrame: SAMPLE_RATE * 4,
        bufferStartFrame: SAMPLE_RATE,
      }),
    });

    expect(decision?.reason).toBe("loop-boundary-missing");
    expect(decision?.startFrame).toBeGreaterThanOrEqual(SAMPLE_RATE);
    expect(decision?.startFrame).toBeLessThan(SAMPLE_RATE * 4);
  });

  it("treats posted Worklet buffer end as speculative until source status confirms it", () => {
    let expectation = noteTransportChunkPosted({
      current: emptyTransportBufferExpectation(),
      endFrame: SAMPLE_RATE * 40,
      sourceFrameCount: SAMPLE_RATE * 120,
      sourceRevision: 1,
    });

    expect(expectation.state).toBe("speculative");
    expect(speculativeTransportBufferEndFrame(expectation)).toBe(
      SAMPLE_RATE * 40,
    );

    expect(
      chooseTransportRefill({
        active: true,
        expectedBufferEndFrame: speculativeTransportBufferEndFrame(expectation),
        runtime: runtimeStatus({
          sourceFrame: SAMPLE_RATE,
        }),
        sourceFrameCount: SAMPLE_RATE * 120,
        sourceSampleRate: SAMPLE_RATE,
        sourceStatus: sourceStatus({
          bufferEndFrame: SAMPLE_RATE * 4,
        }),
      }),
    ).toBeNull();

    for (let cycle = 0; cycle < 3; cycle += 1) {
      expectation = reconcileTransportBufferExpectation({
        current: expectation,
        sourceFrameCount: SAMPLE_RATE * 120,
        sourceRevision: 1,
        sourceStatus: sourceStatus({
          bufferEndFrame: SAMPLE_RATE * 4,
        }),
      });
    }

    expect(expectation.state).toBe("speculative");

    expectation = reconcileTransportBufferExpectation({
      current: expectation,
      sourceFrameCount: SAMPLE_RATE * 120,
      sourceRevision: 1,
      sourceStatus: sourceStatus({
        bufferEndFrame: SAMPLE_RATE * 4,
      }),
    });

    expect(expectation.state).toBe("none");
    expect(speculativeTransportBufferEndFrame(expectation)).toBe(0);

    const resumedDecision = chooseTransportRefill({
      active: true,
      expectedBufferEndFrame: speculativeTransportBufferEndFrame(expectation),
      runtime: runtimeStatus({
        sourceFrame: SAMPLE_RATE,
      }),
      sourceFrameCount: SAMPLE_RATE * 120,
      sourceSampleRate: SAMPLE_RATE,
      sourceStatus: sourceStatus({
        bufferEndFrame: SAMPLE_RATE * 4,
      }),
    });

    expect(resumedDecision?.reason).toBe("ahead-low");
    expect(resumedDecision?.startFrame).toBe(SAMPLE_RATE * 4);
  });

  it("confirms a speculative Worklet buffer end after observed status catches up", () => {
    const expectation = reconcileTransportBufferExpectation({
      current: noteTransportChunkPosted({
        current: emptyTransportBufferExpectation(),
        endFrame: SAMPLE_RATE * 40,
        sourceFrameCount: SAMPLE_RATE * 120,
        sourceRevision: 1,
      }),
      sourceFrameCount: SAMPLE_RATE * 120,
      sourceRevision: 1,
      sourceStatus: sourceStatus({
        bufferEndFrame: SAMPLE_RATE * 40,
      }),
    });

    expect(expectation).toMatchObject({
      endFrame: SAMPLE_RATE * 40,
      state: "confirmed",
      unconfirmedPumpCount: 0,
    });
    expect(speculativeTransportBufferEndFrame(expectation)).toBe(0);
  });

  it("keeps the original-preview scheduler running under normal clock drift", () => {
    expect(
      chooseReferencePreviewSyncAction({
        active: true,
        driftToleranceFrames: 4_096,
        lastRevision: 3,
        playbackRate: 1,
        predictedFrame: 48_000,
        scheduledPlaybackRate: 1,
        sourceRevision: 3,
        targetFrame: 48_256,
      }),
    ).toBe("continue");
  });

  it("resyncs the original preview after a seek or meaningful drift", () => {
    expect(
      chooseReferencePreviewSyncAction({
        active: true,
        driftToleranceFrames: 4_096,
        lastRevision: 3,
        playbackRate: 1,
        predictedFrame: 48_000,
        scheduledPlaybackRate: 1,
        sourceRevision: 3,
        targetFrame: 60_000,
      }),
    ).toBe("resync");
  });
});

function runtimeStatus(
  overrides: Partial<RuntimeStatusSnapshot> = {},
): RuntimeStatusSnapshot {
  const base: RuntimeStatusSnapshot = {
    adapterMode: "real-worklet",
    adapterModeIndex: 1,
    audioWorkletFrameHi: 0,
    audioWorkletFrameLo: 0,
    audioWorkletTimeSeconds: 0,
    blockSamples: 5_760,
    bufferLengthFrames: 7_200,
    bufferReadyFrames: 0,
    commandDroppedTotal: 0,
    durationFrames: SAMPLE_RATE * 120,
    durationSeconds: 120,
    effectiveRate: 1,
    heapGeneration: 1,
    inputLatencyFrames: 5_760,
    inputLatencySeconds: 0.12,
    inputWindowMissingFrames: 0,
    intervalSamples: 1_440,
    invalidSampleTotal: 0,
    invalidTransitionTotal: 0,
    lastAppliedCommandSequence: 0,
    lastAppliedConfigSequence: 0,
    lastAppliedDesiredSequence: 0,
    lastErrorCode: 0,
    loopEnabled: false,
    loopEndFrame: 0,
    loopEndMissingFrames: 0,
    loopRevision: 0,
    loopSourceFrameInside: false,
    loopStartFrame: 0,
    loopStartMissingFrames: 0,
    maxObservedRenderQuantum: 128,
    outputFrame: 0,
    outputLatencyFrames: 1_440,
    outputLatencySeconds: 0.03,
    processingCenterFrame: 0,
    scheduledCommandDroppedTotal: 0,
    scheduledCommandQueueSize: 0,
    sessionId: 1,
    sourceFrame: 0,
    staleReadTotal: 0,
    state: "playing",
    stateIndex: 3,
    underrunTotal: 0,
    workletGeneration: 1,
  };

  return { ...base, ...overrides };
}

function sourceStatus(
  overrides: Partial<SourceStatusSnapshot> = {},
): SourceStatusSnapshot {
  const base: SourceStatusSnapshot = {
    appliedLoadSequence: 1,
    bufferEndFrame: 0,
    bufferStartFrame: 0,
    channelCount: 2,
    decodeErrorCode: 0,
    droppedBufferTotal: 0,
    durationFrames: SAMPLE_RATE * 120,
    durationSeconds: 120,
    loadSequence: 1,
    memoryBytes: 0,
    sampleRate: SAMPLE_RATE,
    sourceRevision: 1,
    state: "accepted",
    stateIndex: 5,
  };

  return { ...base, ...overrides };
}
