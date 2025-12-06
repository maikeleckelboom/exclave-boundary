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

## 2025-11-30 (7h)

[errors, numeric codes] 3h  
Locked down the numeric error-code scheme (8-bit domain ID + 24-bit local
ordinal) and the DOMAIN_IDS map. Split domain ownership cleanly across
packages (env, backing, primitives, binding, handoff, introspect, commands,
hotswap) and wired domain builders in @seqlok/base so each package owns
its registry locally.

[introspect, registry aggregation] 2.5h  
Built the cross-package registry aggregation in @seqlok/introspect:
ALL_DOMAINS, the registry map, and JSON export helpers. Sketched subset
selection (domains, codes, severities) and the first version of the
error-registry export format for external tooling.

[docs, governance] 1.5h  
Drafted architecture docs for the new error system and its governance rules:
how domains map to packages, why numeric codes are append-only, and how
external consumers should treat the registry and schema over time.

## 2025-12-01 (7h)

[tooling, dev workflow] 3h  
Simplified the root CLI scripts: added `pnpm verify` (clean + build + check),
centralized `check` (typecheck + tests + lint), and made sure each workspace
package exposes a consistent script surface (build, clean, test, test:types,
lint, bench where relevant).

[build, tsconfig, Vite] 2h  
Fixed Vite builds that were failing to resolve `@seqlok/base` by introducing
`scripts/vite/vite.base.config.ts` with workspace aliases and externals.
Updated @seqlok/core and @seqlok/hotswap to use the shared helper. Tidied
tsconfig layering with `tsconfig.workspace.json`, per-package `tsconfig.json`
(excluding docs/bench/dist), and `tsconfig.eslint.json` for ESLint.

[docs, onboarding] 2h  
Wrote `docs/DEVELOPER-CLI.md` to document dev/dev:ui/verify/check flows,
package-local workflows, and common troubleshooting steps. Linked it from
the root README and package docs. Trimmed older Gravity Well quickstart and
draft docs that no longer match the current workspace and error layout.

## 2025-12-02 (5h)

[introspect, registry & tests] 2h  
Finalized the error registry tooling in @seqlok/introspect: added
`descriptors.ts` and `export-errors.ts`, tightened the JSON schema for the
registry (locked `schemaVersion` and `generator` via singleton enums and
enforced strict shapes for `domainIds` and stats), and introduced
`domains.aggregation.test.ts` and `error-index-invariants.test.ts` to guard
prefix uniqueness, domainId mapping, and numeric-code invariants. Removed the
obsolete manifest snapshot test and its generator script.

[tooling, pipeline hygiene] 1.5h  
Ran the full `pnpm verify` pipeline (clean + build + check) repeatedly and
fixed edge cases around Vite/Rollup configs, strip-extra-dts behavior, and
ESLint coverage so docs and tests are linted via consistent
`tsconfig.eslint.json` setups in each package.

[branches, planning] 1.5h  
Merged `feat/error-system-split` into `feat/v0.3.0-hotswap`, then merged
hotswap forward into `dev` so the new error system becomes the baseline.
Updated the top-level README and architecture wording to emphasize Seqlok as
a generic real-time substrate rather than a single-client solution, and lined
up the next commands/hotswap work on top of the cleaned-up dev branch.

## 2025-12-03 (7h)

[playground, hotswap UI] 3.5h  
Refined the Hotswap Lab Vue playground into a proper three-panel layout
(Config panel, Progress viewport, Inspector). Extracted `HotswapViewport`,
`HotswapConfigPanel`, and `HotswapInspector` components and wired them against
the composable. Added zoom + follow controls, improved phase band rendering,
added an overview minimap with loop/step transport controls, and polished the
A/B engine markers so the swap feels like a proper deck timeline.

[perf, scroll/animation] 2h  
Profiled the viewport with Chrome DevTools and hunted down layout thrash and
forced reflows. Introduced cached geometry for the scroll container, rAF-throttled
scroll handlers, and pointer-based scrubbing that auto-scrolls near edges.
Switched playback from frame-based stepping to a time-based rAF loop, so
GC / UI stalls no longer cause visible pauses in the swap animation.

[ghost DJ, data model & AI arch] 1.5h  
Drafted `ghost-dj-data-model.md` to formalize the session logging and state
representation for Ghost DJ: track features, timeline event schema, and the
state/action view over a session. Explored how large-context cloud models
(Gemini-style) fit into the architecture as an offline/nearline policy planner,
with Seqlok providing the hard real-time execution layer via scheduled
commands.

## 2025-12-04 (4h)

[docs, alignment] 1.5h  
Re-aligned the core documentation with the current Seqlok codebase. Rewrote the
Seqlok Primer to match the layered package layout and the final canonical flow,
removed or collapsed outdated planning/DoD/critical-path matrices, and trimmed
the Gravity Well docs down to a small set of evergreen files. Cleaned up references
so nothing points at the old monolithic core or obsolete error/interop plans.

[playground, commands lab] 1.5h  
Extended `@seqlok/playground` with Vue Router and a tabbed layout in `App.vue`,
splitting the Hotswap Lab and the new Command Ring Lab into separate routes.
Scaffolded the commands playground: `CommandRingLab`, `CommandRingConfig`,
`CommandRingVisualizer`, `CommandRingMetrics`, `CommandRingEventLog`, and the
`useCommandRingLab` composable. Wired the new components into the router and
ensured the playground builds cleanly with the expanded commands/hotswap UI.

## 2025-12-06 (6h)

[hotswap, multi-swap] 3h  
Finished Level 2.5 multi-swap behavior for lanes. Locked in **Reject-While-Busy** as the policy at the host/integration
boundary: `scheduleSwap` now returns a `SwapResult` with `accepted` and `reason` (`"lane-busy"` vs `"invalid-ticket"`),
and uses an `isLaneBusy` callback so overlapping requests never enqueue a second ticket while a swap is in flight.
Extended the lane engine-bank harness and added an overlaps integration test (A→B plus mid-swap B→C) to prove C never
appears in decisions or audio and that the final idle plateau matches a pure A→B swap. Left the TLA+ extension and
lane-level observability (counters / introspect surface) as explicit follow-ups to 2.5.

[substrate, naming] 1.5h  
Evicted “deck” from the Seqlok substrate in favor of **lane**. Updated core specs, hotswap/integration harnesses, and
tests so public IDs and narratives are lane-centric while keeping DJ “deck” terminology scoped to Dekzer-level docs.
Cleaned up the duplicated mailbox/timeline drain code between the lane timeline and engine-bank harnesses by extracting
a shared helper, keeping the hot path identical while reducing test noise.

[docs, alignment] 1.5h  
Brought the hot-swap docs in line with the new behavior and naming. Updated `HOTSWAP_INTEGRATION.md` to describe the
lane-centric flow and engine-bank application, refreshed the `hotswap-multi-swap-requirements.md` spec to mark overlaps
(2.5-O1) as PASS under Reject-While-Busy, and wired in references to the new `lane.timeline` and `lane.engine-bank`
integration tests so Level 2.5 is backed by explicit, greppable scenarios rather than hand-wavy prose.
