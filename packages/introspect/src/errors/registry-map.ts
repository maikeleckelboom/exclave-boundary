/**
 * @fileoverview
 * Read-only view over domain registries from base/core/primitives/introspect.
 *
 * This module normalizes all per-domain registries to the portable
 * `ErrorRegistry` shape from `@seqlok/base` so that higher-level tooling
 * (JSON export, native codegen, REPL helpers) can treat them uniformly.
 */

import {
  type ErrorDescriptor as BaseErrorDescriptor,
  type ErrorRegistry as BaseErrorRegistry,
  INTERNAL_ERRORS,
  panic,
} from "@seqlok/base";
import { COMMANDS_ERRORS } from "@seqlok/commands";
import {
  BACKING_ERRORS,
  BINDING_ERRORS,
  ENV_ERRORS,
  HANDOFF_ERRORS,
  PLAN_ERRORS,
  SPEC_ERRORS,
} from "@seqlok/core";
import { PRIMITIVES_ERRORS } from "@seqlok/primitives";

import { INTROSPECT_ERRORS } from "./introspect";

import type { DomainName } from "./all-domains";

/**
 * Descriptor for a single error.
 *
 * Matches the public registry entry shape in `@seqlok/base`.
 */
export type RegistryEntry = BaseErrorDescriptor;

/**
 * Registry map for a single domain.
 *
 * Keys are local error keys (e.g. "allocFailed").
 */
export type DomainRegistry = BaseErrorRegistry;

/**
 * Look up the registry for a given domain prefix.
 *
 * All registries are structurally compatible with `DomainRegistry`:
 *
 *   { [key: string]: { code, message, meta } }
 *
 * The casts are a one-way, read-only bridge from the strongly-typed
 * per-domain maps (internal/env/...) to the generic registry shape.
 */
export function getRegistryForDomain(domain: DomainName): DomainRegistry {
  switch (domain) {
    case "internal":
      return INTERNAL_ERRORS as unknown as DomainRegistry;

    case "env":
      return ENV_ERRORS as unknown as DomainRegistry;

    case "backing":
      return BACKING_ERRORS as unknown as DomainRegistry;

    case "primitives":
      return PRIMITIVES_ERRORS as unknown as DomainRegistry;

    case "binding":
      return BINDING_ERRORS as unknown as DomainRegistry;

    case "spec":
      return SPEC_ERRORS as unknown as DomainRegistry;

    case "plan":
      return PLAN_ERRORS as unknown as DomainRegistry;

    case "handoff":
      return HANDOFF_ERRORS as unknown as DomainRegistry;

    case "commands":
      return COMMANDS_ERRORS as unknown as DomainRegistry;

    case "introspect":
      return INTROSPECT_ERRORS as unknown as DomainRegistry;

    default:
      // DomainName is currently just `string`, so this is a runtime guard,
      // not an exhaustiveness check.
      panic(`Unhandled error domain in registry lookup: ${domain}`);
  }
}
