# Command Ring Protocol (planned)

**Status:** Planned  
**Scope:** SPSC command ring used for RT command delivery (tickets, etc.)

This is the intended formalization target for a bounded FIFO ring transport:

- **FIFO**: consumed order matches produced order
- **No corruption**: no phantom reads, no duplication
- **Bounded capacity** with explicit full-ring behavior (reject / overwrite-oldest, etc.)

## Planned artifacts

```text
packages/hotswap/docs/formal/primitives/tla/CommandRingProtocol.tla
packages/hotswap/docs/formal/primitives/tla/CommandRingProtocol.cfg
```

## Target invariants (sketch)

- `TypeOK`
- `CapacityBound` (\(writeIndex - readIndex \le CAPACITY\))
- `FIFOOrdering` (\(consumed = SubSeq(produced, 1, Len(consumed))\))
- `NoPhantomRead`
