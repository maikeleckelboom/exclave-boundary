# Exclave Boundary Signalsmith Stretch — Current Implementation Specification

- **Status:** current implementation authority for the demo/proof; not package API authority
- **Date:** 2026-06-29
- **Product:** Signalsmith Stretch
- **Boundary package:** `@exclave/boundary`
- **Repository:** `maikeleckelboom/exclave-boundary`
- **Supersedes:** `Seqlok v0 Signalsmith Stretch Proof — Final Implementation Specification.md` for demo/proof planning only
- **Preserves:** the product thesis, runtime proof intent, Signalsmith adapter direction, waveform/A-B/output-level requirements, failure model, and staged delivery discipline from the original Seqlok document

---

## 0. Current update

This document updates the old Seqlok Signalsmith Stretch proof specification to the current Exclave Boundary reality.

The original document remains valuable as the product and runtime proof source. Its package architecture is obsolete.

This document describes how a private Signalsmith Stretch demo/proof should use the current package. The package API itself remains governed by the `@exclave/boundary` source, tests, release docs, and public documentation.

The old document assumed a future package and package-subpath architecture that is no longer the active release path.

The active release path is:

```text
@exclave/boundary
```

`@exclave/boundary` is the public package. It currently exposes the role-based boundary API that the demo must use rather than redesign:

```ts
import {
  acceptHandoff,
  allocatePacked,
  allocatePartitioned,
  allocateWasm,
  bindController,
  bindObserver,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  verifyHandoff,
  BoundaryError,
  isBoundaryError,
} from "@exclave/boundary";
```

The demo must therefore sit **on top of** Exclave Boundary. It must not pull the package back toward the old prototype reset architecture.

### 0.1 Current authority order

1. Current `@exclave/boundary` package surface and tests.
2. This updated specification, for Signalsmith Stretch demo/proof work only.
3. Original Seqlok Signalsmith Stretch proof document, for product/runtime requirements only.
4. Implementation tests.
5. Source code.

### 0.2 Terms

| Old term in source document | Current term |
| --- | --- |
| Seqlok | Exclave Boundary, except in historical notes |
| old prototype package name | `@exclave/boundary` |
| old prototype package subpaths | Current `@exclave/boundary` public API surface |
| Seqlok proof path | Exclave Boundary proof path |
| Seqlok publication | Exclave Boundary param/meter or publication-like boundary flow, depending on current package API |
| Seqlok command queue | Demo-private command transport using current SWSR primitives, if required |
| Seqlok meter | Product-level output-level publication/display; do not call it a package “meter” unless referring to current API meters |
| Seqlok prototype | Historical source/prototype name |
| seqlock | Keep as the real synchronization primitive term |

### 0.3 Hard corrections from the old document

The following old positions are now superseded:

1. **Do not implement a new public package under the old prototype name.** The package is `@exclave/boundary`.
2. **Do not implement old prototype package subpaths.** The current package already exposes its chosen surface.
3. **Do not run the old Stage 0/1A prompt.** It bans `controller`, `processor`, `observer`, `params`, `meters`, and `Handoff`, which are current public API concepts.
4. **Do not use the old export firewall as current authority.** The current package intentionally exports role bindings, params/meters types, handoff, diagnostics, and SWSR primitives.
5. **Do not publish a public Signalsmith adapter yet.** The Signalsmith adapter remains demo-private until the proof earns a package boundary.
6. **Do not claim zero-copy audio.** The proof targets deterministic ownership, bounded control/status, and no per-quantum metadata messaging.
7. **Do not overfit the name or docs to AudioWorklet.** Audio is the first and clearest proof. Exclave Boundary remains a general typed shared-memory boundary substrate for timing-sensitive systems.

### 0.4 Runtime policy

The local audible dev path prepares the generated module and starts Vite in
real-adapter mode:

```sh
pnpm install
pnpm signalsmith:dev
```

The clean-checkout validation path is simulator-first:

```sh
pnpm signalsmith:build
pnpm signalsmith:check
pnpm signalsmith:test:browser
```

Those commands run `apps/signalsmith-stretch` through the private package
`@exclave/signalsmith-stretch`. The default dev command requires the local
real-adapter toolchain because it prepares the generated module before serving.
The simulator dev server is still available explicitly:

```sh
pnpm signalsmith:dev:simulator
```

The tracked vendor files are enough for provenance checks and for building the
real adapter on a machine with Emscripten, but the generated module is not
committed. Real adapter generation remains an explicit step in validation
because it requires external Emscripten tooling:

```sh
pnpm signalsmith:prepare
pnpm signalsmith:test:browser:real
```

`pnpm signalsmith:prepare` runs the vendor/provenance refresh and then builds
`generated/signalsmith-stretch.module.js`. `pnpm signalsmith:test:browser:real`
runs the browser smoke with Vite in `real-adapter` mode. Without that opt-in,
build and the default browser smoke stay on the clean-checkout simulator path.

Root `pnpm verify` includes `pnpm signalsmith:check`, so the proof app's lint,
typecheck, and unit tests are part of root validation. Browser smoke remains a
separate gate because it requires Chrome and browser audio/Worklet conditions.

Raw upstream mirrors under `apps/signalsmith-stretch/vendor/**` and mirrored
third-party README files under `apps/signalsmith-stretch/third_party/**` keep
their upstream whitespace. The repository records that policy in
`.gitattributes`; run `pnpm check:diff-whitespace` for the branch whitespace
gate.

---

## 1. Executive verdict

Signalsmith Stretch is still the right mind-blowing demo.

The demo is a desktop-first browser audio product for loading a local track, navigating a waveform, stretching time independently of pitch, editing a loop, comparing processed output with a source-aligned reference, inspecting latency and applied state, and observing processed-output RMS, peaks, and full-scale events.

It is materially superior to the official Signalsmith demo when it proves:

- trustworthy waveform navigation;
- frame/position-aware seek and loop behavior;
- source-aligned A/B instead of misleading original/processed toggles;
- explicit desired versus applied state;
- visible latency and buffer readiness;
- persistent runtime diagnostics;
- coherent processed-output level facts;
- recoverable browser/runtime failures;
- keyboard-accessible operation;
- no ordinary hot-path state crossing via `MessagePort`.

The integration route remains a custom private Signalsmith C++/WASM/AudioWorklet adapter. The official Signalsmith web package remains an oracle, smoke path, and audible comparison reference. It is not the canonical runtime bundle.

The first implementation slice may use a demo-private fake/stretch simulator to prove the Exclave Boundary integration before the full custom WASM adapter exists.

### 1.1 The core promise

> Load a local track, change duration and pitch independently, navigate and loop musically, compare against the same source-time position, and see what the runtime actually applied.

### 1.2 Non-goals

The demo does not attempt to become:

- a DAW;
- a generic audio framework;
- a plugin host;
- a generic shared-memory playground;
- a public Signalsmith SDK;
- a public Worklet/WASM adapter package;
- a public stream-buffer package;
- a live-input processor;
- an offline renderer.

---

## 2. What the old spec still contributes

The following original conclusions remain load-bearing:

1. The official Signalsmith package is useful but not enough. It owns the worklet, scheduling, MessagePort protocol, buffers, and WASM lifetime, so it cannot prove the Exclave Boundary runtime path.
2. The true proof path is a custom Signalsmith adapter that reaches the actual realtime boundary.
3. The output-level probe must be separate from the stretch runtime status writer. Engine status and processed-output levels are separate status surfaces.
4. The browser render quantum must be read dynamically. A permanent 128-frame assumption is invalid.
5. An uncaught AudioWorklet error permanently silences the node. Recovery requires creating a fresh node/session.
6. SharedArrayBuffer requires secure context and cross-origin isolation.
7. The first playback model is whole-file decoded, immutable planar `Float32` PCM with adapter-private random access.
8. Seek, reset, transport, loop commits, flush, and destroy are ordered lifecycle operations.
9. Rate, pitch, tonality, and formant controls are latest-state controls.
10. Quality configuration is cold. It rebuilds or replaces the adapter session rather than mutating active render configuration.
11. The product must expose pending versus applied state.
12. The product must expose recoverable errors and retained safe state.
13. The proof must preserve realtime-path discipline: no allocations, promises, string construction, dynamic typed views, unbounded loops, or `Atomics.wait` in the render callback.

---

## 3. Current Exclave Boundary mapping

### 3.1 Current package flow

The demo should use the current package flow directly:

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    // host-owned desired/control state
  },
  meters: {
    // runtime/probe-owned status facts
  },
}));

const plan = planLayout(spec);
const backing = allocatePacked(plan);

const controller = bindController(spec, plan, backing);
const handoff = buildHandoff(plan, backing);
const accepted = acceptHandoff(handoff);
const processor = bindProcessor(accepted);
const observer = bindObserver(accepted);
```

`controller` models the host/product writer side.

`processor` models the timing-sensitive runtime side.

`observer` models UI/status inspection that should read without becoming an authority.

### 3.2 Proof surfaces

The demo should define separate boundary surfaces rather than one overloaded megaspec.

#### Desired stretch state

- Writer: host/controller.
- Reader: stretch runtime/processor.
Purpose: latest hot control state.

Fields:

| Field | Kind | Meaning |
| --- | --- | --- |
| `desiredSequence` | `u32` or pair-backed sequence field until true u64 exists | Host-monotonic acknowledgement identity |
| `rate` | `f32` or `f64` according to package support | Source frames per output frame |
| `pitchSemitones` | `f32` | Independent transpose |
| `tonalityEnabled` | `u32` or `bool` | Tonality processing flag |
| `tonalityHz` | `f32` | Tonality limit, 2000-20000 Hz |
| `formantSemitones` | `f32` | Independent voice/formant shift, -12 to 12 st |
| `formantCompensation` | `u32` or `bool` | Engine compensation flag |
| `formantBaseHz` | `f32` | Zero for Auto; manual voice base clamps to 50-500 Hz |
| `transitionFrames` | `u32` | Reserved for future hot-control smoothing; not currently read by the Worklet |

The first demo slice may use current numeric kinds only. If the current package does not support true `u64` fields, do not redesign the package. Use a documented pair or `u32` sequence for the demo.

#### Runtime status

- Writer: stretch runtime/processor or fake simulator.
- Reader: UI/observer.
Purpose: applied state, timing, status, queue pressure, and failures.

Field groups:

- identity/session/generation/continuity where current API can represent them;
- engine state;
- last error code;
- last applied desired sequence;
- last applied command sequence;
- output frame;
- source frame;
- processing center frame;
- active/paused/seeking/flushing/ended state;
- loop enabled/start/end/revision;
- buffer readiness;
- underrun/stale/invalid totals;
- max observed render quantum.

#### Processed output levels

- Writer: output-level probe or fake simulator.
- Reader: UI/observer.
Purpose: processed-output RMS, peak, full-scale, invalid-sample, and probe state facts.

Fields:

| Field | Kind | Meaning |
| --- | --- | --- |
| `windowEndOutputFrame` | sequence/pair if needed | Exclusive processed-output frame at window end |
| `windowFrames` | `u32` | Number of frames in the RMS/peak window |
| `channelCount` | `u32` | 0, 1, or 2 |
| `rmsLeft` | `f32` | Linear RMS |
| `rmsRight` | `f32` | Linear RMS, zero for mono |
| `peakLeft` | `f32` | Max absolute finite sample |
| `peakRight` | `f32` | Max absolute finite sample, zero for mono |
| `fullScaleLeftTotal` | sequence/pair if needed | Cumulative count of `abs(sample) >= 1` |
| `fullScaleRightTotal` | sequence/pair if needed | Same for right channel |
| `invalidSampleTotal` | sequence/pair if needed | Cumulative non-finite samples replaced by zero |
| `unsupportedChannelBlockTotal` | sequence/pair if needed | Unexpected channel blocks |
| `silent` | `u32` or `bool` | Completed RMS window classified as silence |
| `probeState` | `u32` | Uninitialized, ready, active, no-input, failed |
| `lastErrorCode` | `u32` | Probe error |

### 3.3 Commands

The original spec describes ordered command queues. Current `@exclave/boundary` exports SWSR ring primitives, but the demo should keep command vocabulary demo-private.

Allowed in demo-private code:

- command IDs for play/pause, seek, reset, loop commit, flush, destroy;
- fixed-width payload structs;
- bounded SWSR queue wrappers over current primitives;
- drop-newest overflow facts;
- stale sequence/continuity rejection in the simulator/adapter.

Not allowed in the public package during this demo work:

- new public Signalsmith command package;
- new public Worklet helper package;
- generic command bus revival;
- product command names exported from `@exclave/boundary`.

---

## 4. Product specification

### 4.1 Runtime state vocabulary

The product state machine remains:

```text
unsupported
  -> idle
  -> reading-file
  -> decoding
  -> analysing-waveform
  -> allocating-pcm
  -> attaching-runtime
  -> publishing-descriptors
  -> ready-paused
  -> playing
  -> seeking
  -> flushing
  -> ended
  -> failed-recoverable | failed-terminal
```

`Ready` means:

- shared-memory attachment succeeded;
- runtime or simulator initialized;
- the complete PCM source or simulated source extent is accepted;
- desired state has an applied acknowledgement;
- status and output-level surfaces are readable;
- the `AudioContext` may still require a user gesture before sound can begin.

### 4.2 User journeys

| Journey | Required behavior |
| --- | --- |
| Load a file and hear or simulate processed audio | Decode/load path shows progress, metadata, memory size, ready state, and retained safe old source on failure. |
| Change rate without changing pitch | Desired value updates immediately; applied value changes only after runtime acknowledgement. |
| Change pitch without changing duration | Pitch control maps independently of rate and appears in applied status. |
| Adjust tonality/formant-like controls | Product-space controls map to runtime desired state and applied status. |
| Seek while playing | Requested target appears as ghost; solid playhead updates only after applied acknowledgement. |
| Create and audition a loop | Local preview is separate from committed applied loop. Invalid ranges remain local and explain why. |
| Compare processed and aligned source | Both paths represent the same output-frame/source-map position; the UI states when source reference is varispeed. |
| Inspect latency and applied state | Inspector shows source/session identity, desired/applied sequence, frames, latency estimates, and queue/error facts. |
| Observe output levels and clipping | RMS/peak/full-scale facts are separate from the A/B selection and persist across UI stalls. |
| Recover from failure | Failure is persistent, coded, recoverable where possible, and never reuses a permanently failed worklet node. |

### 4.3 Desktop-first layout

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Signalsmith Stretch                         Source / Help / Inspector   │
├────────────────────────────────────────────────────────────────────────────┤
│ Load/drop surface or file metadata: name · duration · channels · rate · MB │
├────────────────────────────────────────────────────────────────────────────┤
│ Waveform overview                                                          │
│ ┌────────────────────────────────────────────────────────────────────────┐ │
│ │ loop start      applied playhead      requested seek       loop end     │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│ zoom · current time / duration · loop start/end/duration                    │
├────────────────────────────────────────────────────────────────────────────┤
│ Play/Pause · Stop · Loop · Loop start · Processed / Aligned source          │
├───────────────────────────┬───────────────────────────┬────────────────────┤
│ Timing & pitch            │ Tone & formants           │ Processed output    │
│ Rate                      │ Tonality                  │ RMS / peak dBFS     │
│ Pitch shift               │ Formant shift             │ L/R or mono         │
│                           │ Compensation · Base       │ Full-scale latch    │
├───────────────────────────┴───────────────────────────┴────────────────────┤
│ Quality: Standard / Lower CPU / Custom       Advanced engine configuration │
├────────────────────────────────────────────────────────────────────────────┤
│ Engine · buffer · input/output latency · applied state · diagnostics       │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 First visual slice

The first demo slice should be impressive even before real Signalsmith WASM lands.

It must include:

- branded Exclave Boundary + Signalsmith Stretch shell;
- local file drop/chooser surface;
- decoded metadata mock/real display;
- waveform overview panel;
- requested seek ghost and applied playhead;
- transport buttons;
- loop preview handles;
- rate and pitch controls;
- tonality/formant-like controls;
- processed/aligned source selector;
- processed output RMS/peak/full-scale display;
- runtime inspector with desired/applied sequence;
- persistent error/status area;
- “simulation mode” badge if the real adapter is not yet active.

The first slice must be truthful. If it simulates audio/runtime behavior, say so clearly in the UI and docs.

---

## 5. Runtime topology

### 5.1 Final processed path

```text
decoded planar PCM
  -> custom Signalsmith AudioWorklet node
  -> adapter-private output-level-probe node
  -> browser product routing
  -> AudioDestinationNode
```

### 5.2 A/B graph

```text
                           ┌─ processed output
shared planar PCM          │    -> OutputLevelProbe
        │                  │    -> processed GainNode ─┐
        v                  │                            │
custom Signalsmith node ───┤                            ├─> destination
                           │                            │
                           └─ aligned-source output     │
                                -> source GainNode ─────┘
```

The output-level probe always measures the processed branch before A/B gain. Selecting aligned source does not rename or reinterpret the processed-output publication.

### 5.3 First-slice simulator topology

```text
UI/controller
  -> desired stretch state backing
  -> fake/stretch simulator processor
  -> runtime status backing
  -> processed output levels backing
  -> observer/UI snapshots
```

The simulator should model:

- applied sequence;
- pending state;
- source frame;
- output frame;
- rate accumulation;
- play/pause/seek/loop status;
- fake RMS/peak/full-scale counters;
- recoverable errors;
- stale/pending behavior.

It does not need real audio processing.

---

## 6. Signalsmith adapter contract, deferred until after demo slice 1

The real adapter remains the long-term proof path.

It must eventually:

- pin Signalsmith source commit and artifact hashes;
- compile a private C++/WASM ABI;
- disable WASM memory growth;
- instantiate in an adapter-private AudioWorklet runtime;
- preallocate all slabs and typed views;
- avoid ordinary MessagePort control/status traffic;
- perform no render-path allocation after prewarm;
- publish runtime status and output-level facts through Exclave Boundary surfaces;
- use official Signalsmith package as oracle and smoke reference only.

No public adapter package is created in the first demo slice.

---

## 7. Failure and safety model

The old failure matrix remains valid as product ambition. The first demo slice should implement a smaller but real subset:

| Failure | First-slice requirement |
| --- | --- |
| SAB unavailable | Unsupported state with clear guidance. |
| Cross-origin isolation missing | Unsupported state with header guidance. |
| File decode failure | Inline recoverable error; previous source retained. |
| Invalid channel count | Reject more than two channels. |
| Oversized decoded PCM | Preflight before activation. |
| Pending state timeout | UI shows pending/stale rather than pretending applied. |
| Simulated runtime fault | Persistent error with reset/rebuild action. |
| Busy/stale read | Keep previous accepted display, marked as not newly read. |
| Clip/full-scale event | Latch until user clears UI baseline. |
| Worklet exception, later slice | Never reuse a silenced node; rebuild session. |

No normal failure may:

- throw from the render path;
- allocate a larger scratch buffer in response;
- continue against unexpected lineage;
- imply stale status is current;
- silently drop a critical command without surfacing pressure/failure.

---

## 8. Accessibility and responsive requirements

The demo must be operated by keyboard for the core journeys:

- load/select source;
- play/pause;
- seek;
- set loop start/end;
- toggle loop;
- change rate;
- change pitch;
- toggle A/B;
- reset control;
- inspect status/error.

Rules:

- Prefer native range inputs where possible.
- Custom waveform seek/loop UI must have numeric equivalents.
- Sliders expose readable value text.
- Pending/applied state is not color-only.
- Full-scale/clip indication is not color-only.
- Errors use persistent alert region.
- Output-level motion is not announced every frame.
- Reduced motion preserves data while removing decorative animation.
- Primary touch targets are at least 44×44 CSS px.
- No horizontal page scroll at 320 CSS px.

---

## 9. Docs integration

The docs site should gain a demo section and a blog post.

Required docs pages:

```text
apps/docs/src/examples/signalsmith-stretch.md
apps/docs/src/blog/signalsmith-stretch-boundary-proof.md
```

The example page must explain:

- what Signalsmith Stretch proves;
- what is real in the first slice;
- what is simulated;
- how `@exclave/boundary` is used;
- why the real adapter remains private/deferred;
- how this differs from the official Signalsmith demo.

The blog post must be technical and restrained. It should not oversell the demo as a finished audio product before the real adapter lands.

---

## 10. Staged implementation plan

### Stage A — Spec refresh and docs handoff

Purpose: create this updated Exclave Boundary specification and remove old Seqlok package assumptions.

Exit criteria:

- current package name is `@exclave/boundary` throughout;
- old Stage 0/1A Seqlok prompt is removed or quarantined as historical;
- demo prompt targets `apps/signalsmith-stretch` or equivalent;
- no instruction asks Codex to redesign the public package.

### Stage B — Boundary simulator proof

Purpose: prove the product control/status loop with current `@exclave/boundary` APIs before real audio.

Files likely touched:

```text
apps/signalsmith-stretch/
apps/docs/src/examples/signalsmith-stretch.md
apps/docs/src/blog/signalsmith-stretch-boundary-proof.md
```

Exit criteria:

- app builds;
- fake runtime uses real `@exclave/boundary` specs/backings/bindings;
- pending/applied state works;
- output-level display works;
- docs explain simulation boundary;
- root verify remains green.

### Stage C — Product shell and waveform

Purpose: make the demo visually impressive and musically credible.

Exit criteria:

- load/drop surface;
- file metadata;
- waveform overview;
- loop preview;
- playhead/seek ghost;
- responsive desktop-first layout;
- accessibility baseline.

### Stage D — Real browser audio path

Purpose: add real audio graph scaffolding without custom WASM yet.

Exit criteria:

- AudioContext lifecycle surfaced;
- source/aligned path truthful;
- browser failures visible;
- no false claims of Signalsmith processing until adapter exists.

### Stage E — Custom Signalsmith adapter

Purpose: implement the true proof path.

Exit criteria:

- pinned source/artifact manifest;
- fixed-memory C++/WASM build;
- adapter-private AudioWorklet;
- allocator audit;
- official oracle comparison;
- processed-output probe;
- seek/loop/rate/A-B alignment tests.

---

## 11. Stage B handoff constraints

Use `docs/proofs/signalsmith-stretch.md` as the Stage B proof authority after this document lands.

Definition of done:

1. Scope: add a private demo app, preferably `apps/signalsmith-stretch`. Do not redesign `@exclave/boundary`. Do not rename package APIs. Do not publish a Signalsmith adapter package.
2. Naming: public/demo language says Exclave Boundary and Signalsmith Stretch. Keep "Seqlok" only in historical migration notes if needed. Keep "seqlock" only as the primitive term.
3. Demo thesis: build a desktop-first browser demo shell for loading a local track, viewing waveform/navigation state, controlling rate/pitch/tonality/formant-like desired state, seeing pending vs applied state, showing runtime status, and displaying processed-output RMS/peak/full-scale facts. Audio can be simulated in this first slice if full Signalsmith WASM/AudioWorklet integration is too large.
4. Boundary proof: use real `@exclave/boundary` APIs. Define the four app-private specs: desired stretch state, runtime status, source status, and processed output levels. Use `defineSpec`, `planLayout`, `allocatePacked`, `buildHandoff`/`acceptHandoff`, `bindController`, `bindProcessor`, and `bindObserver` where appropriate.
5. Engine strategy: implement a demo-private fake/stretch simulator first. The fake engine should model applied sequence, source frame, output frame, rate, pitch, status, levels, clipping counters, stale/pending state, and failure modes. Leave TODO docs for the later custom C++/WASM/AudioWorklet adapter.
6. UI: make it visually impressive but truthful. Include load/drop surface, waveform panel, transport row, rate and pitch controls, loop region mock/preview, A/B selector mock, processed output level display, status/latency inspector, and persistent error/status area. Prioritize a clean instrument-panel feel, not a generic playground.
7. Docs integration: add a docs page and blog post for Signalsmith Stretch under the VitePress docs site only when the demo is ready for public proof framing. Explain what the demo proves, what is simulated, what becomes the real custom adapter later, and how `@exclave/boundary` is used.
8. Tests: add unit/component tests for demo boundary specs and simulator state transitions. Add smoke tests that the demo imports `@exclave/boundary` and does not import stale prototype package names. Existing package tests must remain green.
9. Scripts: add root/demo scripts only if needed. Keep `pnpm verify`, `pnpm run docs`, `pnpm docs:build`, `pnpm test:types`, `pnpm test`, `pnpm build`, and `pnpm test:pack` passing.
10. Validation: run `pnpm install` if needed, `pnpm format`, `pnpm lint`, `pnpm test:types`, `pnpm test`, `pnpm build`, `pnpm run docs`, `pnpm docs:build`, `pnpm test:pack`, and `pnpm --filter @exclave/boundary pack`.
11. Commit/push: commit and push on the active feature branch. Do not target `main` unless a later task explicitly says to do so.
12. Final report: include branch, commit SHA, push status, files changed, what from the old spec was preserved, what was intentionally deferred, commands run/results, and remaining risks.

### 11.1 Stage B concrete implementation contract

This section is the concrete Stage B app contract for
`apps/signalsmith-stretch`. It is still proof/demo authority only. It does
not promote Signalsmith, audio, Worklet, WASM, or command concepts into
`@exclave/boundary` package API authority.

#### App package shape

Stage B adds one private workspace app:

- path: `apps/signalsmith-stretch`;
- package name: `@exclave/signalsmith-stretch`;
- `private: true`;
- vanilla Vite + TypeScript unless the repository already has an intentional UI
  framework dependency for this app surface;
- no React, Vue, Svelte, or similar UI framework dependency added only for this
  proof slice;
- workspace dependency on `@exclave/boundary`;
- no publication path, and no inclusion in the `@exclave/boundary` package
  files.

#### Exact Stage B file map

Stage B should create this app-private file map unless implementation discovery
finds a small repo-local reason to rename a test helper:

```text
apps/signalsmith-stretch/
  package.json
  index.html
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  src/main.ts
  src/styles.css
  src/boundary/specs.ts
  src/boundary/session.ts
  src/boundary/commands.ts
  src/runtime/fake-stretch-engine.ts
  src/ui/dom.ts
  src/ui/waveform.ts
  src/types.ts
  tests/specs.test.ts
  tests/fake-stretch-engine.test.ts
  tests/imports.test.ts
```

#### Exact boundary specs

Define the four Stage B specs in `src/boundary/specs.ts` with
`defineSpec`. They are app-private contracts. Their IDs and canonical keys
should be tested exactly.

```ts
import { defineSpec } from "@exclave/boundary";

import {
  ADAPTER_MODES,
  PROBE_STATES,
  RUNTIME_STATES,
  SOURCE_STATES,
  STRETCH_PRESETS,
} from "../types";

export const desiredStretchSpec = defineSpec(({ param }) => ({
  id: "signalsmith-stretch/desired-stretch" as const,
  params: {
    desiredSequence: param.u32(),
    active: param.bool(),
    rate: param.f32({ min: 0.05, max: 8 }),
    pitchSemitones: param.f32({ min: -48, max: 48 }),
    tonalityEnabled: param.bool(),
    tonalityHz: param.f32({ min: 2_000, max: 20_000 }),
    formantSemitones: param.f32({ min: -12, max: 12 }),
    formantCompensation: param.bool(),
    formantBaseHz: param.f32({ min: 0, max: 500 }),
    // Reserved for future smoothing; not currently read by the Worklet.
    transitionFrames: param.u32({ min: 0, max: 48_000 }),
    configSequence: param.u32(),
    preset: param.enum(STRETCH_PRESETS),
    blockMs: param.f32({ min: 0, max: 1_000 }),
    intervalMs: param.f32({ min: 0, max: 1_000 }),
    splitComputation: param.bool(),
  },
}));

export const runtimeStatusSpec = defineSpec(({ meter }) => ({
  id: "signalsmith-stretch/runtime-status" as const,
  meters: {
    state: meter.enum(RUNTIME_STATES),
    sessionId: meter.u32(),
    adapterMode: meter.enum(ADAPTER_MODES),
    lastErrorCode: meter.u32(),
    lastAppliedDesiredSequence: meter.u32(),
    lastAppliedConfigSequence: meter.u32(),
    lastAppliedCommandSequence: meter.u32(),
    outputFrame: meter.f64(),
    sourceFrame: meter.f64(),
    processingCenterFrame: meter.f64(),
    effectiveRate: meter.f32(),
    blockSamples: meter.u32(),
    intervalSamples: meter.u32(),
    inputLatencyFrames: meter.u32(),
    outputLatencyFrames: meter.u32(),
    inputLatencySeconds: meter.f64(),
    outputLatencySeconds: meter.f64(),
    bufferLengthFrames: meter.u32(),
    durationFrames: meter.f64(),
    durationSeconds: meter.f64(),
    audioWorkletTimeSeconds: meter.f64(),
    audioWorkletFrameLo: meter.u32(),
    audioWorkletFrameHi: meter.u32(),
    loopEnabled: meter.bool(),
    loopStartFrame: meter.f64(),
    loopEndFrame: meter.f64(),
    loopRevision: meter.u32(),
    bufferReadyFrames: meter.u32(),
    commandDroppedTotal: meter.f64(),
    underrunTotal: meter.f64(),
    staleReadTotal: meter.f64(),
    invalidTransitionTotal: meter.f64(),
    invalidSampleTotal: meter.f64(),
    maxObservedRenderQuantum: meter.u32(),
    heapGeneration: meter.u32(),
    workletGeneration: meter.u32(),
  },
}));

export const sourceStatusSpec = defineSpec(({ meter }) => ({
  id: "signalsmith-stretch/source-status" as const,
  meters: {
    state: meter.enum(SOURCE_STATES),
    sourceRevision: meter.u32(),
    loadSequence: meter.u32(),
    appliedLoadSequence: meter.u32(),
    sampleRate: meter.u32(),
    channelCount: meter.u32(),
    durationFrames: meter.f64(),
    durationSeconds: meter.f64(),
    bufferStartFrame: meter.f64(),
    bufferEndFrame: meter.f64(),
    memoryBytes: meter.f64(),
    decodeErrorCode: meter.u32(),
    droppedBufferTotal: meter.f64(),
  },
}));

export const processedOutputLevelsSpec = defineSpec(({ meter }) => ({
  id: "signalsmith-stretch/processed-output-levels" as const,
  meters: {
    windowEndOutputFrame: meter.f64(),
    windowFrames: meter.u32(),
    channelCount: meter.u32(),
    rmsLeft: meter.f32(),
    rmsRight: meter.f32(),
    peakLeft: meter.f32(),
    peakRight: meter.f32(),
    outputBranchActive: meter.bool(),
    referenceBranchActive: meter.bool(),
    maxAbsWindow: meter.f32(),
    clipLatched: meter.bool(),
    fullScaleLeftTotal: meter.f64(),
    fullScaleRightTotal: meter.f64(),
    invalidSampleTotal: meter.f64(),
    unsupportedChannelBlockTotal: meter.f64(),
    silent: meter.bool(),
    probeState: meter.enum(PROBE_STATES),
    lastErrorCode: meter.u32(),
    historyRms: meter.f32.array(64),
    historyPeak: meter.f32.array(64),
  },
}));
```

Rules for these specs:

- `desiredStretchSpec` uses params only. The host/controller writes it and the
  fake runtime/processor reads it.
- Use only current supported param kinds. Do not use `param.f64`, `u64`, or
  pair-backed sequence fields in Stage B.
- `runtimeStatusSpec` uses meters only. The fake runtime/processor publishes it
  and the observer/UI reads it.
- Use `meter.f64` for frame positions and long counters. Do not invent `u64` or
  pair fields in Stage B unless implementation proves they are absolutely
  necessary.
- `sourceStatusSpec` uses meters only. The fake runtime/source loader publishes
  it and the observer/UI reads it.
- `processedOutputLevelsSpec` uses meters only. The fake runtime/probe publishes
  it and the observer/UI reads it.
- `historyRms` and `historyPeak` are optional Stage B
  visualization facts that demonstrate array-meter publication with
  `meter.stage`. They are not package API.

#### Boundary usage requirements

The app must visibly exercise the current `@exclave/boundary` surface:

- `defineSpec`;
- `planLayout`;
- `allocatePacked`;
- `buildHandoff`;
- `verifyHandoff`;
- `acceptHandoff`;
- `bindController`;
- `bindProcessor`;
- `bindObserver`;
- `BoundaryError` and `isBoundaryError` where useful;
- `allocateSwsrRing`, `bindSwsrRingProducer`, and `bindSwsrRingConsumer` if the
  demo-private command ring is implemented in Stage B.

Use `allocatePacked` for the normal Stage B runtime path.
`allocatePartitioned` may be demonstrated in tests or a debug toggle if
that stays simple. Do not require `allocateWasm` in Stage B because
wasm handoff is not the first-slice path.

Do not create public Signalsmith, Worklet, WASM, audio, or command exports from
`@exclave/boundary`.

#### Demo-private command transport

If implemented cleanly in Stage B, transport operations use a bounded
app-private SWSR command ring. The command vocabulary remains app-private:

- `play`;
- `pause`;
- `stop`;
- `seek`;
- `setLoop`;
- `clearLoop`;
- `resetFault`.

The Stage B slot contract is fixed-width `Uint32` payloads:

| Word | Meaning |
| --- | --- |
| `0` | command sequence |
| `1` | command id |
| `2` | argument 0, such as seek frame or loop start frame |
| `3` | argument 1, such as loop end frame |
| `4` | argument 2, such as loop revision |
| `5` | flags |
| `6` | reserved |
| `7` | reserved |

Rules:

- single host producer;
- single fake-runtime consumer;
- newest command is dropped on overflow according to SWSR behavior;
- dropped count is surfaced through `commandDroppedTotal`;
- seek and loop frame arguments are Stage B simulation frame indices, not a new
  public package integer type.

#### UI proof requirements

The Stage B app must show:

- Exclave Boundary + Signalsmith Stretch branded shell;
- simulation mode badge;
- load/drop surface;
- metadata panel with truthful simulated or decoded status;
- waveform overview generated from decoded data or deterministic simulation;
- applied playhead and requested seek ghost;
- loop preview and applied loop state;
- rate and pitch controls;
- tonality/formant-like controls;
- processed/aligned source selector, marked as a truthful mock when no real
  audio exists;
- processed output RMS, peak, and full-scale panel;
- Boundary Inspector showing plan IDs, spec hashes, `bytesTotal`, plane byte
  lengths, lock stride, handoff versions, applied sequence, command drops, stale
  reads, and latest error code;
- persistent error/status area.

#### Tests and stale-name guards

Stage B tests must cover:

- exact spec IDs and required canonical keys;
- `planLayout` produces non-zero byte totals for all three specs;
- `buildHandoff`, `verifyHandoff`, and `acceptHandoff` round-trip;
- controller writes desired params and processor reads them;
- fake runtime publishes runtime status and processed-output levels;
- array meter history is published through `meter.stage`;
- SWSR command overflow and drop accounting if the command ring is implemented;
- new app files do not import `@seqlok/core`, `@exclave/core`, old seqlok
  package subpaths, or public rename-status language.

#### Validation commands

For the current proof app, the validation run must execute at least:

```sh
pnpm signalsmith:check
pnpm signalsmith:test:browser
pnpm signalsmith:build
pnpm lint
pnpm test:types
pnpm test
pnpm run docs
pnpm test:pack
pnpm check:diff-whitespace
pnpm verify
```

The real adapter path is explicit and separate:

```sh
pnpm signalsmith:prepare
pnpm signalsmith:test:browser:real
```

The package pack gate remains:

```sh
pnpm --filter @exclave/boundary pack
```

The older direct package-filter form is equivalent to `pnpm signalsmith:check`
and `pnpm signalsmith:build`:

```sh
pnpm --filter @exclave/signalsmith-stretch lint
pnpm --filter @exclave/signalsmith-stretch test:types
pnpm --filter @exclave/signalsmith-stretch test
pnpm --filter @exclave/signalsmith-stretch build
```

Stage B remains under these guardrails:

- do not change package public API;
- do not publish a Signalsmith adapter;
- do not add public docs/nav links yet;
- do not claim real Signalsmith WASM/AudioWorklet processing unless the
  explicit real-adapter browser smoke has passed for the generated module;
- do not claim zero-copy audio;
- do not claim sample-accurate automation;
- do not reintroduce `@seqlok/core`, `@exclave/core`, old seqlok
  package-subpath architecture, or public rename-status language;
- keep "seqlock" only as the primitive term where relevant.

---

## 12. Release guardrails

Before any demo is treated as public proof:

- `@exclave/boundary` package tests must remain green.
- The demo must not introduce public Signalsmith, audio, Worklet, or product exports from `@exclave/boundary`.
- The demo must not use stale import paths.
- The demo must distinguish simulated behavior from real adapter behavior.
- The docs must not claim the real custom WASM/AudioWorklet adapter is complete until it exists.
- The docs must not claim zero-copy audio.
- The docs must not claim sample-accurate automation.
- The docs must not claim standards-compliant VU/LUFS measurement.
- The demo must be usable without a pointer for the primary workflow before public launch.
- The packed `@exclave/boundary` tarball must remain free of demo app code, worklets, WASM, fixtures, and private proof assets.

---

## 13. Historical reference note

The original Seqlok document named the proof package and repository differently. It remains useful as a frozen product/runtime reference, especially for:

- Signalsmith source identity;
- official demo superiority criteria;
- waveform and loop UX;
- output-level probe requirements;
- browser/Web Audio failure cases;
- accessibility requirements;
- long-term custom adapter gates.

It is no longer authoritative for public package naming, repo shape, export firewall, or the Stage 0/1A implementation prompt.
