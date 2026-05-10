# ADR-013: Clarify Plan/Backing/Handoff Naming

## Status

Proposed

## Context

The core pipeline is conceptually three-layered:

1. **Planning**: pure, deterministic, serializable computation of slots/offsets/plane sizes from a spec.
2. **Backing**: allocation of memory plus typed views over the plan's planes.
3. **Bindings**: ergonomic APIs (controller/processor/observer) layered on top of plan+backing.

Current function names blur these layers (e.g. `planLayout`, `allocateShared`). This increases cognitive load and can
mislead contributors into thinking that expanding the kind catalog or plane unions implies "all planes must be
implemented everywhere."

We want names that make the layer boundary obvious at the call site and scale naturally to multiple backing
implementations.

## Decision

Introduce clearer, layer-explicit public names. Renames will be implemented later via additive aliases, then
deprecations, then removal in a major version bump.

### Planning

* **Rename** `planLayout(spec)` → `buildPlan(spec)` (acceptable alternative: `compilePlan(spec)`)

**Rationale**

* The returned artifact is a `Plan`; "layout" (offset assignment) is an internal detail baked into the plan.
* `buildPlan` communicates "construct the plan" without implying a UI/layout concept.

### Backing

* **Rename** `allocateShared(plan)` → `allocateBacking(plan)`

**Rationale**

* Callers want "the backing memory and views"; the fact that it is SharedArrayBuffer-based is a backend choice.
* This name scales if multiple backends exist.

**Optional explicit variants (future)**

* `allocateSharedBacking(plan)`
* `allocateWasmBacking(plan)`
* `allocateLocalBacking(plan)`

### Handoff

* **Rename** `buildHandoff(plan, backing)` → `createHandoff(plan, backing)`
* **Rename** `acceptHandoff(handoff)` → `acceptHandoff(handoff)` (preferred) or `decodeHandoff(handoff)`

**Rationale**

* `createHandoff` communicates "construct a transfer object."
* `acceptHandoff` communicates validation/normalization into a safe accepted representation; avoids the IO connotation
  of "receive."

### Bindings

* Keep as-is:

  * `bindController(...)`
  * `bindProcessor(...)`
  * `bindObserver(...)` (and other binding entrypoints)

**Rationale**

* "bind" clearly communicates "attach an API surface over plan+backing."
* Names remain concise and consistent across binding types.

## Consequences

### Positive

* Call sites immediately communicate which layer is being invoked (plan vs backing vs binding).
* Reduces confusion around plane coverage expectations when adding kinds.
* Provides a scalable naming scheme for multiple backing implementations.

### Negative

* Requires a staged migration to avoid breaking downstream consumers.
* Temporary duplication (old names + new names) until deprecations are completed.

## Migration Plan

1. **Add new exported aliases** (no behavior changes):

* `buildPlan` as alias of `planLayout`
* `allocateBacking` as alias of `allocateShared`
* `createHandoff` as alias of `buildHandoff`
* `acceptHandoff` as alias of `acceptHandoff`

2. Mark old names as deprecated in docs/types (JSDoc `@deprecated`).
3. Update internal code and tests to use new names.
4. Remove deprecated names in the next major version.

## Notes for Tests (Readability)

Recommended naming for test-local type aliases once the rename lands:

```ts
type SpecT = ReturnType<typeof defineSpec>;
type PlanT = ReturnType<typeof buildPlan>;
type BackingT = ReturnType<typeof allocateBacking>;
type ControllerT = ReturnType<typeof bindController>;
type HandoffT = ReturnType<typeof createHandoff>;
type AcceptedHandoffT = ReturnType<typeof acceptHandoff>;
type ProcessorT = ReturnType<typeof bindProcessor>;
```
