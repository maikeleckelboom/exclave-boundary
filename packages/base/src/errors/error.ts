import { panic } from "./panic";

import type { JsonValue } from "./json";

/**
 * @fileoverview
 * Core error primitives shared across all Seqlok packages.
 *
 * This layer is intentionally small and stable:
 * - It knows nothing about specific domains like spec/backing/env.
 * - Higher layers define registries and factories using these primitives.
 */

/**
 * Typed array constructor names used in introspect and metadata.
 */
export type TypedArrayName =
  | "Int8Array"
  | "Uint8Array"
  | "Uint8ClampedArray"
  | "Int16Array"
  | "Uint16Array"
  | "Int32Array"
  | "Uint32Array"
  | "Float32Array"
  | "Float64Array"
  | "BigInt64Array"
  | "BigUint64Array";

/**
 * Coarse severity classification for errors.
 *
 * @remarks
 * - "warning"   → recoverable, usually non-fatal
 * - "error"     → operation failed, but process may continue
 * - "fatal"     → unrecoverable, process or worker should be torn down
 */
export type ErrorSeverity = "warning" | "error" | "fatal";

/**
 * Metadata describing an error code’s semantics.
 *
 * @remarks
 * This is registry-level information: it does not vary per instance.
 */
export interface ErrorMeta {
  /**
   * Severity classification for operators and logging.
   */
  readonly severity: ErrorSeverity;

  /**
   * Whether recovery is plausible in principle.
   *
   * @remarks
   * Example: a transient timeout may be recoverable, a corrupted layout is not.
   */
  readonly recoverable: boolean;

  /**
   * Whether it is safe to surface this error across trust boundaries.
   *
   * @remarks
   * - `true`  → safe to expose to user-facing UIs or external callers
   * - `false` → keep confined to logs / internal telemetry
   */
  readonly boundarySafe: boolean;

  /**
   * Optional documentation URL for “learn more” links.
   */
  readonly docsUrl?: string;

  /**
   * Optional tags used by tooling / dashboards.
   */
  readonly tags?: readonly string[];

  /**
   * Optional hint about the dominant resource or subsystem.
   *
   * Examples: "memory", "env", "binding", "handoff".
   */
  readonly domainHint?: string;
}

/**
 * Structured detail payload for a single error instance.
 *
 * @remarks
 * Values must be JSON-serializable for logging and transport.
 */
export interface ErrorDetails {
  readonly where?: string;
  readonly detail?: string;
  readonly feature?: string;
  readonly reason?: string;
  readonly [key: string]: JsonValue | undefined;
}

/**
 * Portable, JSON-serializable error envelope.
 *
 * @remarks
 * This is what you would log, send over postMessage, or across a process
 * boundary. It intentionally drops stack and prototype information.
 */
export interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly meta: ErrorMeta;
  readonly details?: ErrorDetails;
}

/**
 * Extract the local key type from a fully qualified error code.
 *
 * @example
 * "env.unsupported" → "unsupported"
 */
export type ErrorKeyFromCode<Code extends string> =
  Code extends `${string}.${infer Key}` ? Key : never;

/**
 * Canonical runtime error type for Seqlok.
 *
 * @typeParam Code - Fully-qualified error code string.
 */
export class SeqlokError<Code extends string = string> extends Error {
  readonly code: Code;
  readonly details: ErrorDetails;
  readonly meta: ErrorMeta;

  constructor(
    code: Code,
    message: string,
    details: ErrorDetails,
    meta: ErrorMeta,
    cause?: unknown,
  ) {
    super(message, { cause });

    this.name = "SeqlokError";
    this.code = code;
    this.details = details;
    this.meta = meta;

    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Convert this error into a plain JSON envelope.
   *
   * @remarks
   * Stack and prototype information are intentionally dropped.
   */
  toJSON(): ErrorEnvelope & { readonly code: Code } {
    return {
      code: this.code,
      message: this.message,
      meta: this.meta,
      details: this.details,
    };
  }
}

/**
 * Type guard that checks whether a thrown value is a SeqlokError instance
 * (or a structural equivalent created in another realm).
 */
export function isSeqlokError(value: unknown): value is SeqlokError {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { name?: unknown; code?: unknown };

  return candidate.name === "SeqlokError" && typeof candidate.code === "string";
}

/**
 * Helper: extract the string keys from a type.
 *
 * Used to avoid `keyof T & string` intersection noise and keep ESLint happy.
 */
type StringKeyOf<T> = Extract<keyof T, string>;

/**
 * Factory-of-factories for building domain-specific error constructors.
 *
 * @typeParam Registry - Descriptor map indexed by a domain-local key
 *                       (for example "allocFailed" or "unsupported").
 *
 * @param registry - Map from local key to code/message/meta triple.
 *
 * @remarks
 * The registry stores the fully-qualified error `code` string so callers only
 * need to reference local keys while native / introspect still see stable
 * codes like "backing.allocFailed".
 */
export function createErrorFactory<
  Registry extends Record<
    string,
    {
      readonly code: string;
      readonly message: string;
      readonly meta: ErrorMeta;
    }
  >,
>(registry: Registry) {
  return function createError<K extends StringKeyOf<Registry>>(
    key: K,
    details: ErrorDetails,
    cause?: unknown,
  ): SeqlokError<Registry[K]["code"]> {
    const def = registry[key];

    if (def === undefined) {
      throw new Error(
        `Internal error: unknown error key passed to createErrorFactory: ${key}`,
      );
    }

    return new SeqlokError(def.code, def.message, details, def.meta, cause);
  };
}

/**
 * Shared descriptor shape used by domain helpers and diagnostics.
 */
export interface ErrorDescriptor {
  readonly code: string;
  readonly message: string;
  readonly meta: ErrorMeta;
}

/**
 * Registry type used by diagnostics and aggregation.
 *
 * @remarks
 * This is intentionally loose: domain-specific registries can be narrower
 * (finite key unions) but are assignable to this.
 */
export type ErrorRegistry = Record<string, ErrorDescriptor>;

/**
 * Minimal per-entry definition a domain author writes.
 */
export interface DomainDef {
  readonly message: string;
  readonly meta: ErrorMeta;
}

/**
 * Extract the concrete string keys from a defs object.
 *
 * @remarks
 * We no longer require an index signature; any "closed" object whose values
 * are `DomainDef`-ish is fine.
 */
type DomainKeys<Defs extends { [K in keyof Defs]: DomainDef }> =
  StringKeyOf<Defs>;

/**
 * Turn a `{ key: { message, meta } }` bag into a registry with fully
 * qualified codes `${Prefix}.${key}`.
 */
export type DomainRegistry<
  Prefix extends string,
  Defs extends { [K in keyof Defs]: DomainDef },
> = {
  readonly [Key in DomainKeys<Defs>]: {
    readonly code: `${Prefix}.${Key}`;
    readonly message: Defs[Key]["message"];
    readonly meta: Defs[Key]["meta"];
  };
};

/**
 * Logical error domain: value-level registry + prefix.
 */
export interface ErrorDomain<
  Prefix extends string,
  Registry extends ErrorRegistry,
> {
  readonly prefix: Prefix;
  readonly registry: Registry;
}

/**
 * Union of fully-qualified codes for a given domain.
 *
 *   "introspect.counterInvalid" | "introspect.featureInvalid" | ...
 */
export type ErrorCodeOf<D extends ErrorDomain<string, ErrorRegistry>> =
  D["registry"][keyof D["registry"]]["code"];

/**
 * Union of *local* keys for a given domain (e.g. "counterInvalid").
 *
 *   "counterInvalid" | "featureInvalid" | ...
 */
export type ErrorKeyOf<D extends ErrorDomain<string, ErrorRegistry>> =
  StringKeyOf<D["registry"]>;

/**
 * Factory type for domains that don’t distinguish per-key detail types.
 */
export type ErrorFactoryOf<D extends ErrorDomain<string, ErrorRegistry>> = <
  Key extends ErrorKeyOf<D>,
>(
  key: Key,
  details: ErrorDetails,
  cause?: unknown,
) => SeqlokError<ErrorCodeOf<D>>;

/**
 * Factory type that *does* distinguish per-key detail types.
 * (Used by `primitives.*` style domains.)
 */
export type KeyedErrorFactoryOf<
  D extends ErrorDomain<string, ErrorRegistry>,
  DetailsByKey extends Record<ErrorKeyOf<D>, ErrorDetails>,
> = <Key extends ErrorKeyOf<D>>(
  key: Key,
  details: DetailsByKey[Key],
  cause?: unknown,
) => SeqlokError<ErrorCodeOf<D>>;

/**
 * Convenience type: full domain including its factory.
 *
 * @remarks
 * This is the actual return type of `defineErrorDomain`. Using a named alias
 * lets packages write `ErrorDomainWithFactory<"env", Defs>`.
 */
export type ErrorDomainWithFactory<
  Prefix extends string,
  Defs extends { [K in keyof Defs]: DomainDef },
> = ErrorDomain<Prefix, DomainRegistry<Prefix, Defs>> & {
  readonly createError: ErrorFactoryOf<
    ErrorDomain<Prefix, DomainRegistry<Prefix, Defs>>
  >;
};

/**
 * One-stop helper: define a domain from a `prefix` and local defs.
 *
 * - You write `{ key: { message, meta } }`.
 * - Codes are derived as `${prefix}.${key}`.
 * - You get a typed `createError` back.
 */
export function defineErrorDomain<
  Prefix extends string,
  Defs extends { [K in keyof Defs]: DomainDef },
>(prefix: Prefix, defs: Defs): ErrorDomainWithFactory<Prefix, Defs> {
  const registry: ErrorRegistry = {};

  for (const key of Object.keys(defs) as DomainKeys<Defs>[]) {
    const def = defs[key];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (def === undefined) {
      panic(`createErrorFactory: unknown registry key "${key}"`);
    }

    registry[key] = {
      code: `${prefix}.${key}`,
      message: def.message,
      meta: def.meta,
    };
  }

  const typedRegistry: DomainRegistry<Prefix, Defs> =
    registry as DomainRegistry<Prefix, Defs>;

  const baseDomain: ErrorDomain<Prefix, DomainRegistry<Prefix, Defs>> = {
    prefix,
    registry: typedRegistry,
  };

  const baseFactory = createErrorFactory(typedRegistry);

  const createError: ErrorFactoryOf<typeof baseDomain> = (
    key,
    details,
    cause,
  ) => baseFactory(key, details, cause);

  return {
    ...baseDomain,
    createError,
  } satisfies ErrorDomainWithFactory<Prefix, Defs>;
}
