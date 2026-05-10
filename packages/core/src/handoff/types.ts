/**
 * @fileoverview
 * Handoff type definitions.
 *
 * This module defines the public handoff envelopes used to move a planned
 * memory layout and its backing across concurrency boundaries:
 *
 * - {@link Handoff} – owner-side transport envelope (protocol-level shape).
 * - {@link AcceptedHandoff} – processor-side capability (plan + backing descriptor).
 *
 * Design principles:
 *
 * - `Plan<S>` is the single source of truth for layout and spec metadata.
 * - No duplicated header fields (hash, byte lengths, planes) outside `Plan<S>`.
 * - **Branded Types**: `Handoff<S>` uses a phantom brand to ensure that only
 *   envelopes created by `buildHandoff` can be passed to typed consumers, preventing
 *   accidental usage of raw objects.
 *
 * Binding guidance:
 * - Across a boundary (e.g. `postMessage`), consumers SHOULD validate with
 *   `acceptHandoff(...)` and bind from a `Handoff<S>` or `AcceptedHandoff<S>`.
 * - For local wiring / tests / custom hosts, binding from `SharedContext<S>` or
 *   explicit `(spec, plan, backing)` is supported by the binding layer.
 */

import type { Plan } from "../plan/types";
import type { SpecInput } from "../spec/types";

/**
 * Unique symbol used to brand Handoff types.
 *
 * @remarks
 * This prevents accidental assignment of raw objects to `Handoff<S>` in TypeScript.
 * It has no runtime representation.
 */
declare const HandoffBrand: unique symbol;

/**
 * Handoff packing strategy discriminator.
 *
 * @remarks
 * - v1 supports:
 *   - `'shared'` – single contiguous `SharedArrayBuffer` backing all planes.
 *   - `'shared-partitioned'` – separate `SharedArrayBuffer` per plane.
 * - Future versions may introduce additional packing modes (e.g. hybrid layouts).
 * - `wasm-shared` backings are represented as `'shared'` because the envelope
 *   transports the underlying `SharedArrayBuffer` (`memory.buffer`), not the
 *   `WebAssembly.Memory` object itself.
 *
 * This value is consumed by `acceptHandoff` and interpreted by bindings;
 * it is not meant to be inspected by most application code.
 */
export type HandoffPacking = "shared" | "shared-partitioned";

/**
 * Owner-side handoff envelope for a single SAB backing.
 *
 * @typeParam S - Spec type parameter inferred from `defineSpec`.
 */
interface SharedHandoff<S extends SpecInput = SpecInput> {
  /**
   * Phantom property ensuring this object was created via `buildHandoff`.
   */
  readonly [HandoffBrand]: S;

  /**
   * Protocol version of the handoff envelope.
   *
   * @remarks
   * - Currently fixed to `1`.
   * - Checked by `acceptHandoff` at the boundary.
   * - Incremented when making breaking changes to the envelope or its
   *   interpretation semantics.
   */
  readonly version: 1;

  /**
   * Memory layout strategy used by this handoff.
   *
   * @remarks
   * - `'shared'` means a single contiguous `SharedArrayBuffer` backing all planes.
   */
  readonly packing: "shared";

  /**
   * Backing memory for all planes.
   *
   * @remarks
   * - In this packing mode, this is a single contiguous {@link SharedArrayBuffer}.
   * - The {@link Plan} describes how this buffer is partitioned into logical
   *   planes such as PF32, PI32, PB, MU32, etc.
   */
  readonly sab: SharedArrayBuffer;

  /**
   * Embedded plan – the inference anchor and metadata source.
   *
   * @remarks
   * All layout and spec information flows through this field:
   *
   * - `plan.hash` – spec hash / identity.
   * - `plan.bytesTotal` – required backing byte length.
   * - `plan.planes` – per-plane byte lengths.
   * - `Plan<S>` – carries the spec type, enabling end-to-end inference.
   *
   * There is intentionally no duplicated or denormalized metadata in
   * the handoff envelope; consumers always look at `plan` for details.
   */
  readonly plan: Plan<S>;
}

/**
 * Owner-side handoff envelope for partitioned SAB backing.
 *
 * @typeParam S - Spec type parameter inferred from `defineSpec`.
 */
interface SharedPartitionedHandoff<S extends SpecInput = SpecInput> {
  /**
   * Phantom property ensuring this object was created via `buildHandoff`.
   */
  readonly [HandoffBrand]: S;

  /**
   * Protocol version of the handoff envelope.
   *
   * @remarks
   * - Currently fixed to `1`.
   * - Checked by `acceptHandoff` at the boundary.
   * - Incremented when making breaking changes to the envelope or its
   *   interpretation semantics.
   */
  readonly version: 1;

  /**
   * Memory layout strategy used by this handoff.
   *
   * @remarks
   * - `'shared-partitioned'` means one `SharedArrayBuffer` per logical plane.
   */
  readonly packing: "shared-partitioned";

  /**
   * Backing memory map for all planes.
   *
   * @remarks
   * - Each entry is a `SharedArrayBuffer` backing a single logical plane.
   * - Plane keys are implementation-defined (e.g. `"PF32"`, `"PI32"`, `"PB"`, ...).
   * - The {@link Plan} describes byte lengths and offsets for each plane.
   */
  readonly planes: Readonly<Record<string, SharedArrayBuffer>>;

  /**
   * Embedded plan – the inference anchor and metadata source.
   *
   * @remarks
   * All layout and spec information flows through this field:
   *
   * - `plan.hash` – spec hash / identity.
   * - `plan.bytesTotal` – aggregate backing byte length.
   * - `plan.planes` – per-plane byte lengths.
   * - `Plan<S>` – carries the spec type, enabling end-to-end inference.
   *
   * There is intentionally no duplicated or denormalized metadata in
   * the handoff envelope; consumers always look at `plan` for details.
   */
  readonly plan: Plan<S>;
}

/**
 * Typed handoff envelope for cross-thread/process communication.
 *
 * @typeParam S - Spec type parameter inferred from `defineSpec`.
 *
 * @remarks
 * This is the shape produced by `buildHandoff` on the owner/orchestrator side,
 * either from `(plan, backing)` or from a `SharedContext<S>`. It is designed to be:
 *
 * - **Serializable** via `postMessage` / structured clone.
 * - **Minimal**: carries only protocol bits + backing descriptor + `Plan<S>`.
 * - **Stable**: future protocol changes are versioned, not ad hoc.
 * - **Branded**: Ensures type safety when used within TypeScript environments.
 *
 * The embedded `plan: Plan<S>` is the single source of truth for:
 *
 * - Layout metadata: `plan.hash`, `plan.bytesTotal`, `plan.planes`.
 * - Spec structure: params/meters as defined by `defineSpec`.
 * - Memory offsets and alignment: plane-relative byte layouts.
 *
 * Consumers should not construct this type manually; use
 * `buildHandoff(...)` to ensure invariants are met.
 */
export type Handoff<S extends SpecInput = SpecInput> =
  | SharedHandoff<S>
  | SharedPartitionedHandoff<S>;

/**
 * Receiver-side view of a single-SAB handoff.
 *
 * @typeParam S - Spec type (inferred from `handoff.plan`).
 */
interface AcceptedSharedHandoff<S extends SpecInput = SpecInput> {
  /**
   * Memory layout strategy used by this accepted handoff.
   *
   * @remarks
   * - Preserved from the original {@link Handoff} to allow bindings to
   *   reconstruct an appropriate backing strategy.
   */
  readonly packing: "shared";

  /**
   * Shared memory backing for all planes.
   *
   * @remarks
   * - The SAB is assumed to be at least `plan.bytesTotal` bytes long.
   *   This invariant is typically enforced by bindings/mapViews rather
   *   than at the handoff boundary.
   */
  readonly sab: SharedArrayBuffer;

  /**
   * Typed plan describing how to interpret the backing.
   *
   * @remarks
   * - This is the same `Plan<S>` that was embedded in the original
   *   {@link Handoff}.
   * - It is the single source of truth for all layout and spec metadata
   *   required by `bindController` / `bindProcessor`.
   */
  readonly plan: Plan<S>;
}

/**
 * Receiver-side view of a partitioned-SAB handoff.
 *
 * @typeParam S - Spec type (inferred from `handoff.plan`).
 */
interface AcceptedSharedPartitionedHandoff<S extends SpecInput = SpecInput> {
  /**
   * Memory layout strategy used by this accepted handoff.
   *
   * @remarks
   * - Preserved from the original {@link Handoff} to allow bindings to
   *   reconstruct an appropriate backing strategy.
   */
  readonly packing: "shared-partitioned";

  /**
   * Shared memory backings for all planes.
   *
   * @remarks
   * - Each entry is a `SharedArrayBuffer` backing a single logical plane.
   * - Plane keys must match those implied by `plan.planes`.
   */
  readonly planes: Readonly<Record<string, SharedArrayBuffer>>;

  /**
   * Typed plan describing how to interpret the backing.
   *
   * @remarks
   * - This is the same `Plan<S>` that was embedded in the original
   *   {@link Handoff}.
   * - It is the single source of truth for all layout and spec metadata
   *   required by `bindController` / `bindProcessor`.
   */
  readonly plan: Plan<S>;
}

/**
 * Result of `acceptHandoff` – validated handoff with typed plan.
 *
 * @typeParam S - Spec type (inferred from `handoff.plan`).
 *
 * @remarks
 * This is the minimal capability a processor needs in order to bind to
 * shared state. It is intentionally smaller than {@link Handoff} and
 * strips away protocol-level header fields:
 *
 * - The processor cares only about:
 *   - the backing descriptor (`sab` or `planes`), and
 *   - how to interpret it (`plan`).
 * - Protocol details like `version` are validated and then discarded by
 *   `acceptHandoff`.
 *
 * **Authority model:**
 *
 * - Owner/orchestrator:
 *   - calls `planLayout(spec)` and `allocateShared(plan)` / `allocateSharedPartitioned(plan)`,
 *   - then builds a {@link Handoff} via `buildHandoff(...)`,
 *   - and transfers it across the boundary.
 * - Processor:
 *   - calls `acceptHandoff(handoff)` and obtains `AcceptedHandoff<S>`,
 *   - then typically binds via `bindProcessor(accepted)`.
 *
 * Binding guidance:
 * - Across a boundary, `AcceptedHandoff<S>` (or a {@link Handoff}) is the
 *   recommended capability form.
 * - For local wiring / tests / custom hosts, the binding layer may also accept
 *   `SharedContext<S>` or explicit `(spec, plan, backing)` inputs.
 */
export type AcceptedHandoff<S extends SpecInput = SpecInput> =
  | AcceptedSharedHandoff<S>
  | AcceptedSharedPartitionedHandoff<S>;
