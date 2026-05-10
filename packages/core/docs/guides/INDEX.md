# Guides

Focused guides for `@seqlok/core`.

These documents are practical, current, and tied to the live package surface.
They build on the main README and assume you already know the canonical core flow:

>
`defineSpec → planLayout → allocateShared / allocateSharedPartitioned / allocateWasmShared → buildHandoff → acceptHandoff → bindController / bindProcessor / bindObserver`

---

## Available guides

### Core flow

- [Seqlok Canonical Flow: From Spec to Bindings](./seqlok-flow-from-spec-to-bindings.md)  
  The end-to-end pipeline from schema to shared memory, handoff, and live bindings.

### Utilities & UI wiring

- [Enum helpers & UI wiring](./enum-helpers.md)  
  How to drive UI controls, legends, and fixtures directly from enum params and meters using:

  - `enumValues`
  - `enumPaletteFor`
  - `enumArrayToLabels` / `enumLabelsToArray`
  - `enumIndexFromLabel` / `enumLabelFromIndex`

---

## Archived essays

The following material is no longer treated as live package guidance, but may still be useful as background reading:

- [Onboarding: The Seqlok Mindset and Hot Path](../attic/onboarding-seqlok-mindset-and-hot-path.md)

More guides can land here over time, but this folder should stay narrow:
current package usage, current package contracts, and practical patterns.
