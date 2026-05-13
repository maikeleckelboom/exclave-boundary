# Seqlok Docs

This folder is the documentation entry point for the Seqlok repo.

It serves two main audiences:

- people **building with** Seqlok
- people **working on** the Seqlok monorepo itself

Seqlok is a **schema-first coordination kernel** for coherent state exchange across execution boundaries.

It owns shared-state coordination, command transport, and explicit live-swap protocol layers.
It does **not** encode product semantics such as decks, BPM, tracks, cues, or host workflow policy.

---

## Start Here

### Understand what Seqlok is

- **[Seqlok Primer](./seqlok-primer.md)**  
  High-level explanation of what Seqlok owns, the boundary it defines, the package stack, and the canonical flows.

- **[Seqlok Minimal Setup Sketch](./seqlok-minimal-setup-sketch.md)**  
  One small current concrete path through the model.  
  Read this after the primer when you want the boundary shape to become operational.

### Work on the repo

- **[Developer CLI](./developer-cli.md)**  
  Monorepo workflows, verification commands, tests, benches, and maintenance commands.

### Cross-package contract references

- **[Error Domains](./error-domains.md)**  
  Numeric error-domain allocation and package ownership of error prefixes.

---

## Repo Navigation

When you need exact implementation or package surface detail, use the repo itself.

### Root

- **[Repo README](../README.md)**  
  Root project entry point and top-level package overview.

- **[Packages Overview](../packages/README.md)**  
  Reusable package map for the monorepo.

### Core architecture docs

The long-lived architecture, ADRs, guides, and internals now live under `packages/core/docs/`.

- **[Core Docs Index](../packages/core/docs/INDEX.md)**
- **[Architecture Index](../packages/core/docs/architecture/INDEX.md)**
- **[ADR Index](../packages/core/docs/adr/INDEX.md)**
- **[Guides Index](../packages/core/docs/guides/INDEX.md)**
- **[Internals Index](../packages/core/docs/internals/INDEX.md)**
- **[Performance Index](../packages/core/docs/performance/INDEX.md)**

### Package entry points

Each package owns its own local contract surface through its README and public exports.

- **[base](../packages/base/README.md)**
- **[primitives](../packages/primitives/README.md)**
- **[core](../packages/core/README.md)**
- **[commands](../packages/commands/README.md)**
- **[hotswap](../packages/hotswap/README.md)**
- **[introspect](../packages/introspect/README.md)**
- **[streambuf](../packages/streambuf/README.md)**
- **[worklet-mount](../packages/worklet-mount/README.md)**

For exact exported APIs, use each package `src/index.ts`.

---

## Current Package Families

The reusable library substrate currently centers around these package families:

- **`base`**  
  Shared error algebra, invariants, numeric domain support, panic/invariant infrastructure.

- **`primitives`**  
  Low-level seqlock, SWSR ring, atomics, and plane-oriented shared-memory primitives.

- **`core`**  
  Spec → layout → backing → handoff → bindings.

- **`commands`**  
  Typed command transport over ring-backed mailbox infrastructure.

- **`hotswap`**  
  Explicit live engine replacement protocol and scheduling helpers.

- **`introspect`**  
  Error registry export, counters, budgets, sessions, and runtime observability surfaces.

- **`diagnostics`**  
  Additional diagnostic data structures and runtime-oriented observation helpers.

- **`streambuf`**  
  Bulk stream transport primitives.

- **`worklet-mount`**  
  Worklet mounting and host/worklet wiring utilities.

## Apps

- **[`playground`](../apps/playground/)**  
  Interactive experimentation and visualization surface.

---

## Formal Verification and Runtime Evidence

Formal and verification-adjacent material lives with the working repo structure.

Relevant locations include:

- **[`../scripts/tla/`](../scripts/tla/)**
- **[`../tools/tla/`](../tools/tla/)**
- package tests
- package benches

Use those when you are validating protocol behavior, performance boundaries, or hot-path invariants.

---

## How to Read the Repo

Use this order unless you have a very specific task:

1. **[Seqlok Primer](./seqlok-primer.md)**
2. **[Seqlok Minimal Setup Sketch](./seqlok-minimal-setup-sketch.md)**
3. **[Repo README](../README.md)**
4. **[Packages Overview](../packages/README.md)**
5. the package `README.md` you are actually changing
6. the package `src/index.ts` for exact exports

That path keeps conceptual understanding ahead of surface detail.

---

## What This Index Does Not Do

This index does **not** try to mirror older doc structures that no longer exist as the main navigation surface.

It does not assume root-level docs such as:

- `architecture/`
- `adr/`
- `admin/`
- `concept/`

as if they still live directly under `docs/`.

Those long-lived conceptual docs now live under **`packages/core/docs/`**.

This file is only an entry point into the repo as it exists now.

---

## Maintenance Rule

When the repo shape changes, update this file by checking the actual tree first.

This index should describe the repo that exists, not the repo we remember.
