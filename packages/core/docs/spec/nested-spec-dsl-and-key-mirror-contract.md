# Nested spec DSL and key mirror contract

> **Status:** Active implementation contract
> **Owner:** `@seqlok/core`
> **Scope:** authored spec semantic compilation, canonical-key formation, anonymous-id normalization, `keysOf(spec)` output contract

---

## 1. Purpose

This document defines the implementation contract for nested authored specs and the `keysOf(spec)` key-mirror surface.

It exists to make the rules explicit at the semantic-compilation boundary.

This is not a broad public-story essay.
This is the contract that implementation, tests, and docs must agree on.

---

## 2. Ownership

### Authored AST owns

- recursive authored namespace structure
- authored leaf definitions
- optional authored `id`

### Semantic compilation owns

- segment validation
- flattening namespace structure into canonical runtime keys
- duplicate and conflict rejection
- canonical compiled output formation
- deterministic anonymous-id generation

### `keysOf(spec)` owns

- ergonomic projection of compiled canonical keys back into a structural mirror
- no additional identity semantics beyond that projection

### Planning and bindings do not own

- authored namespace interpretation
- tolerant conflict resolution
- placeholder anonymous identity

Those decisions must already be complete before planning consumes the compiled contract.

---

## 3. Definitions

### 3.1 Authored segment

One property-name segment inside an authored namespace path.

Examples:

- `"transport"`
- `"tempo"`
- `"engine"`

Non-examples:

- `""`
- `"transport.tempo"`

### 3.2 Authored path

An ordered list of authored segments accumulated during recursive traversal.

Example:

```txt
["transport", "tempo"]
```

### 3.3 Canonical key

The flattened runtime key derived from an authored path.

Rule:

```txt
canonicalKey = authoredPath.join(".")
```

Example:

```txt
["transport", "tempo"] -> "transport.tempo"
```

### 3.4 Namespace occupancy

A canonical path currently occupied as a namespace root during semantic compilation.

Example:

- `transport`
- `transport.tempo`

### 3.5 Leaf occupancy

A canonical path currently occupied by a field definition during semantic compilation.

Example:

- `transport`
- `transport.tempo`

Namespace occupancy and leaf occupancy are distinct and must both be tracked.

---

## 4. Input contract

Semantic compilation accepts authored spec input with this shape:

- optional `id`
- optional `params`
- optional `meters`

`params` and `meters` are recursive namespace trees whose leaves are field definitions.

`params` and `meters` are separate ownership planes and are compiled independently.

---

## 5. Segment validity rules

Every authored segment must satisfy all of the following:

- it is a string
- it is not empty
- it does not contain `.`
- it is used as one segment, not as a pre-flattened path string

Reject on violation.

### 5.1 Invalid examples

```ts
{
  params: {
    "": { kind: "f32" },
  },
}
```

```ts
{
  params: {
    transport: {
      "tempo.bpm": { kind: "f32" },
    },
  },
}
```

---

## 6. Plane independence

`params` and `meters` are compiled independently.

This means:

- duplicate checks are per plane
- conflict checks are per plane
- a param canonical key and a meter canonical key may share the same spelling without conflict

Example:

```ts
{
  params: {
    transport: {
      tempo: { kind: "f32" },
    },
  },
  meters: {
    transport: {
      tempo: { kind: "f32" },
    },
  },
}
```

This is valid.

---

## 7. Semantic-compilation algorithm contract

The implementation may vary in shape, but it must produce the same semantic result.

### 7.1 Traverse each plane independently

Compile `params` and `meters` separately.

For each plane, recursively walk the authored namespace tree while carrying:

- the current authored path
- a set of namespace-occupied canonical paths
- a map of leaf-occupied canonical paths to normalized leaf definitions
- source-path metadata sufficient for diagnostics

### 7.2 Validate each segment before descent

Before appending a property key to the current authored path:

- reject empty segment
- reject segment containing `.`

### 7.3 Handle namespace nodes

When the current node is a namespace object:

1. compute its canonical path from the current authored path
2. if that canonical path is already occupied by a leaf, reject
3. record namespace occupancy for that canonical path
4. recurse into children

### 7.4 Handle leaf nodes

When the current node is a leaf field definition:

1. compute its canonical key from the current authored path
2. reject if that canonical key is already leaf-occupied
3. reject if that canonical key is already namespace-occupied
4. reject if any strict ancestor canonical path is leaf-occupied
5. record leaf occupancy and normalized leaf definition

This ancestor check is required.

Without it, a prior leaf such as `transport` would incorrectly allow a descendant such as `transport.tempo`.

### 7.5 Finish compiled plane

At the end of compilation for one plane, the result is a flat canonical map:

- canonical key -> normalized leaf definition

That flat map is the compiled runtime-facing representation for that plane.

---

## 8. Required rejection cases

These rejection cases are mandatory.

### 8.1 Duplicate canonical key

Reject when two authored inputs in the same plane flatten to the same canonical key.

Example:

```ts
defineSpec({
  params: {
    transport: {
      tempo: { kind: "f32" },
    },
    "transport.tempo": { kind: "f32" },
  },
})
```

### 8.2 Namespace collides with existing leaf

Reject when a namespace canonical path is already occupied by a leaf.

Example shape:

- leaf at `transport`
- namespace later at `transport.*`

### 8.3 Leaf collides with existing namespace

Reject when a leaf canonical key is already occupied by a namespace.

Example shape:

- namespace at `transport.*`
- leaf later at `transport`

### 8.4 Ancestor leaf blocks descendant

Reject when any strict ancestor canonical path of a leaf is already leaf-occupied.

Example shape:

- leaf at `transport`
- later leaf at `transport.tempo`

### 8.5 Invalid authored segment

Reject when a segment is empty or contains `.`.

No tolerant fallback is permitted for any of these cases.

---

## 9. Deterministic anonymous-id contract

### 9.1 Rule

If authored `id` is present, it wins.

If authored `id` is omitted, semantic compilation must generate a deterministic id from canonical compiled content excluding `id`.

### 9.2 Explicitly forbidden behavior

The following are not valid anonymous-id strategies:

- constant placeholder ids such as `"spec"`
- random ids
- time-based ids
- traversal-order-dependent serialization of raw authored input

### 9.3 Identity input

The generated id must be derived from canonical compiled content with these properties:

- object keys sorted deterministically
- arrays preserve authored order
- enum vocabularies preserve authored order
- explicit `id` is excluded from the identity input
- compiled canonical `params` map is included
- compiled canonical `meters` map is included
- semantic-compilation defaults, if any are part of compiled identity, are included consistently

### 9.4 Required behavioral outcomes

- same anonymous authored meaning -> same generated id
- different anonymous authored meaning -> different generated id
- explicit authored `id` overrides generated identity

### 9.5 Recommended shape

The exact prefix is not doctrinal, but the normalized id should truthfully signal anonymous generation.

Examples of acceptable shapes:

- `anon_<stableHash>`
- `spec_<stableHash>`

A plain constant placeholder is not acceptable.

---

## 10. `keysOf(spec)` output contract

`keysOf(spec)` is the official ergonomic key-mirror API.

### 10.1 Required shape

It always returns:

```ts
{
  params: ..., 
  meters: ..., 
}
```

Both top-level planes must always exist in the returned object, even if one plane is empty.

### 10.2 Leaf values

Every leaf value in the returned mirror is the canonical dot-path runtime key string for that field.

Example:

```ts
const keys = keysOf(spec)

keys.params.transport.tempo
// "transport.tempo"
```

### 10.3 Structural shape

The mirror preserves the compiled authored namespace shape.

It is not a flat map.

### 10.4 Immutability

The returned mirror must be deeply frozen before being exposed publicly.

### 10.5 Memoization

`keysOf(spec)` may memoize by spec object identity.

If memoization exists, it should use `WeakMap`.

Memoization is an implementation optimization.
It must not change the semantic output contract.

### 10.6 Explicit non-goals

`keysOf(spec)` must not:

- invent alias paths
- expose camelized alternatives
- expose a second canonical key model
- flatten itself into a separate public identity story

Its job is projection, not invention.

---

## 11. Error-surface contract

Semantic-compilation failures for this feature must be explicit enough to explain the authored mistake.

At minimum, the error surface should distinguish:

- invalid authored segment
- duplicate canonical key
- leaf/namespace conflict

Recommended diagnostic payload fields:

### Invalid authored segment

- `plane`
- `pathSoFar`
- `offendingSegment`
- `reason`

### Duplicate canonical key

- `plane`
- `canonicalKey`
- `firstPath`
- `secondPath`

### Leaf/namespace conflict

- `plane`
- `canonicalPath`
- `leafPath`
- `namespacePath`
- `conflictKind`

The exact class/type names may differ, but the semantic distinction must remain visible.

---

## 12. Test contract

This feature is not landed unless tests prove the invariants.

### 12.1 Semantic-compilation tests

Must cover at least:

- legal nested authored namespaces
- duplicate canonical-key rejection in `params`
- duplicate canonical-key rejection in `meters`
- leaf/namespace conflict rejection in `params`
- leaf/namespace conflict rejection in `meters`
- invalid segment containing `.`
- empty-segment rejection
- deterministic anonymous-id generation
- explicit `id` overriding generated identity

### 12.2 `keysOf(spec)` tests

Must cover at least:

- tree-shaped mirror output
- canonical dot-path leaf values
- deep-freeze behavior
- identity-based memoization if caching is implemented

---

## 13. Acceptance bar

This contract is satisfied only when all of the following are true:

- semantic compilation accepts legal nested authored structure
- semantic compilation rejects ambiguous canonical-key outcomes
- anonymous authored specs normalize to deterministic identity
- explicit authored ids still win
- `keysOf(spec)` returns frozen structural mirrors with canonical leaf strings
- tests prove the above behavior
- docs teach structural authoring first, canonical compilation second, and `keysOf(spec)` consumption third

---

## 14. Non-goals

This contract does **not** define:

- schema-package publication details
- broader schema versioning policy
- compatibility windows across non-identical contracts
- builder redesign beyond lowering into the same authored contract
- additional identifier-style segment regex policy beyond non-empty and no-dot

Those are adjacent arcs.
They are not part of this contract.

---

## 15. Short version

Nested authored structure is real.
Canonical runtime keys remain flat dot paths.
Semantic compilation must protect that keyspace.
`keysOf(spec)` projects canonical keys back into a structural mirror.

That is the contract.
