import { createError } from '../errors/error';

import type { EnvCoopCoepDetails, EnvUnsupportedDetails } from '../errors/codes/env';

/**
 * Coarse environment classification for SAB/COOP/COEP diagnostics.
 */
export type EnvKind = 'node' | 'browser' | 'worker' | 'unknown';

export interface EnvSummary {
  readonly kind: EnvKind;
  readonly hasSharedArrayBuffer: boolean;
  /**
   * Mirrors `globalThis.crossOriginIsolated` when present (browser/worker),
   * otherwise `undefined`.
   */
  readonly crossOriginIsolated?: boolean;
}

/**
 * Narrowed view of the global object used for runtime probing.
 *
 * All fields are optional to keep this safe in Node/bare environments.
 *
 * @remarks
 * - Exported so tests can construct minimal fake environments.
 */
export type EnvGlobal = typeof globalThis & {
  SharedArrayBuffer?: typeof SharedArrayBuffer;
  Atomics?: typeof Atomics;
  crossOriginIsolated?: boolean;
  document?: unknown;
  importScripts?: (...urls: string[]) => void;
  process?: {
    readonly versions?: {
      readonly node?: string;
    };
  };
};

/**
 * Pure classification helper for an arbitrary "global-like" object.
 *
 * @remarks
 * - This is the main entry point for tests; it does not touch real globals.
 */
export function summarizeEnvFrom(globalLike: EnvGlobal): EnvSummary {
  const hasSharedArrayBuffer = typeof globalLike.SharedArrayBuffer === 'function';

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const isNode = typeof globalLike.process?.versions?.node === 'string';
  if (isNode) {
    return {
      kind: 'node',
      hasSharedArrayBuffer,
    };
  }

  const isWorker =
    typeof globalLike.importScripts === 'function' &&
    typeof globalLike.document === 'undefined';

  if (isWorker) {
    return {
      kind: 'worker',
      hasSharedArrayBuffer,
      crossOriginIsolated: globalLike.crossOriginIsolated,
    };
  }

  const isBrowser = typeof globalLike.document !== 'undefined';
  if (isBrowser) {
    return {
      kind: 'browser',
      hasSharedArrayBuffer,
      crossOriginIsolated: globalLike.crossOriginIsolated,
    };
  }

  // Fallback bucket for exotic hosts.
  return {
    kind: 'unknown',
    hasSharedArrayBuffer,
    crossOriginIsolated: globalLike.crossOriginIsolated,
  };
}

/**
 * Lightweight, side-effect free probe of the current runtime.
 */
export function probeEnvironment(): EnvSummary {
  return summarizeEnvFrom(globalThis as EnvGlobal);
}

/**
 * Pure assertion helper for a precomputed EnvSummary.
 *
 * @remarks
 * - Main test hook: no global access, fully deterministic.
 */
export function assertSharedArrayBufferSupportFromSummary(
  where: string,
  summary: EnvSummary,
): EnvSummary {
  const base: { readonly where: string } = { where };

  if (!summary.hasSharedArrayBuffer) {
    const details: EnvUnsupportedDetails = {
      ...base,
      feature: 'SharedArrayBuffer',
      reason: `${summary.kind} environment lacks SharedArrayBuffer support`,
    };

    throw createError(
      'env.unsupported',
      'SharedArrayBuffer is required but not available in this environment',
      details,
    );
  }

  if (
    (summary.kind === 'browser' || summary.kind === 'worker') &&
    summary.crossOriginIsolated === false
  ) {
    const details: EnvCoopCoepDetails = {
      ...base,
      context: summary.kind,
    };

    throw createError(
      'env.coopCoepRequired',
      'SharedArrayBuffer usage requires COOP/COEP headers (crossOriginIsolated = true).',
      details,
    );
  }

  return summary;
}

/**
 * Assert that SharedArrayBuffer can be safely used from this environment.
 *
 * Throws a typed SeqlokError on failure:
 *  - `env.unsupported`      → no SharedArrayBuffer support at all.
 *  - `env.coopCoepRequired` → browser/worker without COOP/COEP headers
 *                             (`crossOriginIsolated === false`).
 */
export function assertSharedArrayBufferSupport(where: string): EnvSummary {
  const summary = probeEnvironment();
  return assertSharedArrayBufferSupportFromSummary(where, summary);
}
