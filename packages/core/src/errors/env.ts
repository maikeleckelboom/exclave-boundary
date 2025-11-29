/**
 * @fileoverview
 * Error codes and detail types for environment / platform constraints.
 *
 * @remarks
 * - Models hard requirements like SharedArrayBuffer availability.
 * - Used by env helpers and allocation guards to gate SAB usage.
 * - Registered into the global error registry as the `env.*` domain.
 */

import {
  buildErrorDomain,
  DOMAIN_IDS,
  type BuiltErrorDomain,
  type DomainRegistry,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorKeyOf,
  type KeyedErrorFactoryOf,
  type SeqlokError,
} from "@seqlok/base";

/**
 * Details for `env.unsupported`.
 *
 * @remarks
 * Used when the runtime is missing a required platform feature such as
 * SharedArrayBuffer or Atomics.
 */
export interface EnvUnsupportedDetails extends ErrorDetails {
  readonly feature: string;
  readonly reason?: string;
}

/**
 * Details for `env.coopCoepRequired`.
 *
 * @remarks
 * Used when a browser/worker environment has SharedArrayBuffer but is
 * not cross-origin isolated (COOP/COEP headers missing).
 */
export interface EnvCoopCoepDetails extends ErrorDetails {
  readonly context: "browser" | "worker" | "unknown";
}

interface EnvDetailsByKey {
  readonly unsupported: EnvUnsupportedDetails;
  readonly coopCoepRequired: EnvCoopCoepDetails;
}

const ENV_DEFS = {
  unsupported: {
    message: "Required env feature unavailable: SharedArrayBuffer",
    meta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: true,
    },
  },
  coopCoepRequired: {
    message: "COOP/COEP headers required for SharedArrayBuffer usage",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
} as const;

type EnvDefs = typeof ENV_DEFS;

export const ENV: BuiltErrorDomain<"env", EnvDefs> = buildErrorDomain(
  "env",
  DOMAIN_IDS.env,
  ENV_DEFS,
);

export type EnvErrorCode = ErrorCodeOf<typeof ENV>;
export type EnvErrorKey = ErrorKeyOf<typeof ENV>;
export type EnvError = SeqlokError<EnvErrorCode>;

export const ENV_ERRORS: DomainRegistry<"env", EnvDefs> = ENV.registry;

export const createEnvError: KeyedErrorFactoryOf<
  BuiltErrorDomain<"env", EnvDefs>,
  EnvDetailsByKey
> = ENV.createError;

export type EnvErrorFactory = typeof createEnvError;
