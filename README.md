# Seqlok Boundary Substrate R&D

Status: Engineering artifact. R&D prototype. Release held deliberately.

This repository contains the first Seqlok boundary-substrate implementation. It is public as engineering evidence, not as the final public API.

This repository is not an npm release target. The current prototype core package is `@seqlok-internal/prototype-core`, and it is private.

The original package shape exposed the wrong public mental model around controller, processor, observer, params, and meters. The future Seqlok name remains reserved for a cleaner boundary-substrate extraction.

Audio and DSP were the first clients, but the prototype is about the broader boundary problem: a soft host/runtime side coordinating with timing-sensitive work across explicit shared-memory contracts.

---

## Prototype Scope

The current implementation explored:

- typed shared-memory contracts
- deterministic layout planning
- shared backing allocation
- coherent reads
- role-specific bindings for controller, processor, and observer
- handoff artifacts across trust and runtime boundaries
- browser environment probes
- tests, regression coverage, and benchmarks

The old implementation is intentionally preserved as engineering evidence. It should not be read as the final package shape or final API vocabulary for Seqlok.

---

## Current Package

- `@seqlok-internal/prototype-core`: private prototype package for specs, layout planning, shared backing, handoff, diagnostics, benchmarks, and bindings.

There is no current public core-package release target in this repository.

---

## Canonical Prototype Flow

The preserved prototype centers on one explicit flow:

```text
defineSpec
  -> planLayout
  -> allocateShared / allocateSharedPartitioned / allocateWasmShared
  -> buildHandoff
  -> receiveHandoff
  -> bindController / bindProcessor / bindObserver
```

Example imports should target the private prototype package:

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

## Future Seqlok Direction

The next public Seqlok direction is a cleaner boundary-substrate extraction around:

- layout
- core publications
- commands
- lineage
- invalidation
- host/runtime integration

Browser support and future Electron compatibility remain proof constraints for that extraction. The future public package or repository may use the clean Seqlok name; this repository deliberately does not.

---

## Documentation

- [Prototype core package docs](packages/core/README.md)
- Additional technical documentation lives under [packages/core/docs](packages/core/docs)
