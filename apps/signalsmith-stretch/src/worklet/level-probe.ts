import { enumIndex, PROBE_STATES } from "../types";

import type { signalsmithStretchSpec } from "../boundary/specs";
import type { ProcessorBinding } from "@exclave/boundary";

export class LevelProbe {
  private readonly historyPeak = new Float32Array(64);
  private readonly historyRms = new Float32Array(64);
  private cursor = 0;
  private fullScaleLeftTotal = 0;
  private fullScaleRightTotal = 0;
  private invalidSampleTotal = 0;

  publish(
    levels: ProcessorBinding<typeof signalsmithStretchSpec>,
    output: readonly Float32Array[],
    options: {
      readonly active: boolean;
      readonly channelCount: number;
      readonly failed: boolean;
      readonly lastErrorCode: number;
      readonly outputFrame: number;
      readonly silent: boolean;
      readonly unsupportedChannelBlockTotal: number;
      readonly windowFrames: number;
    },
  ): void {
    const left = output[0] ?? null;
    const right = output[1] ?? left;
    const leftFacts = measureChannel(left, options.windowFrames);
    const rightFacts = measureChannel(right, options.windowFrames);
    const maxAbs = Math.max(leftFacts.peak, rightFacts.peak);

    this.invalidSampleTotal += leftFacts.invalid + rightFacts.invalid;

    if (leftFacts.peak >= 1) {
      this.fullScaleLeftTotal += 1;
    }
    if (rightFacts.peak >= 1 && options.channelCount > 1) {
      this.fullScaleRightTotal += 1;
    }

    this.historyRms[this.cursor] = Math.max(leftFacts.rms, rightFacts.rms);
    this.historyPeak[this.cursor] = maxAbs;
    this.cursor = (this.cursor + 1) % this.historyRms.length;

    levels.meters.publish((writer) => {
      writer.set("levels.channelCount", options.channelCount);
      writer.set("levels.clipLatched", this.fullScaleLeftTotal > 0);
      writer.set("levels.fullScaleLeftTotal", this.fullScaleLeftTotal);
      writer.set("levels.fullScaleRightTotal", this.fullScaleRightTotal);
      writer.set("levels.invalidSampleTotal", this.invalidSampleTotal);
      writer.set(
        "levels.lastErrorCode",
        options.failed ? options.lastErrorCode : 0,
      );
      writer.set("levels.maxAbsWindow", maxAbs);
      writer.set("levels.outputBranchActive", options.active);
      writer.set("levels.peakLeft", leftFacts.peak);
      writer.set("levels.peakRight", rightFacts.peak);
      writer.set(
        "levels.probeState",
        enumIndex(
          PROBE_STATES,
          options.failed ? "failed" : options.active ? "active" : "ready",
        ),
      );
      writer.set("levels.rmsLeft", leftFacts.rms);
      writer.set("levels.rmsRight", rightFacts.rms);
      writer.set("levels.referenceBranchActive", options.active);
      writer.set("levels.silent", options.silent || maxAbs < 0.000_001);
      writer.set(
        "levels.unsupportedChannelBlockTotal",
        options.unsupportedChannelBlockTotal,
      );
      writer.set("levels.windowEndOutputFrame", options.outputFrame);
      writer.set("levels.windowFrames", options.windowFrames);
      writer.stage("levels.historyPeak", (history) => {
        history.set(this.historyPeak);
      });
      writer.stage("levels.historyRms", (history) => {
        history.set(this.historyRms);
      });
    });
  }
}

function measureChannel(
  channel: Float32Array | null,
  frameCount: number,
): {
  readonly invalid: number;
  readonly peak: number;
  readonly rms: number;
} {
  if (!channel || frameCount <= 0) {
    return { invalid: 0, peak: 0, rms: 0 };
  }

  let invalid = 0;
  let peak = 0;
  let sumSquares = 0;

  for (let index = 0; index < frameCount; index += 1) {
    const sample = channel[index] ?? 0;

    if (!Number.isFinite(sample)) {
      invalid += 1;
      continue;
    }

    const abs = Math.abs(sample);
    peak = Math.max(peak, abs);
    sumSquares += sample * sample;
  }

  return {
    invalid,
    peak,
    rms: Math.sqrt(sumSquares / frameCount),
  };
}
