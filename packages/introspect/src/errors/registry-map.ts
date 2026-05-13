/**
 * @fileoverview
 * Read-only view over domains registries from base/core/primitives/introspect.
 *
 * This module normalizes all per-domains registries to a common
 * `RegistryEntry` shape so that higher-level tooling (JSON export,
 * native codegen, REPL helpers) can treat them uniformly.
 */

import {
  type ErrorDescriptor as BaseErrorDescriptor,
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
import { STREAMBUF_ERRORS } from "@seqlok/streambuf";
import { WORKLET_MOUNT_ERRORS } from "@seqlok/worklet-mount";

import { INTROSPECT_ERRORS } from "./introspect";

import type { DomainName } from "./all-domains";

/**
 * Descriptor for a single error.
 *
 * Matches the public registry entry shape in `@seqlok/base`.
 */
export type RegistryEntry = BaseErrorDescriptor;

type InternalRegistry = typeof INTERNAL_ERRORS;
type PrimitivesRegistry = typeof PRIMITIVES_ERRORS;
type EnvRegistry = typeof ENV_ERRORS;
type SpecRegistry = typeof SPEC_ERRORS;
type BackingRegistry = typeof BACKING_ERRORS;
type BindingRegistry = typeof BINDING_ERRORS;
type PlanRegistry = typeof PLAN_ERRORS;
type HandoffRegistry = typeof HANDOFF_ERRORS;
type CommandsRegistry = typeof COMMANDS_ERRORS;
type IntrospectRegistry = typeof INTROSPECT_ERRORS;
type StreamBufRegistry = typeof STREAMBUF_ERRORS;
type WorkletMountRegistry = typeof WORKLET_MOUNT_ERRORS;

/**
 * Registry map for a single domains.
 *
 * Each concrete registry is a mapping from a local error key
 * (e.g. `"allocFailed"`) to a {@link RegistryEntry}.
 *
 * This union is enough for introspection tooling: all variants share
 * the same value shape.
 */
export type DomainRegistry =
  | InternalRegistry
  | PrimitivesRegistry
  | EnvRegistry
  | SpecRegistry
  | PlanRegistry
  | BackingRegistry
  | BindingRegistry
  | HandoffRegistry
  | CommandsRegistry
  | StreamBufRegistry
  | WorkletMountRegistry
  | IntrospectRegistry;

/**
 * Returns the registry entry for a key in a well-typed way.
 */
export function getRegistryEntry(
  registry: DomainRegistry,
  key: string,
): RegistryEntry | undefined {
  // All registries share the same value shape, so a simple lookup is enough.
  return (registry as Record<string, RegistryEntry | undefined>)[key];
}

/**
 * Registry lookup for the given domains name.
 */
export function getRegistryForDomain(domain: DomainName): DomainRegistry {
  switch (domain) {
    case "internal":
      return INTERNAL_ERRORS;

    case "primitives":
      return PRIMITIVES_ERRORS;

    case "env":
      return ENV_ERRORS;

    case "spec":
      return SPEC_ERRORS;

    case "plan":
      return PLAN_ERRORS;

    case "backing":
      return BACKING_ERRORS;

    case "binding":
      return BINDING_ERRORS;

    case "handoff":
      return HANDOFF_ERRORS;

    case "commands":
      return COMMANDS_ERRORS;

    case "introspect":
      return INTROSPECT_ERRORS;

    case "streambuf":
      return STREAMBUF_ERRORS;

    case "workletMount":
      return WORKLET_MOUNT_ERRORS;

    default:
      // DomainName is currently just `string`,
      // so this is a runtime guard, not an exhaustiveness check.
      panic(`Unhandled error domain in registry lookup: ${domain}`);
  }
}
