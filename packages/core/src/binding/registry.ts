import { invariant } from '../errors/invariant';

import type { Backing } from '../backing/types';

export type BindRole = 'controller' | 'processor';

interface BindSlots {
  controller?: true;
  processor?: true;
}

interface BindingStateView {
  readonly roles: {
    readonly controller: boolean;
    readonly processor: boolean;
  };
}

/**
 * Tracks which roles are bound to a given backing.
 *
 * - Keyed by Backing so reconstructed views do not bypass this.
 * - Used by controller/processor bindings to enforce optional exclusivity.
 *
 * Registry is per-module; tests can reset it via clearBindingRegistry().
 */
let BOUND = new WeakMap<Backing, BindSlots>();

/**
 * Test/diagnostics helper: reset the binding registry to an empty state.
 *
 * Safe because all functions read BOUND via the module-local variable.
 */
export function clearBindingRegistry(): void {
  BOUND = new WeakMap();
}

export function noteBinding(backing: Backing, role: BindRole): void {
  const current = BOUND.get(backing);
  if (!current) {
    BOUND.set(backing, { [role]: true });
    return;
  }
  BOUND.set(backing, { ...current, [role]: true });
}

/**
 * Claim an exclusive binding slot for `role`.
 *
 * If the role is already present for this backing, we treat it as an internal
 * invariant violation: something is double-binding the same backing.
 */
export function claimBinding(backing: Backing, role: BindRole): void {
  const current = BOUND.get(backing);

  invariant(
    !current?.[role],
    'internal.assertionFailed',
    'Exclusive binding already exists for this backing and role',
    { where: `binding.${role}`, detail: 'double-bind on Backing instance' },
  );

  if (!current) {
    BOUND.set(backing, { [role]: true });
  } else {
    BOUND.set(backing, { ...current, [role]: true });
  }
}

/**
 * Release a binding slot. Once both roles are cleared, the backing
 * entry is removed entirely.
 */
export function releaseBinding(backing: Backing, role: BindRole): void {
  const current = BOUND.get(backing);
  if (!current?.[role]) {
    return;
  }

  const next: BindSlots = { ...current };
  // Explicit `delete` to avoid leaving dead flags lying around.
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete (next as Partial<Record<BindRole, true>>)[role];

  if (!next.controller && !next.processor) {
    BOUND.delete(backing);
  } else {
    BOUND.set(backing, next);
  }
}

/**
 * Introspection hook for diagnostics/tests.
 *
 * Normalizes the internal `BindSlots` into a stable view:
 * - Missing roles become `false`.
 * - Callers never see internal optional flags directly.
 */
export function getBindingState(backing: Backing): BindingStateView | undefined {
  const slots = BOUND.get(backing);
  if (!slots) {
    return undefined;
  }
  return {
    roles: {
      controller: !!slots.controller,
      processor: !!slots.processor,
    },
  };
}
