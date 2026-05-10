# @seqlok/hotswap docs

This folder documents the Seqlok hotswap substrate.

The docs are split by ownership:

- **Contract**: shipped protocol law
- **Implementation**: host/runtime wiring and operational integration
- **Engine**: lifecycle semantics and engine-author ABI
- **Formal**: TLA+ models, English formal specs, and reference artefacts
- **ADR**: accepted or proposed design decisions
- **Exploratory**: future-facing, non-binding design parking lot

This file is an index. It is not a second handbook.

---

## Start here

### If you need the shipped protocol contract

Read:

- [CONTRACT.md](./CONTRACT.md)

This is the normative contract for the supported hotswap policy surface.

### If you need to wire the runtime or driver

Read:

- [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)

This covers ticket flow, runtime sequencing, orchestration, and caller responsibilities.

### If you are implementing an engine

Read in this order:

- [engine/engine-lifecycle-spec.md](./engine/engine-lifecycle-spec.md)
- [engine/engine-sdk-guide.md](./engine/engine-sdk-guide.md)

The lifecycle spec explains swap phase semantics.
The SDK guide owns the engine ABI and engine-author contract.

### If you care about formal verification

Read:

- [formal/README.md](./formal/README.md)

That document owns the formal model map, supported policy families, and TLC execution instructions.

---

## Supported doctrine

Seqlok hotswap currently has two separate axes.

### 1. Swap policy axis

Supported policy levels are:

- **Level 1**: `single`
- **Level 2**: `reject-busy`

Anything beyond that is not part of the shipped policy contract.

### 2. Continuity axis

Continuity is orthogonal to swap policy:

- **`aligned`**: continuity by alignment context, bounded warm-up, and crossfade
- **`persistent`**: continuity by explicit handoff snapshot, install, catchup, and guarded retire

See:

- [adr/hotswap-continuity-classes-and-persistent-handoff.md](./adr/hotswap-continuity-classes-and-persistent-handoff.md)

Do not treat continuity class as another policy level.

---

## Directory map

### Core docs

- [CONTRACT.md](./CONTRACT.md)  
  Normative shipped protocol contract.

- [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)  
  Runtime and driver integration guide.

### Engine docs

- [engine/engine-lifecycle-spec.md](./engine/engine-lifecycle-spec.md)  
  Lifecycle semantics for aligned and persistent swap flows.

- [engine/engine-sdk-guide.md](./engine/engine-sdk-guide.md)  
  Engine ABI, handoff capability surface, and engine-author requirements.

### ADRs

- [adr/hotswap-multi-swap-requirements.md](./adr/hotswap-multi-swap-requirements.md)  
  Level 2 overlap policy requirements.

- [adr/hotswap-continuity-classes-and-persistent-handoff.md](./adr/hotswap-continuity-classes-and-persistent-handoff.md)  
  Orthogonal continuity-class decision for `aligned` and `persistent`.

### Formal bundle

- [formal/README.md](./formal/README.md)  
  Entry point for supported formal policy models, experimental models, reference artefacts, and TLC instructions.

### Exploratory material

- [exploratory/hotswap-advanced-multi-swap.md](./exploratory/hotswap-advanced-multi-swap.md)  
  Non-binding future exploration for queueing, retargeting, and richer overlap behavior.

---

## Ownership rules

Use these rules when editing the docs:

- `README.md` is an index only.
- `CONTRACT.md` owns shipped protocol law.
- `IMPLEMENTATION_GUIDE.md` owns host/runtime integration.
- `engine-lifecycle-spec.md` owns lifecycle semantics.
- `engine-sdk-guide.md` owns engine ABI and engine-author contract.
- `formal/README.md` owns formal execution guidance and model map.
- `adr/` is for actual decisions.
- `exploratory/` is for non-binding future material.

If a concept is defined in two places, the docs are wrong.

---

## Editing guidance

Before adding a new doc, ask:

1. Does an existing file already own this concept?
2. Is this shipped law, implementation guidance, formal material, or exploratory thinking?
3. Will this new file reduce ambiguity, or just duplicate doctrine under a new name?

Prefer fewer docs with sharper ownership.
