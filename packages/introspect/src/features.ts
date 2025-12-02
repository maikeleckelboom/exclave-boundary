/**
 * @fileoverview
 * Introspect feature flags and runtime controls.
 *
 * @remarks
 * - Manages debug and introspection features that can be toggled at runtime.
 * - Used for enabling/disabling specific introspect functionality.
 * - Separate from user-facing features to avoid accidental exposure.
 */

import {
  createIntrospectError,
  type IntrospectFeatureDetails,
} from "./errors/introspect";

/**
 * Known introspect / debug feature flags.
 *
 * @remarks
 * These control optional introspection behavior such as:
 * - seqlock timeline tracing
 * - swap / memory watermarks visualization
 * - high-volume logging of certain paths
 *
 * They are intentionally separate from any user-facing feature flags.
 */
export type IntrospectFeatureName =
  | "seqlockTrace"
  | "swapTimeline"
  | "memoryWatermarks";

/**
 * Canonical list of features that the current build knows how to handle.
 *
 * @remarks
 * Extend this list when adding new introspect facilities. Prefer
 * extending over renaming to avoid breaking external tooling that
 * depends on a specific feature name.
 */
const KNOWN_FEATURES: readonly IntrospectFeatureName[] = [
  "seqlockTrace",
  "swapTimeline",
  "memoryWatermarks",
];

/**
 * Runtime set of enabled introspect features.
 *
 * @remarks
 * This is process-local and intentionally simple. More advanced wiring
 * (e.g. per-instance configuration) can layer on top of this helper.
 */
const enabledFeatures = new Set<IntrospectFeatureName>();

function isKnownIntrospectFeature(
  feature: string,
): feature is IntrospectFeatureName {
  return (KNOWN_FEATURES as readonly string[]).includes(feature);
}

/**
 * Enable an introspect feature by its string name.
 *
 * @remarks
 * Primary entrypoint for CLI flags, env vars, config files.
 *
 * @throws SeqlokError<'introspect.featureInvalid'>
 */
export function enableIntrospectFeatureByName(feature: string): void {
  if (!isKnownIntrospectFeature(feature)) {
    const details: IntrospectFeatureDetails = {
      feature,
      detail: "Unknown introspect feature flag",
    };

    throw createIntrospectError("featureInvalid", details);
  }

  enabledFeatures.add(feature);
}

/**
 * Type-safe variant for enabling a feature when you already have a
 * `IntrospectFeatureName` (e.g. internal code).
 *
 * @remarks
 * This never throws; the type guarantees that the feature is known.
 */
export function enableIntrospectFeature(feature: IntrospectFeatureName): void {
  enabledFeatures.add(feature);
}

/**
 * Check whether an introspect feature is currently enabled.
 */
export function isIntrospectFeatureEnabled(
  feature: IntrospectFeatureName,
): boolean {
  return enabledFeatures.has(feature);
}

/**
 * Enumerate all currently enabled introspect features.
 */
export function listEnabledIntrospectFeatures(): readonly IntrospectFeatureName[] {
  return [...enabledFeatures];
}

/**
 * Disable all introspect features.
 *
 * @remarks
 * Intended for tests or when resetting introspect configuration in a
 * long-running process.
 */
export function resetIntrospectFeatures(): void {
  enabledFeatures.clear();
}
