# ADR – Seqlok Error System v1.0

**Status**: Accepted, partially implemented  
**Last Updated**: 2025-11-29

## Context

Seqlok uses structured, numeric error codes across multiple packages and
eventually multiple languages (TS, Rust, C++). Early versions kept all
error domains and registries inside `@seqlok/core`, which:

- made ownership unclear (core knew about everything),
- made cross-package evolution hard,
- and complicated cross-language reuse.

The monorepo split and v0.3.x work moved errors into their owning
packages. This ADR records the **stable design** for v1.0 and the
remaining work.

## Decisions

### 1. Numeric encoding and domain IDs

- Each error has:
  - a fully qualified string code (e.g. `backing.allocFailed`)
  - a numeric code `ErrorNumericCode` (32-bit)
- Numeric codes are encoded as:

  - high 8 bits: **domain ID** (0–255)
  - low 24 bits: **domain-local ordinal** (1–16_777_215, 0 reserved)

Domain IDs live in `@seqlok/base` as `DOMAIN_IDS` and are treated as
ABI-stable once v1.0 ships.

Current allocation (short version):

- `0` – `unknown` / sentinel
- `1` – `internal` (base)
- `10–19` – core domains (`env`, `backing`, `primitives`, `binding`,
  `spec`, `plan`, `handoff`)
- `50–59` – `introspect`
- `60–69` – `commands`
- `70–79` – `hotswap` (planned)
- `200–254` – extension / 3rd-party domains
- `255` – reserved, never assigned

The authoritative table is `DOMAIN_IDS` in `@seqlok/base`.

### 2. Domain ownership per package

Each package owns its own error domain(s) and defines them via
`buildErrorDomain` from `@seqlok/base`:

- `@seqlok/base`
  - `internal.*`
- `@seqlok/primitives`
  - `primitives.*`
- `@seqlok/core`
  - `env.*`, `backing.*`, `binding.*`, `spec.*`, `plan.*`, `handoff.*`
- `@seqlok/introspect`
  - `introspect.*`
- `@seqlok/commands`
  - `commands.*`
- `@seqlok/hotswap` (planned)
  - `hotswap.*`

Each domain module exports:

- the built domain (registry + factory),
- a `DomainRegistry<"domain", Defs>` view for aggregation,
- and a keyed `createXError` factory with correctly typed detail maps.

No package reaches “upwards” to mutate someone else’s registry.

### 3. Global aggregated view lives in `@seqlok/introspect`

`@seqlok/introspect` is the **observatory**. It exports the canonical
aggregated view of all error domains:

- `ALL_DOMAINS: readonly DomainDescriptor[]`
- `listErrors(): ErrorDescriptor[]`
- `computeNumericCode(code: string): ErrorNumericCode | undefined`
- helpers like `extractDomainPrefix` / `extractLocalCode`

This view is used by:

- diagnostics and tooling,
- future JSON/IDL schema exporters,
- and non-TS consumers (Rust/C++).

Neither `@seqlok/core` nor other runtime packages maintain their own
global registry – they just own their domain definitions.

### 4. Health interpretation and docs URL

Portable health interpretation lives in `@seqlok/base`:

- `interpretHealth(meta: ErrorMeta): HealthInterpretation`
- `isBoundarySafe(meta: ErrorMeta): boolean`
- `getDocsUrl(meta: ErrorMeta): string | undefined`

These helpers are:

- pure functions over `ErrorMeta`,
- safe to use from any package,
- and intentionally small (warning / error / fatal, boundary-safe flag).

`@seqlok/introspect` and higher layers are free to build richer views on
top (e.g. `runWithIntrospect`) but the base health semantics are
centralised in `@seqlok/base`.

## Current Implementation Status

As of 2025-11-29:

Implemented:

- `@seqlok/base` hosts:
  - `SeqlokError` and error primitives,
  - `DOMAIN_IDS` and numeric encoding,
  - portable health helpers (`interpretHealth`, `isBoundarySafe`,
    `getDocsUrl`).
- Domains split and owned by packages (`internal.*`, `primitives.*`,
  `env.*`, `backing.*`, `binding.*`, `spec.*`, `plan.*`, `handoff.*`,
  `introspect.*`, `commands.*`).
- `@seqlok/introspect` exposes:
  - `ALL_DOMAINS`,
  - `listErrors`,
  - `computeNumericCode`,
  - registry-based helpers.

Partially done / still evolving:

- `commands.*` domain exists; `hotswap.*` domain is planned but not yet
  implemented.
- Registry invariants are enforced in tests for the current domains but
  not yet hardened as a dedicated test suite.

## Open Work Items

These are the remaining pieces this ADR still requires for v1.0.

### Registry invariants and tests

- Add a dedicated test module (likely in `@seqlok/introspect`) that
  checks:

  - **global uniqueness** of string codes,
  - **no gaps / duplicates** in the domain-local numeric indices,
  - **bijection** between string codes and numeric codes,
  - `DOMAIN_IDS` matches the aggregated registry.

- Keep this test suite cheap enough to run in CI.

### JSON / IDL schema export

- Implement a schema/export helper in `@seqlok/introspect` that emits a
  machine-consumable description of all domains and errors
  (JSON is fine; IDL can come later):

  - domain id and prefix,
  - error code, numeric code,
  - message and `ErrorMeta`,
  - detail field shapes (as far as they are statically knowable).

- Use this as the **single source** for Rust/C++ enums and docs.

### Cross-language consumption example

- Add a minimal Rust and/or C++ example (can live under a `reference`
  or `examples` directory):

  - imports the generated schema,
  - defines domain + error enums,
  - maps numeric codes to enum variants.

This does not have to be production-ready; it is a proof that the schema
and numeric encoding are sufficient.

### Governance note for error evolution

- Write a short governance doc (or section) describing:

  - how new domains and codes are added,
  - how deprecation is handled,
  - guarantee that numeric codes are **never reused**,
  - expectations for third-party / extension domains
    (200–254 range).

This doc can live alongside `ERROR_DOMAINS.md` and reference this ADR.

## Consequences

- Error handling is now **distributed by ownership** but still
  observable from a central place (`@seqlok/introspect`).
- Numeric codes and domain IDs form a stable ABI that other languages
  can consume.
- The remaining work is clearly scoped to:
  - invariants tests,
  - schema export,
  - x-lang prototype,
  - and governance.

Once those are done, the error system is v1.0-ready and should not
change in structure, only by adding new domains/codes.
