import type {
  MeterDef,
  ParamDef,
  ResolvedSpec,
  SpecAstInput,
  SpecInput,
} from "./types";

type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

type ExpandDeep<T> = T extends string
  ? T
  : T extends object
    ? { readonly [K in keyof T]: ExpandDeep<T[K]> }
    : T;

type PathTree<
  FullPath extends string,
  RemainingPath extends string = FullPath,
> = RemainingPath extends `${infer Head}.${infer Rest}`
  ? { readonly [K in Head]: PathTree<FullPath, Rest> }
  : { readonly [K in RemainingPath]: FullPath };

type KeyMirrorFromKeys<K extends string> = [K] extends [never]
  ? Record<string, never>
  : ExpandDeep<UnionToIntersection<K extends string ? PathTree<K> : never>>;

export type ParamKeyMirror<S extends SpecInput> = S extends {
  readonly params: infer P extends Readonly<Record<string, ParamDef>>;
}
  ? KeyMirrorFromKeys<Extract<keyof P, string>>
  : Record<string, never>;

export type MeterKeyMirror<S extends SpecInput> = S extends {
  readonly meters: infer M extends Readonly<Record<string, MeterDef>>;
}
  ? KeyMirrorFromKeys<Extract<keyof M, string>>
  : Record<string, never>;

/**
 * Structural mirror of a resolved spec's canonical flat keyspace.
 *
 * Leaves remain canonical dot-path strings. The nested shape exists purely as a
 * typed ergonomic projection for authoring and call-site access.
 */
export type KeyMirrorOf<S extends SpecInput> = Readonly<{
  params: ParamKeyMirror<S>;
  meters: MeterKeyMirror<S>;
}>;

/**
 * Compatibility alias for the original public type name.
 *
 * The mirror is derived from the resolved flat spec shape, not directly from
 * the authored AST tree.
 */
export type KeyMirrorFromAst<S extends SpecAstInput> = KeyMirrorOf<
  ResolvedSpec<S>
>;

/**
 * Writes one canonical key into the nested mirror at its structural path.
 */
function setAtPath(
  root: Record<string, unknown>,
  parts: readonly string[],
  value: string,
): void {
  let node = root;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (part == null) {
      return;
    }

    const existing = node[part];

    if (existing == null || typeof existing !== "object") {
      node[part] = Object.create(null) as Record<string, unknown>;
    }

    node = node[part] as Record<string, unknown>;
  }

  const leaf = parts[parts.length - 1];
  if (leaf == null) {
    return;
  }

  node[leaf] = value;
}

/**
 * Freezes the returned key mirror recursively before it is exposed publicly.
 */
function deepFreeze<T extends object>(obj: T): T {
  Object.freeze(obj);

  for (const value of Object.values(obj)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Object.isFrozen(value)
    ) {
      deepFreeze(value as object);
    }
  }

  return obj;
}

/**
 * Projects a resolved spec's canonical flat keys back into a nested, typed
 * mirror that matches the structural authored shape.
 */
export function keysOf<const S extends SpecInput>(spec: S): KeyMirrorOf<S> {
  const params = Object.create(null) as Record<string, unknown>;
  const meters = Object.create(null) as Record<string, unknown>;

  const flatParams = spec.params != null ? Object.keys(spec.params) : [];
  const flatMeters = spec.meters != null ? Object.keys(spec.meters) : [];

  for (const key of flatParams) {
    setAtPath(params, key.split("."), key);
  }

  for (const key of flatMeters) {
    setAtPath(meters, key.split("."), key);
  }

  return deepFreeze({
    params,
    meters,
  }) as KeyMirrorOf<S>;
}
