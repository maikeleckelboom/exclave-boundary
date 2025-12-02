/**
 * @fileoverview
 * Numeric domain ids and descriptors for Seqlok error codes.
 *
 * @remarks
 * This module is the cross-language ABI for error domains:
 *
 * - Domain ids are 8-bit (0–255).
 * - High 8 bits of the numeric error code (32-bit) encode the domain id.
 * - Low 24 bits are a domain-local ordinal (1–16_777_215, 0 reserved).
 *
 * The table below is deliberately small and explicit so it can be
 * mirrored in Rust / C++ without ambiguity.
 */

import type { ErrorNumericCode } from "./numeric";

/**
 * Single error code entry within a domain.
 *
 * @remarks
 * - `key` is the domain-local identifier (e.g. "unsupported")
 * - `code` is the fully-qualified string (e.g. "env.unsupported")
 * - `numericCode` is the encoded numeric value derived from:
 *   - domain id (high byte)
 *   - domain-local index (low byte)
 */
export interface DomainEntry {
  /**
   * Domain-local key used in registry maps.
   *
   * @example "unsupported" for "env.unsupported"
   */
  readonly key: string;

  /**
   * Fully-qualified string code.
   *
   * @example "env.unsupported"
   */
  readonly code: string;

  /**
   * Encoded numeric error code derived from the domain id
   * and a domain-local index.
   */
  readonly numericCode: ErrorNumericCode;
}

/**
 * Descriptor for a single error domain.
 *
 * @remarks
 * - `prefix` is the domain prefix (e.g. "env", "backing")
 * - `domainId` is the numeric high byte used by `encodeNumeric`
 * - `entries` are the concrete codes in this domain
 */
export interface DomainDescriptor {
  /**
   * Domain prefix, e.g. "env" / "backing" / "spec".
   */
  readonly prefix: string;

  /**
   * Numeric domain id (0–255).
   *
   * @remarks
   * This is the "high byte" component in the numeric encoding.
   */
  readonly domainId: DomainId;

  /**
   * Concrete error codes belonging to this domain.
   */
  readonly entries: readonly DomainEntry[];
}

/**
 * Canonical domain ID allocation for Seqlok.
 *
 * 8-bit domain IDs (0–255) with reserved ranges:
 *
 * - 0:        unknown / unregistered (fallback)
 * - 1–9:      @seqlok/base
 * - 10–49:    @seqlok/core
 * - 50–59:    @seqlok/introspect (observatory, registry)
 * - 60–69:    @seqlok/commands
 * - 70–79:    @seqlok/hotswap
 * - 200–254:  user / extension domains (3rd-party engines, plugins)
 * - 255:      reserved sentinel (never assign)
 */
export const DOMAIN_IDS = {
  // Reserved / fallback
  unknown: 0,

  // @seqlok/base
  internal: 1,

  // @seqlok/core (10–49)
  env: 10,
  backing: 11,
  primitives: 12,
  binding: 13,
  spec: 14,
  plan: 15,
  handoff: 16,

  // @seqlok/introspect (50–59)
  introspect: 50,

  // @seqlok/commands (60–69)
  commands: 60,

  // @seqlok/hotswap (70–79)
  hotswap: 70,

  // Reserved
  reserved: 255,
} as const;

/**
 * String name of a domain id as used in this table.
 *
 * @remarks
 * Includes sentinel entries (`unknown`, `reserved`) so you can round-trip
 * through the table for debugging / schema export.
 */
export type DomainIdName = keyof typeof DOMAIN_IDS;

/**
 * Numeric domain id for built-in domains.
 *
 * @remarks
 * Does not attempt to model the user range (200–254); third-party code
 * can still use those ids via explicit casts when defining domains.
 */
export type DomainId = (typeof DOMAIN_IDS)[DomainIdName];

/**
 * Domain name for non-sentinel domains (real error domains).
 *
 * @remarks
 * Filters out `unknown` and `reserved`.
 */
export type DomainName = Exclude<DomainIdName, "unknown" | "reserved">;

/**
 * Simple numeric range description used for docs / tooling.
 */
export interface DomainRange {
  readonly min: number;
  readonly max: number;
}

/**
 * Reserved ranges per package / role.
 *
 * @remarks
 * This is intentionally runtime data (not just comments) so that
 * tooling and schema generators can consume it directly.
 */
export const DOMAIN_RANGES: Readonly<{
  base: DomainRange;
  core: DomainRange;
  introspect: DomainRange;
  commands: DomainRange;
  hotswap: DomainRange;
  user: DomainRange;
}> = {
  base: { min: DOMAIN_IDS.internal, max: DOMAIN_IDS.internal },
  core: { min: DOMAIN_IDS.env, max: DOMAIN_IDS.handoff },
  introspect: { min: DOMAIN_IDS.introspect, max: DOMAIN_IDS.introspect },
  commands: { min: DOMAIN_IDS.commands, max: DOMAIN_IDS.commands },
  hotswap: { min: DOMAIN_IDS.hotswap, max: DOMAIN_IDS.hotswap },
  user: { min: 200, max: 254 },
} as const;

/**
 * Type guard for built-in domain ids (as opposed to user / extension ids).
 *
 * @remarks
 * Intended for tooling and guardrails in introspect / schema export.
 * Hot paths should not call this.
 */
export function isBuiltinDomainId(domainId: number): domainId is DomainId {
  // Small table, called off the hot path; linear scan is fine.
  // If this ever moves into hot code, replace with a switch.
  return (Object.values(DOMAIN_IDS) as number[]).includes(domainId);
}

/**
 * Returns true if the numeric id is in the user / extension range.
 */
export function isUserDomainId(domainId: number): boolean {
  const { user } = DOMAIN_RANGES;
  return domainId >= user.min && domainId <= user.max;
}
