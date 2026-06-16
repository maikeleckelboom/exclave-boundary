/**
 * @fileoverview
 * Deterministic authored-layer normalization for spec AST objects.
 *
 * This module stays strictly at the authored AST boundary. It validates
 * structure, clones data, sorts object keys deterministically, preserves enum
 * order and authored nesting, and omits empty planes.
 */

import { validateSpecAst } from "./validate";

import type { MeterDef, ParamDef, SpecAstInput, SpecNamespace } from "./ast";

type AuthoredLeaf = ParamDef | MeterDef;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLeafDef(value: unknown): value is AuthoredLeaf {
  return isRecord(value) && typeof value.kind === "string";
}

function cloneLeafDef<T extends AuthoredLeaf>(def: T): T {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(def).sort()) {
    const value = (def as Record<string, unknown>)[key];
    sorted[key] = Array.isArray(value) ? [...(value as unknown[])] : value;
  }
  return sorted as T;
}

function normalizeNamespace<T extends AuthoredLeaf>(
  namespace: SpecNamespace<T>,
): SpecNamespace<T> {
  const out: Record<string, T | SpecNamespace<T>> = {};

  for (const key of Object.keys(namespace).sort()) {
    const value = namespace[key];
    if (isLeafDef(value)) {
      out[key] = cloneLeafDef(value);
    } else {
      // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
      out[key] = normalizeNamespace(value as SpecNamespace<T>);
    }
  }

  return out as SpecNamespace<T>;
}

/**
 * Normalize an authored spec AST deterministically without crossing into
 * semantic compilation.
 *
 * The normalized AST preserves authored namespace nesting and enum order. It
 * does not flatten namespaces, fill runtime defaults, generate runtime
 * identities, compute canonical runtime keys, or interpret authored meaning.
 */
export function normalizeSpecAst(ast: SpecAstInput): SpecAstInput {
  validateSpecAst(ast);

  const out: {
    $schema?: string;
    id?: string;
    params?: SpecNamespace<ParamDef>;
    meters?: SpecNamespace<MeterDef>;
  } = {};

  if (ast.$schema !== undefined) {
    out.$schema = ast.$schema;
  }
  if (ast.id !== undefined) {
    out.id = ast.id;
  }
  if (ast.params !== undefined && Object.keys(ast.params).length > 0) {
    out.params = normalizeNamespace(ast.params);
  }
  if (ast.meters !== undefined && Object.keys(ast.meters).length > 0) {
    out.meters = normalizeNamespace(ast.meters);
  }

  return out as SpecAstInput;
}
