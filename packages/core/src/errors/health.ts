/**
 * Health interpretation from error metadata.
 * Powers UI error handling and recovery strategies.
 *
 * @module errors/health
 */

import type { ErrorMeta } from './registry';

export type HealthStatus = ErrorMeta['severity'];

export interface HealthInterpretation {
  readonly status: HealthStatus;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly recoverable: boolean;
  readonly safeToExpose: boolean;
}

/**
 * Default label per severity.
 */
const HEALTH_LABELS: Record<HealthStatus, string> = {
  fatal: 'Critical',
  error: 'Error',
  warning: 'Warning',
};

/**
 * Default hint per severity + recoverability.
 */
const HEALTH_HINTS: Record<HealthStatus, (meta: ErrorMeta) => string | undefined> = {
  fatal: (meta) =>
    meta.recoverable
      ? 'Critical error – restart or reconfiguration may recover, but treat as high priority.'
      : 'Fatal error – cannot recover in-process; requires external intervention.',
  error: (meta) =>
    meta.recoverable
      ? 'Error – retry or configuration adjustment may succeed.'
      : 'Error – check configuration, inputs, or environment.',
  warning: () => 'Warning – operation may have degraded performance or partial results.',
};

/**
 * Interpret error metadata as health status.
 *
 * Default policy:
 *  - Group by severity
 *  - Preserve registry flags (recoverable, safeToExpose)
 *  - Attach a generic hint that UIs/CLIs can show or ignore
 */
export function interpretHealth(meta: ErrorMeta): HealthInterpretation {
  const { severity, recoverable, safeToExpose } = meta;
  const status: HealthStatus = severity;

  return {
    status,
    label: HEALTH_LABELS[status],
    hint: HEALTH_HINTS[status](meta),
    recoverable,
    safeToExpose,
  };
}

/**
 * Check if an error is safe and meaningful to expose outside the trust boundary.
 */
export function isSafeToExpose(meta: ErrorMeta): boolean {
  return meta.safeToExpose;
}

/**
 * Check if an error is plausibly recoverable (in principle).
 */
export function isRecoverable(meta: ErrorMeta): boolean {
  return meta.recoverable;
}

/**
 * Get documentation URL for an error (if available).
 */
export function getDocsUrl(meta: ErrorMeta): string | undefined {
  return meta.docsUrl;
}
