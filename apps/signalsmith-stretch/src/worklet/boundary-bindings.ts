import { acceptHandoff, bindProcessor } from "@exclave/boundary";

import type { signalsmithStretchSpec } from "../boundary/specs";
import type { Handoff } from "@exclave/boundary";

export type StretchWorkletHandoff = Handoff<typeof signalsmithStretchSpec>;

export function bindStretchWorkletBoundary(handoff: StretchWorkletHandoff) {
  return bindProcessor(acceptHandoff(handoff));
}
