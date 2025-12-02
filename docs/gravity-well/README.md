# Seqlok v1.0 Gravity Well Documentation

This directory contains the “gravity well” documentation suite for Seqlok v1.0 – it exists to keep every decision
aligned
with shipping a stable, minimal, production-ready real-time control fabric.

---

## Purpose

These documents turn the Definition of Done into a concrete roadmap. They provide:

- Clarity – what is done, what is blocked, what is next
- Focus – one primary goal at a time
- Momentum – small chunks that actually ship
- Accountability – clear success criteria, not vibes

The gravity-well suite is about how work progresses, not about API usage. It complements (not replaces) the architecture
docs.

---

## Document Structure

### Master index

- **[00-GRAVITY-WELL.md](00-GRAVITY-WELL.md)** – Start here. High-level v1.0 intent, critical path, and decision
  framework.
  Treat this as the narrative overview, not the raw status grid.

### Completion tracking

- **[completion/STATUS-MATRIX.md](completion/STATUS-MATRIX.md)** – Detailed Definition-of-Done completion grid for all
  sections.  
  This is the single source of truth for “how far along is v1.0?”.
- **[planning/PACKAGE-READINESS.md](planning/PACKAGE-READINESS.md)** – Per-package readiness and checklists
  for each `@seqlok/*` package.

### Planning and execution

- **[planning/CRITICAL-PATH.md](planning/CRITICAL-PATH.md)** – The minimal sequence of phases from “monolith”
  to “v1.0-ready”, broken into phases with dependencies and example tasks.
- **[reference/WEEKLY-SPRINT.md](reference/WEEKLY-SPRINT.md)** – Template for planning 1–2 week work blocks with
  clear success criteria.

### Reference and templates

- **[reference/DECISION-TEMPLATE.md](reference/DECISION-TEMPLATE.md)** – Short template for architectural decisions
  that affect public API, error semantics, or concurrency.

---

## Quick Start

### First time here

1. Read **[00-GRAVITY-WELL.md](00-GRAVITY-WELL.md)** – get the big picture and phases.
2. Open **[completion/STATUS-MATRIX.md](completion/STATUS-MATRIX.md)** – see current reality.
3. Skim **[planning/PACKAGE-READINESS.md](planning/PACKAGE-READINESS.md)** – understand package boundaries.
4. Check **[planning/CRITICAL-PATH.md](planning/CRITICAL-PATH.md)** – find where you are in the sequence.
5. Use **[reference/WEEKLY-SPRINT.md](reference/WEEKLY-SPRINT.md)** to carve out the next small chunk.

### Starting a work session

1. Check **STATUS-MATRIX** for red / yellow cells you care about.
2. Look at the current sprint in **WEEKLY-SPRINT**.
3. Pick the smallest task that moves a Definition-of-Done cell toward “done”.
4. When you finish a chunk, update **STATUS-MATRIX** (and, if relevant, **PACKAGE-READINESS**).

### Making a non-trivial decision

1. If it touches public API, error semantics, or concurrency:

- Capture it with **DECISION-TEMPLATE**.
- Sanity-check it against the decision framework in **00-GRAVITY-WELL**.

2. If it changes priorities or phases:

- Update **STATUS-MATRIX** and, if needed, **CRITICAL-PATH**.

---

## Current Status (How to Read It)

This file does not hard-code percentages or per-section progress.

- The live state lives in **[completion/STATUS-MATRIX.md](completion/STATUS-MATRIX.md)**.
- Package-specific reality lives in **[planning/PACKAGE-READINESS.md](planning/PACKAGE-READINESS.md)**.

As of the latest updates:

- The layered monorepo exists (`base`, `primitives`, `introspect`, `core`, `commands`, `hotswap`, `integration`,
  `playground`).
- `@seqlok/core` is solid and split from primitives/introspect.
- `@seqlok/base`, `@seqlok/primitives`, and `@seqlok/introspect` exist and are wired into the build.
- The error system has been split into package-owned domains with numeric codes and central aggregation in
  `@seqlok/introspect`.
- `@seqlok/commands`, `@seqlok/hotswap`, and `@seqlok/integration` are still early: API shape plus some scaffolding, but
  not
  v1.0-ready.

For exact statuses (per Definition-of-Done section, per package), always consult `STATUS-MATRIX` and
`PACKAGE-READINESS`.

---

## Navigation Guide

### By “role” (even if it is all you)

**Solo developer (current reality)**

- Overview and intent: **00-GRAVITY-WELL**
- Hard status: **completion/STATUS-MATRIX**
- Package scope: **planning/PACKAGE-READINESS**
- Sprint focus: **reference/WEEKLY-SPRINT**
- Decisions: **reference/DECISION-TEMPLATE**

**Future technical lead / collaborator**

- Roadmap: **planning/CRITICAL-PATH**
- Package status: **planning/PACKAGE-READINESS**
- Global health: **completion/STATUS-MATRIX**

**External contributor (future)**

- Orientation: **00-GRAVITY-WELL**
- What matters now: **CRITICAL-PATH**
- Where help fits: **STATUS-MATRIX** and **PACKAGE-READINESS**

---

## Update Cadence

### Daily

- Update the current sprint in **WEEKLY-SPRINT**.
- If you finish or unblock something substantial, update **STATUS-MATRIX**.

### Weekly

- End of week: scan **STATUS-MATRIX**, mark progress, and note blockers.
- Start of week: use **CRITICAL-PATH** plus **STATUS-MATRIX** to define a new sprint in **WEEKLY-SPRINT**.

### Monthly

- Do a light Definition-of-Done audit using **STATUS-MATRIX**.
- Check whether **00-GRAVITY-WELL** and **CRITICAL-PATH** still match reality.
- Adjust phases or priorities if needed.

### On major changes

- Record an ADR with **DECISION-TEMPLATE** if public API, error semantics, or concurrency change.
- Update any affected parts of **00-GRAVITY-WELL**, **STATUS-MATRIX**, and **PACKAGE-READINESS**.

---

## Success Signals

You are using the gravity well correctly when:

- `STATUS-MATRIX` changes visibly over time (cells move from “not implemented” toward “complete”).
- Sprints in **WEEKLY-SPRINT** have clear, testable outcomes.
- Big shifts in direction show up as ADRs and CRITICAL-PATH edits, not just code.

You know it is drifting when:

- The same red or yellow cells stay unchanged over several weeks.
- You routinely do work that does not connect to any Definition-of-Done or critical-path item.
- Docs say one thing, and the code clearly says another.

---

## Related Documentation

- Definition of Done: `../architecture/00-definition-of-done.md`
- Architecture docs: `../architecture/`
- ADRs: `../adr/`
- Guides: `../guides/`
- Internals: `../internals/`

---

## Maintenance

- Keep this index high-level and relatively stable.
- Put detailed status and evidence in:
  - `completion/STATUS-MATRIX.md`
  - `planning/PACKAGE-READINESS.md`

If the gravity-well docs stop helping you ship v1.0, simplify them until they do.

**Created**: 2025-11-24  
**Last Major Update**: 2025-11-29
