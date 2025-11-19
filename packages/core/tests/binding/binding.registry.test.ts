import { describe, it, expect, beforeEach } from 'vitest';

import {
  claimBinding,
  clearBindingRegistry,
  getBindingState,
  noteBinding,
  releaseBinding,
} from '../../src/binding/registry';

import type { Backing } from '../../src/backing/types';

function backingStub(label: string): Backing {
  // Minimal structural stub; registry only uses identity, not fields.
  // If Backing grows, this stays valid.
  return {
    kind: 'shared',
    sab: new SharedArrayBuffer(8),
    label,
  } as unknown as Backing;
}

describe('binding registry', () => {
  beforeEach(() => {
    clearBindingRegistry();
  });

  it('tracks noteBinding / releaseBinding for each role', () => {
    const backing = backingStub('note-binding');

    expect(getBindingState(backing)).toBeUndefined();

    noteBinding(backing, 'controller');

    expect(getBindingState(backing)).toEqual({
      roles: { controller: true, processor: false },
    });

    noteBinding(backing, 'processor');

    expect(getBindingState(backing)).toEqual({
      roles: { controller: true, processor: true },
    });

    releaseBinding(backing, 'controller');

    expect(getBindingState(backing)).toEqual({
      roles: { controller: false, processor: true },
    });

    releaseBinding(backing, 'processor');

    // Last role released → entry removed
    expect(getBindingState(backing)).toBeUndefined();
  });

  it('enforces exclusive claim semantics per role (not cross-role)', () => {
    const backing = backingStub('exclusive');

    // First controller claim succeeds
    claimBinding(backing, 'controller');

    expect(getBindingState(backing)).toEqual({
      roles: { controller: true, processor: false },
    });

    // Second claim for the SAME role must fail (per-role exclusivity)
    expect(() => {
      claimBinding(backing, 'controller');
    }).toThrowError(/exclusive binding already exists/i);

    // Registry state must be unchanged after the failed claim
    expect(getBindingState(backing)).toEqual({
      roles: { controller: true, processor: false },
    });

    // Cross-role claim is allowed: processor can still bind to the same backing
    claimBinding(backing, 'processor');

    expect(getBindingState(backing)).toEqual({
      roles: { controller: true, processor: true },
    });
  });

  it('releaseBinding is idempotent and does nothing for unknown backings', () => {
    const backing = backingStub('idempotent');

    // Nothing registered yet → no throw
    releaseBinding(backing, 'controller');
    expect(getBindingState(backing)).toBeUndefined();

    noteBinding(backing, 'processor');
    expect(getBindingState(backing)).toEqual({
      roles: { controller: false, processor: true },
    });

    // First release clears processor
    releaseBinding(backing, 'processor');
    expect(getBindingState(backing)).toBeUndefined();

    // Second release remains a no-op
    releaseBinding(backing, 'processor');
    expect(getBindingState(backing)).toBeUndefined();
  });
});
