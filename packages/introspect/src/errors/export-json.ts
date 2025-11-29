/**
 * JSON schema export utilities.
 *
 * @remarks
 * Post-v1.0 candidate for extraction to `@seqlok/schema` when:
 * - Cross-language ports (Rust/C++) need formal ABI contracts
 * - Schema versioning must evolve independently of introspect
 */

import { ALL_DOMAINS } from "./all-domains";
import { type DomainRegistry, getRegistryForDomain } from "./registry-map";

import type { ErrorMeta, ErrorSeverity } from "@seqlok/base";

/**
 * Subset selection criteria for the export.
 *
 * You can filter by domains, severities, recoverable, and boundarySafe.
 * The JSON shape stays identical; only the contents change.
 */
export interface SubsetSelectionCriteria {
  readonly domains?: readonly string[];
  readonly severities?: readonly ErrorSeverity[];
  readonly recoverable?: boolean;
  readonly boundarySafe?: boolean;
}

/**
 * ErrorCode shape, matching `#/$defs/ErrorCode` in the schema.
 */
export interface ExportErrorCode {
  readonly code: string;
  readonly message: string;
  readonly numericCode: number;
  readonly domain: string;
  readonly key: string;
  readonly meta: ErrorMeta;
}

/**
 * Domain shape, matching `#/$defs/Domain` in the schema.
 */
export interface ExportDomain {
  readonly prefix: string;
  readonly domainId: number;
  readonly codes: readonly ExportErrorCode[];
}

/**
 * Internal mutable stats structure for severities.
 */
interface SeverityCounts {
  warning: number;
  error: number;
  fatal: number;
}

/**
 * Stats shape, matching `#/$defs/RegistryStats` in the schema.
 */
export interface ExportRegistryStats {
  readonly totalDomains: number;
  readonly totalCodes: number;
  readonly domainCounts: Record<string, number>;
  readonly severityCounts: SeverityCounts;
}

/**
 * Top-level registry export, matching `error-registry.schema.json`.
 */
export interface ErrorRegistryExport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly generator: "@seqlok/introspect";
  readonly domainIds: Record<string, number>;
  readonly domains: readonly ExportDomain[];
  readonly allCodes: readonly ExportErrorCode[];
  readonly stats: ExportRegistryStats;
}

function shouldInclude(
  meta: ErrorMeta,
  criteria: SubsetSelectionCriteria,
): boolean {
  const { severities, recoverable, boundarySafe } = criteria;

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

  return true;
}

function incrementSeverity(
  counts: SeverityCounts,
  severity: ErrorSeverity,
): void {
  switch (severity) {
    case "warning":
      counts.warning += 1;
      return;
    case "error":
      counts.error += 1;
      return;
    case "fatal":
      counts.fatal += 1;
      return;
    default: {
      return severity;
    }
  }
}

/**
 * Build a registry export object matching `error-registry.schema.json`,
 * optionally filtered by a subset selection criteria.
 */
export function buildErrorRegistryExport(
  criteria: SubsetSelectionCriteria = {},
): ErrorRegistryExport {
  const domains: ExportDomain[] = [];
  const allCodes: ExportErrorCode[] = [];
  const domainIds: Record<string, number> = {};
  const domainCounts: Record<string, number> = {};

  let totalDomains = 0;
  let totalCodes = 0;

  const severityCounts: SeverityCounts = {
    warning: 0,
    error: 0,
    fatal: 0,
  };

  const domainFilter =
    criteria.domains && criteria.domains.length > 0
      ? new Set(criteria.domains)
      : null;

  for (const descriptor of ALL_DOMAINS) {
    if (domainFilter && !domainFilter.has(descriptor.prefix)) {
      continue;
    }

    const registry: DomainRegistry = getRegistryForDomain(descriptor.prefix);
    const codes: ExportErrorCode[] = [];

    for (const entry of descriptor.entries) {
      const info = registry[entry.key];
      if (!info) {
        // Descriptor without registry entry: treat as internal wiring bug.
        continue;
      }

      const { code, message, meta } = info;

      if (!shouldInclude(meta, criteria)) {
        continue;
      }

      const errorCode: ExportErrorCode = {
        code,
        message,
        numericCode: entry.numericCode,
        domain: descriptor.prefix,
        key: entry.key,
        meta,
      };

      codes.push(errorCode);
      allCodes.push(errorCode);

      incrementSeverity(severityCounts, meta.severity);
    }

    if (codes.length === 0) {
      continue;
    }

    const domainExport: ExportDomain = {
      prefix: descriptor.prefix,
      domainId: descriptor.domainId,
      codes,
    };

    domains.push(domainExport);
    domainIds[descriptor.prefix] = descriptor.domainId;
    domainCounts[descriptor.prefix] = codes.length;

    totalDomains += 1;
    totalCodes += codes.length;
  }

  const stats: ExportRegistryStats = {
    totalDomains,
    totalCodes,
    domainCounts,
    severityCounts,
  };

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generator: "@seqlok/introspect",
    domainIds,
    domains,
    allCodes,
    stats,
  };
}
