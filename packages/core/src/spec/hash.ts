import type { SpecHash } from "./types";
import type { CanonicalSpec } from "@seqlok/schema";

/**
 * Small deterministic 64-bit mix without a BigInt dependency.
 */
function mix64(
  seedHi: number,
  seedLo: number,
  data: string,
): Readonly<{ hi: number; lo: number }> {
  let h1 = seedHi >>> 0;
  let h2 = seedLo >>> 0;

  for (let index = 0; index < data.length; index += 1) {
    const code = data.charCodeAt(index) >>> 0;
    h1 = Math.imul(h1 ^ code, 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 ^ code, 0xc2b2ae35) >>> 0;
    h1 = (h1 ^ (h1 >>> 13)) >>> 0;
    h2 = (h2 ^ (h2 >>> 16)) >>> 0;
  }

  return { hi: h1 >>> 0, lo: h2 >>> 0 };
}

/**
 * Hashes the full canonical spec identity, including `id`.
 *
 * The canonical spec is already fully normalized (sorted keys, filled defaults),
 * so we hash it exactly as received using JSON.stringify.
 */
export function hashSpec(spec: CanonicalSpec): SpecHash {
  const json = JSON.stringify(spec);
  const mixed = mix64(0x12345678, 0x9abcdef0, json);

  const hi = mixed.hi.toString(16).padStart(8, "0");
  const lo = mixed.lo.toString(16).padStart(8, "0");

  return `${hi}${lo}` as SpecHash;
}
