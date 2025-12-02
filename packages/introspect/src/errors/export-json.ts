/**
 * @fileoverview
 * Rich JSON + schema export for the error registry.
 *
 * @remarks
 * - Builds a structured `ErrorRegistrySchema` from the global registry.
 * - Reuses `SubsetSelectionCriteria` and `selectErrorSubset`.
 * - Intended as the source of truth for cross-language bindings and
 *   schema-driven tooling.
 */

import {
  type ErrorSubset,
  selectErrorSubset,
  type SubsetSelectionCriteria,
} from "./subset-selection";

import type { DomainName } from "./all-domains";
import type { AggregatedErrorDescriptor } from "./descriptors";
import type { ErrorMeta, ErrorSeverity } from "@seqlok/base";

/**
 * Summary stats for a registry export.
 */
export interface RegistryStats {
  readonly totalDomains: number;
  readonly totalCodes: number;
  readonly domainCounts: Readonly<Record<string, number>>;
  readonly severityCounts: Readonly<Record<ErrorSeverity, number>>;
}

/**
 * JSON-friendly projection of ErrorMeta.
 *
 * @remarks
 * This is intentionally a subset of `ErrorMeta` with only
 * schema-stable fields.
 */
export interface ErrorMetaSchema {
  readonly severity: ErrorSeverity;
  readonly recoverable: boolean;
  readonly boundarySafe: boolean;
  readonly docsUrl?: string;
  readonly tags?: readonly string[];
  readonly domainHint?: string;
}

/**
 * Per-code entry in the rich schema export.
 */
export interface ErrorCodeSchema {
  readonly code: string;
  readonly message: string;
  readonly numericCode: number;
  readonly domain: DomainName;
  readonly key: string;
  readonly meta: ErrorMetaSchema;
}

/**
 * Per-domain entry in the rich schema export.
 */
export interface DomainSchema {
  readonly prefix: DomainName;
  readonly domainId: number;
  readonly codes: readonly ErrorCodeSchema[];
}

/**
 * Rich registry export, suitable for JSON Schema / ABI contracts.
 */
export interface ErrorRegistrySchema {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly generator: "@seqlok/introspect";
  readonly domainIds: Readonly<Record<string, number>>;
  readonly domains: readonly DomainSchema[];
  readonly allCodes: readonly ErrorCodeSchema[];
  readonly stats: RegistryStats;
}

/**
 * Minimal structural type for an accompanying JSON Schema document.
 */
export interface JsonSchemaDocument {
  readonly $schema: string;
  readonly $id: string;
  readonly title: string;
  readonly description: string;
  readonly type: "object";
  readonly additionalProperties: boolean | Record<string, never>;
  readonly properties: Record<string, unknown>;
  readonly required: readonly string[];
  readonly $defs?: Record<string, unknown>;
}

function projectMeta(meta: ErrorMeta): ErrorMetaSchema {
  return {
    severity: meta.severity,
    recoverable: meta.recoverable,
    boundarySafe: meta.boundarySafe,
    ...(meta.docsUrl !== undefined ? { docsUrl: meta.docsUrl } : {}),
    ...(meta.tags !== undefined ? { tags: meta.tags } : {}),
    ...(meta.domainHint !== undefined ? { domainHint: meta.domainHint } : {}),
  };
}

function projectCode(descriptor: AggregatedErrorDescriptor): ErrorCodeSchema {
  return {
    code: descriptor.code,
    message: descriptor.message,
    numericCode: descriptor.numericCode,
    domain: descriptor.domain,
    key: descriptor.key,
    meta: projectMeta(descriptor.meta),
  };
}

function computeStats(domains: readonly DomainSchema[]): RegistryStats {
  const domainCounts: Record<string, number> = {};
  const severityCounts: Record<ErrorSeverity, number> = {
    warning: 0,
    error: 0,
    fatal: 0,
  };

  let totalDomains = 0;
  let totalCodes = 0;

  for (const domain of domains) {
    totalDomains += 1;
    const count = domain.codes.length;
    totalCodes += count;
    domainCounts[domain.prefix] = count;

    for (const code of domain.codes) {
      const sev = code.meta.severity;
      severityCounts[sev] += 1;
    }
  }

  return {
    totalDomains,
    totalCodes,
    domainCounts,
    severityCounts,
  };
}

/**
 * Build the rich registry export with optional subset selection.
 *
 * @remarks
 * - Pass `{}` for "everything".
 * - Use `SubsetSelectionCriteria` to restrict by domain, severity, etc.
 */
export function buildErrorRegistrySchema(
  criteria: SubsetSelectionCriteria = {},
): ErrorRegistrySchema {
  const subset: ErrorSubset = selectErrorSubset(criteria);

  const domains: DomainSchema[] = subset.domains.map((domain) => {
    const codes = domain.errors.map(projectCode);
    return {
      prefix: domain.prefix,
      domainId: domain.domainId,
      codes,
    };
  });

  const allCodes: ErrorCodeSchema[] = [];
  for (const domain of domains) {
    allCodes.push(...domain.codes);
  }

  const stats = computeStats(domains);

  const domainIds: Record<string, number> = {};
  for (const domain of subset.domains) {
    domainIds[domain.prefix] = domain.domainId;
  }

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

/**
 * Optional: static JSON Schema for `ErrorRegistrySchema`.
 *
 * @remarks
 * You can fill this in later if you want a fully-specified schema
 * document. For now it's left as a stub to avoid locking you in.
 */
export const ERROR_REGISTRY_JSON_SCHEMA: JsonSchemaDocument = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schema.seqlok.dev/error-registry.schema.json",
  title: "Seqlok Error Registry",
  description:
    "Structured export of Seqlok error codes, metadata, and domain layout.",
  type: "object",
  additionalProperties: false,
  properties: {},
  required: [],
};

export function exportErrorRegistryJsonSchema(): JsonSchemaDocument {
  return ERROR_REGISTRY_JSON_SCHEMA;
}
