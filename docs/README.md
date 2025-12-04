# Seqlok Docs

This folder holds internal docs for people **building with** Seqlok and
**working on** the Seqlok repo.

Seqlok itself is a **real-time shared-state substrate** – it knows about
params, meters, command rings and hotswap, but it does **not** encode
audio decks, BPM, tracks or cues. Those live in host code on top.

If you are here, you are typically in one of three modes:

- you want to understand what Seqlok is,
- you want to wire it into a host,
- or you are hacking on the monorepo itself.

Pick the entry that matches.

---

## 1. Orientation

**Conceptual overview**

- **[Seqlok Primer](./Seqlok-Primer.md)**  
  High-level explanation of what Seqlok solves, the package stack, and
  the canonical flows (params/meters, commands, hotswap).  
  _Best starting point for contributors and integrators._

**Developer workflow**

- **[Developer CLI](./DEVELOPER-CLI.md)**  
  How to run `pnpm dev`, `pnpm verify`, typecheck, tests and benches.
  Also documents the workspace layout and common troubleshooting.

---

## 2. Architecture & Contracts

The `architecture/` folder describes how the substrate is structured and
what “done” means at the system level.

- **[00 – Definition of Done](./architecture/00-definition-of-done.md)**  
  Target end-state for Seqlok as a stable, language-agnostic control
  fabric. Use this as the contract: new work should move the system
  toward this shape, not away from it.

- **[01 – Package graph & introspect sidecar](./architecture/01-packages-and-introspect.md)**  
  Canonical package DAG, import rules, and the role of
  `@seqlok/introspect` as a diagnostics sidecar that observes runtime
  packages but is never on the hot path.

- **[02 – Error system](./architecture/02-error-system.md)**  
  Anatomy of `SeqlokError`, numeric codes, domain IDs and registry
  aggregation. This is the contract that Rust/C++ or other hosts will
  see.

- **[03 – Error governance](./architecture/03-error-governance.md)**  
  Rules for evolving the error universe (append-only codes, domain
  allocation, deprecation policy, extension domains).

Use these when you are designing new primitives, changing package layout
or touching the error system.

---

## 4. Decisions & ADRs

The `adr/` folder records discrete design decisions with long half-life.

Examples:

- **[0001 – Error system v1.0 audit](./adr/0001-error-system-audit.md)**  
  Split of the error system out of `@seqlok/core` and the move to
  domain-scoped numeric codes.

- **[Error domain ID allocation](ERROR-DOMAINS.md)**  
  Authoritative table of domain IDs and owners. Source of truth for
  which package owns which `*.prefix` and numeric range.

When you make a non-trivial architectural change (new package, new
domain, new host wiring pattern), add a new ADR here using whatever
local template you prefer.

---

## 5. Admin & R&D Evidence

The `admin/` folder is project admin, not runtime API.

- **[Admin README](./admin/README.md)**  
  Explains the purpose of admin docs and conventions for R&D logs.

- **[R&D log](./admin/rd-log-2025.md)**  
  Day-by-day technical log (tags + hours) for WBSO-style evidence and
  future you.

Future additions such as `release-checklist.md` or `governance.md` also
belong here.

---

## 6. Product / Host Docs (Ghost DJ, etc.)

Seqlok is the substrate; Ghost DJ is one of the first serious clients.

Product / host docs live under `docs/concept/` (or similar) so the
substrate stays generic and portable. For example:

- **[Ghost DJ data model](./concept/ghost-dj-data-model.md)**  
  Session log model, track features, event schema and how a set becomes
  structured data that planners / AI policies can reason about.

These docs are allowed to assume “we are building Ghost DJ”; they should
not leak back into the Seqlok public API.
