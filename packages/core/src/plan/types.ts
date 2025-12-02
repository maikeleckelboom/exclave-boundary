/**
 * Canonical plan-facing types.
 *
 * Planning output types live here; DSL-facing spec types remain under `spec/`.
 */

import type { SpecHash, SpecInput } from "../spec/types";
import type { PlaneKey } from "@seqlok/primitives";

/**
 * Logical stride (in bytes) reserved around seqlock planes (PU/MU).
 *
 * This models *padding policy*, not a hardware cache-line probe.
 * Defaults to 128B in `planLayout`, which is safe on both:
 *   - 64B cache-line CPUs (extra isolation, tiny waste)
 *   - 128B cache-line CPUs (Apple Silicon, some ARM) where 64B would be unsafe
 */
export type LockStrideBytes = 64 | 128 | (number & {});

/**
 * Options for planning a spec into a concrete memory plan.
 */
export interface PlanOptions {
  /**
   * Logical padding (in bytes) reserved for each seqlock plane (PU/MU).
   *
   * If omitted, `planLayout` uses 128B by default.
   * Override only if you know your target’s cache-line behaviour
   * and are comfortable changing the isolation/space tradeoff.
   */
  readonly lockStrideBytes?: LockStrideBytes;
}

/** Per-plane total byte lengths in a computed plan. */
export interface PlaneByteLengths {
  readonly PF32: number; // params f32   (Float32Array)
  readonly PI32: number; // params i32 & enum indices (Int32Array)
  readonly PB: number; // params bool   (Uint8Array)

  /**
   * Params seqlock plane (PU), in BYTES.
   *
   * Backed by Uint32Array; must be at least 8 bytes for [LOCK, SEQ],
   * and is typically equal to `lockStrideBytes` for padding/isolation.
   */
  readonly PU: number;

  readonly MF32: number; // meters f32 (Float32Array)
  readonly MF64: number; // meters f64 (Float64Array)
  readonly MU32: number; // meters u32/bool backing (Uint32Array)

  /**
   * Meters seqlock plane (MU), in BYTES.
   *
   * Same constraints as PU: >= 8 bytes and usually `lockStrideBytes`.
   */
  readonly MU: number;
}

/** Slot describing one param/meter entry within its plane. */
export interface EntrySlot {
  readonly plane: PlaneKey;
  /** Byte offset within the plane (not the global backing). */
  readonly offset: number;
  /** Element count (1 for scalars; N for arrays). */
  readonly length: number;
  /** Size of one element in bytes for this entry. */
  readonly bytesPerElement: number;
}

/**
 * Planned plan for a spec.
 *
 * @typeParam S The authored spec (preserves literal key types so that
 *             params/meters stay keyed by the original DSL).
 */
export interface Plan<S extends SpecInput> {
  /**
   * Effective spec id.
   *
   * - If the author provided `id`, this is that value.
   * - Otherwise this is an auto-generated anonymous id (e.g. `anon:<hash>`).
   */
  readonly id: string;

  /** Canonical hash of the authored spec (from `hashSpec(spec)`). */
  readonly hash: SpecHash;

  /** Total backing size (sum of all plane byte lengths). */
  readonly bytesTotal: number;

  /**
   * Logical stride (in bytes) reserved for each seqlock plane (PU/MU).
   *
   * Chosen by `planLayout` (default: 128B). Exposed so allocators / tooling
   * can reason about padding and isolation if they care.
   */
  readonly lockStrideBytes: LockStrideBytes;

  /** Per-plane byte lengths. */
  readonly planes: PlaneByteLengths;

  /** Per-entry param slots, keyed by authored param keys. */
  readonly params: Readonly<{ [K in keyof S["params"]]: EntrySlot }>;

  /** Per-entry meter slots, keyed by authored meter keys. */
  readonly meters: Readonly<{ [K in keyof S["meters"]]: EntrySlot }>;

  /**
   * Seqlock pair indices (pair per domain).
   *
   * These are indices *within* the PU/MU planes as Uint32Array views:
   *   - `locks.PU.lock` / `locks.PU.seq`
   *   - `locks.MU.lock` / `locks.MU.seq`
   */
  readonly locks: Readonly<{
    PU: { lock: number; seq: number };
    MU: { lock: number; seq: number };
  }>;
}
