/**
 * @fileoverview
 * Environment probing and SharedArrayBuffer capability checks.
 *
 * @remarks
 * - Provides a structured summary of the current runtime environment.
 * - Centralizes SAB / Atomics feature detection.
 * - Surfaces failures as structured `env.*` SeqlokError instances.
 */

import {
  createEnvError,
  type EnvCoopCoepDetails,
  type EnvUnsupportedDetails,
} from "../errors/env";

/**
 * High-level classification of the current runtime.
 */
export type EnvKind = "node" | "browser" | "worker" | "unknown";

/**
 * Summary of environment capabilities relevant to SAB usage.
 *
 * @remarks
 * `crossOriginIsolated` is only present when we were able to infer it
 * from the supplied global-like object.
 */
export interface EnvSummary {
  readonly kind: EnvKind;
  readonly hasSharedArrayBuffer: boolean;
  readonly crossOriginIsolated?: boolean;
}

/**
 * Minimal subset of the global object we care about for env probing.
 */
export interface EnvGlobal {
  readonly SharedArrayBuffer?: new (byteLength: number) => ArrayBufferLike;
  readonly Atomics?: {
    load(typedArray: Int32Array, index: number): number;
  };
  readonly document?: unknown;
  readonly importScripts?: (...args: string[]) => void;
  readonly crossOriginIsolated?: boolean;
  readonly process?: {
    readonly versions?: {
      readonly node?: string;
    };
  };
}

/**
 * Attach `crossOriginIsolated` to an EnvSummary base object when the
 * global-like object actually exposes it as a boolean.
 */
function withCrossOriginIsolated(
  base: { kind: EnvKind; hasSharedArrayBuffer: boolean },
  globalLike: EnvGlobal,
): EnvSummary {
  if (typeof globalLike.crossOriginIsolated === "boolean") {
    return {
      ...base,
      crossOriginIsolated: globalLike.crossOriginIsolated,
    };
  }

  // Property omitted entirely when not known, which is compatible with
  // `crossOriginIsolated?: boolean` under `exactOptionalPropertyTypes`.
  return base;
}

/**
 * Classify the given global-like object into an EnvSummary.
 *
 * @remarks
 * Pure function used by both runtime probes and tests with fake globals.
 */
export function summarizeEnv(globalLike: EnvGlobal): EnvSummary {
  const hasSharedArrayBuffer =
    typeof globalLike.SharedArrayBuffer === "function";

  const hasDocument = typeof globalLike.document !== "undefined";
  const hasImportScripts = typeof globalLike.importScripts === "function";

  const isNode =
    typeof globalLike.process?.versions?.node === "string" &&
    globalLike.process.versions.node.length > 0;

  let kind: EnvKind = "unknown";

  if (isNode) {
    kind = "node";
  } else if (hasDocument) {
    kind = "browser";
  } else if (hasImportScripts) {
    kind = "worker";
  }

  // Fast path: clearly no SAB support.
  if (!hasSharedArrayBuffer) {
    return withCrossOriginIsolated(
      {
        kind,
        hasSharedArrayBuffer: false,
      },
      globalLike,
    );
  }

  // Require Atomics as well; SAB without Atomics is not usable for us.
  if (typeof globalLike.Atomics !== "object") {
    return withCrossOriginIsolated(
      {
        kind,
        hasSharedArrayBuffer: false,
      },
      globalLike,
    );
  }

  // Defensive probe: try a tiny SAB allocation and a benign Atomics op,
  // but only using the supplied global-like hooks, not the real global.
  try {
    const SabCtor = globalLike.SharedArrayBuffer;
    const AtomicsObj = globalLike.Atomics;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!SabCtor || !AtomicsObj) {
      return withCrossOriginIsolated(
        {
          kind,
          hasSharedArrayBuffer: false,
        },
        globalLike,
      );
    }

    const sab = new SabCtor(4);
    const view = new Int32Array(sab);
    AtomicsObj.load(view, 0);
  } catch {
    return withCrossOriginIsolated(
      {
        kind,
        hasSharedArrayBuffer: false,
      },
      globalLike,
    );
  }

  return withCrossOriginIsolated(
    {
      kind,
      hasSharedArrayBuffer: true,
    },
    globalLike,
  );
}

/**
 * Probe the real globalThis and return an EnvSummary.
 *
 * @remarks
 * This is the primary runtime entrypoint.
 */
export function probeEnv(): EnvSummary {
  // Cast is safe: we only access a narrow subset checked at runtime.
  return summarizeEnv(globalThis as unknown as EnvGlobal);
}

/**
 * Assert that the current runtime supports SAB for Seqlok usage.
 *
 * @throws SeqlokError<'env.unsupported' | 'env.coopCoepRequired'>
 */
export function assertSabSupport(where: string): EnvSummary {
  const summary = probeEnv();
  return assertSabSupportFromSummary(where, summary);
}

/**
 * Main test hook: no global access, fully deterministic.
 *
 * @throws SeqlokError<'env.unsupported' | 'env.coopCoepRequired'>
 */
export function assertSabSupportFromSummary(
  where: string,
  summary: EnvSummary,
): EnvSummary {
  const base = { where };

  if (!summary.hasSharedArrayBuffer) {
    const details: EnvUnsupportedDetails = {
      ...base,
      feature: "SharedArrayBuffer",
      reason: `${summary.kind} environment lacks SharedArrayBuffer support`,
    };

    throw createEnvError("unsupported", details);
  }

  if (
    (summary.kind === "browser" || summary.kind === "worker") &&
    summary.crossOriginIsolated === false
  ) {
    const details: EnvCoopCoepDetails = {
      ...base,
      context: summary.kind,
    };

    throw createEnvError("coopCoepRequired", details);
  }

  return summary;
}
