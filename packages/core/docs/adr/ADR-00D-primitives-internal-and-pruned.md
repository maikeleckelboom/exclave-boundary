# ADR-2025-11-15 – Primitives Are Internal and Pruned

## Status

Accepted

## Context

`@seqlok-internal/prototype-core` historically had a `src/primitives` layer (planes, atomics, seqlock) with a larger export surface than the runtime actually needed:

- Some helpers were unused (`isPow2`, `isAligned`, `getSeq`, `isWriterActive`).
- Some were design stubs for future features (`acquire`, `AcquireOptions`).
- A couple of functions (`createSeqPair`, `tryRead`) existed primarily to support primitives tests.

At the same time, the public value proposition of `@seqlok-internal/prototype-core` is the **high-level binding pipeline**:

- `defineSpec` → `planLayout` → `allocateShared` / `allocateWasmShared`
- `buildHandoff` / `receiveHandoff`
- `bindController` / `bindProcessor`

Exposing low-level primitives as "public API" would increase maintenance cost and invite misuse without helping the main use cases (audio / realtime apps using bindings).

## Decision

1. **Primitives are internal only**

- `src/primitives/*` is treated as internal implementation detail.
- No primitives are exported from the package root (`src/index.ts`).
- Comments and JSDoc are updated to reflect this.

2. **Dead / speculative helpers are removed**

- Deleted from the runtime:
  - `isPow2`, `isAligned`
  - `acquire`, `AcquireOptions`
  - `getSeq`, `isWriterActive`
- Their final working implementations are preserved in an appendix:
  `docs/appendix/primitives-shelf-removed-helpers-v1.md`.

3. **Test-only helpers remain but are marked internal**

- `createSeqPair` and `tryRead` (and their related types) remain in `src/primitives/seqlock.ts`.
- They are explicitly marked `@internal` and used only by primitives tests.
- They are not re-exported from the package root.

## Consequences

- The **public API surface** matches the library’s real value: high-level, type-safe bindings over SharedArrayBuffer.
- The primitives implementation can be freely refactored or replaced in future versions without breaking consumers.
- There is no implied commitment to support low-level seqlock primitives as a stable API.
- If future features (e.g. coherent meter snapshots, stricter alignment validation) require primitives like `acquire`, they will be designed **binding-first** and can pull code from the shelf appendix as needed.

## Notes

- A code reference for removed helpers, including exact TypeScript implementations, is kept in:
  `docs/appendix/primitives-shelf-removed-helpers-v1.md`.
- If in the future there is real demand for low-level primitives, they may be extracted into a separate package (e.g.
  `@seqlok/primitives` or `@typebits/core`) with its own API and stability guarantees.
