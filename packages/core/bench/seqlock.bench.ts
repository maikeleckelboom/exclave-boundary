import { createSeqPair, publish, tryRead } from "@seqlok/primitives";
import { bench, describe } from "vitest";

import { MICRO_BENCH_OPTS } from "../../../scripts/vitest/bench-presets";

/**
 * @fileoverview
 * Core seqlock operation micro-benchmarks under uncontended load.
 *
 * Focus:
 * - `publish()` cost for a tiny payload (single u32)
 * - `tryRead()` cost with `spinBudget = 0` and `retryBudget = 0` when uncontended
 *
 * This isolates the protocol cost of the seqlock itself, without controller
 * or processor binding logic in the way.
 */

const sab = new SharedArrayBuffer(16);
const u32 = new Uint32Array(sab);
const pair = createSeqPair(u32, 0, 1);
const payloadIndex = 2;

describe("Seqlock (micro): tryRead vs publish (uncontended)", () => {
  bench(
    "tryRead uncontended (spin=0, retry=0)",
    () => {
      const _result = tryRead(
        pair,
        () => {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          return u32[payloadIndex]! >>> 0;
        },
        {
          spinBudget: 0,
          retryBudget: 0,
        },
      );
      void _result;
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    "publish uncontended",
    () => {
      publish(pair, () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        u32[payloadIndex] = (u32[payloadIndex]! + 1) >>> 0;
      });
    },
    MICRO_BENCH_OPTS,
  );
});
