// src/diagnostics/features.ts

import { createError } from '../errors/error';

import type { DiagnosticsFeatureDetails } from '../errors/codes/diagnostics';

/**
 * Known diagnostics / debug feature flags.
 *
 * @remarks
 * These control optional introspection behaviour such as:
 * - seqlock timeline tracing
 * - swap / memory watermarks visualisation
 * - high-volume logging of certain paths
 *
 * They are intentionally separate from any user-facing feature flags.
 */
export type DiagnosticsFeatureName = 'seqlockTrace' | 'swapTimeline' | 'memoryWatermarks';

/**
 * Canonical list of features that the current build knows how to handle.
 *
 * @remarks
 * Extend this list when adding new diagnostics facilities. Prefer
 * extending over renaming to avoid breaking external tooling that
 * depends on a specific feature name.
 */
const KNOWN_FEATURES: readonly DiagnosticsFeatureName[] = [
  'seqlockTrace',
  'swapTimeline',
  'memoryWatermarks',
];

/**
 * Runtime set of enabled diagnostics features.
 *
 * @remarks
 * This is process-local and intentionally simple. More advanced wiring
 * (e.g. per-instance configuration) can layer on top of this helper.
 */
const enabledFeatures = new Set<DiagnosticsFeatureName>();

function isKnownDiagnosticsFeature(feature: string): feature is DiagnosticsFeatureName {
  return (KNOWN_FEATURES as readonly string[]).includes(feature);
}

/**
 * Enable a diagnostics feature by its string name.
 *
 * @remarks
 * Primary entrypoint for CLI flags, env vars, config files.
 *
 * @throws SeqlokError<'diagnostics.featureInvalid'>
 */
export function enableDiagnosticsFeatureByName(feature: string): void {
  if (!isKnownDiagnosticsFeature(feature)) {
    const details: DiagnosticsFeatureDetails = {
      feature,
      detail: 'Unknown diagnostics feature flag',
    };

    throw createError(
      'diagnostics.featureInvalid',
      'Diagnostics feature invalid',
      details,
    );
  }

  enabledFeatures.add(feature);
}

/**
 * Type-safe variant for enabling a feature when you already have a
 * `DiagnosticsFeatureName` (e.g. internal code).
 *
 * @remarks
 * This never throws; the type guarantees that the feature is known.
 */
export function enableDiagnosticsFeature(feature: DiagnosticsFeatureName): void {
  enabledFeatures.add(feature);
}

/**
 * Check whether a diagnostics feature is currently enabled.
 */
export function isDiagnosticsFeatureEnabled(feature: DiagnosticsFeatureName): boolean {
  return enabledFeatures.has(feature);
}

/**
 * Enumerate all currently enabled diagnostics features.
 */
export function listEnabledDiagnosticsFeatures(): readonly DiagnosticsFeatureName[] {
  return [...enabledFeatures];
}

/**
 * Disable all diagnostics features.
 *
 * @remarks
 * Intended for tests or when resetting diagnostics configuration in a
 * long-running process.
 */
export function resetDiagnosticsFeatures(): void {
  enabledFeatures.clear();
}
