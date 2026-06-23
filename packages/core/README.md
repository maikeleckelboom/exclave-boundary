# Seqlok Boundary Substrate R&D

Status: Engineering artifact. R&D prototype. Release held deliberately.

This package is the preserved first Seqlok boundary-substrate implementation. It is now named `@seqlok-internal/prototype-core` and is private. It is public in this repository as engineering evidence, not as the final public API.

This repository is not an npm release target. The future Seqlok name remains reserved for a cleaner boundary-substrate extraction.

The original package shape exposed the wrong public mental model around controller, processor, observer, params, and meters. Those terms still exist in the prototype where they describe the historical implementation, but they should not be read as the final public Seqlok API vocabulary.

---

## What This Prototype Explored

The prototype implements typed shared-memory contracts for timing-sensitive systems on the web and beyond. It covers:

- authored contract compilation into runtime specs
- deterministic layout planning
- shared backing allocation, including partitioned and WASM-compatible backing
- coherent reads over seqlock-protected planes
- role-specific controller, processor, and observer bindings
- explicit handoff artifacts for runtime or trust-boundary transfer
- browser environment probes for `SharedArrayBuffer`, atomics, isolation, and related support
- tests, regression coverage, and benchmarks for the substrate

Audio and DSP were the first clients, but the implementation is about the broader boundary problem: a soft host/runtime side coordinating with timing-sensitive work across explicit shared-memory contracts.

---

## Prototype Flow

The preserved flow is:

```text
defineSpec
  -> planLayout
  -> allocateShared / allocateSharedPartitioned / allocateWasmShared
  -> buildHandoff
  -> receiveHandoff
  -> bindController / bindProcessor / bindObserver
```

Example imports should use the private prototype package:

```ts
import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  receiveHandoff,
} from "@seqlok-internal/prototype-core";
```

---

## Boundaries

The package keeps the technical substance needed to inspect and validate the first implementation:

- `defineSpec` compiles authored structure into the runtime contract consumed by planning.
- `planLayout` is called once at the spec-to-plan boundary.
- backing and bindings consume `Plan`; they do not recompute it.
- readers use coherent snapshots guarded by seqlock state.
- diagnostics remain available through the preserved diagnostics entry point.

The prototype does not claim production readiness. It remains useful as evidence for which layout, backing, browser, and coherence decisions held up under tests, and for which API vocabulary should be avoided in the future public surface.

---

## Benchmarks

Run the raw suite:

```bash
pnpm -F @seqlok-internal/prototype-core run bench
```

Run and format the benchmark report:

```bash
pnpm -F @seqlok-internal/prototype-core run bench:report
```

Treat these numbers as regression guardrails, not marketing claims.

---

## Future Seqlok Direction

The future public Seqlok name remains reserved for a cleaner boundary-substrate extraction around:

- layout
- core publications
- commands
- lineage
- invalidation
- host/runtime integration

Browser support and future Electron compatibility remain proof constraints for that extraction.

---

## Documentation

Additional design docs live under `packages/core/docs`. They describe the preserved prototype implementation and should be read as engineering history, not current public release guidance.
