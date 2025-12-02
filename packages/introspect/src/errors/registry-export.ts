/**
 * @fileoverview
 * Thin JSON export for the error registry.
 *
 * @remarks
 * - Delegates selection to `selectErrorSubset`.
 * - Produces a stable, minimal JSON shape for tooling.
 * - Richer schema exports live in `export-json.ts`.
 */

import {
  selectErrorSubset,
  type ErrorSubset,
  type SubsetSelectionCriteria,
} from "./subset-selection";

import type { DomainName } from "./all-domains";
import type { AggregatedErrorDescriptor } from "./descriptors";
import type { ErrorMeta, ErrorNumericCode } from "@seqlok/base";

/**
 * Error descriptor as it appears in the simple JSON export.
 *
 * @remarks
 * This intentionally mirrors a subset of `AggregatedErrorDescriptor`
 * and does not include the `domain` field (it is implicit via the
 * containing `ExportedDomain`).
 */
export interface ExportedError {
  readonly key: string;
  readonly code: string;
  readonly numericCode: ErrorNumericCode;
  readonly message: string;
  readonly meta: ErrorMeta;
}

/**
 * Domain entry in the simple JSON export.
 */
export interface ExportedDomain {
  readonly prefix: DomainName;
  readonly domainId: number;
  readonly errors: readonly ExportedError[];
}

/**
 * Top-level JSON document for the error registry.
 *
 * @remarks
 * - `version` is for this export format only (not the schema).
 * - For richer, schema-described exports, see `export-json.ts`.
 */
export interface ErrorRegistryJson {
  readonly version: 1;
  readonly domains: readonly ExportedDomain[];
}

function toExportedError(error: AggregatedErrorDescriptor): ExportedError {
  const { key, code, numericCode, message, meta } = error;
  return {
    key,
    code,
    numericCode,
    message,
    meta,
  };
}

function buildExportedDomain(
  domain: ErrorSubset["domains"][number],
): ExportedDomain {
  const errors = domain.errors.map(toExportedError);
  return {
    prefix: domain.prefix,
    domainId: domain.domainId,
    errors,
  };
}

/**
 * Build a JSON registry document for a selected subset of errors.
 */
export function buildErrorRegistryJson(
  criteria: SubsetSelectionCriteria,
): ErrorRegistryJson {
  const subset = selectErrorSubset(criteria);

  const domains: ExportedDomain[] = subset.domains.map(buildExportedDomain);

  return {
    version: 1,
    domains,
  };
}

/**
 * Convenience helper for "all errors, no filters".
 */
export function buildFullErrorRegistryJson(): ErrorRegistryJson {
  return buildErrorRegistryJson({});
}
