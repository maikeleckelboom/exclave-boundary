/**
 * @fileoverview
 * Backing and mapped-view type definitions.
 *
 * @remarks
 * - Describes backing kinds (shared SAB, partitioned SAB, shared WASM).
 * - Defines the `MappedViews` structure used by bindings and introspect.
 * - Centralises typed views for param, meter and lock planes.
 *
 * @internal
 */

import type { PlaneKey } from "@seqlok/primitives";

/**
 * Supported memory backing strategies for Seqlok's shared memory planes.
 *
 * @remarks
 * - `shared`: Single SharedArrayBuffer for all planes
 * - `shared-partitioned`: Separate SharedArrayBuffer per plane
 * - `wasm-shared`: WebAssembly.Memory with shared buffer
 */
export type BackingKind = "shared" | "shared-partitioned" | "wasm-shared";

/** Contiguous SharedArrayBuffer backing all planes in a single allocation. */
export interface SharedBacking {
  readonly kind: "shared";
  readonly sab: SharedArrayBuffer;
}

/** Separate SharedArrayBuffer allocation for each plane. */
export interface SharedPartitionedBacking {
  readonly kind: "shared-partitioned";
  readonly planes: Readonly<Record<PlaneKey, SharedArrayBuffer>>;
}

/** WebAssembly.Memory instance with shared buffer for WebAssembly interop. */
export interface WasmSharedBacking {
  readonly kind: "wasm-shared";
  readonly memory: WebAssembly.Memory;
}

/** Union of all supported memory backing strategies. */
export type Backing =
  | SharedBacking
  | SharedPartitionedBacking
  | WasmSharedBacking;

/** Type guard for {@link SharedBacking} instances. */
export function isSharedBacking(backing: Backing): backing is SharedBacking {
  return backing.kind === "shared";
}

/** Type guard for {@link SharedPartitionedBacking} instances. */
export function isSharedPartitionedBacking(
  backing: Backing,
): backing is SharedPartitionedBacking {
  return backing.kind === "shared-partitioned";
}

/** Type guard for {@link WasmSharedBacking} instances. */
export function isWasmSharedBacking(
  backing: Backing,
): backing is WasmSharedBacking {
  return backing.kind === "wasm-shared";
}
