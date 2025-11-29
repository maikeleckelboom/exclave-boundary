/**
 * Portable health interpretation for Seqlok errors.
 *
 * @remarks
 * - Pure function over ErrorMeta: no registry or runtime coupling.
 * - Safe to use from any package that knows about SeqlokError.
 */

import type { ErrorMeta } from "./error";

export type HealthStatus = ErrorMeta["severity"];

export interface HealthInterpretation {
  readonly status: HealthStatus;
  readonly label: string;
  readonly hint?: string;
  readonly recoverable: boolean;
  readonly boundarySafe: boolean;
}

export function interpretHealth(meta: ErrorMeta): HealthInterpretation {
  switch (meta.severity) {
    case "warning":
      return {
        status: "warning",
        label: "Degraded, but still usable",
        hint: "Something is off, but the system can usually continue safely.",
        recoverable: true,
        boundarySafe: true,
      };

    case "error":
      return {
        status: "error",
        label: "Operation failed, system intact",
        hint: "The current operation failed, but the process can typically recover.",
        recoverable: true,
        boundarySafe: true,
      };

    case "fatal":
    default:
      return {
        status: "fatal",
        label: "Critical failure",
        hint: "Unrecoverable condition. The process or engine should be restarted.",
        recoverable: false,
        boundarySafe: false,
      };
  }
}

/**
 * Default "can I keep running without breaching safety boundaries?"
 */
export function isBoundarySafe(meta: ErrorMeta): boolean {
  // Keep this one trivially cheap and obviously side-effect free.
  return meta.severity !== "fatal";
}

/**
 * Optional docs URL for an error.
 *
 * @remarks
 * This is intentionally observatory-only. Not every environment needs
 * or wants a link back into the Seqlok docs universe.
 */
export function getDocsUrl(meta: ErrorMeta): string | undefined {
  const url = meta.docsUrl;

  if (typeof url !== "string") {
    return undefined;
  }

  const trimmed = url.trim();
  if (trimmed === "") {
    return undefined;
  }

  return trimmed;
}
