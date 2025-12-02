import { describe, it, expect } from "vitest";

import { swapTestVectors } from "./hotswap.vectors";
import {
  initSwapStateRT,
  stepSwapStateRT,
  type SwapStepKind,
} from "../src/spec";

enum EngineKind {
  None = 0,
  A = 1,
  B = 2,
}

/**
 * Conformance tests for the RT hot-swap protocol.
 *
 * These tests assert that:
 * - the sequence of (phase, kind) pairs for a given ticket and block size
 *   matches the expected canonical flows.
 * - state eventually returns to idle with no ticket.
 */
describe("@seqlok/hotswap – conformance vectors", () => {
  for (const vector of swapTestVectors) {
    it(vector.name, () => {
      const state = initSwapStateRT<number>(vector.ticket);

      // In these tests we treat engineKind from the ticket as “next”,
      // and start with some arbitrary current kind.
      let activeKind: EngineKind = EngineKind.A;
      const nextKind: EngineKind = vector.ticket.engineKind as EngineKind;
      const noneSentinel: EngineKind = EngineKind.None;

      const seen: { phase: string; kind: SwapStepKind }[] = [];

      const maxSteps = vector.expectedTransitions.length + 4;

      for (let i = 0; i < maxSteps; i += 1) {
        const decision = stepSwapStateRT(
          state,
          vector.blockFrames,
          activeKind,
          nextKind,
          noneSentinel,
        );

        seen.push({
          phase: decision.status.phase,
          kind: decision.kind,
        });

        if (decision.kind === "retireNow") {
          // Caller swaps engine handles after this block.
          activeKind = nextKind;
        }

        if (decision.status.phase === "idle" && !state.hasTicket) {
          break;
        }
      }

      const prefix = seen.slice(0, vector.expectedTransitions.length);
      expect(prefix).toEqual(vector.expectedTransitions);
    });
  }
});
