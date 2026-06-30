import { describe, expect, it } from "vitest";

import { createStretchCommandTransport } from "../src/boundary/commands";
import {
  createStretchBoundarySession,
  disposeStretchBoundarySession,
  initializeDesiredControls,
  readProcessedLevels,
  readRuntimeStatus,
  readSourceStatus,
  writeDesiredControls,
} from "../src/boundary/session";
import { FakeStretchEngine } from "../src/runtime/fake-stretch-engine";
import { defaultDesiredControls, defaultSimulatedSource } from "../src/types";

function setup(capacity = 16) {
  const session = createStretchBoundarySession();
  const transport = createStretchCommandTransport(capacity);
  initializeDesiredControls(session);
  const engine = new FakeStretchEngine(session, transport, {
    applyDelayTicks: 2,
  });
  engine.tick({ renderQuantum: 128 });

  return { engine, session, transport };
}

describe("FakeStretchEngine", () => {
  it("publishes simulator runtime and source status fields", () => {
    const { engine, session } = setup();

    try {
      const runtime = readRuntimeStatus(session);
      const source = readSourceStatus(session);

      expect(runtime.adapterMode).toBe("simulator");
      expect(runtime.effectiveRate).toBeCloseTo(1);
      expect(runtime.blockSamples).toBe(5_760);
      expect(runtime.intervalSamples).toBe(1_440);
      expect(runtime.inputLatencyFrames).toBe(5_760);
      expect(runtime.outputLatencyFrames).toBe(1_440);
      expect(runtime.bufferLengthFrames).toBe(7_200);
      expect(runtime.durationFrames).toBe(engine.currentSource.frames);
      expect(runtime.durationSeconds).toBe(
        engine.currentSource.durationSeconds,
      );
      expect(runtime.heapGeneration).toBe(0);
      expect(runtime.workletGeneration).toBe(0);

      expect(source.state).toBe("accepted");
      expect(source.sourceRevision).toBe(1);
      expect(source.loadSequence).toBe(1);
      expect(source.appliedLoadSequence).toBe(1);
      expect(source.sampleRate).toBe(engine.currentSource.sampleRate);
      expect(source.channelCount).toBe(engine.currentSource.channels);
      expect(source.durationFrames).toBe(engine.currentSource.frames);
      expect(source.bufferEndFrame).toBe(engine.currentSource.frames);
    } finally {
      disposeStretchBoundarySession(session);
    }
  });

  it("keeps desired changes pending before applying the sequence", () => {
    const { engine, session } = setup();

    try {
      writeDesiredControls(session, {
        ...defaultDesiredControls(),
        desiredSequence: 2,
        rate: 2,
      });

      const pending = engine.tick({ renderQuantum: 128 });
      expect(pending.pendingDesiredSequence).toBe(2);
      expect(pending.runtime.lastAppliedDesiredSequence).toBe(1);

      const applied = engine.tick({ renderQuantum: 128 });
      expect(applied.pendingDesiredSequence).toBeNull();
      expect(applied.runtime.lastAppliedDesiredSequence).toBe(2);
      expect(applied.runtime.adapterMode).toBe("simulator");
      expect(applied.runtime.effectiveRate).toBeCloseTo(2);
    } finally {
      disposeStretchBoundarySession(session);
    }
  });

  it("publishes source status when simulator metadata source changes", () => {
    const { engine, session } = setup();

    try {
      engine.loadSource({
        ...defaultSimulatedSource(),
        channels: 1,
        durationSeconds: 10,
        frames: 480_000,
        memoryBytes: 480_000 * Float32Array.BYTES_PER_ELEMENT,
        name: "short-mono.wav",
        status: "file-metadata",
      });
      engine.tick({ renderQuantum: 128 });

      const source = readSourceStatus(session);
      expect(source.state).toBe("accepted");
      expect(source.sourceRevision).toBe(2);
      expect(source.loadSequence).toBe(2);
      expect(source.appliedLoadSequence).toBe(2);
      expect(source.channelCount).toBe(1);
      expect(source.durationFrames).toBe(480_000);
      expect(source.droppedBufferTotal).toBe(0);
    } finally {
      disposeStretchBoundarySession(session);
    }
  });

  it("models play, pause, seek, loop, fault, and reset transitions", () => {
    const { engine, session, transport } = setup();

    try {
      transport.enqueue("play");
      expect(engine.tick({ renderQuantum: 256 }).runtime.state).toBe("playing");

      transport.enqueue("seek", { targetSourceFrame: 48_000 });
      const seeking = engine.tick({ renderQuantum: 256 }).runtime;
      expect(seeking.state).toBe("seeking");
      expect(seeking.sourceFrame).toBe(48_000);

      transport.enqueue("setLoop", {
        loopEndFrame: 24_000,
        loopStartFrame: 12_000,
      });
      const looped = engine.tick({ renderQuantum: 256 }).runtime;
      expect(looped.loopEnabled).toBe(true);
      expect(looped.loopRevision).toBeGreaterThan(0);

      transport.enqueue("pause");
      expect(engine.tick({ renderQuantum: 256 }).runtime.state).toBe(
        "ready-paused",
      );

      engine.setFault(42);
      expect(engine.tick({ renderQuantum: 256 }).runtime.state).toBe(
        "failed-recoverable",
      );
      expect(readRuntimeStatus(session).lastErrorCode).toBe(42);

      transport.enqueue("resetFault");
      expect(engine.tick({ renderQuantum: 256 }).runtime.state).toBe(
        "ready-paused",
      );
      expect(readRuntimeStatus(session).lastErrorCode).toBe(0);
    } finally {
      disposeStretchBoundarySession(session);
    }
  });

  it("restarts playback from zero after reaching ended without a loop", () => {
    const { engine, session, transport } = setup();

    try {
      transport.enqueue("seek", {
        targetSourceFrame: engine.currentSource.frames - 64,
      });
      engine.tick({ renderQuantum: 128 });

      transport.enqueue("play");
      const ended = engine.tick({ renderQuantum: 128 }).runtime;
      expect(ended.state).toBe("ended");
      expect(ended.sourceFrame).toBe(engine.currentSource.frames);

      transport.enqueue("play");
      const recovered = engine.tick({ renderQuantum: 128 }).runtime;
      expect(recovered.state).toBe("playing");
      expect(recovered.sourceFrame).toBeGreaterThan(0);
      expect(recovered.sourceFrame).toBeLessThan(1_024);
    } finally {
      disposeStretchBoundarySession(session);
    }
  });

  it("restarts playback from loop start after reaching ended with a loop", () => {
    const { engine, session, transport } = setup();

    try {
      transport.enqueue("setLoop", {
        loopEndFrame: 36_000,
        loopStartFrame: 12_000,
      });
      engine.tick({ renderQuantum: 128 });
      transport.enqueue("seek", {
        targetSourceFrame: engine.currentSource.frames,
      });
      engine.tick({ renderQuantum: 128 });

      transport.enqueue("play");
      const recovered = engine.tick({ renderQuantum: 128 }).runtime;
      expect(recovered.state).toBe("playing");
      expect(recovered.sourceFrame).toBeGreaterThanOrEqual(12_000);
      expect(recovered.sourceFrame).toBeLessThan(13_000);
      expect(recovered.state).not.toBe("ended");
    } finally {
      disposeStretchBoundarySession(session);
    }
  });

  it("publishes output-level history arrays and deterministic full-scale events", () => {
    const { engine, session, transport } = setup();

    try {
      transport.enqueue("play");
      for (let index = 0; index < 10; index += 1) {
        engine.tick({ renderQuantum: 4_096 });
      }

      const levels = readProcessedLevels(session);
      const historyPeak = Array.from(levels.historyPeak);

      expect(levels.probeState).toBe("active");
      expect(levels.fullScaleLeftTotal).toBeGreaterThan(0);
      expect(levels.clipLatched).toBe(true);
      expect(levels.maxAbsWindow).toBeGreaterThan(0);
      expect(levels.outputBranchActive).toBe(true);
      expect(levels.referenceBranchActive).toBe(true);
      expect(historyPeak.some((value) => value > 0)).toBe(true);
    } finally {
      disposeStretchBoundarySession(session);
    }
  });

  it("surfaces stale reads without pretending the desired state applied", () => {
    const { engine, session } = setup();

    try {
      writeDesiredControls(session, {
        ...defaultDesiredControls(),
        desiredSequence: 2,
        rate: 1.75,
      });
      engine.simulateStaleRead(1);

      const stale = engine.tick({ renderQuantum: 128 }).runtime;
      expect(stale.staleReadTotal).toBe(1);
      expect(stale.lastAppliedDesiredSequence).toBe(1);

      const pending = engine.tick({ renderQuantum: 128 });
      expect(pending.pendingDesiredSequence).toBe(2);
    } finally {
      disposeStretchBoundarySession(session);
    }
  });

  it("surfaces SWSR newest-command drops in runtime status", () => {
    const { engine, session, transport } = setup(2);

    try {
      expect(transport.enqueue("play").accepted).toBe(true);
      expect(transport.enqueue("pause").accepted).toBe(false);

      engine.tick({ renderQuantum: 128 });
      expect(readRuntimeStatus(session).commandDroppedTotal).toBe(1);
    } finally {
      disposeStretchBoundarySession(session);
    }
  });

  it("publishes failed probe status during a simulated fault", () => {
    const { engine, session } = setup();

    try {
      engine.setFault(7);
      engine.tick({ renderQuantum: 128 });

      const levels = readProcessedLevels(session);
      expect(levels.probeState).toBe("failed");
      expect(levels.lastErrorCode).toBe(7);
    } finally {
      disposeStretchBoundarySession(session);
    }
  });
});
