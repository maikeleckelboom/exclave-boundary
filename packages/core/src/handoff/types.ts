/**
 * @fileoverview
 * Handoff type definitions.
 *
 * This module defines the public handoff envelopes used to move a planned
 * memory layout and its backing across concurrency boundaries:
 *
 * - {@link Handoff} – owner-side transport envelope (protocol-level shape).
 * - {@link ReceivedHandoff} – processor-side capability (plan + SAB).
 *
 * Design principles:
 *
 * - `Plan<S>` is the single source of truth for layout and spec metadata.
 * - No duplicated header fields (hash, byte lengths, planes) outside `Plan<S>`.
 * - No phantom brands or wrapper types: types stay close to the underlying data.
 * - Processors bind from {@link ReceivedHandoff}, not from `(Plan, SharedBacking)`.
 */

import type { Plan } from '../plan/types';
import type { SpecInput } from '../spec/types';

/**
 * Handoff packing strategy discriminator.
 *
 * @remarks
 * - v1 supports only `'shared'`, which denotes a single contiguous
 *   `SharedArrayBuffer` used as the backing for all planes.
 * - Future versions may introduce additional packing modes
 *   (e.g. partitioned SABs, shared Wasm memory, or hybrid layouts).
 *
 * This value is consumed by `receiveHandoff` and interpreted by bindings;
 * it is not meant to be inspected by most application code.
 */
export type HandoffPacking = 'shared';

/**
 * Typed handoff envelope for cross-thread/process communication.
 *
 * @typeParam S - Spec type parameter inferred from `defineSpec`.
 *
 * @remarks
 * This is the shape produced by `buildHandoff(plan, backing)` on the
 * owner/orchestrator side. It is designed to be:
 *
 * - **Serializable** via `postMessage` / structured clone.
 * - **Minimal**: carries only protocol bits + backing + `Plan<S>`.
 * - **Stable**: future protocol changes are versioned, not ad hoc.
 *
 * The embedded `plan: Plan<S>` is the single source of truth for:
 *
 * - Layout metadata: `plan.hash`, `plan.bytesTotal`, `plan.planes`.
 * - Spec structure: params/meters as defined by `defineSpec`.
 * - Memory offsets and alignment: plane-relative byte layouts.
 *
 * Consumers should not construct this type manually; use
 * `buildHandoff(plan, backing)` to ensure invariants are met.
 */
export interface Handoff<S extends SpecInput = SpecInput> {
  /**
   * Protocol version of the handoff envelope.
   *
   * @remarks
   * - Currently fixed to `1`.
   * - Checked by `receiveHandoff` at the boundary.
   * - Incremented when making breaking changes to the envelope or its
   *   interpretation semantics.
   */
  readonly version: 1;

  /**
   * Memory layout strategy used by this handoff.
   *
   * @remarks
   * - v1 supports `'shared'` only, meaning a single contiguous
   *   `SharedArrayBuffer` backing for all planes.
   * - Future modes can be introduced without changing the bindings
   *   signature; the packing code is interpreted by bindings instead.
   */
  readonly packing: HandoffPacking;

  /**
   * Backing memory for all planes.
   *
   * @remarks
   * - In v1, this is a single contiguous {@link SharedArrayBuffer}.
   * - The {@link Plan} describes how this buffer is partitioned into
   *   logical planes such as PF32, PI32, PB, MU32, etc.
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
   * - `plan.planes` – plane byte lengths.
   * - `Plan<S>` – carries the spec type, enabling end-to-end inference.
   *
   * There is intentionally no duplicated or denormalized metadata in
   * the handoff envelope; consumers always look at `plan` for details.
   */
  readonly plan: Plan<S>;
}

/**
 * Result of `receiveHandoff` – validated handoff with typed plan.
 *
 * @typeParam S - Spec type (inferred from `handoff.plan`).
 *
 * @remarks
 * This is the minimal capability a processor needs in order to bind to
 * shared state. It is intentionally smaller than {@link Handoff} and
 * strips away protocol-level header fields:
 *
 * - The processor cares only about:
 *   - the shared backing (`sab`), and
 *   - how to interpret it (`plan`).
 * - Protocol details (`version`, `packing`) are validated and then
 *   discarded by `receiveHandoff`.
 *
 * **Authority model:**
 *
 * - Owner/orchestrator:
 *   - calls `planLayout(spec)` and `allocateShared(plan)`,
 *   - then builds a {@link Handoff} via `buildHandoff(plan, backing)`,
 *   - and transfers it across the boundary.
 * - Processor:
 *   - calls `receiveHandoff(handoff)` and obtains `ReceivedHandoff<S>`,
 *   - then binds via `bindProcessor(received)`.
 *
 * Processors do **not** bind directly from `(Plan<S>, SharedBacking)`.
 * `ReceivedHandoff<S>` is the only supported input to `bindProcessor`,
 * preserving the separation between memory ownership and capability.
 */
export interface ReceivedHandoff<S extends SpecInput> {
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
