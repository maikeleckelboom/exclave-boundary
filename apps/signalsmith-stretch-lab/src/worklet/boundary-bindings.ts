import { acceptHandoff, bindProcessor } from "@exclave/boundary";

import type {
  desiredStretchSpec,
  processedOutputLevelsSpec,
  runtimeStatusSpec,
  sourceStatusSpec,
} from "../boundary/specs";
import type { Handoff } from "@exclave/boundary";

export interface StretchWorkletHandoffs {
  readonly desired: Handoff<typeof desiredStretchSpec>;
  readonly levels: Handoff<typeof processedOutputLevelsSpec>;
  readonly runtime: Handoff<typeof runtimeStatusSpec>;
  readonly source: Handoff<typeof sourceStatusSpec>;
}

export function bindStretchWorkletBoundaries(handoffs: StretchWorkletHandoffs) {
  const desired = bindProcessor(acceptHandoff(handoffs.desired));
  const runtime = bindProcessor(acceptHandoff(handoffs.runtime));
  const source = bindProcessor(acceptHandoff(handoffs.source));
  const levels = bindProcessor(acceptHandoff(handoffs.levels));

  return {
    desired,
    levels,
    runtime,
    source,
  };
}
