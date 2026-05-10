# Seqlok

Seqlok is a real-time shared-state substrate for low-latency, multithreaded engines.

It provides:

- Param and meter bindings over SharedArrayBuffer with seqlock-style coherence
- Lock-free SWSR command rings for cross-thread control
- A generic engine swap protocol (spawn, prime, prewarm, crossfade, retire)

> The Seqlok packages do **not** encode concepts like audio, decks, BPM, tracks or cues.  
> Those concerns live in application code built on top of this substrate.

Audio and DSP are the first clients. The primitives are designed to work equally well for
GPU simulations, live video pipelines, physics engines or any system that needs
glitch-free transitions between stateful processors.

---

## Canonical core API

Everything in `@seqlok/core` revolves around a single shared-state flow:

`defineSpec -> planLayout -> allocateShared / allocateSharedPartitioned / allocateWasmShared -> buildHandoff -> acceptHandoff -> bindController / bindProcessor / bindObserver`

### 1. Define a spec (range-only DSL)

```ts
import { defineSpec } from "@seqlok/core";

export const deckSpec = defineSpec(({ param, meter }) => ({
  params: {
    playbackRate: param.f32({ min: 0.5, max: 2 }),
    volume: param.f32({ min: 0, max: 1 }),
  },
  meters: {
    position: meter.f32(),
    level: meter.f32(),
  },
}));
```

### 2. Plan layout and allocate backing

```ts
import {
  planLayout,
  allocateShared,
  buildHandoff,
  type Handoff,
} from "@seqlok/core";
import { deckSpec } from "./deckSpec";

const plan = planLayout(deckSpec);
const backing = allocateShared(plan);

const handoff: Handoff = buildHandoff(plan, backing);
```

### 3. Receive the handoff and bind roles

```ts
import {
  acceptHandoff,
  bindController,
  bindProcessor,
  bindObserver,
} from "@seqlok/core";
import type { SpecInput } from "@seqlok/core";

import type { Handoff } from "./topology-types";

const incomingHandoff: Handoff;

const shared = acceptHandoff(incomingHandoff);

const controller = bindController(shared);
const processor = bindProcessor(shared);
const observer = bindObserver(shared);
```

### 4. Controller: write params, read meters

```ts
controller.params.set("playbackRate", 1);
controller.params.update({ volume: 0.8 });

const metersSnapshot = controller.meters.snapshot();
const level = metersSnapshot.level;
```

### 5. Processor: read params, publish meters

```ts
processor.params.within((view) => {
  const rate = view.playbackRate;
  const gain = view.volume;
  processAudioBlock(rate, gain);
});

processor.meters.publish((w) => {
  w.set("position", computePosition());
  w.set("level", computeLevel());
});
```

### 6. Observer: read-only view

```ts
const paramsSnapshot = observer.params.snapshot();
const metersSnapshot = observer.meters.snapshot();

const currentRate = paramsSnapshot.playbackRate;
const currentLevel = metersSnapshot.level;
```

---

## Documentation

- [Developer CLI guide](docs/developer-cli.md) for workspace scripts, dev flow and verification pipeline
- Additional technical documentation lives under [docs/](./docs)
