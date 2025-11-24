# ADRs – Architecture Decision Records

This folder contains **Architecture Decision Records (ADRs)** and related design docs for Seqlok.

An ADR is a small, permanent note that captures a **specific architectural decision**:

> What did we decide, why, and what does it imply for the future?

Think of ADRs as “git commits for architecture”: short, focused, and historical.

---

## What belongs in `docs/adr`

ADRs live here when a decision is:

- **Architecturally significant**
  It affects core concepts (spec/plan/backing, bindings, seqlock, memory layout, modes, topology, etc.).

- **Cross-cutting or long-lived**
  It will matter across multiple modules, packages, or years.

- **Non-obvious**
  Reasonable people could pick a different approach unless we write this down.

- **Expensive to reverse**
  Changing it later would require migrations, refactors, or rethinking other docs.

If you're tired of answering "why is it like this?" for the same topic, it probably deserves an ADR.

---

## What does **not** belong in `docs/adr`

This folder is **not** for:

- **User-level documentation**
  Usage guides, examples, API overviews → `docs/architecture` or package-level `README`.

- **Exploratory design docs**
  Big proposals, sketches, experiments → `DESIGN-xxx-*.md` (see below).

- **Implementation notes / internals**
  Low-level details for maintainers, temporary quirks → `docs/internals`, `docs/appendix`, or inline comments.

- **Changelogs / release notes**
  Those belong in `CHANGELOG.md` or GitHub releases.

Rough rule of thumb:

> If it's **how it works** → architecture docs.
> If it's **what we might build** → design doc.
> If it's **what we decided and why** → ADR.

---

## ADR vs DESIGN vs ARCHITECTURE docs

We use three main doc types:

### 1. ADR – Architecture Decision Record (this folder)

- **Scope:** One concrete decision.
- **Shape:** Short, focused, 1–3 pages.
- **Lifetime:** Historical; never deleted, only superseded.
- **Audience:** Anyone asking "why did we choose this?".

File pattern:

```text
ADR-00X-short-title-kebab-case.md
```

### 2. DESIGN – Design docs (also in this folder)

- **Scope:** Proposal or design for a feature/area (e.g. WebGPU twin, telemetry bridge).
- **Shape:** Longer narrative, options, diagrams, open questions.
- **Lifetime:** May age out; can be superseded or archived.
- **Audience:** People implementing or reviewing that feature.

File pattern:

```text
DESIGN-00X-short-title-kebab-case.md
```

### 3. ARCHITECTURE – System docs (`../architecture`)

- **Scope:** Core concepts, mental models, and canonical descriptions of how Seqlok works.
- **Shape:** “Book chapters” (origin, goals, concurrency model, DSL rationale, etc.).
- **Lifetime:** Kept in sync with the actual system; updated over time.
- **Audience:** Anyone trying to understand Seqlok as a whole.

Use ADRs when the decision is made, DESIGN docs when you are still exploring options, and ARCHITECTURE docs when you
want to explain the system as it stands.

---

## Suggested ADR structure

Most ADRs should roughly follow this template:

```md
# Title in Sentence Case

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-00Y-...
**Date:** YYYY-MM-DD

## 1. Context

- What problem, tension, or confusion led to this decision?
- What parts of the system are affected?
- Any relevant background (prior behavior, constraints, requirements).

## 2. Decision

- What did we decide?
- Be explicit and prescriptive.
- If there are "roles" (controller / processor / observer), spell out what each is allowed or required to do.

## 3. Consequences

- Positive: why this is good (simpler, safer, faster, clearer).
- Negative / trade-offs: what we’re giving up (complexity here, cost there).
- Migration/impact notes (tests to update, APIs to avoid, patterns to follow).

## 4. Alternatives (optional)

- Briefly list serious alternatives and why we rejected them.
- Only needed if this is likely to be re-argued in the future.
```

If you're writing a mini-novel, it probably wants to be a DESIGN doc plus a smaller ADR that says "we chose option B
from DESIGN-00X".

---

## Status and lifecycle

Each ADR has a **Status**:

- `Proposed` – not yet fully agreed; open for discussion.
- `Accepted` – current truth; this is how we do things.
- `Deprecated` – still in code, but we intend to move away from it.
- `Superseded by ADR-00Y-...` – replaced by a newer decision.

When you change your mind:

1. Write a new ADR describing the new decision.
2. Update the old ADR's status to `Superseded by ADR-00Y-...`.
3. Cross-link them.

This way we never erase history; we just stack decisions over time.

---

## When to write a new ADR

Use this quick checklist:

- Does this decision affect multiple modules or packages?
- Would reversing it later be a non-trivial refactor or behavior change?
- Are there real alternative designs that keep coming back in discussions?
- Will future contributors be confused without the "why"?

If you hit **yes** on at least one of these, it's probably worth an ADR.

If you're only tweaking a local helper, fixing a bug, or cleaning up internals: no ADR needed.

---

## Referencing ADRs

In code, tests, and other docs, reference ADRs by ID when the decision matters, for example:

```ts
// See ADR-00Z-observer-binding-role for why controller snapshots are best-effort.
```

or in docs:

> Coherent meter reads are owned by the observer binding
> (see ADR-00Z-observer-binding-role and ADR-00C-meter-writes-and-snapshot-into).

This turns the ADR folder into a map of "why" instead of a graveyard of forgotten markdown.

---

## ADRs

- [ADR-00C-meter-writes-and-snapshot-into.md](./ADR-00C-meter-writes-and-snapshot-into.md)
- [ADR-00D-primitives-internal-and-pruned.md](./ADR-00D-primitives-internal-and-pruned.md)
- [ADR-00E-electron-multi-process-runtimes.md](./ADR-00E-electron-multi-process-runtimes.md)
- [ADR-00F-controller-params-hydrate.md](./ADR-00F-controller-params-hydrate.md)
- [ADR-00X-introduce-seqlok-compose-for-system-level-composition.md](./ADR-00X-introduce-seqlok-compose-for-system-level-composition.md)
- [ADR-00Y-mwmr-architecture.md](./ADR-00Y-mwmr-architecture.md)
- [ADR-00Z-observer-binding-role.md](./ADR-00Z-observer-binding-role.md)
- [ADR-012-bind-observer-telemetry-and-multi-reader-rationale.md](ADR-012-bind-observer-telemetry-and-multi-reader-rationale.md)

Each ADR file documents one decision, its context, the chosen option, and consequences.

---

## DESIGN docs (proposals & patterns)

Larger design documents and recurring patterns also live in this folder:

- [DESIGN-002-webgpu-digital-twin-pattern.md](./DESIGN-002-webgpu-digital-twin-pattern.md)
  WebGPU "digital twin" pattern: meters → observer → GPU buffer → WGSL.

- [DESIGN-003-telemetry-bridge-pattern.md](./DESIGN-003-telemetry-bridge-pattern.md)
  Mirroring Seqlok state into external telemetry or hardware without violating SWMR.

Use ADRs when the decision is made, and DESIGN docs when you are still exploring options.

---
