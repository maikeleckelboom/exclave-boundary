# Seqlok Error System

The Seqlok error system gives every failure a stable string code, a compact numeric code, and structured metadata. This page is for engineers who want to inspect, route, or extend errors — library authors, host applications, and tooling.

If you only need to catch and log errors, treat thrown values as `SeqlokError` and call `error.toJSON()` to get a portable envelope.

## Error Anatomy

### SeqlokError class

`SeqlokError<Code>` is the canonical runtime error type for Seqlok. It extends `Error` and carries structured metadata alongside the standard message and stack. Every error thrown by Seqlok packages is an instance of this class.

```typescript
class SeqlokError<Code extends string = string> extends Error {
  readonly code: Code;
  readonly details: ErrorDetails;
  readonly meta: ErrorMeta;

  constructor(
    code: Code,
    message: string,
    details: ErrorDetails,
    meta: ErrorMeta,
    cause?: unknown,
  );

  toJSON(): ErrorEnvelope & { readonly code: Code };
}
```

The `code` field holds the fully-qualified string code (e.g. `"backing.allocFailed"`). The `details` field carries instance-specific diagnostic data. The `meta` field holds registry-level semantics that do not vary per instance. The optional `cause` parameter chains to the underlying `Error.cause` for error provenance.

Calling `toJSON()` produces an `ErrorEnvelope` suitable for logging, `postMessage`, or cross-process transport. Stack and prototype information are intentionally stripped.

### ErrorEnvelope

`ErrorEnvelope` is the JSON-serializable boundary representation of a `SeqlokError`. It is what you would log, send over `postMessage`, or transmit across a process boundary.

```typescript
interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly meta: ErrorMeta;
  readonly details?: ErrorDetails;
}
```

Required fields:

- `code` — fully-qualified string code
- `message` — human-readable description
- `meta` — registry-level metadata

Optional fields:

- `details` — instance-specific diagnostic payload (may be omitted if empty)

The envelope intentionally omits stack traces and class prototype information to keep it portable and safe to serialize.

### ErrorMeta

`ErrorMeta` describes the static semantics of an error code. This metadata is defined once per error code in the domain registry and does not vary between instances.

```typescript
interface ErrorMeta {
  readonly severity: "warning" | "error" | "fatal";
  readonly recoverable: boolean;
  readonly boundarySafe: boolean;
  readonly docsUrl?: string;
  readonly tags?: readonly string[];
  readonly domainHint?: string;
}
```

Core fields:

- `severity` — coarse classification for operators and logging:
  - `"warning"` — recoverable, usually non-fatal
  - `"error"` — operation failed, but process may continue
  - `"fatal"` — unrecoverable, process or worker should be torn down
- `recoverable` — whether recovery is plausible in principle (e.g. a transient timeout may be recoverable; a corrupted layout is not)
- `boundarySafe` — whether it is safe to surface this error across trust boundaries; `false` means keep confined to logs or internal telemetry

Optional fields:

- `docsUrl` — documentation URL for "learn more" links
- `tags` — arbitrary tags for tooling and dashboards
- `domainHint` — hint about the dominant resource or subsystem (e.g. `"memory"`, `"env"`)

### ErrorDetails

`ErrorDetails` is the instance-specific diagnostic payload attached to a `SeqlokError`. Values must be JSON-serializable for logging and transport.

```typescript
interface ErrorDetails {
  readonly where?: string;
  readonly detail?: string;
  readonly feature?: string;
  readonly reason?: string;
  readonly [key: string]: JsonValue | undefined;
}
```

The interface defines common optional fields (`where`, `detail`, `feature`, `reason`) but allows arbitrary additional keys via the index signature. Each domain typically defines its own detail interface per error key — for example, `PrimitivesSeqlockTimeoutDetails` specifies `spinBudget`, `actualSpins`, `retryBudget`, and `retriesUsed` for the `primitives.seqlockTimeout` code.

The details object is carried through into the `ErrorEnvelope` intact, making it available for structured logging and diagnostics without loss of information.

## Numeric Encoding

### Layout

Every error code has a corresponding 32-bit unsigned integer representation, typed as `ErrorNumericCode`. This numeric form is derived deterministically from the domain ID and a domain-local ordinal.

```typescript
type ErrorNumericCode = number & { readonly __brand: "ErrorNumericCode" };

function encodeNumeric(domainId: number, localId: number): ErrorNumericCode;
function decodeNumeric(code: ErrorNumericCode): ErrorNumericParts;

interface ErrorNumericParts {
  readonly domainId: number;
  readonly localId: number;
}
```

The bit layout is:

- **High 8 bits (bits 24–31):** domain ID, range 0–255
- **Low 24 bits (bits 0–23):** domain-local ordinal, range 1–16,777,215

The local ordinal 0 is reserved and never assigned. Within a domain, ordinals are assigned sequentially starting from 1, based on the stable key order in the domain's registry.

For example, if `backing` has domain ID 11 and `allocFailed` is the first key in its registry, the numeric code is:

```
(11 << 24) | 1 = 184549377
```

The helpers `encodeNumeric` and `decodeNumeric` in `@seqlok/base` perform this encoding and decoding. They do not validate ranges; callers are responsible for ensuring domain IDs and ordinals fall within allocation policies.

### Design rationale

The numeric encoding exists for three reasons:

**Cross-language ABI.** Rust and C++ bindings can mirror this layout directly as a 32-bit enum or tagged integer. The encoding is simple enough that no complex parsing is required — a single bit shift and mask extracts the domain ID, and another mask extracts the local ordinal. This makes it straightforward to generate native enum definitions from the exported schema.

**Compact wire format.** A 4-byte integer is smaller than a variable-length string code and faster to compare. For high-volume telemetry, logs, and real-time diagnostics, numeric codes reduce serialization overhead and storage costs.

**Stable, non-reused identifiers.** Numeric codes are derived from string codes and domain IDs, both of which are append-only. Once a numeric code is assigned to an error, it is never reassigned — even if the error is deprecated. This guarantees that historic logs and external systems referencing a numeric code will always resolve to the same error, regardless of schema evolution.

The string code remains the canonical human-readable identifier. Numeric codes are a derived, machine-friendly projection for environments where compactness and cross-language interop matter.

## Domain Map

### Domain IDs and reserved ranges

Each error domain has a stable 8-bit **domain ID** defined in `@seqlok/base` as `DOMAIN_IDS`. The reserved ranges are:

- `0` — `unknown` / sentinel, used only as a fallback
- `1–9` — `@seqlok/base`
- `10–49` — `@seqlok/core` and core-adjacent runtime domains
- `50–59` — `@seqlok/introspect` (observatory, registry)
- `60–69` — `@seqlok/commands`
- `70–79` — `@seqlok/hotswap` (planned)
- `200–254` — user / extension domains (third-party engines, plugins)
- `255` — `reserved`, never assigned

For convenience, `DOMAIN_RANGES` in `@seqlok/base` exposes these ranges as runtime data:

- `base` — `[internal, internal]`
- `core` — `[env, handoff]` (includes `env`, `backing`, `primitives`, `binding`, `spec`, `plan`, `handoff`)
- `introspect` — `[introspect, introspect]`
- `commands` — `[commands, commands]`
- `hotswap` — `[hotswap, hotswap]`
- `user` — `[200, 254]`

Two helpers model the built-in vs user split:

```ts
isBuiltinDomainId(domainId: number): domainId is DomainId;
isUserDomainId(domainId: number): boolean;
```

This lets tooling distinguish Seqlok's own domains from caller-defined extensions without hard-coding ranges.

### Built-in domains

The current built-in domains are:

- `internal.*` — internal assertions and invariants (`@seqlok/base`)
- `primitives.*` — seqlock, rings, atomics, and low-level memory tools (`@seqlok/primitives`)
- `env.*` — environment and platform mismatches (`@seqlok/core`)
- `backing.*` — shared memory backing allocation and layout failures (`@seqlok/core`)
- `binding.*` — param / meter binding and range violations (`@seqlok/core`)
- `spec.*` — spec shape and validation issues (`@seqlok/core`)
- `plan.*` — layout planning and alignment failures (`@seqlok/core`)
- `handoff.*` — handoff construction and adoption failures (`@seqlok/core`)
- `introspect.*` — observability, counters, and registry tooling (`@seqlok/introspect`)
- `commands.*` — command-layer transport errors (`@seqlok/commands`)
- `hotswap.*` — reserved ID range for future engine swap protocol failures (`@seqlok/hotswap`)

The authoritative list of prefixes, IDs, and owners lives in `ERROR_DOMAINS.md`. This overview is intentionally condensed; `ERROR_DOMAINS.md` remains the source of truth for the full table.

## Defining a Domain

### Domain definitions and registries

Domain definitions live in the package that owns the domain. Each domain module defines a small record of message/meta pairs, then uses helpers from `@seqlok/base` to build a registry and factory.

At the lowest level, `defineErrorDomain` turns a prefix and a definition record into a domain-local registry and factory:

```ts
type DomainDef = {
  readonly message: string;
  readonly meta: ErrorMeta;
};

function defineErrorDomain<
  const Prefix extends string,
  const Defs extends Record<string, DomainDef>,
>(
  prefix: Prefix,
  defs: Defs,
): ErrorDomainWithFactory<Prefix, Defs>;
```

This:

- derives fully-qualified string codes (`"${prefix}.${key}"`),
- builds a registry of `{ code, message, meta }` entries,
- and exposes a strongly-typed `createError(key, details, cause?)` factory.

Most domains use the higher-level `buildErrorDomain` helper instead.

### `buildErrorDomain` for built-in domains

`buildErrorDomain` wraps `defineErrorDomain` and adds numeric codes plus a `DomainDescriptor` that `@seqlok/introspect` can aggregate:

```ts
function buildErrorDomain<
  const Prefix extends string,
  const Defs extends Record<string, DomainDef>,
>(
  prefix: Prefix,
  domainId: DomainId,
  defs: Defs,
): BuiltErrorDomain<Prefix, Defs>;
```

It:

- calls `defineErrorDomain(prefix, defs)` to build the registry and factory,
- walks the keys in definition order to assign domain-local ordinals,
- encodes numeric codes via `encodeNumeric(domainId, index + 1)`,
- and returns:
  - `registry` — `{ [key]: { code, message, meta } }`
  - `createError` — typed factory for throwing runtime errors
  - `domainId` — numeric domain ID from `DOMAIN_IDS`
  - `descriptor` — `{ prefix, domainId, entries: DomainEntry[] }`

Core runtime domains (`env.*`, `backing.*`, `binding.*`, `spec.*`, `plan.*`, `handoff.*`) and `internal.*` are defined this way so they carry numeric codes from the start.

Some domains (`primitives.*`, `introspect.*`) currently use `defineErrorDomain` directly and are indexed numerically later in `@seqlok/introspect`. The registry shape is still fully compatible; numeric codes are just attached at aggregation time instead of at domain definition time.

### Extension and third-party domains

Extension domains use the same primitives:

- Choose a **prefix** (e.g. `"myEngine"`).
- Allocate a **domain ID** in the extension range (`200–254`).
- Define a `Defs` record of `{ message, meta }` pairs.
- Call `buildErrorDomain("myEngine", /* your id */, defs)`.

The resulting domain object gives you:

- a typed `createError("someKey", details)` factory,
- a registry map suitable for diagnostics and export,
- and a `DomainDescriptor` that you can either:
  - aggregate yourself (for your own tools), or
  - wire into `@seqlok/introspect` inside the same monorepo if you want it to appear in Seqlok's global registry.

`isUserDomainId` can be used in guardrails and tooling to ensure your chosen ID stays inside the extension range.

## Consuming the Registry

### Global aggregated view in `@seqlok/introspect`

`@seqlok/introspect` is the observatory for the entire error universe. It rebuilds numeric descriptors from the per-domain registries and exposes a compact global index:

```ts
const ALL_DOMAINS: readonly DomainDescriptor[];

function listErrors(): ErrorIndexEntry[];
function computeNumericCode(code: string): ErrorNumericCode | undefined;
function extractDomainPrefix(code: string): string;
function extractLocalCode(code: string): string;
```

- `ALL_DOMAINS` holds one `DomainDescriptor` per domain (`prefix`, `domainId`, `entries` with numeric codes).
- `listErrors()` flattens this into a list of `{ code, domain, key, numericCode }` entries suitable for lookups, UIs, or tooling.
- `computeNumericCode("backing.allocFailed")` resolves a string code to its numeric code, or returns `undefined` if the code is unknown.
- `extractDomainPrefix` / `extractLocalCode` are small helpers for string-only processing where you do not need numeric codes.

This aggregated view is the single canonical numeric-code universe used by diagnostics, registry export, and future native bindings.

### Subset selection and JSON exports

For tooling and cross-language integration, `@seqlok/introspect` can project the registry into JSON.

Subset selection is driven by `SubsetSelectionCriteria`:

```ts
interface SubsetSelectionCriteria {
  readonly domains?: readonly DomainName[];
  readonly codes?: readonly string[];
  readonly severities?: readonly ErrorSeverity[];
  readonly recoverable?: boolean;
  readonly boundarySafe?: boolean;
  readonly tagsAnyOf?: readonly string[];
  readonly tagsAllOf?: readonly string[];
  readonly tagsNoneOf?: readonly string[];
}
```

All filters are AND-combined; omitting a field imposes no restriction. This criteria object is used by both the thin JSON export and the richer schema export.

Thin JSON export:

```ts
interface ErrorRegistryJson {
  readonly version: 1;
  readonly domains: readonly ExportedDomain[];
}

function buildErrorRegistryJson(
  criteria: SubsetSelectionCriteria,
): ErrorRegistryJson;

function buildFullErrorRegistryJson(): ErrorRegistryJson;
```

- Each domain entry includes `prefix`, `domainId`, and a list of `{ key, code, numericCode, message, meta }`.
- `buildFullErrorRegistryJson()` is a convenience for "all domains, all codes".

This shape is intentionally small and stable; it is suitable for dashboards, simple CLIs, or quick integrations where you do not need a full schema.

### Rich schema export

For schema-driven tooling and cross-language bindings, `export-json.ts` exposes a richer structure:

```ts
interface ErrorMetaSchema {
  readonly severity: ErrorSeverity;
  readonly recoverable: boolean;
  readonly boundarySafe: boolean;
  readonly docsUrl?: string;
  readonly tags?: readonly string[];
  readonly domainHint?: string;
}

interface ErrorCodeSchema {
  readonly code: string;
  readonly message: string;
  readonly numericCode: number;
  readonly domain: DomainName;
  readonly key: string;
  readonly meta: ErrorMetaSchema;
}

interface DomainSchema {
  readonly prefix: DomainName;
  readonly domainId: number;
  readonly codes: readonly ErrorCodeSchema[];
}

interface RegistryStats {
  readonly totalDomains: number;
  readonly totalCodes: number;
  readonly domainCounts: Readonly<Record<string, number>>;
  readonly severityCounts: Readonly<Record<ErrorSeverity, number>>;
}

interface ErrorRegistrySchema {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly generator: "@seqlok/introspect";
  readonly domainIds: Readonly<Record<string, number>>;
  readonly domains: readonly DomainSchema[];
  readonly allCodes: readonly ErrorCodeSchema[];
  readonly stats: RegistryStats;
}

function buildErrorRegistrySchema(
  criteria: SubsetSelectionCriteria,
): ErrorRegistrySchema;
```

`buildErrorRegistrySchema` joins:

- numeric descriptors (`ALL_DOMAINS`),
- per-domain registries (messages + `ErrorMeta`),
- and selection criteria

into a single document. This document is intended as the **source of truth** for:

- codegen of Rust / C++ enums,
- documentation sites,
- and any schema-driven tooling around error handling.

A prebuilt JSON Schema document, `ERROR_REGISTRY_JSON_SCHEMA`, plus a small `exportErrorRegistryJsonSchema()` helper, wrap this structure in a JSON-Schema-compatible envelope so non-TS consumers can validate the export. The bundled JSON Schema is intentionally conservative in v0.x and will evolve as cross-language bindings mature.

### Health interpretation helpers

Finally, `@seqlok/base` provides small, portable helpers over `ErrorMeta`:

```ts
function interpretHealth(meta: ErrorMeta): HealthInterpretation;
function isBoundarySafe(meta: ErrorMeta): boolean;
function getDocsUrl(meta: ErrorMeta): string | undefined;
```

These functions live in the base package so both runtime code and tools can share the same classification logic. Typical consumers include:

- host applications deciding whether to surface an error to users,
- monitoring dashboards colouring errors by severity / recoverability,
- and future REPL / CLI tooling that wants a consistent "health" view without duplicating policy.
