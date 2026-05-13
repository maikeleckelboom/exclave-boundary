# Seqlok

Seqlok is a deterministic shared-memory contract system for timing-sensitive, multithreaded engines.

It gives you:

- structured spec authoring for params and meters
- deterministic memory planning
- explicit shared backing allocation
- explicit handoff across trust boundaries
- role-specific bindings for controller, processor, and observer
- lock-free SWSR command rings

> Seqlok does **not** encode product concepts like decks, tracks, BPM, transport rules, or cues. Those belong in application code built on top of the substrate.

Audio and DSP are the first clients, but the model is broader than audio. It fits any system where a hot path must cross a runtime boundary without torn state, hidden layout, or ad hoc memory contracts.

---

## Canonical core flow

Everything in `@seqlok/core` centers on one explicit flow:

`defineSpec -> planLayout -> allocateShared / allocateSharedPartitioned / allocateWasmShared -> buildHandoff -> acceptHandoff -> bindController / bindProcessor / bindObserver`

`keysOf(spec)` exists too, but it is ergonomic sugar. It projects canonical runtime keys back into the authored shape. It is not part of runtime identity.

---

## Minimal example

```ts
import {
  acceptHandoff,
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  keysOf,
  planLayout,
} from "@seqlok/core";

export const deckSpec = defineSpec(({ param, meter }) => ({
  id: "deck",
  params: {
    playback: {
      rate: param.f32({ min: 0.5, max: 2 }),
    },
    mixer: {
      volume: param.f32({ min: 0, max: 1 }),
    },
  },
  meters: {
    output: {
      level: meter.f32(),
    },
  },
}));

export const deckKeys = keysOf(deckSpec);

const plan = planLayout(deckSpec);
const backing = allocateShared(plan);

const controller = bindController(deckSpec, plan, backing);
const handoff = buildHandoff(plan, backing);

controller.params.set(deckKeys.params.playback.rate, 1);
controller.params.update({
  [deckKeys.params.mixer.volume]: 0.8,
});

const accepted = acceptHandoff(handoff);
const processor = bindProcessor(accepted);

processor.params.within((params) => {
  const rate = params[deckKeys.params.playback.rate];
  const gain = params[deckKeys.params.mixer.volume];
  processAudioBlock(rate, gain);
});

processor.meters.publish((writer) => {
  writer.set(deckKeys.meters.output.level, computeLevel());
});
```

---

## Packages

- `@seqlok/core`  
  Specs, layout planning, shared backing, handoff, and bindings.
- `@seqlok/primitives`  
  Low-level synchronization and memory primitives.
- `@seqlok/commands`  
  Lock-free command-ring substrate.
- `@seqlok/streambuf`  
  Stream-oriented shared-buffer utilities.
- `@seqlok/worklet-mount`  
  Worklet mounting and runtime integration helpers.

---

## Documentation

- [Developer CLI guide](docs/developer-cli.md)
- [Core package docs](packages/core/README.md)
- Additional technical documentation lives under [docs/](./docs)

---

## License

See the repository license for current licensing terms.
