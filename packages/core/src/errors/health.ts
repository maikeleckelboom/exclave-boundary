/**
 * Health interpretation for Seqlok errors.
 *
 * @remarks
 * This module turns low-level error metadata into a small, UI-friendly
 * health description. It is intentionally:
 *
 * - **Meta-driven**: currently derives health status directly from
 *   `ErrorMeta['severity']`.
 * - **Domain-agnostic**: callers are free to wrap or override this for
 *   specific error codes (e.g. `diagnostics.*`, `backing.*`).
 *
 * The goal is to provide a stable, generic fallback that CLIs / UIs can
 * use without knowing every error code in detail.
 */

import type { ErrorMeta } from './registry';

/**
 * High-level health status derived from the error severity.
 *
 * @remarks
 * This is intentionally kept as an alias of `ErrorMeta['severity']`
 * so adding a new severity in the registry forces an update here.
 */
export type HealthStatus = ErrorMeta['severity'];

/**
 * Interpreted health view for a single error.
 *
 * @remarks
 * - `status` and `label` are suitable for badges / headings.
 * - `hint` is a single action-oriented line; callers may show it verbatim
 *   or ignore it.
 * - `recoverable` and `boundarySafe` are passed through from `ErrorMeta`
 *   and should guide control flow and logging / UX decisions.
 */
export interface HealthInterpretation {
  readonly status: HealthStatus;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly recoverable: boolean;
  readonly boundarySafe: boolean;
}

/**
 * Default label per severity.
 *
 * @remarks
 * These are short, UI-facing labels that can be shown in badges or
 * summaries. Domain-specific wrappers may override them.
 */
const HEALTH_LABELS: Record<HealthStatus, string> = {
  fatal: 'Critical',
  error: 'Error',
  warning: 'Warning',
};

// Default hint per health status + recoverability.
//
// These are generic fallbacks. Domain-specific code (e.g. a helper that
// switches on `error.code`) is free to override `hint` with something
// more precise.
//
// The aim is to answer “what should the operator do next?” in one line.

const FATAL_HINT_RECOVERABLE =
  'Severe internal failure; restart the affected subsystem or reload the current task before continuing.';

const FATAL_HINT_NON_RECOVERABLE =
  'Unrecoverable internal failure; stop processing in this process and restart the application or host environment.';

const ERROR_HINT_RECOVERABLE =
  'Operation failed; retry or adjust configuration and inputs, then run it again.';

const ERROR_HINT_NON_RECOVERABLE =
  'Operation failed due to invalid configuration or environment; correct the setup before retrying.';

const WARNING_HINT =
  'Non-critical issue; processing continues but behaviour, performance, or results may be partially degraded.';

const HEALTH_HINTS: Record<HealthStatus, (meta: ErrorMeta) => string | undefined> = {
  fatal: (meta) =>
    meta.recoverable ? FATAL_HINT_RECOVERABLE : FATAL_HINT_NON_RECOVERABLE,

  error: (meta) =>
    meta.recoverable ? ERROR_HINT_RECOVERABLE : ERROR_HINT_NON_RECOVERABLE,

  warning: () => WARNING_HINT,
};

/**
 * Interpret error metadata as health status.
 *
 * @remarks
 * Default policy:
 * - Uses `meta.severity` as the health status.
 * - Derives a short label from `HEALTH_LABELS`.
 * - Attaches a generic, action-oriented hint from `HEALTH_HINTS`.
 * - Passes through `recoverable` and `boundarySafe` from the registry.
 *
 * Callers that know the full error object (including `code`) can wrap
 * this and override `label` or `hint` for specific domains.
 */
export function interpretHealth(meta: ErrorMeta): HealthInterpretation {
  const { severity, recoverable, boundarySafe } = meta;
  const status: HealthStatus = severity;

  return {
    status,
    label: HEALTH_LABELS[status],
    hint: HEALTH_HINTS[status](meta),
    recoverable,
    boundarySafe: boundarySafe,
  };
}

/**
 * Check if an error is safe and meaningful to expose outside the
 * current trust boundary (e.g. to logs, UIs, or remote callers).
 *
 * @remarks
 * This is a thin alias over `meta.boundarySafe` to keep call sites
 * expressive.
 */
export function isSafeToExpose(meta: ErrorMeta): boolean {
  return meta.boundarySafe;
}

/**
 * Check if an error is plausibly recoverable in principle.
 *
 * @remarks
 * This does not guarantee recovery will succeed; it reflects the
 * registry’s intent that retry / reconfiguration may be viable.
 */
export function isRecoverable(meta: ErrorMeta): boolean {
  return meta.recoverable;
}

/**
 * Get a documentation URL for an error, if one is registered.
 *
 * @remarks
 * UIs and CLIs may surface this as a “Learn more” link next to the
 * interpreted health state.
 */
export function getDocsUrl(meta: ErrorMeta): string | undefined {
  return meta.docsUrl;
}
