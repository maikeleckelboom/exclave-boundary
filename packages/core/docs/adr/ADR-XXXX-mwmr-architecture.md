# ADR-XXXX: MWMR System Architecture via Seqlok Domains + Observers + Command Ring

**Status**: Proposed
**Date**: 2025-11-16
**Owner**: _TBD_
**Related**:

- ADR-001 – Seqlok Core Golden Flow
- ADR-002 – Memory Growth & Swap via Handoff Sequences

---

## 1. Context

Seqlok core provides rock-solid **SWMR** primitives with seqlock-based coherence. The golden flow is frozen:

```txt
defineSpec → planLayout → allocateShared → buildHandoff → receiveHandoff → bind{Controller,Processor}
```

Real-world systems like Dekzer need **system-level MWMR** without compromising the per-domain SWMR guarantee. We achieve
this through **compositional architecture** rather than primitive complexity.

---

## 2. Problem Statement

Complex real-time systems require:

1. **Multiple logical writers** across different domains
2. **Multiple concurrent readers** with coherent views
3. **Real-time guarantees** (predictable latency, no allocations in hot paths)
4. **Clear authority boundaries** (who owns what)

Extending Seqlok primitives to MWMR would violate core principles. We need MWMR **emergent behavior** from SWMR
_building blocks_.

---

## 3. Decision

### 3.1 Core Architecture: Domains as Islands

```ts
type Domain<S extends SpecInput> = {
  readonly spec: Spec<S>;
  readonly backing: Backing;
  readonly controller: ControllerBinding<S> | null; // One param writer
  readonly processor: ProcessorBinding<S> | null; // One meter writer
  readonly observers: Set<ObserverBinding<S>>; // Many readers
};

type SystemDomain = Domain<SpecInput>;

type System = {
  readonly domains: Map<DomainId, SystemDomain>;
  readonly commandRing: CommandRing;
  readonly registry: Domain<RegistrySpec>;
};
```

Each `Domain<S>` is a strictly SWMR Seqlok instance: at most one controller and at most one processor are allowed to
write; observers are always read-only.

The **system** is a graph of such domains wired with:

- `bindObserver` for fan-out (many readers)
- Command ring(s) for fan-in (many writers → a hub/governor)
- Optional registry domain for discovery/coordination

---

### 3.2 New Binding Role: `bindObserver`

`bindObserver` is a third binding role alongside `bindController` and `bindProcessor`. It gives coherent, **read-only**
access to params and meters.

Public surface (conceptual):

```ts
export function bindObserver<S extends SpecInput>(
  received: ReceivedHandoff<S>,
  options?: ObserverOptions,
): ObserverBinding<S>;
```

- `bindController(spec, backing, ...)` is **owner-side**.
- `bindProcessor(received, ...)` and `bindObserver(received, ...)` are **consumer-side** and always start from
  `ReceivedHandoff<S>`.

Observer types:

```ts
export interface ObserverParams<S extends SpecInput> {
  snapshot(): FullParamsSnapshot<S>;

  snapshot<const K extends readonly ParamKeys<S>[]>(keys: K): SnapshotParamsObject<S, K>;

  version(): PUSeq; // same semantics as controller-side param version
}

export interface ObserverMeters<S extends SpecInput> {
  snapshot(): FullMetersSnapshot<S>;

  snapshot<const K extends readonly MeterKeys<S>[]>(keys: K): SnapshotMetersObject<S, K>;

  version(): MUSeq; // same semantics as processor-side meter version
}

export interface ObserverBinding<S extends SpecInput> {
  readonly params: ObserverParams<S>;
  readonly meters: ObserverMeters<S>;

  dispose(): void;
}
```

Implementation reuses existing snapshot machinery from the controller binding (conceptually `controller.snapshot.ts`),
minus all write methods:

```ts
export function observerImpl<S extends SpecInput>(
  plan: Plan<S>,
  backing: Backing,
  options: ObserverOptions = {},
): ObserverBinding<S> {
  const mapped = mapViews(plan, backing);

  const params = createParamSnapshotView(mapped, plan, options);
  const meters = createMeterSnapshotView(mapped, plan, options);

  return {
    params: {
      snapshot: params.snapshot,
      version: params.version, // wraps the same PU seqlock counter
    },
    meters: {
      snapshot: meters.snapshot,
      version: meters.version, // wraps the same MU seqlock counter
    },
    dispose: () => {
      // No-op for read-only binding (no ownership of backing)
    },
  };
}
```

> Note: the ADR deliberately leaves out internal details such as exact field names on `mapped.locks.*`. The only
> guarantee is: `ObserverParams.version()` and `ObserverMeters.version()` report the same counters as controller- and
> processor-side views for the same domain.

Same-thread diagnostics can still construct observers by going through the golden flow:

```ts
const plan = planLayout(spec);
const backing = allocateShared(plan);
const handoff = buildHandoff(plan, backing);
const received = receiveHandoff(handoff);
const observer = bindObserver(received);
```

---

### 3.3 Command Ring: Lock-Free Intent Bus (MPSC)

A separate package, e.g. `@seqlok/command-ring`, provides a **many-producer / single-consumer** (MPSC) ring for intents.
It is **not** implemented using Seqlok; it is a dedicated SAB layout with its own invariants.

Conceptual interface:

```ts
interface Command {
  readonly opcode: number; // u32 semantic
  readonly agent: number; // u32 agent/producer id
  readonly timestampHi: number; // high 32 bits of u64
  readonly timestampLo: number; // low 32 bits of u64
  readonly args: readonly [number, number, number, number]; // 4× u32 payload
}

interface CommandRing {
  // Producer side (many threads/workers)
  tryEnqueue(command: Command): boolean;

  // Consumer side (single thread)
  tryDequeue(): Command | null;

  drainInto(buffer: Command[], max: number): number;

  // Metrics (approximate)
  readonly capacity: number;
  readonly pending: number;
}
```

Key properties:

- Many producers, **exactly one** consumer per ring.
- Fixed-size slots, fixed-size commands; no allocation in hot path.
- Separate from Seqlok: Seqlok transports **state**, the ring transports **intents** (“do work”).

Implementation sketch (conceptual):

```ts
class LockFreeCommandRing implements CommandRing {
  private readonly buffer: SharedArrayBuffer;
  private readonly head: Uint32Array; // producer cursor (Atomics)
  private readonly tail: Uint32Array; // consumer cursor (Atomics)
  private readonly commands: Uint32Array; // raw command words
  private readonly mask: number;

  readonly capacity: number;

  constructor(capacity: number) {
    invariant(isPowerOfTwo(capacity), 'capacity must be power of 2');

    this.capacity = capacity;
    this.mask = capacity - 1;

    const CACHE_LINE = 64;
    const COMMAND_WORDS = 8; // opcode, agent, tsHi, tsLo, args[4]
    const headerBytes = CACHE_LINE * 2;
    const commandBytes = capacity * COMMAND_WORDS * 4;

    this.buffer = new SharedArrayBuffer(headerBytes + commandBytes);
    this.head = new Uint32Array(this.buffer, 0, 1);
    this.tail = new Uint32Array(this.buffer, CACHE_LINE, 1);
    this.commands = new Uint32Array(this.buffer, headerBytes / 4);
  }

  tryEnqueue(cmd: Command): boolean {
    const h = Atomics.load(this.head, 0);
    const t = Atomics.load(this.tail, 0);

    const next = (h + 1) & this.mask;
    if (next === t) return false; // ring full

    const offset = h * 8;
    this.commands[offset + 0] = cmd.opcode;
    this.commands[offset + 1] = cmd.agent;
    this.commands[offset + 2] = cmd.timestampHi;
    this.commands[offset + 3] = cmd.timestampLo;
    this.commands[offset + 4] = cmd.args[0];
    this.commands[offset + 5] = cmd.args[1];
    this.commands[offset + 6] = cmd.args[2];
    this.commands[offset + 7] = cmd.args[3];

    Atomics.store(this.head, 0, next);
    return true;
  }

  // Consumer must be single-threaded per ring
  tryDequeue(): Command | null {
    const t = Atomics.load(this.tail, 0);
    const h = Atomics.load(this.head, 0);
    if (t === h) return null;

    const offset = t * 8;
    const opcode = this.commands[offset + 0];
    const agent = this.commands[offset + 1];
    const timestampHi = this.commands[offset + 2];
    const timestampLo = this.commands[offset + 3];
    const args: [number, number, number, number] = [
      this.commands[offset + 4],
      this.commands[offset + 5],
      this.commands[offset + 6],
      this.commands[offset + 7],
    ];

    const next = (t + 1) & this.mask;
    Atomics.store(this.tail, 0, next);

    return { opcode, agent, timestampHi, timestampLo, args };
  }

  drainInto(buffer: Command[], max: number): number {
    let count = 0;
    while (count < max) {
      const cmd = this.tryDequeue();
      if (!cmd) break;
      buffer.push(cmd);
      count += 1;
    }
    return count;
  }

  get pending(): number {
    const h = Atomics.load(this.head, 0);
    const t = Atomics.load(this.tail, 0);
    return (h - t) & this.mask;
  }
}
```

> Note: this is an MPSC ring. If multiple consumers are required, multiple rings must be provisioned.

---

### 3.4 Registry Domain: Discovery & Coordination

A dedicated Seqlok domain acts as the system registry. It exposes **metadata**, not raw SAB references:

```ts
const registrySpec = defineSpec(({ param, meter }) => ({
  id: 'system-registry',
  params: {
    // Written by orchestrator
    domainCount: param.u32(),
    swapGeneration: param.u32(),
  },
  meters: {
    // Per-domain metadata (fixed array, sparse)
    domainIds: meter.u32.array({ length: MAX_DOMAINS }),
    domainHashes: meter.u32.array({ length: MAX_DOMAINS }),
    domainGenerations: meter.u32.array({ length: MAX_DOMAINS }),
    domainByteLengths: meter.u32.array({ length: MAX_DOMAINS }),
  },
}));
```

Key points:

- The registry **does not store `SharedArrayBuffer` objects**.
  It only carries IDs, hashes, generations, sizes, etc.
- SABs are distributed via `postMessage` at bootstrap or on topology changes (e.g. growth), and the registry carries the
  metadata that describes them.

---

### 3.5 Orchestration Layer: Growth & Swapping

Growth and backing evolution are handled by an orchestration layer (e.g. `@seqlok/orchestration`), not core.

We build on `SwapTicket` semantics:

```ts
// Minimal swap directive (existing concept)
interface SwapTicket<S extends SpecInput> {
  readonly id: number; // u32
  readonly atFrame: number; // absolute processor frame
  readonly fadeLen: number; // crossfade window in frames
  readonly handoff: Handoff<S>;
}

// Rich orchestration wrapper (new)
interface SwapSession<S extends SpecInput> {
  readonly ticket: SwapTicket<S>;
  readonly metadata: SwapMetadata<S>;
  readonly coordination: SwapCoordination;
}

interface SwapMetadata<S extends SpecInput> {
  readonly from: {
    handoff: Handoff<S>;
    generation: number;
    byteLength: number;
  };
  readonly to: {
    handoff: Handoff<S>;
    generation: number;
    byteLength: number;
  };
  readonly copyRegions?: Array<{
    offset: number;
    length: number;
    priority: 'critical' | 'lazy';
  }>;
}
```

The orchestrator manages growth via **handoff sequences**, never mutating existing backings in place:

```ts
class DomainOrchestrator<S extends SpecInput> {
  private nextTicketId = 1;

  async requestGrowth(domain: Domain<S>, targetBytes: number): Promise<SwapSession<S>> {
    const plan = planLayout(domain.spec);

    // Conceptual helper in @seqlok/orchestration (not core)
    const newBacking = allocateSharedWithSize(plan, targetBytes);

    // Copy live bytes off-thread using a worker
    await this.copyWorker.postMessage({
      from: getSharedBuffer(domain.backing),
      to: getSharedBuffer(newBacking),
      bytes: plan.bytesTotal,
    });

    const newHandoff = buildHandoff(plan, newBacking);

    const session: SwapSession<S> = {
      ticket: {
        id: this.nextTicketId++,
        atFrame: this.computeSwapFrame(),
        fadeLen: 512,
        handoff: newHandoff,
      },
      metadata: {
        from: {
          handoff: domain.handoff,
          generation: domain.generation,
          byteLength: domain.backing.byteLength,
        },
        to: {
          handoff: newHandoff,
          generation: domain.generation + 1,
          byteLength: targetBytes,
        },
      },
      coordination: {
        strategy: 'quantum-boundary',
        acknowledgments: new Map(),
      },
    };

    await this.broadcastSwapIntent(session);
    return session;
  }
}
```

> `allocateSharedWithSize` is a conceptual orchestration helper that wraps `allocateShared` or a custom allocator; it is
> **not** part of `@seqlok/core`.

---

## 4. Implementation Patterns

### 4.1 Domain Lifecycle

```ts
class DomainManager {
  private domains = new Map<DomainId, SystemDomain>();

  async createDomain<S extends SpecInput>(
    id: DomainId,
    spec: Spec<S>,
    role: 'controller' | 'processor' | 'observer',
  ): Promise<Domain<S>> {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const handoff = buildHandoff(plan, backing);

    let controller: ControllerBinding<S> | null = null;
    let processor: ProcessorBinding<S> | null = null;
    let observers: Set<ObserverBinding<S>> = new Set();

    switch (role) {
      case 'controller':
        controller = bindController(spec, backing);
        break;
      case 'processor': {
        const received = receiveHandoff(handoff);
        processor = bindProcessor(received);
        break;
      }
      case 'observer': {
        const received = receiveHandoff(handoff);
        observers.add(bindObserver(received));
        break;
      }
    }

    const domain: Domain<S> = {
      spec,
      backing,
      controller,
      processor,
      observers,
    };

    this.domains.set(id, domain as SystemDomain);

    await this.updateRegistry(id, plan.hash, plan.bytesTotal);

    return domain;
  }
}
```

### 4.2 Quantum-Accurate Swapping (Audio Example)

```ts
class AudioWorkletSwapper<S extends SpecInput> {
  private pendingSwap?: SwapTicket<S>;
  private currentBinding: ProcessorBinding<S>;

  constructor(initial: ProcessorBinding<S>) {
    this.currentBinding = initial;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], currentFrame: number) {
    const quantum = 128; // frames

    if (this.pendingSwap && currentFrame >= this.pendingSwap.atFrame) {
      this.executeSwap();
    }

    this.currentBinding.params.within((params) => {
      // Real-time DSP using params
    });

    this.currentBinding.meters.publish((meters) => {
      // Real-time meters
    });

    return true;
  }

  scheduleSwap(ticket: SwapTicket<S>) {
    this.pendingSwap = ticket;
  }

  private executeSwap() {
    const ticket = this.pendingSwap!;
    const received = receiveHandoff(ticket.handoff);
    const newBinding = bindProcessor(received);

    if (ticket.fadeLen > 0) {
      this.startCrossfade(this.currentBinding, newBinding, ticket.fadeLen);
    } else {
      this.currentBinding.dispose();
      this.currentBinding = newBinding;
    }

    this.pendingSwap = undefined;
  }

  private startCrossfade(
    from: ProcessorBinding<S>,
    to: ProcessorBinding<S>,
    fadeLen: number,
  ) {
    // Crossfade implementation is application-specific
  }
}
```

---

## 5. Example: Multi-Domain Dekzer

```ts
// Domain topology
const dekzerDomains = {
  deck: defineSpec(/* deck control & meters */),
  reservoir: defineSpec(/* PCM cache state */),
  waveform: defineSpec(/* visual waveform build state */),
  analyzer: defineSpec(/* spectral / groove analysis */),
  mixer: defineSpec(/* crossfader, EQ */),
  registry: registrySpec,
};

// Role assignments (conceptual)
const topology = {
  mainThread: {
    deck: 'controller', // UI writes deck params
    mixer: 'controller', // UI writes mixer params
    '*': 'observer', // UI can observe other domains for HUD
  },
  audioWorklet: {
    deck: 'processor', // Engine writes deck meters
    mixer: 'processor', // Engine writes mixer meters
    '*': 'observer', // Engine observes reservoir/analyzer as needed
  },
  reservoirWorker: {
    reservoir: 'controller', // Governor owns reservoir state
    deck: 'observer', // Observes deck for prefetch decisions
  },
  analyzerWorker: {
    analyzer: 'controller', // Analyzer owns analyzer meters
    deck: 'observer', // Observes deck transport
    mixer: 'observer', // Observes mixer context
  },
  hudWorker: {
    '*': 'observer', // Composite HUD over all domains
  },
};
```

---

## 6. Invariants & Non-Goals

**Invariants**

- Each Seqlok domain has **at most one** param writer (controller) and **at most one** meter writer (processor).
- `bindObserver` **never** exposes any API that can write params or meters.
- Command rings are **not** implemented using Seqlok; they are separate SAB structures with their own invariants.
- Growth and swapping are expressed as **new `Handoff<S>` instances**; Seqlok never mutates existing backings in place.

**Non-Goals**

- Do not support MWMR at Seqlok plane level.
- Do not use Seqlok planes to transport JS object references (e.g. `SharedArrayBuffer` objects).
- Do not embed epoch/growth metadata into Seqlok core backing types; this belongs in orchestration/registry layers.

---

## 7. Benefits of This Architecture

1. **Principled Composition** – MWMR emerges from SWMR building blocks.
2. **Clear Authority** – Each domain has exactly one param writer and one meter writer.
3. **Scalable Observation** – Unlimited read-only observers per domain via `bindObserver`.
4. **Real-Time Safe** – No allocations in the hot path, predictable latency, quantum-/frame-accurate swaps.
5. **Growth Without Tears** – New handoffs, not in-place mutations; orchestrated swaps at frame boundaries.
6. **Type Safety** – Full TypeScript inference preserved across domain boundaries.
7. **Future-Proof for Agents/AI** – The same pattern scales to real-time agent/AI runtimes that:

- Observe shared world state via `bindObserver`.
- Emit intents via command rings.
- Let a hub/governor apply changes to authoritative Seqlok domains.

---

## 8. Summary

We achieve system-level MWMR by:

- Composing multiple SWMR Seqlok domains.
- Adding `bindObserver` for many-reader fan-out.
- Using command rings for many-writer fan-in.
- Orchestrating growth via handoff sequences and `SwapTicket`s.
- Maintaining frame-accurate swap semantics for real-time contexts.

This preserves Seqlok's elegant core while enabling arbitrarily complex real-time systems—from Dekzer's multi-worker
audio engine to real-time AI/agent runtimes—without ever compromising the SWMR guarantees at the primitive level.
