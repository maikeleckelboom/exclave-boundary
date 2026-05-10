# ADR-00E: Electron & Multi-Process Runtimes

**Status**: Informational / Future-Oriented
**Date**: 2025-11-16
**Owner**: _TBD_

**Related**:

- ADR-001 – Seqlok Core Canonical Flow
- ADR-002 – Memory Growth & Swap via Handoff Sequences
- ADR-00Y – MWMR System Architecture via Domains + Observers + Rings
- ADR-00X – `@seqlok/compose` for System-Level Composition

---

## 1. Context

Seqlok is designed for **single-address-space** environments with:

- `SharedArrayBuffer` + `Atomics`
- concurrency via Web Workers / AudioWorklets / threads

Electron introduces a **multi-process** architecture:

- **Renderer processes** (Chromium):
  - DOM, Web Workers, AudioWorklets
  - `SharedArrayBuffer`, `Atomics`
- **Main process** (Node.js):
  - file system, native modules
  - `worker_threads`, `SharedArrayBuffer`, `Atomics`
- Optional pools:
  - Node workers spawned from main
  - Web Workers / AudioWorklets spawned from renderer

Recurring questions:

> "Does Electron make Seqlok obsolete or redundant?"
>
> "Should Seqlok become an Electron IPC abstraction?"

This ADR draws the line: **Seqlok remains an in-process shared-memory engine**, not an IPC framework.

---

## 2. Problem Statement

We need to clarify:

1. **Where** Seqlok is meant to run in an Electron app:

- renderer vs main vs worker

2. How Seqlok interacts with **multi-process IPC**:

- renderer ↔ main

3. Whether Electron-specific constraints should change:

- Seqlok's **core SWMR model**
- the **MWMR system model** (ADR-00Y)
- `@seqlok/compose` topology semantics (ADR-00X)

We explicitly want to avoid:

- over-extending Seqlok into "cross-process magic"
- coupling core APIs to Electron-specific concepts

---

## 3. Decision

### 3.1 Seqlok remains **per-process**

Seqlok canonical flow is per address space:

```txt
defineSpec
→ planLayout
→ allocateShared / allocateWasmShared
→ buildHandoff
→ acceptHandoff
→ bind{Controller,Processor,Observer}
```

A **Seqlok domain** assumes:

- a backing (SAB or shared Wasm memory) that is **local to the process**
- `Atomics` operating directly on that backing
- all bindings (controller, processor, observers) sharing that address space

In Electron:

- **Renderer process**

  Seqlok is used like in a normal browser:

  - main thread
  - Web Workers
  - AudioWorklets

- **Main process** (Node)

  Seqlok can also be used with `worker_threads`:

  - main Node thread
  - worker threads

Each process hosts **its own** Seqlok systems. There is no attempt to share Seqlok backings across the renderer/main
boundary.

> **Decision:** Seqlok **does not** grow cross-process primitives.
> It stays **per-process SWMR/MWMR**.

---

### 3.2 Cross-process boundaries use IPC, not Seqlok

Communication between processes:

- renderer ↔ main
- main ↔ other OS processes

is done via:

- Electron IPC (`ipcRenderer` / `ipcMain`)
- Node IPC / sockets / pipes / OS-specific mechanisms
- optional binary payloads, shared file handles, etc.

but **not** via Seqlok-managed shared memory.

Seqlok sees **one process at a time**. Anything cross-process is outside `@seqlok/core` and `@seqlok/compose`.

---

### 3.3 MWMR & rings are still **per-process**

ADR-00Y describes MWMR as:

- multiple SWMR domains (deck, reservoir, analyzer, mixer, registry, …)
- **ring primitives** (ADR-010) used as intent buses
- `bindObserver` for many-reader fan-out
- growth & swapping via `SwapTicket`-driven handoff sequences

In Electron this is **scoped to one process**:

- A renderer may host:

  - deck domains
  - analyzers
  - WebGPU visualizers
  - HUD observers
  - **rings** for UI/MIDI/network intents

- The main process may host:

  - library scan / indexing domains
  - non-realtime analyzers
  - IPC bridges

There can be multiple Seqlok **systems** (one per process), each with its own MWMR topology, but **no shared SAB/Wasm
memory across processes**.

---

## 4. Recommended Topologies in Electron

### 4.1 Realtime-first: Seqlok in renderer

- Renderer:

  - deck, reservoir, analyzer domains
  - AudioWorklet processor bindings
  - UI & WebGPU observers
  - rings for:

    - UI gestures
    - MIDI
    - automation

- Main:

  - library, playlist & database
  - file/metadata scanning
  - offline analysis

Renderer ↔ main use IPC for:

- library updates
- "load track X" commands
- telemetry / logging

**Seqlok stays completely inside renderer.**

---

### 4.2 Split responsibilities: Seqlok in renderer and main

- Renderer:

  - "hot path" Seqlok systems (deck, waveform, HUD)

- Main:

  - Seqlok systems for:

    - batch analyzers
    - long-running indexing
    - agent & recommendation services

IPC is used to:

- send high-level intents and results between systems
- not to "project" one Seqlok domain into another process

Each process remains responsible for its own:

- spec → plan → backing → handoff → bindings pipeline
- MWMR wiring (rings + observers)

---

## 5. Non-goals

Seqlok does **not** attempt to:

- implement a generic Electron IPC abstraction
- share `SharedArrayBuffer` across renderer/main
- manage OS-level process lifecycles
- hide Electron's process model behind a Seqlok API

Electron-specific features (e.g., window management, menus, OS integration) are handled at the app layer, not in
`@seqlok/core` or `@seqlok/compose`.

---

## 6. Consequences

- `@seqlok/core` and `@seqlok/compose` remain **platform-neutral**:

  - no special Electron types or concepts
  - still usable in plain browser / Node / workers

- The **MWMR story (ADR-00Y)** and **ring primitive (ADR-010)** apply per process, unchanged.

- Electron apps that use Seqlok:

  - treat each process as an independent "Seqlok island"
  - use IPC between islands
  - can evolve their IPC protocols without touching Seqlok's core APIs

---

## 7. Future Work

- Provide **examples** in `docs/architecture`:

  - "Dekzer in Electron":

    - renderer: decks + visualizers
    - main: library + agents

  - contrasting "all-in-renderer" vs "split" architectures.

- Optional helper in a **separate** package (not `@seqlok/core`) to:

  - serialize ring payloads / hydrate patches across IPC
  - document recommended message formats
  - but **not** to hide Electron APIs themselves.
