# Seqlok Boundary Substrate R&D

Status: Engineering artifact. R&D prototype. Release held deliberately.

This repository preserves the first Seqlok boundary-substrate implementation: a typed shared-memory prototype for systems where a soft host side coordinates with timing-sensitive runtime work. It demonstrates authored contracts, deterministic layout planning, shared backing allocation, coherent reads, explicit handoff artifacts, and role-specific bindings across a runtime boundary.

This is not an npm release target. The preserved prototype package is private and named `@seqlok-internal/prototype-core`. The future Seqlok name remains reserved for a cleaner public extraction.

## Prototype Showcase

The example below shows the preserved prototype flow inside this repository. It models an audio/DSP lane where a host controller writes transport and EQ params, then a timing-sensitive processor reads a coherent param view and publishes output meters.

### Authored Spec

```ts
import { defineSpec } from "@seqlok-internal/prototype-core";

export const transportModes = ["stopped", "playing", "scrub"] as const;

export const audioEngineSpec = defineSpec(({ param, meter }) => ({
  id: "audio-engine/control-plane",
  params: {
    "transport.timeRatio": param.f32({ min: 0.25, max: 4 }),
    "transport.mode": param.enum(transportModes),
    "mixer.eqBands": param.f32.array(8),
  },
  meters: {
    "output.rms": meter.f32(),
    "output.peak": meter.f32(),
    "engine.framesProcessed": meter.u32(),
  },
}));
```

### Host / Controller Side

```ts
import {
  allocateShared,
  bindController,
  buildHandoff,
  planLayout,
} from "@seqlok-internal/prototype-core";

import { audioEngineSpec } from "./audio-engine-spec";

export function connectAudioEngine(audioWorkletNode: AudioWorkletNode) {
  const plan = planLayout(audioEngineSpec);
  const backing = allocateShared(plan);
  const controller = bindController(audioEngineSpec, plan, backing);
  const handoff = buildHandoff(plan, backing);

  audioWorkletNode.port.postMessage({
    type: "seqlok-handoff",
    handoff,
  });

  controller.params.update({
    "transport.timeRatio": 1.0,
    "transport.mode": "playing",
  });

  controller.params.stage("mixer.eqBands", (bands) => {
    bands.set([0, -1.5, 0.5, 1, 0, -0.5, 0, 0.75]);
  });

  const output = controller.meters.snapshot([
    "output.rms",
    "output.peak",
    "engine.framesProcessed",
  ]);

  return { controller, handoff, output };
}
```

### Processor / Runtime Side

```ts
import {
  bindProcessor,
  receiveHandoff,
  type Handoff,
} from "@seqlok-internal/prototype-core";

import { audioEngineSpec, transportModes } from "./audio-engine-spec";

const PLAYING_MODE = transportModes.indexOf("playing");

let processor: ReturnType<typeof createProcessor> | undefined;
let framesProcessed = 0;

function createProcessor(handoff: Handoff<typeof audioEngineSpec>) {
  const received = receiveHandoff(handoff);
  return bindProcessor(received);
}

export function attachHandoff(handoff: Handoff<typeof audioEngineSpec>): void {
  processor = createProcessor(handoff);
}

export function processBlock(input: Float32Array): void {
  if (!processor) {
    return;
  }

  let timeRatio = 1;
  let isPlaying = false;
  let eqTilt = 0;

  processor.params.within((params) => {
    timeRatio = params["transport.timeRatio"];
    isPlaying = params["transport.mode"] === PLAYING_MODE;

    const bands = params["mixer.eqBands"];
    for (let i = 0; i < bands.length; i++) {
      eqTilt += bands[i] ?? 0;
    }
  });

  const gain = isPlaying ? Math.min(2, timeRatio * (1 + eqTilt * 0.01)) : 0;
  let sumSquares = 0;
  let peak = 0;

  for (const sample of input) {
    const value = sample * gain;
    sumSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
  }

  framesProcessed += input.length;

  processor.meters.publish((meters) => {
    meters.set("output.rms", Math.sqrt(sumSquares / Math.max(1, input.length)));
    meters.set("output.peak", peak);
    meters.set("engine.framesProcessed", framesProcessed);
  });
}
```

## What This Proves

- Authored TypeScript contracts drive layout and binding types without runtime string registries.
- `planLayout` turns the authored spec into a deterministic shared-memory plan consumed by allocation and bindings.
- `buildHandoff` and `receiveHandoff` make the runtime-boundary artifact explicit instead of relying on ambient process state.
- The controller writes params through scalar and staged array APIs, while the processor reads a coherent param view inside one critical section.
- The processor publishes meters back to the host through the meter plane, preserving separate write/read roles across the boundary.

## Current Package and Status Notes

- `@seqlok-internal/prototype-core` is the preserved private prototype package for specs, layout planning, shared backing, handoff, diagnostics, benchmarks, and bindings.
- The repository is public as engineering evidence, not as the final public API.
- This repository is not an npm release target.
- The vocabulary around controller, processor, observer, params, and meters is preserved prototype vocabulary. It should not be read as final public Seqlok doctrine.

## Future Seqlok Direction

The future Seqlok name remains reserved for a cleaner boundary-substrate extraction around:

- layout
- core publications
- commands
- lineage
- invalidation
- host/runtime integration

Browser support and future Electron compatibility remain proof constraints for that extraction. The future public package or repository may use the clean Seqlok name; this repository deliberately does not.

## Documentation

- [Prototype core package docs](packages/core/README.md)
- [Prototype design docs](packages/core/docs/INDEX.md)
- Additional technical documentation lives under [packages/core/docs](packages/core/docs)
