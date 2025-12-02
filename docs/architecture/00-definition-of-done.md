# Seqlok: Definition of Done (Gravity Well)

Seqlok is "done" when it is a stable, language-agnostic control fabric for real-time systems with:

- a locked and minimal API surface
- proven concurrency semantics
- a coherent error and diagnostics story
- a small set of reference integrations that show real use

The sections below describe that target.

---

## DOD-ARCH: Architecture and packages

### ARCH-1: Layered monorepo is stable and enforced

- Packages and dependency flow (runtime spine + sidecars):

  - `@seqlok/base`: axioms, base error algebra, cross-cutting protocol types  
    → **no dependencies**

  - `@seqlok/primitives`: concurrency and memory (atomics, seqlock, SWSR rings)  
    → depends on `@seqlok/base`

  - `@seqlok/core`: spec, plan, backing, handoff and bindings  
    → depends on `@seqlok/base`, `@seqlok/primitives`

  - `@seqlok/commands`: command transport protocol (rings, op codes)  
    → depends on `@seqlok/base`, `@seqlok/primitives`, `@seqlok/core`

  - `@seqlok/hotswap`: engine lifecycle and swap protocol  
    → depends on `@seqlok/base`, `@seqlok/primitives`, `@seqlok/core`, `@seqlok/commands`

  - `@seqlok/integration`: host wiring and topologies (workers, audio/compute hosts)  
    → depends on `@seqlok/base`, `@seqlok/primitives`, `@seqlok/core`, `@seqlok/commands`, `@seqlok/hotswap`

  - `@seqlok/introspect`: error registry, health interpretation, environment probing  
    → depends on `@seqlok/base`, `@seqlok/primitives`, `@seqlok/core`, `@seqlok/commands`, `@seqlok/hotswap`  
    → **does not** depend on `@seqlok/integration`

  - `@seqlok/docs` (or equivalent): documentation site  
    → may depend on all packages

  - `@seqlok/playground` (or equivalent): interactive demo app  
    → depends on `@seqlok/integration`, `@seqlok/introspect`

- Dependency rules are expressed in tooling (ESLint, dependency graph checks, TypeScript references) and CI fails on
  violations.

### ARCH-2: Ownership of concepts is unambiguous

- Each concern (errors, seqlock, command ring, hotswap protocol, host wiring, introspection) has exactly one owning
  package.
- Public types are exported from that package root barrel. Internal modules are not re-exported across package
  boundaries.
- Introspect aggregates runtime information but does not "own" runtime domains; it owns introspection-only domains.

### ARCH-3: Memory and layout model is frozen

- Memory planes and packed layouts are versioned and described in docs, including alignment guarantees.
- A minimal layout spec document exists that is enough for a Rust or C++ implementation to interoperate without reading
  the TypeScript source.

---

## DOD-API: Public surface and semantics

### API-1: Canonical flow is final and documented

- Public API centers on:

  ```text
  defineSpec
  → planLayout
  → allocateShared | allocateSharedSplit | allocateWasmShared
  → buildHandoff
  → receiveHandoff
  → bindController / bindProcessor
  ```

- Observer bindings (read-only views) are allowed, but they follow the same handoff and binding model and do not need a
  separate "canonical flow".
- No alternative experimental flows are required for normal usage.

### API-2: Param and meter interfaces are stable

- Controller:

  - `params.set(key, value)`
  - `params.update(patch)`
  - `params.stage(key, cb(view))` for arrays
  - `meters.snapshot(...)` for coherent reads (object and positional API)

- Processor:

  - `params.within(cb)` for coherent param read windows
  - `meters.publish(cb)` for coherent meter writes:

    - scalar meters via writer functions (e.g. `writer.level(value)`)
    - array meters via `writer.stage('arrayKey', cb(view))`

- Observer (when present):

  - `snapshot(...)` API equivalent to controller meters, but read-only
  - never owns params or meters; it only reads coherent views

- DSL ranges are range-only (`{min, max}`). There is no `step`, `origin` or `default` in the DSL itself; snapping and
  defaults are handled by hosts.

### API-3: No legacy names or aliases remain

- No `setMany`, no `adoptHandoff`, no `meters.sample`, no legacy DSL options.
- Deprecated symbols, if they exist at all, are marked and scheduled for removal with a clear policy.

### API-4: TypeScript experience is first class

- All public APIs are generically typed end to end, with no `any`.
- `defineSpec` → `Plan<S>` → `Handoff<S>` → `ReceivedHandoff<S>` → bindings preserves type information without manual
  casts.
- Example projects build without needing `as never` or `@ts-expect-error` outside of tests.

---

## DOD-CONC: Concurrency and correctness

### CONC-1: Concurrency model is explicit and documented

- Seqlok documents which data paths are SWMR (params and meters) and which are SWSR/MWSR/MWMR (command rings, hotswap
  orchestration).
- The seqlock protocol used for params and meters is described in plain language with diagrams.
- The command-ring protocol is documented (producer/consumer roles, wraparound, ABA considerations).

### CONC-2: Hot paths are property tested

- Property tests cover at least:

  - seqlock coherence with monotone version progression and no torn reads
  - param updates and snapshot invariants with no partial structs
  - hotswap ticket lifecycle, which always reaches a terminal state and keeps at most one active engine per slot

### CONC-3: Concurrency is stress tested

- Node and browser worker tests exist for:

  - cross-thread seqlock behavior under load
  - command ring under bursty producers and consumers
  - hotswap transitions while commands are in flight

- A simulated SPARBB-style harness runs randomized scenarios (start, pause, abort, resume, blend) and is part of CI.

---

## DOD-ERR: Errors, diagnostics, health

### ERR-1: Error domains are fully split and stable

- Error codes are partitioned by package:

  - `internal.*`: base (internal invariants, unreachable states, programmer errors)
  - `primitives.*`: primitives (seqlock, rings, planes)
  - `env.*`, `backing.*`, `binding.*`, `spec.*`, `plan.*`, `handoff.*`: core
  - `commands.*`: commands
  - `hotswap.*`: hotswap
  - `integration.*`: integration (host-specific; not required for cross-language consumers)
  - `introspect.*`: introspect (observability and instrumentation sidecar)

- Each code lives in exactly one `codes/*.ts` file under its owning package.

- Runtime packages construct errors via their domain-local factories (e.g. `createBackingError`, `createPrimitivesError`), all built on top of the shared error primitives in `@seqlok/base`. They do not know or care about global registries.

### ERR-2: Global registry in the introspect package aggregates, does not own

- `@seqlok/introspect` exposes the global registry view:

  - type unions such as `ErrorCode`, `ErrorDomain`, `CodeToPayload`
  - maps such as `ERROR_META`, `ERROR_MESSAGES`
  - helpers such as `getErrorMeta`, `getErrorMessage`, `isErrorCode`, `interpretHealth`

- The registry imports domain maps and detail types from:

  - base (`internal.*`, env protocol types)
  - primitives (`primitives.*`)
  - core (`spec.*`, `plan.*`, `backing.*`, `binding.*`, `handoff.*`)
  - commands (`commands.*`)
  - hotswap (`hotswap.*`)

- Integration-specific codes (`integration.*`) may expose their own maps but are not required to be part of the global,
  cross-language registry.

- Runtime packages never depend on `@seqlok/introspect`; introspect is a sidecar that depends on the runtime spine.

### ERR-3: Invariants are formalized and enforced

- Invariants include, at minimum:

  - globally unique `code` strings
  - immutable codes after release, with no renames
  - a bijection between code unions and map keys
  - complete metadata and messages, with no orphan entries

- CI has tests that fail on invariant violations.

### ERR-4: JSON schema or IDL exists

- A generated JSON (or similar) schema describes all **registry** error codes, fields and severities.
- The schema is generated from `@seqlok/introspect` and reflects the aggregated registry view.
- Rust or C++ code can be generated from this schema to mirror the TypeScript error surface.

### ERR-5: Diagnostics are structured and documented

- `@seqlok/introspect` provides:

  - environment probes for `Atomics`, `SharedArrayBuffer`, `WebAssembly` and related features
  - result types that carry structured errors and health interpretations
  - guidance on how hosts should degrade when capabilities are missing
  - utilities to route `SeqlokError` + `ErrorCode` into host logging and observability systems

---

## DOD-PERF: Performance

### PERF-1: Performance budgets are defined

- Clear targets exist for key operations at the level of order of magnitude, not fine tuning. For example:

  - `seqlock.publish`: about one hundred nanoseconds
  - `params.stage` for scalar and array: about one to two hundred nanoseconds
  - `meters.snapshot` on small sets: below one microsecond

- Targets are documented in `docs/performance`.

### PERF-2: Benchmarks are reproducible and tracked

- `pnpm bench` (or equivalent) produces machine-readable output and a generated markdown summary.
- There is a visible history of benchmark runs, for example checked-in JSON or markdown files, so regressions can be
  tracked.

### PERF-3: Performance is part of correctness

- CI includes at least one performance smoke step on a standard machine profile that fails if hot path timings grow
  beyond a reasonable factor.

---

## DOD-DOCS: Documentation and examples

### DOCS-1: Architecture docs match reality

- The VitePress (or equivalent) site includes:

  - an overview of the layer stack:

    - runtime spine:
      `base → primitives → core → commands → hotswap → integration`
    - introspect as a sidecar that depends on the runtime spine

  - a canonical flow walkthrough with diagrams

  - the error and diagnostics story, including domain ownership and the role of `@seqlok/introspect`

  - concurrency model diagrams for params/meters (seqlock) and for the command ring

- Docs are kept current enough that a new engineer can implement a small host without reading the entire source tree.

### DOCS-2: API reference is discoverable

- Public exports of each package are documented, at least by hand-curated sections rather than only raw generated dumps.
- Each major function has at least one non-trivial example.

### DOCS-3: Reference integrations exist

- At least two real examples exist:

  1. a minimal audio-adjacent host, such as a simple DSP worker with UI controls, using core bindings
  2. a non-audio simulation, such as a WebGPU boids demo, using params and meters and optionally hotswap

- Both live in the repo or in a sibling repo and compile and run against current Seqlok versions.

---

## DOD-TEST: Testing and CI

### TEST-1: Test coverage is meaningful, not just numeric

- All critical modules, such as spec validation, plan layout, backing allocation, bindings, command ring and hotswap,
  have focused tests.
- Property-based tests exist for spec, layout and hotswap invariants.

### TEST-2: Cross environment tests

- The test matrix includes:

  - Node, including worker threads
  - browser-equivalent tests, for example Happy DOM with workers or Playwright
  - runs with and without `SharedArrayBuffer`, `Atomics` and `WebAssembly` when that is possible

### TEST-3: CI pipeline is canonical

- A single command, for example `pnpm ci`, runs:

  - lint and formatting checks
  - type checking with `tsc -b` across the monorepo
  - unit and integration tests
  - benchmarks or at least a smoke run, optionally gated
  - docs build with VitePress (or equivalent)

---

## DOD-XLANG and HOST: Cross language and integration

### XLANG-1: Interoperability story is real

- A small Rust or C++ prototype exists that:

  - consumes the error schema from `@seqlok/introspect`
  - implements the memory layout spec
  - successfully exchanges params and meters with a JavaScript host that uses a Seqlok-style shared memory layout

### XLANG-2: Integration patterns are documented

- `@seqlok/integration` provides patterns or utilities for:

  - worker wiring, including controller, processor (and optional observer) topology
  - transport of handoffs and command rings
  - host lifecycle, including start, stop and teardown, with clear error surfaces

- Docs include at least one end-to-end host wiring chapter.

---

## DOD-GOV: Versioning and evolution

### GOV-1: Semantic versioning and deprecation policy

- Seqlok follows semantic versioning per package.
- Deprecation rules are documented, including how long symbols live and how error codes are retired.

### GOV-2: Changelog discipline

- Each package has a maintained `CHANGELOG.md` with:

  - sections for breaking changes, features, fixes and internal changes
  - callouts for any changes that affect error codes, layouts or public APIs

---

Treat this as the gravity well. Most changes should move the project toward this shape, not away from it. When most
items on this list are obviously true and new features fit without reopening debates about names, semantics or layering,
Seqlok has become a stable platform instead of a moving target.
