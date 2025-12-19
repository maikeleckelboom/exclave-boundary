/**
 * @fileoverview
 * Shared param-def helpers for binding factories.
 *
 * @remarks
 * Bindings accept sources where `spec.params` may be absent (e.g. remote handoffs).
 * This module normalizes that to a stable empty record to avoid `undefined` plumbing.
 */

import type { ParamDef } from "../../spec/types";

/**
 * Normalized param definition table.
 */
export type ParamDefs = Readonly<Record<string, ParamDef>>;

/**
 * Stable empty param table.
 *
 * @remarks
 * Frozen to prevent accidental mutation by consumers.
 */
export const EMPTY_PARAM_DEFS: ParamDefs = Object.freeze({});

/**
 * Returns a normalized param table from a spec-like shape.
 *
 * @remarks
 * Use this in binders to avoid `params?: ...` propagating into binding impls.
 */
export function getParamDefs(
  spec: { readonly params?: ParamDefs } | undefined,
): ParamDefs {
  return spec?.params ?? EMPTY_PARAM_DEFS;
}
