# ADR-00E: Electron & Multi-Process Runtimes

**Status**: Informational / Future-Oriented
**Date**: 2025-11-16
**Owner**: _TBD_
**Related**:

- ADR-001 – Seqlok Core Golden Flow
- ADR-002 – Memory Growth & Swap via Handoff Sequences
- ADR-XXXX – MWMR via Domains + Observers + Command Ring
- ADR-00X – `@seqlok/compose` for System-Level Composition

---

## 1. Context

Seqlok is designed for **single-address-space** environments with:

- `SharedArrayBuffer` + `Atomics`, and
- concurrency via workers / AudioWorklets / threads.

Electron introduces a **multi-process** architecture:

- **Renderer processes** (Chromium):

  - DOM, Web Workers, AudioWorklets, `SharedArrayBuffer`, `Atomics`.

- **Main process** (Node.js):

  - File system, native modules, `worker_threads`, `SharedArrayBuffer`, `Atomics`.

- Optional Node workers spawned from main, and Web Workers / AudioWorklets spawned from renderer.

A natural question: _“Does Electron make Seqlok obsolete or redundant?”_
This ADR codifies the answer and sets boundaries for future Electron integration.

---

## 2. Problem Statement

We need to clarify:

1. **Where Seqlok is meant to run** in an Electron app (renderer vs main vs workers).
2. How Seqlok interacts with **multi-process IPC** (renderer ↔ main).
3. Whether Electron-specific constraints should change:

- Seqlok's core model (SWMR per domain),
- the `@seqlok/compose` architecture,
- or future `@seqlok/command-ring` semantics.

We explicitly want to avoid:

- over-extending Seqlok into "cross-process magic",
- coupling core APIs to Electron-specific concepts.

---

## 3. Decision

### 3.1 Seqlok remains a **per-process** primitive

Seqlok's core and composition model are **per-address-space**:

- A **Seqlok domain** lives inside a single process where:

  - a backing is a SAB (or shared Wasm memory),
  - `Atomics` operate on that backing,
  - readers/writers share the same address space.

In Electron:

- **Renderer process**:

  - Seqlok is used exactly like in a browser:

    - main thread ↔ Web Workers ↔ AudioWorklets.

- **Main process** (Node):

  - Seqlok can be used with `worker_threads` the same way:

    - main ↔ worker threads for CPU work, analyzers, etc.

We intentionally scope Seqlok to this **per-process** model because `SharedArrayBuffer` and `WebAssembly.Memory` are bound to a single process in standard Electron; cross-process shared memory requires platform-specific native modules and introduces very different performance, failure, and security trade-offs, which are outside the scope of `@seqlok/core`.

**Decision:** Seqlok is **not** extended to “magically” span the main/renderer process boundary. It stays per-process.

### 3.2 Cross-process boundaries use IPC, not Seqlok

Communication between:

- **renderer ↔ main** (and between different OS processes) uses:

  - Electron IPC (`ipcRenderer` / `ipcMain`),
  - or other Node mechanisms (pipes, sockets, etc.),
  - potentially with binary payloads and shared file handles,

but **not** direct SAB sharing managed by Seqlok.

We may adopt Seqlok's _schema ideas_ (e.g. using spec-like descriptions to pack/unpack messages) in future packages, but:

- `@seqlok/core` and `@seqlok/compose` will treat IPC as an **external transport**, out of scope for the core model.

### 3.3 Compositions are per-process

`@seqlok/compose` compositions are **per-process** system graphs:

- A **renderer composition** might include:

  - domains: `deck`, `mixer`, `reservoir`, `waveform`, `analyzer`, `registry`, …
  - runtimes: `mainThread`, `audioWorklet`, `analyzerWorker`, `hudWorker`, …
  - rings: `system`, `analyzer`, …

- A **main-process composition** might include:

  - domains: `library`, `offlineAnalyzer`, `registry`, …
  - runtimes: `mainThread`, `indexerWorker`, `importWorker`, …
  - rings: `libraryCommands`, `offlineJobs`, …

**Decision:** each composition is defined and realized inside a **single process**.
Multi-process designs use **multiple compositions**, one per process.

### 3.4 Future Electron support is via `PlatformAdapter`

Electron-specific integration is handled via the **PlatformAdapter** abstraction from ADR-00X:

- The renderer can use a browser-flavoured adapter:

  - `createBrowserPlatformAdapter({ spawnWorker, spawnAudioWorklet })`

- The main process can use a Node-flavoured adapter:

  - `createNodePlatformAdapter({ spawnWorkerThread })`

A future **Electron helper** may be provided:

```ts
// hypothetical helper
const rendererPlatform = createBrowserPlatformAdapterForElectron(/*...*/);
const mainPlatform = createNodePlatformAdapterForElectron(/*...*/);
```

but:

- this remains a **convenience layer**,
- does not change `@seqlok/core` or `@seqlok/compose` semantics.

---

## 4. Implications

### 4.1 For Dekzer

A future Dekzer Electron app might look like:

- **Renderer composition**:

  - Time-critical stuff:

    - UI, HUD, waveform drawing.
    - AudioWorklet DSP for decks/mixer.
    - Analyzer workers.

  - Seqlok domains for `deck`, `mixer`, `reservoir`, `waveform`, `analyzer`, `registry`, …
  - Command rings for real-time intents (play/pause/swap, prefetch, analysis jobs).

- **Main composition**:

  - Non-real-time / heavy work:

    - Library scanning, track import, offline analysis, file system operations.

  - Seqlok domains for `library`, `offlineAnalyzer`, `registry`, …
  - Command rings for job queues and status.

These two compositions talk via **Electron IPC** with whatever protocol Dekzer chooses (JSON, binary chunks, paths, etc.). Seqlok is not responsible for hiding that boundary.

### 4.2 For Agents / AI runtimes

If a future agent runtime runs in Electron, the same pattern holds:

- Seqlok-based compositions inside each process (agent swarms, world state, analyzers).
- IPC for coordination between UI and backend processes.

### 4.3 What we explicitly do _not_ do

- No attempt to make Seqlok "cross-process transparent".
- No direct `SharedArrayBuffer` sharing across main/renderer via Seqlok (if ever done, it would be a **separate**, dangerous, highly constrained thing with its own ADR).
- No Electron-specific branching in core APIs.

---

## 5. Non-Goals

- **Not** defining Electron as a first-class runtime in `@seqlok/core`.
  Core remains browser/Node general with no Electron imports.

- **Not** baking IPC protocols into Seqlok or compose.
  IPC remains an outer-system concern (Dekzer runtime, app code, or a separate helper package).

- **Not** promising `@seqlok/ipc` or Electron helpers as part of the v1 scope.
  They are future candidates, not required deliverables.

- **Enables hybrid architectures (positive consequence):** This strict separation lets applications use Seqlok for performance-critical, real-time, intra-process loops while freely using simple JSON- or binary-based IPC for non-critical, cross-process communication—choosing the right tool for each layer without overloading Seqlok’s responsibilities.

---

## 6. Summary

Electron **does not** obsolete Seqlok. It:

- adds more environments where Seqlok's per-process SWMR semantics are valuable (renderer and main),
- introduces cross-process boundaries that are intentionally handled by IPC, **outside** Seqlok's responsibility.

We standardize on:

- Seqlok as the **per-process** shared-memory wire (`@seqlok/core` + `@seqlok/compose`),
- command rings as the **per-process** intent bus,
- Electron IPC as the cross-process bridge, with optional Seqlok-inspired structuring in higher-level packages.

This keeps Seqlok's core model clean and reusable while acknowledging Electron as a practical, but external, concern.
