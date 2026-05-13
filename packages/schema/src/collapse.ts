/**
 * @fileoverview
 * Internal namespace collapse logic for canonicalization.
 *
 * Exported only for consumption by canonicalize.ts.
 */

import { createSchemaError } from "./errors/schema";

import type { SpecNamespace } from "./ast";

type SpecPlane = "params" | "meters";
type AuthoredPath = readonly string[];

interface PlaneCompileState<TLeaf> {
  readonly plane: SpecPlane;
  readonly leafDefsByCanonicalKey: Map<string, TLeaf>;
  readonly leafSourcePathsByCanonicalKey: Map<string, string[]>;
  readonly namespaceSourcePathsByCanonicalKey: Map<string, string[]>;
}

interface CompiledPlane<TLeaf> {
  readonly byCanonicalKey: Record<string, TLeaf>;
}

function canonicalKeyFromPath(path: AuthoredPath): string {
  return path.join(".");
}

export function toSortedRecord<T>(input: Map<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of [...input.keys()].sort()) {
    const value = input.get(key);
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function clonePath(path: AuthoredPath): string[] {
  return [...path];
}

function validateAuthoredSegment(
  plane: SpecPlane,
  parentPath: AuthoredPath,
  segment: string,
): void {
  if (segment.length === 0) {
    throw createSchemaError("invalidSegment", {
      plane,
      parentPath: clonePath(parentPath),
      offendingSegment: segment,
      reason: "empty-segment",
    });
  }
  if (segment.includes(".")) {
    throw createSchemaError("invalidSegment", {
      plane,
      parentPath: clonePath(parentPath),
      offendingSegment: segment,
      reason: "segment-contains-dot",
    });
  }
}

function registerNamespaceNode<TLeaf>(
  state: PlaneCompileState<TLeaf>,
  canonicalPath: string,
  sourcePath: AuthoredPath,
): void {
  if (canonicalPath.length === 0) {
    return;
  }
  const existingLeafPath =
    state.leafSourcePathsByCanonicalKey.get(canonicalPath);
  if (existingLeafPath !== undefined) {
    throw createSchemaError("leafNamespaceConflict", {
      plane: state.plane,
      canonicalPath,
      leafPath: clonePath(existingLeafPath),
      namespacePath: clonePath(sourcePath),
      conflictKind: "namespace-collides-with-leaf",
    });
  }
  if (!state.namespaceSourcePathsByCanonicalKey.has(canonicalPath)) {
    state.namespaceSourcePathsByCanonicalKey.set(
      canonicalPath,
      clonePath(sourcePath),
    );
  }
}

function assertNoLeafAncestorConflict<TLeaf>(
  state: PlaneCompileState<TLeaf>,
  canonicalKey: string,
  sourcePath: AuthoredPath,
): void {
  const segments = canonicalKey.split(".");
  for (let i = 1; i < segments.length; i += 1) {
    const ancestorKey = segments.slice(0, i).join(".");
    const existingLeafPath =
      state.leafSourcePathsByCanonicalKey.get(ancestorKey);
    if (existingLeafPath !== undefined) {
      throw createSchemaError("leafNamespaceConflict", {
        plane: state.plane,
        canonicalPath: ancestorKey,
        leafPath: clonePath(existingLeafPath),
        namespacePath: clonePath(sourcePath),
        conflictKind: "ancestor-leaf-blocks-descendant",
      });
    }
  }
}

function registerLeafNode<TLeaf>(
  state: PlaneCompileState<TLeaf>,
  canonicalKey: string,
  sourcePath: AuthoredPath,
  normalizedLeafDef: TLeaf,
): void {
  const existingLeafPath =
    state.leafSourcePathsByCanonicalKey.get(canonicalKey);
  if (existingLeafPath !== undefined) {
    throw createSchemaError("duplicateCanonicalKey", {
      plane: state.plane,
      canonicalKey,
      firstPath: clonePath(existingLeafPath),
      secondPath: clonePath(sourcePath),
    });
  }
  const existingNamespacePath =
    state.namespaceSourcePathsByCanonicalKey.get(canonicalKey);
  if (existingNamespacePath !== undefined) {
    throw createSchemaError("leafNamespaceConflict", {
      plane: state.plane,
      canonicalPath: canonicalKey,
      leafPath: clonePath(sourcePath),
      namespacePath: clonePath(existingNamespacePath),
      conflictKind: "leaf-collides-with-namespace",
    });
  }
  assertNoLeafAncestorConflict(state, canonicalKey, sourcePath);
  state.leafDefsByCanonicalKey.set(canonicalKey, normalizedLeafDef);
  state.leafSourcePathsByCanonicalKey.set(canonicalKey, clonePath(sourcePath));
}

export function isNamespaceObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isLeafDef(value: unknown): value is { kind: string } {
  return isNamespaceObject(value) && typeof value.kind === "string";
}

function visitNamespaceNode<TLeaf>(
  state: PlaneCompileState<TLeaf>,
  path: string[],
  namespaceNode: SpecNamespace<TLeaf>,
  isLeaf: (value: unknown) => value is TLeaf,
  normalizeLeafDef: (key: string, leaf: TLeaf) => TLeaf,
): void {
  for (const [segment, child] of Object.entries(namespaceNode)) {
    validateAuthoredSegment(state.plane, path, segment);
    const childPath = [...path, segment];
    const canonicalPath = canonicalKeyFromPath(childPath);
    if (!isNamespaceObject(child)) {
      throw createSchemaError("invalidDefinition", {
        key: `${state.plane}.${canonicalPath}`,
        reason: "invalidKind",
      });
    }
    if (isLeaf(child)) {
      const normalizedLeafDef = normalizeLeafDef(canonicalPath, child);
      registerLeafNode(state, canonicalPath, childPath, normalizedLeafDef);
      continue;
    }
    registerNamespaceNode(state, canonicalPath, childPath);
    visitNamespaceNode(
      state,
      childPath,
      child,
      isLeaf,
      normalizeLeafDef,
    );
  }
}

export function compilePlane<TLeaf>(
  plane: SpecPlane,
  root: SpecNamespace<TLeaf> | undefined,
  isLeaf: (value: unknown) => value is TLeaf,
  normalizeLeafDef: (key: string, leaf: TLeaf) => TLeaf,
): CompiledPlane<TLeaf> {
  const state: PlaneCompileState<TLeaf> = {
    plane,
    leafDefsByCanonicalKey: new Map<string, TLeaf>(),
    leafSourcePathsByCanonicalKey: new Map<string, string[]>(),
    namespaceSourcePathsByCanonicalKey: new Map<string, string[]>(),
  };
  if (root !== undefined) {
    visitNamespaceNode(state, [], root, isLeaf, normalizeLeafDef);
  }
  return {
    byCanonicalKey: toSortedRecord(state.leafDefsByCanonicalKey),
  };
}
