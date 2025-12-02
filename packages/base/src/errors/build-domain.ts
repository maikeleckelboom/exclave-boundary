/**
 * @fileoverview
 * Domain builder that extends defineErrorDomain with numeric codes.
 *
 * @remarks
 * This is the single entry point for defining error domains. It wraps
 * defineErrorDomain and adds domainId + descriptor for introspect.
 */

import {
  defineErrorDomain,
  type DomainDef,
  type ErrorDomainWithFactory,
} from "./error";
import { encodeNumeric } from "./numeric";

import type { DomainDescriptor, DomainEntry, DomainId } from "./domains";

/**
 * A domain extended with numeric codes and a descriptor.
 *
 * @typeParam Prefix - The string literal prefix for error codes (e.g., "backing")
 * @typeParam Defs - The error definitions record mapping keys to DomainDef
 */
export type BuiltErrorDomain<
  Prefix extends string,
  Defs extends Record<string, DomainDef>,
> = ErrorDomainWithFactory<Prefix, Defs> & {
  readonly domainId: DomainId;
  readonly descriptor: DomainDescriptor;
};

/**
 * Build a complete error domain with numeric codes and descriptor.
 *
 * @remarks
 * This wraps defineErrorDomain and adds:
 *
 * - domainId: The numeric domain ID from DOMAIN_IDS
 * - descriptor: A DomainDescriptor ready for introspect aggregation
 *
 * @typeParam Prefix - The string literal prefix for error codes
 * @typeParam Defs - The error definitions record
 *
 * @param prefix - Domain prefix string (e.g., "backing")
 * @param domainId - Numeric domain ID from DOMAIN_IDS
 * @param defs - Error definitions mapping keys to message + meta
 * @returns A complete error domain with factory, registry, and descriptor
 *
 * @example
 * ```ts
 * const BACKING_DEFS = {
 *   allocFailed: {
 *     message: "Backing allocation failed",
 *     meta: { severity: "fatal", recoverable: true, boundarySafe: true },
 *   },
 * } as const;
 *
 * type BackingDefs = typeof BACKING_DEFS;
 *
 * export const BACKING: BuiltErrorDomain<"backing", BackingDefs> =
 *   buildErrorDomain("backing", DOMAIN_IDS.backing, BACKING_DEFS);
 *
 * throw BACKING.createError("allocFailed", { plane: "shared" });
 * ```
 */
export function buildErrorDomain<
  const Prefix extends string,
  const Defs extends Record<string, DomainDef>,
>(
  prefix: Prefix,
  domainId: DomainId,
  defs: Defs,
): BuiltErrorDomain<Prefix, Defs> {
  const domain: ErrorDomainWithFactory<Prefix, Defs> = defineErrorDomain(
    prefix,
    defs,
  );

  const keys: string[] = Object.keys(defs);

  const entries: DomainEntry[] = keys.map(
    (key: string, index: number): DomainEntry => {
      const registryEntry =
        domain.registry[key as keyof typeof domain.registry];
      return {
        key,
        code: registryEntry.code,
        numericCode: encodeNumeric(domainId, index + 1),
      };
    },
  );

  const descriptor: DomainDescriptor = {
    prefix,
    domainId,
    entries,
  };

  return {
    ...domain,
    domainId,
    descriptor,
  } satisfies BuiltErrorDomain<Prefix, Defs>;
}
