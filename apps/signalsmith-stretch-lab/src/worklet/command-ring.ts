import {
  bindStretchCommandConsumer,
  type StretchCommand,
} from "../boundary/commands";

import type { SwsrRingBacking, SwsrRingConsumer } from "@exclave/boundary";

export function bindWorkletCommandRing(
  backing: SwsrRingBacking,
): SwsrRingConsumer<StretchCommand> {
  return bindStretchCommandConsumer(backing);
}
