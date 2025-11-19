# @seqlok/core

**Zero-copy, lock-free state synchronization for real-time systems.**

A typed shared-memory layer between a **Controller** (main/UI thread) and a **Processor** (Worker / AudioWorklet).
The Controller writes **params**, the Processor writes **meters** — both with atomic, coherent reads via a seqlock
protocol.

## Why Seqlok?

- **Zero allocations** – direct typed-array access over `SharedArrayBuffer`
- **Type-safe** – full TypeScript inference from spec through plan, backing, and bindings
- **Coherent reads** – readers never observe torn/partial state
- **Predictable** – deterministic memory layout, no hidden orchestration

```ts
// Define once, use everywhere
import { defineSpec } from '@seqlok/core';

export const spec = defineSpec(({ param, meter }) => ({
  id: 'synth',
  params: {
    cutoff: param.f32({ min: 20, max: 20_000 }),
  },
  meters: {
    level: meter.f32(),
  },
}));
```

---

## Install

```bash
pnpm add @seqlok/core
```

**Requirements:** ESM-only (Browser ≈2022+ / Node 20+), with `SharedArrayBuffer` enabled
(e.g. COOP/COEP headers in the browser, or a compatible runtime embedding).

---

## Quick Start

This example is shaped like a small audio engine:

- Controller lives on the main/UI thread.
- Processor lives in a Worker (or AudioWorklet) and reads params / writes meters.

### Step 1: Define your spec — `src/spec.ts`

```ts
import { defineSpec } from '@seqlok/core';

export const spec = defineSpec(({ param, meter }) => ({
  id: 'deck',
  params: {
    // Playback rate / time stretching
    timeRatio: param.f32({ min: 0.25, max: 4 }),

    // EQ bands / filter coefficients
    eqBands: param.f32.array({ length: 8 }),

    // Engine mode (e.g. normal vs granular time-stretch)
    mode: param.enum({ values: ['normal', 'granular'] }),
  },
  meters: {
    rms: meter.f32(),
    peak: meter.f32(),
    spectrum: meter.f32.array({ length: 1024 }),
    framesProcessed: meter.u32(),
  },
}));

export type DeckSpec = typeof spec;
```

### Step 2: Bind the controller — `src/main.ts`

```ts
import {
  planLayout,
  allocateShared,
  buildHandoff,
  bindController,
  type Handoff,
} from '@seqlok/core';
import { spec, type DeckSpec } from './spec';

const plan = planLayout(spec);
const backing = allocateShared(plan);
const controller = bindController(spec, backing);

const handoff: Handoff<DeckSpec> = buildHandoff(plan, backing);

// Worker; for AudioWorklet you would post `handoff` to the worklet instead.
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.postMessage({ type: 'handoff', handoff });

// Example: update playback params from UI
controller.params.update({
  timeRatio: 1.5,
  mode: 'granular',
});

controller.params.stage('eqBands', (view) => {
  for (let i = 0; i < view.length; i++) {
    view[i] = i < 4 ? -3 : +3; // simple low/high shelf sketch
  }
});

let lastVersion = 0;

function pollMeters() {
  const v = controller.meters.version();
  if (v !== lastVersion) {
    const { rms, peak, framesProcessed } = controller.meters.snapshot(
      'rms',
      'peak',
      'framesProcessed',
    );

    // Use meters for UI: deck HUD, level meters, debug overlays, etc.
    console.log('rms', rms, 'peak', peak, 'frames', framesProcessed);

    lastVersion = v;
  }

  requestAnimationFrame(pollMeters);
}

pollMeters();
```

### Step 3: Bind the processor — `src/worker.ts`

```ts
import {
  receiveHandoff,
  bindProcessor,
  type Handoff,
  type ProcessorBinding,
} from '@seqlok/core';
import type { DeckSpec } from './spec';

type InitMessage = {
  type: 'handoff';
  handoff: Handoff<DeckSpec>;
};

let processor: ProcessorBinding<DeckSpec> | undefined;

self.onmessage = (ev: MessageEvent<InitMessage>) => {
  if (ev.data.type !== 'handoff') return;

  const received = receiveHandoff(ev.data.handoff);
  processor = bindProcessor(received);
};

// In a real audio engine this would be called from your audio loop or
// from an AudioWorklet's process() callback. Here it's just a sketch.
function processAudioBlock() {
  if (!processor) return;

  processor.params.within((params) => {
    const { timeRatio, eqBands, mode } = params;

    // Tiny fake "DSP" use of params: mode and EQ influence a gain factor.
    const lowShelf = eqBands[0] ?? 0;
    const highShelf = eqBands[7] ?? 0;

    const modeGain = mode === 'granular' ? 0.8 : 1.0;
    const eqGain = 1 + (lowShelf + highShelf) * 0.01;
    const gain = modeGain * eqGain;

    const framesForBlock = Math.floor(128 * timeRatio);

    processor.meters.publish((writer) => {
      writer.rms(0.42 * gain);
      writer.peak(0.71 * gain);

      writer.stage('spectrum', (buf) => {
        for (let i = 0; i < buf.length; i++) {
          // Fake spectrum: alternate low/high magnitude scaled by gain.
          buf[i] = (i & 1 ? 0.25 : 1.0) * gain;
        }
      });

      writer.framesProcessed(framesForBlock);
    });
  });
}
```

---

## Memory Layout

Seqlok organizes memory into **planes** by type. Each plane is a typed view over a shared backing.

### Param planes

| Plane  | Types                                             | Usage                                        |
| :----- | :------------------------------------------------ | :------------------------------------------- |
| `PF32` | `param.f32`, `param.f32.array({ length })`        | Float32 params                               |
| `PI32` | `param.i32`, `param.i32.array({ length })`, enums | Int32 params + enum indices                  |
| `PB`   | `param.bool`, `param.bool.array({ length })`      | Boolean params as `0/1` bytes (`Uint8Array`) |
| `PU`   | —                                                 | Param seqlock control `[LOCK, SEQ]`          |

### Meter planes

| Plane  | Types                                      | Usage                                       |
| :----- | :----------------------------------------- | :------------------------------------------ |
| `MF32` | `meter.f32`, `meter.f32.array({ length })` | Float32 meters                              |
| `MF64` | `meter.f64`, `meter.f64.array({ length })` | Float64 meters                              |
| `MU32` | `meter.u32`, `meter.bool`                  | Uint32 meters, bool meters as `0/1` numbers |
| `MU`   | —                                          | Meter seqlock control `[LOCK, SEQ]`         |

Bindings precompute indices from byte offsets; normal user code never touches raw offsets.

---

## Benchmarks

Seqlok ships with micro- and scenario-level benchmarks:

```bash
pnpm bench
```

This runs Vitest benchmarks for primitives (seqlock) and real-world parameter operations and writes a JSON report to:

```text
packages/core/bench-results.json
```

These are intended as **internal guardrails** for regressions (e.g. seqlock tweaks, backing layout changes), not as
marketing numbers.

---

## Diagnostics & Health

Seqlok has a dedicated diagnostics lane and a health lens on top of the error registry. This layer is **optional** and \*
\*edge-only\*\*: it is meant for stress tests, soak runs, CLIs, and dev tools, not for hot paths.

Key pieces:

- `errors/registry` – domain-scoped codes + `ErrorMeta` (severity, recoverable, safeToExpose, docsUrl)
- `errors/health` – `interpretHealth(meta)` → `HealthInterpretation` (`fatal` / `error` / `warning` + label + hint)
- `diagnostics/*` – counters, sessions, export, and helpers
- `diagnostics/run-with-health` – wraps a scenario in a diagnostics + health envelope

### Golden pattern: run a stress scenario with diagnostics

```ts
// Internal helper; not exported from the public @seqlok/core API surface.
import { runWithDiagnostics } from './src/diagnostics/run-with-health';

async function runDeckLoadAndScrubScenario(): Promise<void> {
  // Real bindings, real spec/plan/backing, real work.
  // e.g. load two decks, scrub, rate-ramp, etc.
}

async function main(): Promise<void> {
  const result = await runWithDiagnostics(
    async () => {
      await runDeckLoadAndScrubScenario();
    },
    {
      scenarioId: 'stress:deck-load-and-scrub',
      metadata: {
        decks: 2,
        durationMs: 30_000,
      },
      thresholds: {
        degradedSnapshots: 100,
        spinBudgetExhausted: 1_000,
        retryBudgetExhausted: 100,
      },
    },
  );

  // 1) Health view over any SeqlokError
  if (result.error !== undefined && result.health !== undefined) {
    // result.health.status: 'fatal' | 'error' | 'warning'
    // result.health.label / result.health.hint: operator-facing summary
    if (!result.boundarySafe) {
      // Keep this inside the current trust boundary (no remote logs).
      console.error('[seqlok][internal]', result.error, result.health);
      return;
    }
  }

  // 2) Threshold violations over diagnostics counters
  if (result.thresholdViolations.length > 0) {
    for (const violation of result.thresholdViolations) {
      console.warn(
        `[seqlok][diagnostics] ${violation.metric} = ${violation.actual} (max ${violation.threshold})`,
      );
    }
  }

  // 3) Exportable snapshot for logs / bug reports / tooling
  // Includes a timestamp and all diagnostics counters.
  console.log(result.diagnosticsExportJson);
}

void main();
```

This pattern gives you, in one call:

- a **typed error + health view** (`result.error`, `result.health`, `result.boundarySafe`),
- a **diagnostics snapshot** (`result.diagnosticsCounters`, `result.thresholdViolations`),
- and an **exportable artefact** (`result.diagnosticsExportJson`) you can send to logs, CLIs, or external tools —

without wiring diagnostics or health into the core hot path.

---

## Documentation

Seqlok's design is documented in depth. This is the recommended reading order.

### Core concepts (start here)

- [E2E Flow – Visual Guide](docs/architecture/16-seqlok-e2e-flow-visual-guide.md)
  High-level mental model of the `spec → plan → backing → handoff → bindings` pipeline.
- [Concurrency Model & Roles](./docs/architecture/03-seqlok-concurrency-model-and-roles.md)
  Controller vs Processor, params vs meters, and coherence guarantees.
- [DSL Overview & Rationale](./docs/architecture/04-seqlok-dsl-overview-and-rationale.md)
  How to define state with `defineSpec`.
- [API Reference](./docs/architecture/09-seqlok-api-reference.md)
  Canonical reference for all public functions and types.

### Architectural rationale (the "why")

- [Origin & Design History](./docs/architecture/00-seqlok-origin-and-design-history.md)
- [Goals & Non-Goals](./docs/architecture/01-seqlok-goals-and-non-goals.md)
- [Intellectual Heritage](./docs/architecture/02-seqlok-intellectual-heritage.md)
- [Object Model Rationale](./docs/architecture/06-object-model-rationale.md)
- [API Shape Rationale](./docs/architecture/07-seqlok-api-shape-rationale.md)
- [API & Naming Rationale](./docs/architecture/08-seqlok-api-and-naming-rationale)

### Coherence & memory model

- [Primitives & Seqlock](./docs/architecture/10-seqlok-primitives-and-seqlock.md)
- [Backing & Plane Layout](./docs/architecture/11-seqlok-backing-and-plane-layout.md)
- [Coherent Reads & Planes](./docs/architecture/12-coherent-reads-and-planes.md)
- [Implementation Notes (Kernel)](./docs/architecture/13-implementation-notes-kernel.md)

### Deep dives

- [Enum Arrays – Schema vs Runtime](./docs/architecture/05-enum-arrays-runtime-behavior.md)
- [ABA/Wraparound: Not a Bug](./docs/architecture/14-seqlok-aba-wraparound-not-a-bug.md)
- [Error System & Fail-Fast Philosophy](./docs/architecture/15-seqlok-error-system-and-fail-fast-philosophy.md)

### Reference & ADRs

- [API Reference](./docs/architecture/09-seqlok-api-reference.md)
- [ADR-2025-11-12 — Meter Writes & Snapshot `into`](docs/adr/ADR-00C-meter-writes-and-snapshot-into.md)

---

## License

MIT
