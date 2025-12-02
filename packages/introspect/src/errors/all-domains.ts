/**
 * @fileoverview
 * Global numeric index for all error domains.
 *
 * @remarks
 * - Pulls registries from @seqlok/base, @seqlok/core, @seqlok/primitives,
 *   and the local `introspect.*` domain.
 * - Rebuilds numeric-code descriptors here so this remains the single
 *   canonical view used by diagnostics, health, and schema tooling.
 */

import {
  encodeNumeric,
  DOMAIN_IDS,
  type DomainDescriptor,
  type DomainEntry,
  type DomainId,
  type ErrorNumericCode,
} from "@seqlok/base";

import { getRegistryForDomain, type DomainRegistry } from "./registry-map";

/**
 * Domain name type used by the introspect layer.
 *
 * @remarks
 * This stays intentionally loose (`string`-compatible). The canonical
 * list of domains lives in `DOMAIN_IDS` and the registry map.
 */
export type DomainName = DomainDescriptor["prefix"];

/**
 * Lightweight entry in the global numeric error index.
 *
 * @remarks
 * - `code` is the fully-qualified string code (e.g. "env.unsupported")
 * - `domain` is the prefix (e.g. "env")
 * - `key` is the domain-local key (e.g. "unsupported")
 * - `numericCode` is the encoded numeric value
 *
 * For `message` / `meta`, join this with the per-domain registry from
 * `getRegistryForDomain(domain)`, whose values are `ErrorDescriptor`
 * from `@seqlok/base`.
 */
export interface ErrorIndexEntry {
  readonly code: string;
  readonly domain: DomainName;
  readonly key: string;
  readonly numericCode: ErrorNumericCode;
}

/**
 * Build domain entries from a registry map.
 *
 * @remarks
 * The registry map supplies `code`/`message`/`meta`; we derive the
 * numeric code from the domain id and a stable key order.
 */
function entriesFromRegistry(
  registry: DomainRegistry,
  domainId: number,
): DomainEntry[] {
  const keys = Object.keys(registry);
  return keys.map((key, index): DomainEntry => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const descriptor = registry[key]!;
    return {
      key,
      code: descriptor.code,
      numericCode: encodeNumeric(domainId, index + 1),
    };
  });
}

/**
 * Build a full domain descriptor from the global registry map and
 * a numeric domain id.
 */
function buildDomainDescriptor(
  prefix: DomainName,
  domainId: DomainId,
): DomainDescriptor {
  const registry = getRegistryForDomain(prefix);
  return {
    prefix,
    domainId,
    entries: entriesFromRegistry(registry, domainId),
  };
}

/**
 * Domain descriptors for all known domains.
 *
 * @remarks
 * The order here defines the iteration order of `ALL_DOMAINS` and
 * is kept stable for tooling expectations.
 */
const INTERNAL_DOMAIN_DESCRIPTOR: DomainDescriptor = buildDomainDescriptor(
  "internal",
  DOMAIN_IDS.internal,
);

const PRIMITIVES_DOMAIN_DESCRIPTOR: DomainDescriptor = buildDomainDescriptor(
  "primitives",
  DOMAIN_IDS.primitives,
);

const ENV_DOMAIN_DESCRIPTOR: DomainDescriptor = buildDomainDescriptor(
  "env",
  DOMAIN_IDS.env,
);

const SPEC_DOMAIN_DESCRIPTOR: DomainDescriptor = buildDomainDescriptor(
  "spec",
  DOMAIN_IDS.spec,
);

const PLAN_DOMAIN_DESCRIPTOR: DomainDescriptor = buildDomainDescriptor(
  "plan",
  DOMAIN_IDS.plan,
);

const BACKING_DOMAIN_DESCRIPTOR: DomainDescriptor = buildDomainDescriptor(
  "backing",
  DOMAIN_IDS.backing,
);

const BINDING_DOMAIN_DESCRIPTOR: DomainDescriptor = buildDomainDescriptor(
  "binding",
  DOMAIN_IDS.binding,
);

const HANDOFF_DOMAIN_DESCRIPTOR: DomainDescriptor = buildDomainDescriptor(
  "handoff",
  DOMAIN_IDS.handoff,
);

const INTROSPECT_DOMAIN_DESCRIPTOR: DomainDescriptor = buildDomainDescriptor(
  "introspect",
  DOMAIN_IDS.introspect,
);

const COMMANDS_DOMAIN_DESCRIPTOR: DomainDescriptor = buildDomainDescriptor(
  "commands",
  DOMAIN_IDS.commands,
);

/**
 * All error domains exported by Seqlok.
 *
 * @remarks
 * This is the single canonical numeric-code universe used by
 * diagnostics, schema generation, and future native bindings.
 */
export const ALL_DOMAINS: readonly DomainDescriptor[] = [
  INTERNAL_DOMAIN_DESCRIPTOR,
  PRIMITIVES_DOMAIN_DESCRIPTOR,
  ENV_DOMAIN_DESCRIPTOR,
  SPEC_DOMAIN_DESCRIPTOR,
  PLAN_DOMAIN_DESCRIPTOR,
  BACKING_DOMAIN_DESCRIPTOR,
  BINDING_DOMAIN_DESCRIPTOR,
  HANDOFF_DOMAIN_DESCRIPTOR,
  INTROSPECT_DOMAIN_DESCRIPTOR,
  COMMANDS_DOMAIN_DESCRIPTOR,
];

/**
 * Returns a flattened list of all registered errors across all domains,
 * in a numeric-index-friendly shape.
 */
export function listErrors(): ErrorIndexEntry[] {
  const descriptors: ErrorIndexEntry[] = [];

  for (const domain of ALL_DOMAINS) {
    for (const entry of domain.entries) {
      descriptors.push({
        code: entry.code,
        domain: domain.prefix,
        key: entry.key,
        numericCode: entry.numericCode,
      });
    }
  }

  return descriptors;
}

/**
 * Computes the numeric code for a string error code by looking it up in
 * the aggregated registry.
 *
 * Returns undefined if the code is unknown.
 */
export function computeNumericCode(code: string): ErrorNumericCode | undefined {
  for (const domain of ALL_DOMAINS) {
    const found = domain.entries.find((entry) => entry.code === code);
    if (found) {
      return found.numericCode;
    }
  }

  return undefined;
}

/**
 * Extracts the domain prefix from a fully-qualified error code.
 *
 * @example
 * extractDomainPrefix("env.unsupported") === "env"
 * extractDomainPrefix("weird") === ""
 */
export function extractDomainPrefix(code: string): string {
  const idx = code.indexOf(".");
  if (idx <= 0) {
    return "";
  }
  return code.slice(0, idx);
}

/**
 * Extracts the local code part from a fully-qualified error code.
 *
 * @example
 * extractLocalCode("env.unsupported") === "unsupported"
 * extractLocalCode("weird") === "weird"
 */
export function extractLocalCode(code: string): string {
  const idx = code.indexOf(".");
  if (idx < 0 || idx === code.length - 1) {
    return code;
  }
  return code.slice(idx + 1);
}
