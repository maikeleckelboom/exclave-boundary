# R&D Log 2025 Seqlok

## 2025-11-25 (5h)

[hotswap, concurrency] 3h  
Refined the seqlock-backed SwapTicket state machine and tightened
the conformance tests around version wraparound and ABA-style races.

[arch, monorepo, tooling] 2h  
Scaffolded the layered workspace (base/primitives/introspect/core/commands/hotswap/
integration/playground). Wired per-package tsconfig, ESLint, and Vitest so each
layer can lint and test in isolation.

## 2025-11-26 (5h)

[errors, design] 2.5h  
First serious attempt at splitting the error system out of core. Explored
domain IDs, ownership per package, and how a global registry could aggregate
without centralizing everything again.

[tooling, types] 1.5h  
Experimented with workspace tsconfig setup, project references, and type-only
test commands. Learned what breaks when core pulls in base-style helpers.

[diagnostics, introspect] 1h  
Started shaping the idea of an observability sidecar (future introspect package)
and how it could consume errors and counters without polluting core.

## 2025-11-27 (6.5h)

[errors, registry] 3h  
Pushed on distributed error domains: split out internal/spec/plan/backing/binding/
handoff env-style domains conceptually and designed how a numeric registry could
be aggregated from multiple packages.

[introspect, architecture] 2h  
Clarified the role of an introspect layer vs core: counters, sessions, health
views, registry export. Sketched how ALL_DOMAINS and error schema export might
work as a separate package.

[tests, stability] 1.5h  
Kept core tests green while changing the error shapes. Ran through binding/
backing/spec tests to make sure behavior was still unchanged despite refactors.

## 2025-11-28 (6.5h)

[monorepo, extraction] 3h  
Started the actual extraction of base/primitives/introspect from core. Moved
type helpers and low-level primitives into their new homes and adjusted imports
to respect the layering.

[errors, health] 2h  
Iterated on error domain definitions and health interpretation. Designed how
health should sit on top of ErrorMeta without coupling to any specific package
or registry layout.

[docs, planning] 1.5h  
Updated architecture notes and planning docs around error domains, introspect,
and package layering. Aligned the v1.0 story with the new monorepo shape.

## 2025-11-29 (7.5h)

[errors, base, primitives, introspect] 3.5h  
Completed the split of the error system into @seqlok/base, @seqlok/primitives,
and @seqlok/introspect. Wired core to consume the new domains, fixed imports,
and kept tests and type checks passing.

[health, diagnostics] 2h  
Moved health helpers into base as a portable lens over ErrorMeta. Finished
ALL_DOMAINS aggregation, numeric code mapping, registry export helpers, and
runWithIntrospect wiring on top of the new layout.

[tooling, perf, docs] 2h  
Hooked up strip-extra-dts and shared Vitest config across packages, re-ran
benches and refreshed generated bench docs. Updated Status Matrix, Package
Readiness, Gravity Well, and this R&D log to reflect the new reality.
