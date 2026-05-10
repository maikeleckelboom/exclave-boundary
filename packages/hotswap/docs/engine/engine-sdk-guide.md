# Seqlok Engine SDK Guide

> **Status:** Design specification  
> **Audience:** Engine authors integrating DSP engines with Seqlok hotswap

## 1. Purpose

This document defines the engine-author contract for Seqlok hotswap.

It owns:

- the engine ABI
- alignment context
- handoff capability discovery
- persistent handoff snapshot contracts
- engine-author requirements for structural swaps and live parameter updates
- engine conformance expectations

It does **not** own:

- lifecycle semantics, see [`engine-lifecycle-spec.md`](./engine-lifecycle-spec.md)
- runtime/driver orchestration, see [`../IMPLEMENTATION_GUIDE.md`](../IMPLEMENTATION_GUIDE.md)
- shipped protocol law, see [`../CONTRACT.md`](../CONTRACT.md)

If a concept is defined here and somewhere else, this document is the owner.

---

## 2. Core engine contract

Every Seqlok-compatible engine follows these rules:

1. **Structural configuration is immutable per instance.**  
   If a change would rebuild internal state, resize buffers, alter algorithmic structure, or otherwise risk transient behavior, that change happens by creating a new instance.

2. **Non-structural controls may update live.**  
   Parameters the engine can absorb safely at runtime may be updated on the live instance through `updateParams()`.

3. **Instances must be parallel-safe.**  
   During swap, two instances may run at the same time on the same input. They must not interfere with each other.

4. **Processing must be real-time safe.**  
   `process()` must not allocate, block, or take unbounded time.

5. **Continuity claims must be honest.**  
   If an engine family cannot support persistent handoff for a transition, it must decline that transition explicitly. It must not claim support it cannot provide.

---

## 3. Structural and non-structural parameters

Not every parameter change uses hotswap.

## 3.1 Structural parameters

Structural parameters require instance replacement.

Typical examples:

- algorithm family
- quality tier
- FFT size
- window length
- hop size
- sample rate
- channel count
- transient mode
- formant mode
- any parameter the engine family treats as rebuild-only

## 3.2 Non-structural parameters

Non-structural parameters stay on the live-update path.

Typical examples:

- `stretchRatio`
- `pitchRatio`
- gain
- mix
- small smooth controls the engine can apply without rebuild

### Rule of thumb

If you are unsure, classify the parameter as structural.

A structural swap is operationally heavier, but safe.
A live mutation on the wrong parameter is a contract violation.

---

## 4. Continuity classes

Seqlok recognizes two continuity classes for structural swaps:

- `aligned`
- `persistent`

These are not overlap-policy levels.
They are an orthogonal continuity axis.

## 4.1 `aligned`

`aligned` continuity means the incoming engine receives alignment context such as:

- playback position
- recent input history
- optional engine-defined auxiliary alignment state

This supports a strong warm start.
It does **not** guarantee that full running state survives the swap.

## 4.2 `persistent`

`persistent` continuity means the outgoing engine exports a formal handoff snapshot, the incoming engine installs it, the runtime advances the incoming engine through catchup as needed, and the swap does not silently degrade when persistent continuity was required.

This is the stronger continuity class.

## 4.3 Honesty rule

An engine family may support:

- no handoff support
- aligned continuity only
- persistent continuity for some transitions
- persistent continuity for a wider set of transitions

Support is transition-specific.

Do not treat `persistent` as a blanket engine-family badge.
A family may support persistent continuity for:

- same algorithm family + quality-tier change

while declining it for:

- different algorithm families
- incompatible state schemas
- transitions with unreconstructible running state

---

## 5. TypeScript ABI

The TypeScript ABI is the canonical engine surface for Seqlok runtimes.

> **Runtime truth:** The `@seqlok/hotswap` package currently implements **only** the aligned RT protocol (`spec.ts`). The persistent-handoff types and ABI below are the intended design, but the runtime does not yet expose `continuityRequirement`, `exportHandoffRT`, or `importHandoff` surfaces.

### 5.1 Continuity types

    export type ContinuityRequirement = "aligned" | "persistent";

    export type ContinuityGranted = "cold" | "aligned" | "persistent";

    export type HandoffSupport = "none" | "aligned" | "persistent";

### 5.2 Prime context

`PrimeContext` is alignment context.
It is **not** a complete persistent-state transfer contract.

    export interface PrimeContext {
      /** Current playback position in samples */
      readonly positionSamples: number;

      /** Current playback position in seconds */
      readonly positionSeconds: number;

      /**
       * Recent input history for look-back algorithms.
       * The runtime owns retention and validity window.
       */
      readonly inputHistory: readonly Float32Array[];

      /** Number of valid samples available in inputHistory */
      readonly historyLength: number;

      /**
       * Optional engine-defined auxiliary alignment state.
       * This is for aligned startup help, not for claiming persistent continuity
       * by itself.
       */
      readonly phaseState?: unknown;
    }

### 5.3 Handoff capability discovery

The runtime must not guess whether persistent continuity is supported.
The engine family must declare it.

    export interface HandoffCapability<TConfig> {
      readonly support: HandoffSupport;
      readonly handoffAbiVersion?: number;
      readonly maxSnapshotBytes?: number;

      canHandoff(
        fromConfig: Readonly<TConfig>,
        toConfig: Readonly<TConfig>,
      ): {
        readonly supported: boolean;
        readonly continuityGranted: ContinuityGranted;
        readonly reason?:
          | "different-algorithm-family"
          | "incompatible-quality-mode"
          | "state-schema-mismatch"
          | "engine-declines";
      };
    }

### 5.4 Snapshot types

    export interface HandoffSnapshotDescriptor {
      readonly abiVersion: number;
      readonly sourceEngineFamily: string;
      readonly sourceConfigHash: string;
      readonly captureFrame: number;
      readonly latencySamples: number;
      readonly payloadByteLength: number;
    }

    export interface ExportedHandoffSnapshot {
      readonly descriptor: HandoffSnapshotDescriptor;
      readonly payload: ArrayBuffer;
    }

### 5.5 Core engine ABI

    export interface EngineABI<TConfig, THandle> {
      /**
       * Create a new engine instance from immutable structural config.
       * Called off the audio thread.
       */
      create(config: Readonly<TConfig>): THandle;

      /**
       * Prepare the engine for aligned startup.
       * Called before the engine enters the audio path.
       */
      prime(handle: THandle, ctx: PrimeContext): void;

      /**
       * Process one block of audio.
       * Called on the audio thread.
       * Must be real-time safe.
       */
      process(
        handle: THandle,
        input: readonly Float32Array[],
        output: Float32Array[],
        frames: number,
      ): void;

      /**
       * Update non-structural parameters only.
       * Called on the audio thread if provided.
       */
      updateParams?(
        handle: THandle,
        params: Partial<TConfig>,
      ): void;

      /**
       * Return input-to-output latency in samples for this instance.
       */
      getLatency(handle: THandle): number;

      /**
       * Release all resources for the instance.
       * Called off the audio thread after retire.
       */
      destroy(handle: THandle): void;
    }

### 5.6 Persistent handoff extension ABI

    export interface EngineHandoffABI<TConfig, THandle> {
      /**
       * Report whether the engine family supports aligned or persistent continuity,
       * and for which config transitions.
       */
      getHandoffCapability(): HandoffCapability<TConfig>;

      /**
       * Export running-state handoff data from the active instance.
       * Called on the audio thread into preallocated memory.
       */
      exportHandoffRT?(
        handle: THandle,
        frame: number,
        targetBuffer: ArrayBuffer,
      ): ExportedHandoffSnapshot;

      /**
       * Install a previously exported handoff snapshot into the new instance.
       * Called before the instance becomes audible.
       */
      importHandoff?(
        handle: THandle,
        snapshot: ExportedHandoffSnapshot,
        ctx: PrimeContext,
      ): {
        readonly accepted: boolean;
        readonly reason?:
          | "abi-version-mismatch"
          | "config-incompatible"
          | "payload-invalid"
          | "engine-rejected";
      };
    }

### 5.7 Full engine surface

A fully featured engine family typically provides both surfaces:

    export type FullEngineABI<TConfig, THandle> =
      EngineABI<TConfig, THandle> & Partial<EngineHandoffABI<TConfig, THandle>>;

That does **not** mean every engine must support persistent continuity.
It means the capability surface is how the engine declares what it actually supports.

---

## 6. Native ABI sketch

TypeScript is canonical for Seqlok runtimes, but native adapters should mirror the same contract shape.

A native surface should include equivalents for:

- create
- prime
- process
- update live params
- latency query
- destroy
- handoff capability query
- export handoff snapshot
- import handoff snapshot

Example sketch:

    typedef enum {
        SEQLOK_HANDOFF_NONE = 0,
        SEQLOK_HANDOFF_ALIGNED = 1,
        SEQLOK_HANDOFF_PERSISTENT = 2
    } seqlok_handoff_support_t;

    typedef struct {
        int64_t position_samples;
        double position_seconds;
        const float** input_history;
        int32_t history_length;
        const void* phase_state;
        int32_t phase_state_size;
    } seqlok_prime_ctx_t;

    typedef struct {
        uint32_t abi_version;
        const char* source_engine_family;
        const char* source_config_hash;
        int64_t capture_frame;
        int32_t latency_samples;
        int32_t payload_byte_length;
    } seqlok_handoff_snapshot_descriptor_t;

A native implementation must preserve the same semantics even if the names differ.

---

## 7. Engine-author obligations

## 7.1 Real-time safety

`process()` must satisfy all of these:

- no allocation
- no blocking
- no locks on the audio path
- no unbounded loops
- no syscalls on the hot path
- bounded, predictable execution time

Preallocate in `create()`.
Process in `process()`.

## 7.2 Deterministic processing

For a given config, instance state, and input, the engine must behave deterministically enough for runtime sequencing and conformance testing to make sense.

That is especially important for:

- aligned warm start
- replay/catchup
- persistent handoff conformance

## 7.3 Parallel instance safety

During prewarm and crossfade, two instances may process simultaneously on the same input block.

Your engine must not rely on mutable global state shared across instances.

Bad:

    static float g_last_sample = 0.0f;

Good:

    struct Engine {
      float lastSample;
    };

## 7.4 Accurate latency reporting

`getLatency()` must report non-negative input-to-output latency for the current instance configuration.

If quality tier affects latency, report the latency for the active tier.

The runtime uses latency for alignment and scheduling.
Bad latency reporting corrupts continuity.

## 7.5 Honest live-update boundary

`updateParams()` must not mutate structural fields.

If a field is structural, changing it through `updateParams()` is a contract violation.

## 7.6 Honest persistent-handoff claims

If your engine claims `persistent` support for a transition, you are asserting that the runtime can rely on:

- valid export from the running instance
- valid import into the candidate instance
- meaningful continuation after catchup/replay
- explicit decline for unsupported transitions

Do not return `supported: true` for aspirational cases.

---

## 8. What counts as persistent support

An engine family may honestly claim persistent continuity for a transition only if at least one of these is true:

1. it can export and import enough internal running state directly
2. it can clone the running state exactly at a capture boundary
3. it can reconstruct the effective running state from a formal snapshot plus bounded replay window

If none of these is true, the engine may still support `aligned`, but it must decline `persistent`.

---

## 9. Prime guidance

`prime()` is the aligned-start hook.

Use it to:

- seek to the right playback position
- feed history into internal analysis state
- align look-back dependent processing
- prepare a warm non-cold first audible block after prewarm

Example shape:

    prime(handle: EngineHandle, ctx: PrimeContext): void {
      const engine = getEngine(handle);

      engine.seekToSample(ctx.positionSamples);

      if (ctx.historyLength > 0) {
        for (let ch = 0; ch < engine.channels; ch++) {
          engine.feedHistory(ch, ctx.inputHistory[ch], ctx.historyLength);
        }
      }

      if (ctx.phaseState !== undefined) {
        engine.tryApplyAuxAlignmentState(ctx.phaseState);
      }
    }

Important:

- `phaseState` is optional
- `phaseState` is engine-defined
- `phaseState` does **not** by itself justify claiming persistent continuity

---

## 10. Persistent handoff guidance

Persistent continuity needs more than `prime()`.

A persistent-capable engine family should support this shape:

1. **Capability check**  
   Decide whether the specific `fromConfig -> toConfig` transition can support persistent continuity.

2. **Export**  
   Serialize or materialize enough running-state data from the active instance at a capture frame.

3. **Import**  
   Install that snapshot into the candidate instance.

4. **Catchup compatibility**  
   Produce meaningful continuation after replay from capture frame to crossfade start.

### Example decision logic

    canHandoff(fromConfig, toConfig) {
      if (fromConfig.algorithm !== toConfig.algorithm) {
        return {
          supported: false,
          continuityGranted: "aligned",
          reason: "different-algorithm-family",
        };
      }

      if (fromConfig.sampleRate !== toConfig.sampleRate) {
        return {
          supported: false,
          continuityGranted: "aligned",
          reason: "state-schema-mismatch",
        };
      }

      return {
        supported: true,
        continuityGranted: "persistent",
      };
    }

### Example export/import shape

    exportHandoffRT(handle, frame, targetBuffer) {
      const engine = getEngine(handle);

      return engine.exportSnapshotInto(targetBuffer, {
        captureFrame: frame,
      });
    }

    importHandoff(handle, snapshot, ctx) {
      const engine = getEngine(handle);

      return engine.importSnapshot(snapshot, {
        positionSamples: ctx.positionSamples,
      });
    }

The exact payload format is engine-owned.
The contract is not.

---

## 11. Signalsmith-class engines

Signalsmith-based stretch engines are a primary motivator for this surface.

The important distinction is:

- `stretchRatio` and `pitchRatio` are normally live parameters
- a structural swap may still occur while audio is actively being stretched or pitched
- persistent continuity for that structural swap is only honest if the adapter can actually preserve or reconstruct enough running state

A Signalsmith-based adapter may therefore support:

- `aligned` continuity for broad transitions
- `persistent` continuity for a narrower set, such as some same-family quality-tier transitions
- explicit decline for transitions it cannot support honestly

That is the correct shape.
Do not promise more than the adapter can really provide.

---

## 12. Example stretch config

A concrete family may use a config like this:

    export interface StretchEngineConfig {
      readonly version: 1;

      readonly algorithm:
        | "varispeed"
        | "signalsmith"
        | "signalsmith-hq";

      readonly qualityTier:
        | "eco"
        | "normal"
        | "insane";

      readonly sampleRate: number;
      readonly channels: number;

      /**
       * Live-updateable parameters.
       * These are not normal structural hotswap triggers.
       */
      readonly stretchRatio: number;
      readonly pitchRatio: number;

      readonly extensions?: Readonly<Record<string, unknown>>;
    }

This is only an example shape.
The SDK contract does not require this exact config.

---

## 13. Conformance expectations

Any engine family integrated with Seqlok should have conformance coverage.

## 13.1 Baseline engine conformance

Test:

- create/destroy without leaks
- real-time safe processing assumptions
- deterministic output for same input/config
- parallel instance safety
- accurate latency reporting
- structural vs non-structural boundary enforcement

## 13.2 Aligned continuity conformance

Test:

- `prime()` uses position/history meaningfully
- warm startup does not ignore alignment context
- aligned swaps produce acceptable startup behavior after prewarm
- unsupported persistent transitions fall back only through explicit runtime policy, not by false capability claims

## 13.3 Persistent continuity conformance

If the engine claims `persistent`, test:

- capability discovery accepts only valid transitions
- invalid snapshots are rejected
- wrong ABI version is rejected
- incompatible config lineage is rejected
- export/import round-trip works for supported transitions
- replay/catchup continuation is meaningful and deterministic enough for the runtime contract

---

## 14. Common mistakes

### Mistake 1: mutating structural config in `updateParams()`

Wrong:

    updateParams(handle, params) {
      if (params.qualityTier !== undefined) {
        handle.qualityTier = params.qualityTier;
      }
    }

`qualityTier` is structural.
That must be a new instance.

### Mistake 2: claiming persistent support because `prime()` exists

Wrong mental model:

- "we can seek and feed history, so persistent continuity is done"

No.
That is aligned continuity.

### Mistake 3: exporting snapshots that are not lineage-safe

If a snapshot can be imported into the wrong config family or wrong schema version, the contract is broken.

### Mistake 4: relying on global mutable state

Two instances must be able to run side by side during prewarm and crossfade.

### Mistake 5: bad latency reporting

If latency is wrong, the runtime can sequence the swap incorrectly even if the engine ABI itself looks fine.

---

## 15. Minimal engine example

A minimal aligned-only engine may look like this:

    interface PassthroughConfig {
      readonly channels: number;
      readonly gain: number;
    }

    interface PassthroughHandle {
      channels: number;
      gain: number;
    }

    const passthroughEngine: EngineABI<PassthroughConfig, PassthroughHandle> = {
      create(config) {
        return {
          channels: config.channels,
          gain: config.gain,
        };
      },

      prime(handle, ctx) {
        // No-op for simple passthrough
      },

      process(handle, input, output, frames) {
        for (let ch = 0; ch < handle.channels; ch++) {
          for (let i = 0; i < frames; i++) {
            output[ch][i] = input[ch][i] * handle.gain;
          }
        }
      },

      updateParams(handle, params) {
        if (params.gain !== undefined) {
          handle.gain = params.gain;
        }
      },

      getLatency(handle) {
        return 0;
      },

      destroy(handle) {
        // No-op
      },
    };

This engine does not claim persistent continuity.
That is fine.

---

## 16. Final summary

The Seqlok engine-author contract is simple in principle:

- structural changes create a new instance
- non-structural controls may update live
- engines are parallel-safe and real-time safe
- alignment uses `PrimeContext`
- persistent continuity needs explicit capability, export, import, and replay compatibility
- engines must not overclaim what they support

You own the DSP behavior.
Seqlok owns lifecycle sequencing and runtime orchestration.
This document defines the boundary between those two responsibilities.
