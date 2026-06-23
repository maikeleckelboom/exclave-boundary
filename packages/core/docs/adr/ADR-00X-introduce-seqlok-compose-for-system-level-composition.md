# ADR-00X: Historical System-Level Composition Proposal

**Status**: Historical note, not current package guidance
**Date**: 2025-11-16
**Owner**: _TBD_

**Related**:

- ADR-001 - Seqlok Core Golden Flow
- ADR-002 - Memory Growth & Swap via Handoff Sequences
- ADR-00Y - MWMR System Architecture via Domains + Observers + Rings
- ADR-00Z - Observer Binding Role in `@seqlok-internal/prototype-core` (`bindObserver`)
- ADR-010 - Ring Primitive in `@seqlok-internal/prototype-core` (SWSR intent queue)

---

## Historical Context

This ADR originally proposed a named public composition package for topology wiring. That package name is no longer current guidance. This repository is preserved as an engineering artifact, and the future Seqlok direction is limited to boundary-substrate concerns: layout, core publications, commands, lineage, invalidation, host/runtime integration, plus browser and Electron proof constraints.

The useful design note from the original proposal is architectural rather than package-specific: complex systems can be assembled from multiple SWMR domains, observer bindings, and SWSR ring primitives without weakening the single-writer rules inside each shared-memory plane.

---

## Preserved Design Idea

System-level MWMR remains a composition pattern:

- each domain keeps exactly one params writer and one meters writer
- observers provide read-only fan-out
- SWSR rings can carry intents into a single driver or hub
- product code owns policy, lifecycle, conflict resolution, and timing decisions

This keeps `@seqlok-internal/prototype-core` focused on the prototype substrate instead of turning it into an orchestration framework.

---

## Current Guidance

Do not treat this ADR as an active package plan. It is historical evidence for why topology, commands, lineage, invalidation, and host/runtime integration belong above the low-level shared-memory substrate.

Current documentation should use neutral architecture language unless a package actually exists in this repository. Do not introduce replacement package names in this document.
