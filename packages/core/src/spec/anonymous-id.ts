import { hashCanonicalSpecContent } from "./hash";

import type { MeterDef, ParamDef } from "./types";

type AnonymousSpecIdentityInput = Readonly<{
  params: Readonly<Record<string, ParamDef>>;
  meters: Readonly<Record<string, MeterDef>>;
}>;

/**
 * Generates a deterministic id for authored specs that omit `id`.
 *
 * Identity is derived from canonical compiled meaning only. Authored namespace
 * spelling and explicit `id` are excluded.
 */
export function anonymousId(input: AnonymousSpecIdentityInput): string {
  const hashHex = hashCanonicalSpecContent({
    params: input.params,
    meters: input.meters,
  });

  return formatAnonymousSpecId(hashHex);
}

function formatAnonymousSpecId(hashHex: string): string {
  return `anon_${hashHex}`;
}
