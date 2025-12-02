import { beforeEach, describe, expect, it } from "vitest";

import {
  claimBinding,
  clearBindingRegistry,
  getBindingState,
  noteBinding,
  releaseBinding,
} from "../../src/binding/common/registry";

import type { Backing } from "../../src/backing/types";

/**
 * Creates a minimal Backing stub for registry identity testing.
 * The registry relies on object identity, so full structural compliance is not required.
 */
function backingStub(label: string): Backing {
  return {
    kind: "shared",
    sab: new SharedArrayBuffer(8),
    label,
  } as unknown as Backing;
}

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error(
    `Error(core/tests/helpers/capture-error.ts): Expected function to throw.`,
  );
}

/**
 * Tests for the binding registry which manages shared state between
 * controller, processor and observer roles.
 *
 * Verifies role-based access control and lifecycle management of bindings.
 */
describe("Binding Registry: Global State Management", () => {
  beforeEach(() => {
    clearBindingRegistry();
  });

  it("manages role lifecycle with note/release operations", () => {
    const backing = backingStub("lifecycle-test");

    expect(getBindingState(backing)).toBeUndefined();

    // Add controller role
    noteBinding(backing, "controller");
    expect(getBindingState(backing)).toEqual({
      roles: { controller: true, processor: false, observer: false },
    });

    // Add processor role (dual binding)
    noteBinding(backing, "processor");
    expect(getBindingState(backing)).toEqual({
      roles: { controller: true, processor: true, observer: false },
    });

    // Add observer role
    noteBinding(backing, "observer");
    expect(getBindingState(backing)).toEqual({
      roles: { controller: true, processor: true, observer: true },
    });

    // Release controller
    releaseBinding(backing, "controller");
    expect(getBindingState(backing)).toEqual({
      roles: { controller: false, processor: true, observer: true },
    });

    // Release processor
    releaseBinding(backing, "processor");
    expect(getBindingState(backing)).toEqual({
      roles: { controller: false, processor: false, observer: true },
    });

    // Release observer (last role) -> entry cleanup
    releaseBinding(backing, "observer");
    expect(getBindingState(backing)).toBeUndefined();
  });

  it("enforces role exclusivity while allowing cross-role bindings", () => {
    const backing = backingStub("exclusivity-test");

    // First claim should succeed
    claimBinding(backing, "controller");

    expect(getBindingState(backing)).toEqual({
      roles: { controller: true, processor: false, observer: false },
    });

    // Duplicate claim should fail
    const thrown = captureError(() => {
      claimBinding(backing, "controller");
    });

    const err = thrown as {
      code?: string;
      details?: { where?: string; detail?: string };
    };

    expect(err.code).toBe("internal.assertionFailed");
    expect(err.details?.where ?? "").toMatch(/binding/i);
    // detail string is tested in error-focused tests, so we ignore it here

    // State remains unchanged after failed claim
    expect(getBindingState(backing)).toEqual({
      roles: { controller: true, processor: false, observer: false },
    });

    // Cross-role binding is allowed (processor)
    claimBinding(backing, "processor");
    expect(getBindingState(backing)).toEqual({
      roles: { controller: true, processor: true, observer: false },
    });

    // Observer is also allowed alongside controller + processor
    noteBinding(backing, "observer");
    expect(getBindingState(backing)).toEqual({
      roles: { controller: true, processor: true, observer: true },
    });
  });

  it("gracefully handles idempotent releases and unknown backings", () => {
    const backing = backingStub("idempotency-test");

    // Releases on non-existent binding are safe
    releaseBinding(backing, "controller");
    releaseBinding(backing, "processor");
    releaseBinding(backing, "observer");
    expect(getBindingState(backing)).toBeUndefined();

    // Set up test state
    noteBinding(backing, "processor");
    expect(getBindingState(backing)).toEqual({
      roles: { controller: false, processor: true, observer: false },
    });

    // Releasing a role that was never set is a no-op
    releaseBinding(backing, "observer");
    expect(getBindingState(backing)).toEqual({
      roles: { controller: false, processor: true, observer: false },
    });

    // First release removes the processor role and clears the entry
    releaseBinding(backing, "processor");
    expect(getBindingState(backing)).toBeUndefined();

    // Additional releases remain no-ops
    releaseBinding(backing, "processor");
    releaseBinding(backing, "observer");
    expect(getBindingState(backing)).toBeUndefined();
  });
});
