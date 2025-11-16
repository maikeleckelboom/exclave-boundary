# ADR-00X: Introduce `@seqlok/compose` for System-Level Composition

**Status**: Draft
**Date**: 2025-11-16
**Owner**: _TBD_
**Related**:

- ADR-001 – Seqlok Core Golden Flow
- ADR-002 – Memory Growth & Swap via Handoff Sequences
- ADR-XXXX – MWMR System Architecture via Domains + Observers + Command Ring
- _Future_ – ADR-00Y: `@seqlok/command-ring` MPSC Intent Bus
- _Future_ – ADR-00Z: Observer Binding Role in `@seqlok/core` (`bindObserver`)

---

## 1. Context

`@seqlok/core` is intentionally narrow:

```txt
defineSpec
→ planLayout
→ allocateShared
→ buildHandoff
→ receiveHandoff
→ bind{Controller,Processor,Observer}
```

It provides:

- a typed **shared-memory wire** (params + meters),
- a deterministic layout pipeline,
- SWMR domains with seqlock-based coherence.

The MWMR ADR (ADR-XXXX) describes **system-level** architectures built from these SWMR domains:

- multiple Seqlok **domains** (deck, reservoir, analyzer, mixer, registry, …),
- a **command ring** for many-writer fan-in,
- `bindObserver` for many-reader fan-out,
- growth & swapping via `SwapTicket`-driven handoff sequences.

Right now, all of that lives as _conceptual_ architecture and ad-hoc wiring in examples (e.g. Dekzer). There is no
first-class place in the Seqlok ecosystem where you can:

- declaratively describe a **full system topology**, and
- turn that description into concrete backings, handoffs, workers, and bindings.

---

## 2. Problem Statement

We need a way to describe and realize **complex systems** that:

1. Use multiple Seqlok **domains** (each SWMR) across multiple runtimes (main, workers, AudioWorklet, agents).
2. Use one or more **command rings** for many-writer → hub fan-in.
3. Respect core invariants:

- at most **one param writer** (controller) per domain,
- at most **one meter writer** (processor) per domain,
- any number of read-only observers per domain.

4. Coordinate **growth and swap** operations across domains using `SwapTicket` and handoff sequences.
5. Do all of this **declaratively**, with strong TypeScript inference and minimal boilerplate.

Trying to solve this inside `@seqlok/core` would:

- bloat the core package with topology/orchestration concerns,
- tangle basic bindings with system-specific policies,
- make it harder to use Seqlok in "small" contexts (single domain, no workers).

We need a **separate layer** that builds on core and `@seqlok/command-ring`, without contaminating them.

---

## 2.1 Prerequisites

This ADR assumes the following core capabilities exist:

1. **Observer binding in `@seqlok/core`**

   A third binding role `bindObserver` exists alongside `bindController` and `bindProcessor`, providing:

- read-only snapshots for params and meters,
- `version()` counters aligned with controller/processor versions,
- no write APIs (`set`, `update`, `stage`, `publish`) exposed.

This is covered conceptually in ADR-XXXX and will be formalized in a dedicated core ADR (
`ADR-00Z: Observer Binding Role`).

2. **Command ring primitive (`@seqlok/command-ring`)**

   A separate package provides an MPSC command ring with:

- fixed-size, SAB-backed ring buffer,
- many producers, exactly one consumer,
- typed schemas for commands.

`@seqlok/compose` builds on these two pillars plus the existing core golden flow.

---

## 3. Decision

Introduce a new package:

```txt
@seqlok/compose
```

with the following responsibilities:

- Provide a **declarative DSL** to describe:

  - Seqlok **domains** (by spec),
  - **command rings** (by schema + capacity),
  - **runtime roles** (controller/processor/observer per domain per runtime),
  - optional system-wide **policies** (growth, memory governance).

- Provide a **realizer** that turns a composition into:

  - concrete plans and backings,
  - `Handoff<S>` bundles per domain,
  - runtime initialization messages and bindings,
  - a `RealizedSystem` with lifecycle and health,
  - a `SystemManager` that can coordinate growth & swaps using `SwapTicket` semantics.

`@seqlok/compose` will _not_ define new memory primitives. It will only:

- call into `@seqlok/core` (`defineSpec`, `planLayout`, `allocateShared`, `buildHandoff`, `receiveHandoff`, `bind*`),
- call into `@seqlok/command-ring` (for MPSC intent buses),
- structure this into a coherent **system graph**.

### 3.1 Layering

The final layering (conceptual) becomes:

```
// Layer 1: Memory primitives (@seqlok/core)
defineSpec
→ planLayout
→ allocateShared
→ buildHandoff
→ receiveHandoff
→ bindController / bindProcessor / bindObserver

// Layer 2: Intent bus (@seqlok/command-ring)
createCommandRing
→ defineCommandSchema
→ createTypedCommandRing

// Layer 3: System composition (@seqlok/compose)
defineComposition
→ validateComposition
→ realizeComposition
→ SystemManager / GrowthCoordinator / RealizedSystem
```

Typical consumers:

- `@dekzer/runtime` – concrete DJ engine compositions.
- `@seqlok/agents` – real-time agent/AI runtime compositions (future).

---

## 4. `@seqlok/compose` API Sketch

### 4.1 `defineComposition` – declarative system graph

`defineComposition` describes:

- **domains** – Seqlok specs lifted into macro-level entities,
- **rings** – typed command rings,
- **runtimes** – mapping from runtime IDs to roles-per-domain,
- optional **policies** for growth and memory governance.

```ts
// @seqlok/compose/composition.ts

import type { Spec, SpecInput } from '@seqlok/core';
import type { CommandSchema, CommandUnion } from '@seqlok/command-ring';

export interface GrowthPolicy {
  readonly strategy: 'independent' | 'coordinated';
  readonly defaultMultiplier?: number;
  readonly maxBytes?: number;
}

export type RingOverflowPolicy = 'drop-latest' | 'drop-oldest';

export interface DomainDescriptor<S extends SpecInput> {
  readonly id: string;
  readonly spec: Spec<S>;
  readonly growth?: GrowthPolicy;
}

export interface RingDescriptor<C extends CommandUnion> {
  readonly id: string;
  readonly capacity: number;
  readonly schema: CommandSchema<C>;
  readonly overflowPolicy: RingOverflowPolicy;
}

export type RuntimeRole = 'controller' | 'processor' | 'observer';

export type RuntimeMapping<D> = {
  [K in keyof D]?: RuntimeRole;
} & {
  '* '?: 'observer';
};

export interface CompositionBuilder {
  domain<S extends SpecInput>(config: {
    spec: Spec<S>;
    growth?: GrowthPolicy;
  }): DomainDescriptor<S>;

  ring<C extends CommandUnion>(config: {
    capacity: number;
    schema: CommandSchema<C>;
    overflowPolicy?: RingOverflowPolicy;
  }): RingDescriptor<C>;

  registry<S extends SpecInput>(config: { spec: Spec<S> }): DomainDescriptor<S>; // special-cased by Realizer
}

export interface MemoryGovernancePolicy {
  readonly softWatermarkRatio?: number;
  readonly hardWatermarkRatio?: number;
  readonly fatalWatermarkRatio?: number;
}

export interface CompositionDescription<
  D extends Record<string, DomainDescriptor<SpecInput>>,
  R extends Record<string, RingDescriptor<CommandUnion>>,
  RT extends Record<string, RuntimeMapping<D>>,
> {
  readonly id: string;
  readonly domains: D;
  readonly rings: R;
  readonly runtimes: RT;
  readonly policies?: {
    readonly memory?: MemoryGovernancePolicy;
    readonly growth?: GrowthPolicy;
  };
}

export function defineComposition<
  const D extends Record<string, DomainDescriptor<SpecInput>>,
  const R extends Record<string, RingDescriptor<CommandUnion>>,
  const RT extends Record<string, RuntimeMapping<D>>,
>(
  build: (b: CompositionBuilder) => {
    id: string;
    domains: D;
    rings: R;
    runtimes: RT;
    policies?: CompositionDescription<D, R, RT>['policies'];
  },
): CompositionDescription<D, R, RT> {
  // Implementation: collect builder outputs into a typed description.
  // No side effects; pure description.
}
```

Usage (Dekzer-flavoured):

```ts
const dekzerComposition = defineComposition((b) => ({
  id: 'dekzer-dual-deck',

  domains: {
    deckA: b.domain({ spec: deckSpec }),
    deckB: b.domain({ spec: deckSpec }),
    reservoir: b.domain({ spec: reservoirSpec }),
    analyzer: b.domain({ spec: analyzerSpec }),
    mixer: b.domain({ spec: mixerSpec }),
    registry: b.registry({ spec: createRegistrySpec() }),
  },

  rings: {
    system: b.ring({
      capacity: 4096,
      schema: SystemCommandSchema,
    }),
    analyzer: b.ring({
      capacity: 2048,
      schema: AnalyzerCommandSchema,
    }),
  },

  runtimes: {
    mainThread: {
      deckA: 'controller',
      deckB: 'controller',
      mixer: 'controller',
      registry: 'controller',
      '*': 'observer',
    },
    audioWorklet: {
      deckA: 'processor',
      deckB: 'processor',
      mixer: 'processor',
      reservoir: 'observer',
    },
    reservoirWorker: {
      reservoir: 'controller',
      deckA: 'observer',
      deckB: 'observer',
    },
    analyzerWorker: {
      analyzer: 'controller',
      deckA: 'observer',
      deckB: 'observer',
    },
    hudWorker: {
      '*': 'observer',
    },
  },
}));
```

### 4.2 `realizeComposition` – turn description into a running system

`realizeComposition` takes:

- a `CompositionDescription`, and
- a `PlatformAdapter` that knows how to spawn workers / AudioWorklets / main-thread bindings,

and returns a `RealizedSystem`.

```ts
// @seqlok/compose/realizer.ts

import type { Handoff, SpecInput, Plan, Backing } from '@seqlok/core';
import type { CommandRing, CommandUnion } from '@seqlok/command-ring';
import type {
  CompositionDescription,
  DomainDescriptor,
  RingDescriptor,
  RuntimeMapping,
} from './composition';

export interface RuntimeInitDomainBinding {
  readonly domainId: string;
  readonly role: 'controller' | 'processor' | 'observer';
  readonly handoff?: Handoff<SpecInput>; // for non-main runtimes
}

export interface RuntimeInitRingBinding {
  readonly ringId: string;
  readonly endpoint: 'producer' | 'consumer';
  readonly sab: SharedArrayBuffer;
}

export interface RuntimeInitMessage {
  readonly runtimeId: string;
  readonly domains: readonly RuntimeInitDomainBinding[];
  readonly rings: readonly RuntimeInitRingBinding[];
}

export interface RuntimeError {
  readonly runtimeId: string;
  readonly fatal: boolean;
  readonly message: string;
  readonly cause?: unknown;
}

export interface RuntimeHandle {
  readonly id: string;

  /**
   * Terminate the runtime (worker/AudioWorklet/etc.).
   */
  terminate(): Promise<void>;

  /**
   * Subscribe to unrecoverable runtime errors (e.g. uncaught exceptions).
   * SystemManager is expected to attach listeners here and surface them
   * via health / registry.
   */
  onError(handler: (error: RuntimeError) => void): void;
}

export interface PlatformAdapter {
  spawnWorker(init: RuntimeInitMessage): Promise<RuntimeHandle>;

  spawnAudioWorklet(init: RuntimeInitMessage): Promise<RuntimeHandle>;

  bindMainThread(init: RuntimeInitMessage): Promise<RuntimeHandle>;
}
```

In practice, `@seqlok/compose` is expected to ship **reference adapters**:

```ts
// Browser workers + AudioWorklet
export function createBrowserPlatformAdapter(
  opts: BrowserAdapterOptions,
): PlatformAdapter;

// Node.js worker_threads
export function createNodePlatformAdapter(opts: NodeAdapterOptions): PlatformAdapter;
```

so typical users do not have to implement `PlatformAdapter` from scratch.

Domain / ring realization:

```ts
export interface RealizedDomain {
  readonly id: string;
  readonly plan: Plan<SpecInput>;
  readonly backing: Backing;
  readonly handoff: Handoff<SpecInput>;
}

export interface RealizedRing<C extends CommandUnion> {
  readonly id: string;
  readonly ring: CommandRing<C>;
}

export interface DomainHealth {
  readonly id: string;
  readonly lastPlanHash: number;
  readonly lastSwapGeneration: number;
  readonly bytesAllocated: number;
  readonly ok: boolean;
  readonly issues: readonly string[];
}

export interface RingHealth {
  readonly id: string;
  readonly capacity: number;
  readonly pending: number;
  readonly drops: number;
  readonly ok: boolean;
}

export interface SystemHealth {
  readonly domains: Map<string, DomainHealth>;
  readonly rings: Map<string, RingHealth>;
  readonly uptimeMs: number;
  readonly runtimeErrors: readonly RuntimeError[];
}

export interface RealizedSystem<
  D extends Record<string, DomainDescriptor<SpecInput>>,
  R extends Record<string, RingDescriptor<CommandUnion>>,
> {
  readonly composition: CompositionDescription<D, R, Record<string, RuntimeMapping<D>>>;
  readonly domains: Map<string, RealizedDomain>;
  readonly rings: Map<string, RealizedRing<CommandUnion>>;
  readonly runtimes: Map<string, RuntimeHandle>;

  dispose(): Promise<void>;

  getHealth(): SystemHealth;
}
```

`realizeComposition` high-level:

```ts
export async function realizeComposition<
  const D extends Record<string, DomainDescriptor<SpecInput>>,
  const R extends Record<string, RingDescriptor<CommandUnion>>,
  const RT extends Record<string, RuntimeMapping<D>>,
>(
  composition: CompositionDescription<D, R, RT>,
  platform: PlatformAdapter,
): Promise<RealizedSystem<D, R>> {
  // 1. validateComposition(composition)
  // 2. Plan domains (planLayout).
  // 3. Allocate backings (allocateShared).
  // 4. Build handoffs (buildHandoff).
  // 5. Create rings (createTypedCommandRing + expose SAB).
  // 6. Construct RuntimeInit messages (domains + ring endpoints).
  // 7. Spawn runtimes via PlatformAdapter; attach onError handlers.
  // 8. Return RealizedSystem with dispose()/getHealth().
}
```

### 4.3 Growth Coordination via `SystemManager`

`realizeComposition` creates the initial system. `SystemManager` is the **primary public-facing orchestrator** that:

- wraps a `RealizedSystem`,
- exposes high-level operations (`requestGrowth`, `executeSwap`, future scheduling ops),
- surfaces health and registry updates.

Typical usage:

```ts
const realized = await realizeComposition(
  dekzerComposition,
  createBrowserPlatformAdapter(/* ... */),
);
const manager = new SystemManager(dekzerComposition, realized);

// Normal applications talk to `manager`, not bare `RealizedSystem`.
```

`RealizedSystem` remains available for advanced users and tooling, but the **recommended entry point** for apps is
`SystemManager`.

`SystemManager` sketch (shortened; same as previous version but with clarified role):

```ts
export class SystemManager<
  D extends Record<string, DomainDescriptor<SpecInput>>,
  R extends Record<string, RingDescriptor<CommandUnion>>,
> {
  // holds onto RealizedSystem internally
  constructor(
    private readonly composition: CompositionDescription<
      D,
      R,
      Record<string, RuntimeMapping<D>>
    >,
    private readonly realized: RealizedSystem<D, R>,
  ) {
    // attach runtime onError handlers and fold into SystemHealth/registry
  }

  getHealth(): SystemHealth {
    return this.realized.getHealth();
  }

  async requestGrowth(
    domainId: keyof D & string,
    targetBytes: number,
  ): Promise<SwapSession<SpecInput>> {
    // allocate larger backing, copy data, build new handoff, create SwapTicket
  }

  async executeSwap(session: SwapSession<SpecInput>): Promise<void> {
    // broadcast swap intent, coordinate quantum boundary, commit
  }

  async dispose(): Promise<void> {
    await this.realized.dispose();
  }
}
```

So the public layering becomes:

- `RealizedSystem`: structural handles, lifecycle, health (lower-level).
- `SystemManager`: orchestration methods and growth/swap operations (higher-level, default API).

### 4.4 Registry Domain Pattern

The registry is a **normal Seqlok domain** dedicated to system introspection. It carries metadata (IDs, generations,
byte sizes, simple health flags), not raw `SharedArrayBuffer` references.

```ts
// @seqlok/compose/registry-spec.ts

import { defineSpec } from '@seqlok/core';

export const createRegistrySpec = (maxDomains = 32) =>
  defineSpec(({ param, meter }) => ({
    id: 'system-registry',
    params: {
      // Written by SystemManager / orchestrator
      epochCounter: param.u32(),
      swapPending: param.u32(),
    },
    meters: {
      // Per-domain metadata arrays
      domainIds: meter.u32.array({ length: maxDomains }),
      domainGenerations: meter.u32.array({ length: maxDomains }),
      domainBytes: meter.u32.array({ length: maxDomains }),
      domainHealth: meter.u8.array({ length: maxDomains }),
    },
  }));
```

Usage in composition:

```ts
const composition = defineComposition((b) => ({
  id: 'example-system',
  domains: {
    registry: b.registry({ spec: createRegistrySpec() }),
    // ... other domains
  },
  rings: {
    system: b.ring({ capacity: 4096, schema: SystemCommandSchema }),
  },
  runtimes: {
    mainThread: {
      registry: 'controller', // SystemManager writes registry
      '*': 'observer',
    },
    workerA: {
      registry: 'observer',
    },
    workerB: {
      registry: 'observer',
    },
  },
}));
```

The registry remains SWMR:

- one controller (SystemManager's runtime),
- many observers.

---

## 5. Implementation Patterns (Conceptual)

### 5.1 Domain lifecycle inside `@seqlok/compose`

On the orchestrator side:

```ts
const plan = planLayout(domain.spec);
const backing = allocateShared(plan);
const handoff = buildHandoff(plan, backing);

const realizedDomain: RealizedDomain = {
  id: domainId,
  plan,
  backing,
  handoff,
};
```

Domains are owned centrally; runtimes never call `planLayout` or `allocateShared`.

### 5.2 Runtime initialization

`@seqlok/compose` builds a `RuntimeInitMessage` per runtime, using:

- `composition.runtimes` for roles,
- `RealizedDomain.handoff` for non-main runtimes,
- ring SABs + endpoint roles for producer/consumer ends.

Worker side (conceptual):

```ts
self.onmessage = (ev: MessageEvent<RuntimeInitMessage>) => {
  const { domains, rings } = ev.data;

  for (const d of domains) {
    if (d.role === 'processor' && d.handoff) {
      const received = receiveHandoff(d.handoff);
      const binding = bindProcessor(received);
      // store binding
    } else if (d.role === 'observer' && d.handoff) {
      const received = receiveHandoff(d.handoff);
      const obs = bindObserver(received);
      // store observer
    }
    // controller bindings on mainThread are created via bindMainThread adapter
  }

  for (const r of rings) {
    if (r.endpoint === 'producer') {
      const producer = attachCommandRingProducer(r.sab);
      producers.set(r.ringId, producer);
    } else {
      const consumer = attachCommandRingConsumer(r.sab);
      consumers.set(r.ringId, consumer);
    }
  }
};
```

### 5.3 System Lifecycle & Teardown

`RealizedSystem.dispose()` is responsible for clean shutdown:

1. Stop accepting new commands / mark rings closed, drain remaining items.
2. Flush buffered writes if applicable (e.g. metrics).
3. Dispose domain-local resources in dependency order.
4. Terminate workers / AudioWorklets via `RuntimeHandle.terminate()`.

`RuntimeHandle.onError()` allows runtimes to report unrecoverable errors back to `SystemManager`, which:

- aggregates them into `SystemHealth.runtimeErrors`,
- may surface them through the registry domain as well.

### 5.4 Composition Validation

`validateComposition` enforces:

- **single controller** per domain,
- **single processor** per domain,
- power-of-two ring capacities,
- no unknown domain references,
- optional orphan-domain detection.

(Implementation sketch same as previous revision; omitted here for brevity.)

### 5.5 Command Ring Endpoint Creation & Semantics

Command rings are **MPSC**:

- many producers, **exactly one consumer** per ring.

In `CompositionDescription`, ring **consumer** is implicitly the runtime that:

- is designated as the _hub_ for that ring in `@seqlok/compose` (typically where `SystemManager` lives), or
- is explicitly configured in composition metadata (future extension).

In v1:

- **default rule**: each ring’s consumer is the runtime where `SystemManager` runs (usually `mainThread`), unless a
  future ADR adds explicit per-ring consumer configuration.

`@seqlok/compose`:

- allocates each ring's SAB once on the orchestrator side,
- shares that SAB as:

  - producer endpoints in multiple runtimes,
  - a single consumer endpoint in exactly one runtime.

Validation ensures:

- at most one consumer endpoint per ring across all runtimes.

---

## 6. Invariants & Non-Goals for `@seqlok/compose`

**Invariants**

- Does not change `@seqlok/core` public surface or semantics.

- Does not introduce new backing types or memory primitives.

- Enforces:

  - at most one controller per domain per composition,
  - at most one processor per domain per composition,
  - at most one consumer per ring per composition.

- Command rings remain MPSC; `@seqlok/compose` does not "multiplex" consumers.

- Growth and swapping are expressed as **new `Handoff<S>` instances** plus `SwapTicket` semantics (ADR-002 / ADR-XXXX),
  never in-place SAB growth from this layer.

- Registry is a **normal Seqlok domain** with SWMR semantics.

- `bindObserver` is read-only and must never expose write APIs.

**Non-Goals**

- No UI framework integration (React/Vue/etc.) in `@seqlok/compose`.
- No domain-specific presets (Dekzer, agents, etc.) in `@seqlok/compose` itself.
- No generic "cluster orchestration" or cross-process distribution; this remains in-process (main + workers + Worklets).
- No new reactivity model (`subscribe`, etc.). Composition is about topology, lifecycle, and coordination, not reactive
  stores.

---

## 7. Benefits

1. **Clean layering** – core stays a “boring wire”; composition handles topology and runtime wiring.
2. **Declarative topology** – a single `defineComposition` call describes the entire system layout.
3. **Type-safe wiring** – domain keys, runtime roles, ring schemas, and growth policies are all typed end-to-end.
4. **Reusability** – Dekzer, agent swarms, and other runtimes can share the same composition machinery.
5. **Testability** – compositions are pure data; they can be validated and inspected without spawning threads.
6. **Lifecycle-safe** – `RealizedSystem.dispose()` enables clean teardown in tests and hot-reload loops.
7. **Growth-aware** – `SystemManager` integrates `SwapTicket`-based growth and swap sequences across domains.
8. **Production observability** – `getHealth()` and the registry pattern give an official place for topology and health
   introspection.
9. **Platform-friendly** – `PlatformAdapter` plus reference adapters make it practical to adopt in both browser and
   Node.

---

## 8. Summary

We introduce `@seqlok/compose` as the **macro composition layer** for Seqlok-based systems:

- `@seqlok/core` continues to handle **single-domain** SWMR memory wires.
- `@seqlok/command-ring` provides a common **intent bus** primitive.
- `@seqlok/compose` describes and realizes **systems of domains + rings + runtimes** via:

  - `defineComposition` – declarative topology,
  - `validateComposition` – structural invariants and error reporting,
  - `realizeComposition` – plans, backings, handoffs, and runtime initialization,
  - `SystemManager` – growth, swap, and health coordination built on ADR-002 / ADR-XXXX,
  - `RealizedSystem` – lifecycle, structure, and health snapshots.

This keeps core pristine while giving Dekzer and future agent runtimes a principled place to live their system-level
complexity—without ever compromising the SWMR guarantees at the primitive level.

---

## 9. Future Considerations

### 9.1 Multi-Composition Systems

Future work may support compositions-of-compositions for very large systems:

```ts
const superComposition = defineMetaComposition({
  subsystems: {
    audio: dekzerComposition,
    visuals: visualizerComposition,
    agents: agentComposition,
  },
  bridges: [
    // describe how domains/rings across subsystems are coupled
  ],
});
```

### 9.2 Composition Migrations

As specs evolve, we may need composition migration tools:

```ts
const migrated = migrateComposition(oldComposition, {
  version: '2.0',
  migrations: [
    // declarative transforms over domains/rings/runtimes
  ],
});
```

### 9.3 Development Tools

Composition introspection and visualization:

- DevTools extension showing domain/ring/runtime topology.
- Real-time ring throughput and drop-rate monitoring.
- Visual swap timeline for debugging growth operations.
- “Dry run” validation view that pretty-prints `validateComposition` errors for a given topology.
