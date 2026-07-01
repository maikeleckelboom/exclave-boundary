import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LatestPrefetchGate } from "../src/audio/latest-prefetch-gate";
import { ScheduledCommandQueue } from "../src/worklet/scheduled-commands";
import { SourceWindow } from "../src/worklet/source-window";
import { calculateSignalsmithSourceWindow } from "../src/worklet/source-window-position";

import type {
  ChunkedWavSourceInfo,
  PlanarFrameChunk,
} from "../src/audio/chunked-wav-source";
import type { StretchCommand } from "../src/boundary/commands";

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKLET_PROCESSOR = join(
  APP_ROOT,
  "src",
  "worklet",
  "stretch-processor.ts",
);
const STRETCH_NODE = join(APP_ROOT, "src", "audio", "stretch-node.ts");
const MAIN = join(APP_ROOT, "src", "main.ts");

describe("Signalsmith Worklet runtime semantics", () => {
  it("does not post sourceAccepted from publishAll or the process hot path", () => {
    const source = readFileSync(WORKLET_PROCESSOR, "utf8");
    const publishAllBody = methodBody(source, "publishAll");
    const processBody = methodBody(source, "process");

    expect(source).not.toContain("publishSourceAccepted");
    expect(publishAllBody).not.toContain("acceptSource(");
    expect(publishAllBody).not.toContain("publishSourceStatus(");
    expect(processBody).not.toContain("acceptSource(");
    expect(processBody).not.toContain("publishSourceStatus(");
  });

  it("keeps desired control application out of the configure and buffer path", () => {
    const source = readFileSync(WORKLET_PROCESSOR, "utf8");
    const desiredBody = methodBody(source, "applyDesiredControls");
    const configBody = methodBody(source, "applyConfigControls");

    expect(desiredBody).toContain("_setTransposeSemitones");
    expect(desiredBody).toContain("_setFormantSemitones");
    expect(desiredBody).toContain("_setFormantBase");
    expect(desiredBody).not.toContain("transitionFrames");
    expect(desiredBody).not.toContain("configureModule");
    expect(desiredBody).not.toContain("_configure");
    expect(desiredBody).not.toContain("_setBuffers");
    expect(configBody).toContain("configureModule");
    expect(configBody).toContain("_reset");
  });

  it("delivers host commands without changing the Signalsmith buffered render path", () => {
    const processor = readFileSync(WORKLET_PROCESSOR, "utf8");
    const stretchNode = readFileSync(STRETCH_NODE, "utf8");
    const handleMessageBody = methodBody(processor, "handleMessage");
    const applyHostCommandBody = methodBody(processor, "applyHostCommand");
    const applyCommandBody = methodBody(processor, "applyCommand");
    const renderBody = methodBody(processor, "renderQuantum");

    expect(stretchNode).toContain("notifyCommandsAvailable()");
    expect(stretchNode).toContain("postCommand(command: StretchCommand)");
    expect(handleMessageBody).toContain('case "command"');
    expect(handleMessageBody).toContain('case "commandsAvailable"');
    expect(applyHostCommandBody).toContain("scheduleOrApplyCommand(command)");
    expect(applyCommandBody).toContain(
      "command.sequence <= this.lastAppliedCommandSequence",
    );
    expect(renderBody).toContain(
      "module._seek(this.bufferLengthFrames, this.effectiveRate)",
    );
    expect(renderBody).toContain("module._process(0, outputFrameCount)");
  });

  it("terminates destroyed processors instead of publishing stale source meters", () => {
    const source = readFileSync(WORKLET_PROCESSOR, "utf8");
    const processBody = methodBody(source, "process");
    const handleMessageBody = methodBody(source, "handleMessage");
    const applyCommandBody = methodBody(source, "applyCommand");

    expect(source).toContain("private destroyed = false");
    expect(processBody).toContain("if (this.destroyed)");
    expect(processBody).toContain("return false");
    expect(handleMessageBody).toContain("this.destroyed = true");
    expect(applyCommandBody).toContain("this.destroyed = true");
  });

  it("keeps the Worklet fallback defaults aligned with musical pitch defaults", () => {
    const source = readFileSync(WORKLET_PROCESSOR, "utf8");

    expect(source).toContain("private tonalityHz = TONALITY_LIMIT_DEFAULT_HZ");
    expect(source).toContain("private formantCompensation = false");
    expect(source).toContain("private formantBaseHz = FORMANT_BASE_AUTO_HZ");
    expect(source).not.toContain("private tonalityHz = 440");
    expect(source).not.toContain("private formantCompensation = true");
  });

  it("queues scheduled commands until outputFrame reaches the target", () => {
    const queue = new ScheduledCommandQueue<StretchCommand>({ capacity: 2 });
    const applied: StretchCommand[] = [];
    const delayedSeek = command("seek", {
      scheduledOutputFrame: 512,
      targetSourceFrame: 12_345,
    });

    expect(queue.schedule(delayedSeek, 128)).toBe("queued");
    queue.drainReady(511, (item) => {
      applied.push(item);
    });
    expect(applied).toEqual([]);

    queue.drainReady(512, (item) => {
      applied.push(item);
    });
    expect(applied).toEqual([delayedSeek]);
  });

  it("bounds scheduled command queue overflow", () => {
    const queue = new ScheduledCommandQueue<StretchCommand>({ capacity: 1 });

    expect(
      queue.schedule(command("play", { scheduledOutputFrame: 256 }), 0),
    ).toBe("queued");
    expect(
      queue.schedule(command("pause", { scheduledOutputFrame: 512 }), 0),
    ).toBe("dropped");
    expect(queue.dropped).toBe(1);
  });

  it("calculates the initial Signalsmith source window from latency", () => {
    expect(
      calculateSignalsmithSourceWindow({
        audibleSourceFrame: 0,
        bufferLengthFrames: 7_200,
        effectiveRate: 1,
        inputLatencyFrames: 5_760,
        outputLatencyFrames: 1_440,
      }),
    ).toEqual({
      audibleSourceFrame: 0,
      inputWindowEndFrame: 7_200,
      inputWindowStartFrame: 0,
      processingCenterFrame: 1_440,
    });
  });

  it("calculates seek and steady-state windows with output-latency compensation", () => {
    expect(
      calculateSignalsmithSourceWindow({
        audibleSourceFrame: 48_000,
        bufferLengthFrames: 7_200,
        effectiveRate: 0.5,
        inputLatencyFrames: 5_760,
        outputLatencyFrames: 1_440,
      }),
    ).toEqual({
      audibleSourceFrame: 48_000,
      inputWindowEndFrame: 54_480,
      inputWindowStartFrame: 47_280,
      processingCenterFrame: 48_720,
    });

    expect(
      calculateSignalsmithSourceWindow({
        audibleSourceFrame: 48_128,
        bufferLengthFrames: 7_200,
        effectiveRate: 1,
        inputLatencyFrames: 5_760,
        outputLatencyFrames: 1_440,
      }).inputWindowStartFrame,
    ).toBe(48_128);
  });

  it("wraps source-window fills across loopEnd to loopStart", () => {
    const window = new SourceWindow();
    const target = new Float32Array(5);
    window.setInfo(sourceInfo(10, 1));
    window.addChunk(chunk(0, [0, 1, 2, 3, 4]));
    window.addChunk(chunk(5, [5, 6, 7, 8, 9]));

    const fill = window.fillInputWindow([target], 7, 5, {
      enabled: true,
      endFrame: 10,
      startFrame: 2,
    });

    expect(fill).toEqual({ copiedFrames: 5, missingFrames: 0 });
    expect(Array.from(target)).toEqual([7, 8, 9, 2, 3]);
  });

  it("wraps source-window fills when only loop boundary chunks are cached", () => {
    const window = new SourceWindow();
    const target = new Float32Array(4);
    window.setInfo(sourceInfo(12, 1));
    window.addChunk(chunk(2, [2, 3]));
    window.addChunk(chunk(8, [8, 9]));

    const fill = window.fillInputWindow([target], 8, 4, {
      enabled: true,
      endFrame: 10,
      startFrame: 2,
    });

    expect(fill).toEqual({ copiedFrames: 4, missingFrames: 0 });
    expect(Array.from(target)).toEqual([8, 9, 2, 3]);
  });

  it("wraps source-window fills that cross below loopStart", () => {
    const window = new SourceWindow();
    const target = new Float32Array(4);
    window.setInfo(sourceInfo(24, 1));
    window.addChunk(chunk(10, [10, 11]));
    window.addChunk(chunk(18, [18, 19]));

    const fill = window.fillInputWindow([target], 8, 4, {
      enabled: true,
      endFrame: 20,
      startFrame: 10,
    });

    expect(fill).toEqual({ copiedFrames: 4, missingFrames: 0 });
    expect(Array.from(target)).toEqual([18, 19, 10, 11]);
  });

  it("detects non-contiguous source-window coverage despite min and max buffer meters", () => {
    const window = new SourceWindow();
    window.setInfo(sourceInfo(24, 1));
    window.addChunk(chunk(10, [10, 11]));
    window.addChunk(chunk(18, [18, 19]));

    expect(window.bufferStartFrame).toBe(10);
    expect(window.bufferEndFrame).toBe(20);
    expect(window.coverageForInputWindow(12, 6)).toEqual({
      copiedFrames: 0,
      missingFrames: 6,
    });
  });

  it("evicts Worklet source chunks below the byte limit", () => {
    const window = new SourceWindow({ maxCachedBytes: 4 * 4 });
    window.setInfo(sourceInfo(12, 1));
    window.addChunk(chunk(0, [0, 1]));
    window.addChunk(chunk(2, [2, 3]));
    window.addChunk(chunk(4, [4, 5]));

    expect(window.cachedBytes).toBeLessThanOrEqual(4 * 4);
    expect(window.droppedBufferTotal).toBe(1);
    expect(window.readyFrames).toBe(4);
    expect(window.bufferStartFrame).toBe(2);
  });

  it("posts only the newest rapid prefetch request", async () => {
    const gate = new LatestPrefetchGate<PlanarFrameChunk>();
    const first = deferred<PlanarFrameChunk>();
    const second = deferred<PlanarFrameChunk>();
    const posted: number[] = [];

    gate.request(
      () => first.promise,
      (value) => {
        posted.push(value.startFrame);
      },
    );
    gate.request(
      () => second.promise,
      (value) => {
        posted.push(value.startFrame);
      },
    );

    first.resolve(chunk(1_000, [1]));
    await first.promise;
    await Promise.resolve();
    expect(posted).toEqual([]);

    second.resolve(chunk(2_000, [2]));
    await second.promise;
    await Promise.resolve();
    expect(posted).toEqual([2_000]);
  });

  it("requests both committed loop boundaries outside the latest-prefetch gate", () => {
    const source = readFileSync(MAIN, "utf8");

    expect(source).toContain(
      "prefetchForLoop(status.validation.range, runtime)",
    );
    expect(source).toContain("range.endFrame - prefetchFrames");
    expect(source).toContain("prefetchForFrame(range.startFrame");
    expect(source).toContain("prefetchForFrame(range.endFrame");
    expect(source).toContain(
      "prefetchGate.request(() => load(prefetcher), postChunk)",
    );
  });

  it("prefetches the loop-normalized target for host seek requests", () => {
    const source = readFileSync(MAIN, "utf8");
    const commitSeekBody = functionBody(source, "commitSeek");
    const recentSeekFrameForMarkBody = functionBody(
      source,
      "recentSeekFrameForMark",
    );
    const clearAppliedSeekGhostBody = functionBody(
      source,
      "clearAppliedSeekGhost",
    );

    expect(commitSeekBody).toContain(
      "const targetFrame = normalizeSeekFrameForRuntime(frame, runtime)",
    );
    expect(commitSeekBody).toContain("requestedSeekTargetFrame = targetFrame");
    expect(commitSeekBody).toContain("recentSeekFrame = targetFrame");
    expect(commitSeekBody).toContain("prefetchForFrame(targetFrame)");
    expect(commitSeekBody).toContain("targetSourceFrame: frame");
    expect(recentSeekFrameForMarkBody).toContain("requestedSeekTargetFrame");
    expect(recentSeekFrameForMarkBody).toContain("return null");
    expect(clearAppliedSeekGhostBody).toContain(
      "const targetFrame = requestedSeekTargetFrame ?? requestedSeekFrame",
    );
  });

  it("keeps loop cache coverage checks out of render-quantum publishing", () => {
    const source = readFileSync(WORKLET_PROCESSOR, "utf8");
    const renderBody = methodBody(source, "renderQuantum");
    const publishRuntimeStatusBody = methodBody(source, "publishRuntimeStatus");

    expect(source).toContain("private updateLoopCacheCoverage()");
    expect(source).toContain("this.updateLoopCacheCoverage();");
    expect(source).toContain("coverageForInputWindow(");
    expect(renderBody).not.toContain("updateLoopCacheCoverage");
    expect(publishRuntimeStatusBody).not.toContain("coverageForInputWindow");
    expect(publishRuntimeStatusBody).toContain(
      "loopStartMissingFrames: this.loopStartMissingFrames",
    );
    expect(publishRuntimeStatusBody).toContain(
      "loopEndMissingFrames: this.loopEndMissingFrames",
    );
  });

  it("keeps audio transport scheduling out of the visual RAF loop", () => {
    const source = readFileSync(MAIN, "utf8");
    const animateBody = constFunctionBody(source, "animate");

    expect(calledFunctions(animateBody)).toEqual([
      "syncMonitorGains",
      "clearAppliedSeekGhost",
      "render",
      "window.requestAnimationFrame",
    ]);
    expect(animateBody).not.toContain("engine.tick");
    expect(animateBody).not.toContain("prefetch");
    expect(animateBody).not.toContain("scheduleTransportRefill");
    expect(animateBody).not.toContain("postTransportRefill");
    expect(animateBody).not.toContain("realRuntime");
    expect(animateBody).not.toContain("referenceMonitor");
    expect(animateBody).not.toContain("sourceStatus");
    expect(animateBody).not.toContain("updateReferencePreview");
    expect(source).toContain("window.setInterval(");
    expect(source).toContain('runTransportPump("interval")');
    expect(source).toContain("chooseTransportRefill");
  });

  it("recovers Worklet play commands from ended source positions", () => {
    const source = readFileSync(WORKLET_PROCESSOR, "utf8");
    const playBody = methodBody(source, "play");

    expect(playBody).toContain("this.sourceFrame >= durationFrames");
    expect(playBody).toContain(
      "this.repositionToSourceFrame(this.sourceFrame)",
    );
    expect(playBody).toContain("this.repositionToSourceFrame(0)");
    expect(playBody).toContain('this.runtimeState = "playing"');
    expect(playBody).toContain("this.active = true");
  });

  it("normalizes Worklet seek and play positions while a loop is active", () => {
    const source = readFileSync(WORKLET_PROCESSOR, "utf8");
    const repositionBody = methodBody(source, "repositionToSourceFrame");
    const playBody = methodBody(source, "play");
    const wrapBody = methodBody(source, "wrapLoopIfNeeded");

    expect(repositionBody).toContain("normalizeSeekFrameIntoLoopRange");
    expect(repositionBody).toContain("this.loopEnabled");
    expect(playBody).toContain(
      "this.repositionToSourceFrame(this.sourceFrame)",
    );
    expect(wrapBody).toContain("sourceFrameInsideLoopRange");
    expect(wrapBody).toContain(
      "this.repositionToSourceFrame(this.sourceFrame)",
    );
  });

  it("checks heap view identity before using Worklet input and output buffers", () => {
    const source = readFileSync(WORKLET_PROCESSOR, "utf8");

    expect(source).toContain("lastHeapBuffer");
    expect(source).toContain("checkHeapViews");
    expect(source).toContain("module.HEAPF32.buffer");
    expect(source).toContain("bindHeapViews(module)");
  });
});

function command(
  name: StretchCommand["name"],
  overrides: Partial<StretchCommand> = {},
): StretchCommand {
  return {
    blockMs: 0,
    configSequence: 0,
    desiredSequence: 0,
    flags: 0,
    flushOutputFrames: 0,
    id: 0,
    intervalMs: 0,
    loopEndFrame: 0,
    loopStartFrame: 0,
    name,
    presetIndex: 0,
    reserved0: 0,
    reserved1: 0,
    scheduledOutputFrame: 0,
    sequence: 1,
    sourceRevision: 0,
    splitComputation: false,
    targetSourceFrame: 0,
    ...overrides,
  };
}

function chunk(
  startFrame: number,
  samples: readonly number[],
): PlanarFrameChunk {
  return {
    channels: [Float32Array.from(samples)],
    frameCount: samples.length,
    startFrame,
  };
}

function sourceInfo(
  frameCount: number,
  channelCount: 1 | 2,
): ChunkedWavSourceInfo {
  return {
    audioFormat: 3,
    bitsPerSample: 32,
    blockAlign: channelCount * Float32Array.BYTES_PER_ELEMENT,
    byteRate: 48_000 * channelCount * Float32Array.BYTES_PER_ELEMENT,
    channelCount,
    dataBytes: frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT,
    dataOffset: 44,
    durationSeconds: frameCount / 48_000,
    frameCount,
    kind: "wav" as const,
    memoryBytes: frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT,
    sampleRate: 48_000,
  };
}

function deferred<TValue>(): {
  readonly promise: Promise<TValue>;
  readonly resolve: (value: TValue) => void;
} {
  let resolve: (value: TValue) => void = () => {
    throw new Error("Deferred promise resolver was not initialized.");
  };
  const promise = new Promise<TValue>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

function methodBody(source: string, methodName: string): string {
  const signature = source.indexOf(` ${methodName}(`);

  if (signature < 0) {
    throw new Error(`Missing method ${methodName}.`);
  }

  const bodyStart = source.indexOf("{", signature);
  let depth = 0;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart, index + 1);
      }
    }
  }

  throw new Error(`Missing body for ${methodName}.`);
}

function functionBody(source: string, functionName: string): string {
  const signature = source.indexOf(`function ${functionName}(`);

  if (signature < 0) {
    throw new Error(`Missing function ${functionName}.`);
  }

  return bodyFrom(source, signature, functionName);
}

function constFunctionBody(source: string, constName: string): string {
  const signature = source.indexOf(`const ${constName} =`);

  if (signature < 0) {
    throw new Error(`Missing const function ${constName}.`);
  }

  const bodyStart = source.indexOf("{", signature);
  let depth = 0;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart, index + 1);
      }
    }
  }

  throw new Error(`Missing body for const function ${constName}.`);
}

function bodyFrom(source: string, signature: number, name: string): string {
  const bodyStart = source.indexOf("{", signature);
  let depth = 0;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart, index + 1);
      }
    }
  }

  throw new Error(`Missing body for ${name}.`);
}

function calledFunctions(body: string): string[] {
  const calls: string[] = [];
  const callPattern = /\b((?:window\.)?[A-Za-z][A-Za-z0-9_]*)\s*\(/gu;

  for (const match of body.matchAll(callPattern)) {
    const call = match[1];
    if (call && call !== "if") {
      calls.push(call);
    }
  }

  return calls;
}
