# ADRs – Architecture Decision Records

This folder contains **live, current Architecture Decision Records (ADRs)** for Seqlok.

An ADR is a small, permanent note that captures a **specific architectural decision**:

> What did we decide, why, and what does it imply for the future?

Think of ADRs as "git commits for architecture": short, focused, and historical.

---

## What belongs here

**Only live, accepted ADRs that match current code and package ownership.**

- Architecturally significant decisions affecting core concepts.
- Cross-cutting or long-lived decisions.
- Current truth (not proposals, not historical drafts).

**This folder is narrowed to:**

- `ADR-00C` – Meter writes and snapshot `into`
- `ADR-00F` – Controller params hydrate
- `ADR-010` – Ring primitive ownership
- `ADR-011` – MWMR ground truth
- `ADR-014` – Nested spec DSL and key mirror contract

---

## What does **not** belong here

## Live ADRs

| ADR                                                         | Title                          | Scope                                                                     |
|-------------------------------------------------------------|--------------------------------|---------------------------------------------------------------------------|
| [ADR-00C](./ADR-00C-meter-writes-and-snapshot-into.md)      | Meter Writes & Snapshot `into` | Processor meter API, controller snapshot options                          |
| [ADR-00F](./ADR-00F-controller-params-hydrate.md)           | Controller Params Hydrate      | Cold-path bulk param updates                                              |
| [ADR-010](./ADR-010-ring-primitive-in-seqlok-core.md)       | Ring Primitive Ownership       | Package ownership: primitives → commands/streambuf → core                 |
| [ADR-011](./ADR-011-mwmr-ground-truth.md)                   | MWMR Ground Truth              | System model and guardrails                                               |
| [ADR-014](./ADR-014-lock-nested-spec-dsl-and-key-mirror.md) | Nested Spec DSL and Key Mirror | Authored spec contract, canonical key formation, ergonomic key projection |

**Do not add to this folder:**

- Draft or proposed decisions (use a PR discussion first).
- Design docs (go to `../patterns/`).
- Non-existent package references.
- Speculative APIs presented as current truth.

Rough rule of thumb:

> If it's **how it works today** → live ADR (this folder).
> If it's **what we decided in the past** → attic (historical, not normative).
> If it's **what we might build** → patterns (exploratory, may age out).
> If it's **system documentation** → architecture docs.

---

## Suggested ADR structure

```md
# Title in Sentence Case

**Status:** Accepted (live ADRs are always Accepted)
**Date:** YYYY-MM-DD
**Revised:** YYYY-MM-DD (if updated)

## 1. Context

What problem led to this decision? What parts of the system are affected?

## 2. Decision

What did we decide? Be explicit and prescriptive. Spell out roles (controller/processor/observer).

## 3. Consequences

- Positive: why this is good.
- Negative / trade-offs.
- Migration notes.

## 4. Package ownership (required)

Which packages own which parts of this decision? Must match `packages/README.md`.

---

## Status and lifecycle

**Live ADRs in this folder are always `Accepted`.**

If a decision changes:

1. Update the ADR in place (add revision date, document the evolution).
2. OR move it to `../attic/adr/` if superseded, and write a new live ADR.

Historical ADRs are preserved in the attic, not here.

---

## When to write a new ADR

- Affects multiple packages?
- Would reversing it be non-trivial?
- Do alternatives keep coming up in discussion?
- Would future contributors be confused without the "why"?

If yes to any: write a draft, get consensus, then add here.

**Before adding:** Check that package ownership claims match `packages/README.md` and live package docs.

---

## Referencing ADRs

In code and docs:

```ts
// See ADR-00C for meter write hot-path contract.
```

> Coherent meter reads use `snapshot(..., { into })` per ADR-00C.

Live ADRs are the source of truth for current behavior.

---

## Live ADRs

| ADR                                                    | Title                          | Scope                                                     |
|--------------------------------------------------------|--------------------------------|-----------------------------------------------------------|
| [ADR-00C](./ADR-00C-meter-writes-and-snapshot-into.md) | Meter Writes & Snapshot `into` | Processor meter API, controller snapshot options          |
| [ADR-00F](./ADR-00F-controller-params-hydrate.md)      | Controller Params Hydrate      | Cold-path bulk param updates                              |
| [ADR-010](./ADR-010-ring-primitive-in-seqlok-core.md)  | Ring Primitive Ownership       | Package ownership: primitives → commands/streambuf → core |
| [ADR-011](./ADR-011-mwmr-ground-truth.md)              | MWMR Ground Truth              | System model and guardrails                               |

---

## Historical Archive

Stale, superseded, or proposal-grade ADRs are preserved in [`../attic/adr/`](../attic/adr/INDEX.md).

**Attic docs are historical, not normative.** They are kept for context and traceability but do not describe current
system behavior or package ownership. See the attic index for the complete list of archived documents.

---

## Patterns

Implementation patterns and design notes live in [`../patterns/`](../patterns/INDEX.md).

**Patterns are not ADRs.** They are exploratory documents that may age out or be replaced over time. See the patterns
index for current design notes.

---

## Maintenance Rule

**Keep the ADR folder honest.**

- Verify against `packages/README.md` and package-level docs before committing.
- No non-existent package references.
- No invented APIs presented as current truth.
- When in doubt, draft in a PR; merge to live ADRs only when Accepted and current.
