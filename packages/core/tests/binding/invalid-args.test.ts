import { isSeqlokError } from "@seqlok/base";
import { describe, expect, it } from "vitest";

import { bindController, bindObserver, bindProcessor } from "../../src";

type UnknownFn = (...args: readonly unknown[]) => unknown;

function callWithUnknown(fn: UnknownFn, ...args: readonly unknown[]): unknown {
  return fn(...args);
}

function expectInvalidArgs(
  fnName: "bindController" | "bindObserver" | "bindProcessor",
  reason: "missingPlan" | "missingBacking",
  thunk: () => unknown,
): void {
  try {
    thunk();
    expect.fail("Expected an error");
  } catch (err: unknown) {
    expect(isSeqlokError(err)).toBe(true);
    if (!isSeqlokError(err)) {
      return;
    }

    // SeqlokError is identified by .code (not .key).
    expect(err.code).toBe("binding.invalidArgs");

    // BindingInvalidArgsDetails lives in .details.
    expect(err.details.fn).toBe(fnName);
    expect(err.details.reason).toBe(reason);

    // Extra sanity: signature is present and stringly.
    expect(typeof err.details.signature).toBe("string");
  }
}

describe("binding factories: invalidArgs", () => {
  it("bindController: missingPlan", () => {
    expectInvalidArgs("bindController", "missingPlan", () =>
      callWithUnknown(bindController as unknown as UnknownFn, {}),
    );
  });

  it("bindController: missingBacking", () => {
    expectInvalidArgs("bindController", "missingBacking", () =>
      callWithUnknown(bindController as unknown as UnknownFn, {}, {}),
    );
  });

  it("bindObserver: missingPlan", () => {
    expectInvalidArgs("bindObserver", "missingPlan", () =>
      callWithUnknown(bindObserver as unknown as UnknownFn, {}),
    );
  });

  it("bindObserver: missingBacking", () => {
    expectInvalidArgs("bindObserver", "missingBacking", () =>
      callWithUnknown(bindObserver as unknown as UnknownFn, {}, {}),
    );
  });

  it("bindProcessor: missingPlan", () => {
    expectInvalidArgs("bindProcessor", "missingPlan", () =>
      callWithUnknown(bindProcessor as unknown as UnknownFn, {}),
    );
  });

  it("bindProcessor: missingBacking", () => {
    expectInvalidArgs("bindProcessor", "missingBacking", () =>
      callWithUnknown(bindProcessor as unknown as UnknownFn, {}, {}),
    );
  });
});
