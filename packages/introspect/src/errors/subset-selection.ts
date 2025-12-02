/**
 * @fileoverview
 * Subset selection over the global error universe.
 *
 * @remarks
 * - Joins numeric descriptors (`ALL_DOMAINS`) with per-domain registries.
 * - Produces `AggregatedErrorDescriptor` values for each selected error.
 * - Used by JSON export, tooling, and future native bindings.
 */

import { ALL_DOMAINS, type DomainName } from "./all-domains";
import { type AggregatedErrorDescriptor } from "./descriptors";
import { type DomainRegistry, getRegistryForDomain } from "./registry-map";

import type { DomainDescriptor, ErrorMeta, ErrorSeverity } from "@seqlok/base";

/**
 * Criteria for selecting a subset of the error universe.
 *
 * @remarks
 * All filters are conjunctive (ANDed):
 * - If a field is omitted, it imposes no restriction.
 * - Arrays are treated as "any-of" unless otherwise specified.
 */
export interface SubsetSelectionCriteria {
  /**
   * Restrict to these domain prefixes (e.g. ["env", "backing"]).
   * If omitted, all domains are considered.
   */
  readonly domains?: readonly DomainName[];

  /**
   * Restrict to this set of full error codes
   * (e.g. ["env.sharedArrayBufferNotSupported"]).
   */
  readonly codes?: readonly string[];

  /**
   * Restrict to these severities.
   */
  readonly severities?: readonly ErrorSeverity[];

  /**
   * If set, require meta.recoverable to equal this flag.
   */
  readonly recoverable?: boolean;

  /**
   * If set, require meta.boundarySafe to equal this flag.
   */
  readonly boundarySafe?: boolean;

  /**
   * If set, require the error to have at least one of these tags.
   */
  readonly tagsAnyOf?: readonly string[];

  /**
   * If set, require the error to have all of these tags.
   */
  readonly tagsAllOf?: readonly string[];

  /**
   * If set, require the error to have none of these tags.
   */
  readonly tagsNoneOf?: readonly string[];
}

/**
 * Domain in a selected subset.
 *
 * @remarks
 * `errors` are fully-joined `AggregatedErrorDescriptor` values.
 */
export interface SelectedDomain {
  readonly prefix: DomainName;
  readonly domainId: DomainDescriptor["domainId"];
  readonly errors: readonly AggregatedErrorDescriptor[];
}

/**
 * Result of a subset selection.
 */
export interface ErrorSubset {
  readonly criteria: SubsetSelectionCriteria;
  readonly domains: readonly SelectedDomain[];
}

function matchesTags(
  meta: ErrorMeta,
  criteria: SubsetSelectionCriteria,
): boolean {
  const tags = meta.tags ?? [];
  const { tagsAnyOf, tagsAllOf, tagsNoneOf } = criteria;

  if (tagsAnyOf && tagsAnyOf.length > 0) {
    const ok = tagsAnyOf.some((tag) => tags.includes(tag));
    if (!ok) {
      return false;
    }
  }

  if (tagsAllOf && tagsAllOf.length > 0) {
    const ok = tagsAllOf.every((tag) => tags.includes(tag));
    if (!ok) {
      return false;
    }
  }

  if (tagsNoneOf && tagsNoneOf.length > 0) {
    const bad = tagsNoneOf.some((tag) => tags.includes(tag));
    if (bad) {
      return false;
    }
  }

  return true;
}

function matchesCriteria(
  error: AggregatedErrorDescriptor,
  criteria: SubsetSelectionCriteria,
): boolean {
  const { codes, severities, recoverable, boundarySafe } = criteria;
  const { code, meta } = error;

  if (codes && codes.length > 0 && !codes.includes(code)) {
    return false;
  }

  if (
    severities &&
    severities.length > 0 &&
    !severities.includes(meta.severity)
  ) {
    return false;
  }

  if (typeof recoverable === "boolean" && meta.recoverable !== recoverable) {
    return false;
  }

  if (typeof boundarySafe === "boolean" && meta.boundarySafe !== boundarySafe) {
    return false;
  }

  if (!matchesTags(meta, criteria)) {
    return false;
  }

  return true;
}

/**
 * Compute a filtered view of the error universe.
 *
 * @remarks
 * - Joins `ALL_DOMAINS` numeric entries with per-domain registries.
 * - Applies `SubsetSelectionCriteria` to each joined descriptor.
 * - Returns domains that have at least one matching error.
 */
export function selectErrorSubset(
  criteria: SubsetSelectionCriteria,
): ErrorSubset {
  const domains: SelectedDomain[] = [];

  for (const descriptor of ALL_DOMAINS) {
    const prefix = descriptor.prefix;

    if (
      criteria.domains &&
      criteria.domains.length > 0 &&
      !criteria.domains.includes(prefix)
    ) {
      continue;
    }

    const registry: DomainRegistry = getRegistryForDomain(prefix);
    const errors: AggregatedErrorDescriptor[] = [];

    for (const entry of descriptor.entries) {
      const registryEntry = registry[entry.key];

      if (!registryEntry) {
        // Invariant violation: descriptor entry without registry entry.
        // This is a bug in the registry wiring, so fail loudly.
        throw new Error(
          `Missing registry entry for ${prefix}.${entry.key} (${entry.code})`,
        );
      }

      const aggregated: AggregatedErrorDescriptor = {
        domain: prefix,
        key: entry.key,
        code: registryEntry.code,
        message: registryEntry.message,
        meta: registryEntry.meta,
        numericCode: entry.numericCode,
      };

      if (!matchesCriteria(aggregated, criteria)) {
        continue;
      }

      errors.push(aggregated);
    }

    if (errors.length > 0) {
      domains.push({
        prefix,
        domainId: descriptor.domainId,
        errors,
      });
    }
  }

  return {
    criteria,
    domains,
  };
}
