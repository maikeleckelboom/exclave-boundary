# Seqlok Core Protocol (planned)

**Status:** Draft design  
**Scope:** Coherence protocol for `@seqlok/core` parameters + meters (LU/MU seqlock)

This document is a pointer/stub kept in `@seqlok/hotswap`’s formal bundle so the
transport + coherence story stays discoverable from one place.

The actual formal artifacts are expected to live under `@seqlok/core`:

```text
packages/core/docs/formal/tla/SeqlokCoreProtocol.tla
packages/core/docs/formal/tla/SeqlokCoreProtocol.cfg
packages/core/docs/formal/core-test-vectors.json
```

Key goals when formalized:

- **No torn snapshots** (readers see whole generations only)
- **Monotonic versions** (LU / MU never decrease)
- **Lock-free on RT** (no blocking / bounded work)
