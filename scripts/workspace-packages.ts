/**
 * Single source of truth for all @seqlok/* workspace packages.
 * Import this anywhere you need the package list.
 */
export const SEQLOK_PACKAGES = [
  "base",
  "schema",
  "worklet-mount",
  "primitives",
  "streambuf",
  "core",
  "commands",
  "hotswap",
  "introspect",
  "playground",
] as const;

export type SeqlokPackageName = (typeof SEQLOK_PACKAGES)[number];
