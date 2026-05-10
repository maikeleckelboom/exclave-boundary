# ADR-014: Lock nested spec DSL and key mirror

> **Status:** Accepted
> **Date:** 2026-05-10
> **Owner:** `@seqlok/core`
> **Decision area:** authored spec contract, semantic compilation, public ergonomic API

---

## 1. Decision

Seqlok treats nested authored namespaces as a first-class authoring surface.

Seqlok continues to treat flat dot-path keys as the only canonical runtime identity.

`keysOf(spec)` is the official ergonomic bridge between those two facts.

This ADR locks the following:

- authored `params` and `meters` may be recursive namespace trees
- semantic compilation flattens those trees into canonical dot-path runtime keys
- flat canonical keys remain the runtime ABI
- `keysOf(spec)` returns a structural mirror whose leaf values are those canonical keys
- ambiguous canonical-key outcomes are rejected during semantic compilation
- omitted authored `id` remains allowed, but anonymous specs must normalize to a deterministic generated id rather than a fixed placeholder

This ADR does **not** introduce a second runtime identity model.
It does **not** permit handwritten alternative key aliases.
It does **not** permit camelized canonical-key projections.

---

## 2. Context

The current authored contract direction is already clear:

- the canonical authored format is a serializable AST
- `params` and `meters` are recursive authored namespace trees
- semantic compilation is the boundary where authored structure becomes the validated runtime contract
- flat dot-path keys are formed downstream of authored structure
- authored `id` is currently optional at author time

That makes a flat-string-only teaching model incomplete.

It also exposes a risk:

If nested authoring exists but semantic compilation still tolerates ambiguous flattening, then two authored shapes can
collapse into the same canonical runtime keyspace in ways that depend on traversal behavior or silent overwrite. That is not acceptable.

The feature is therefore not merely “add a helper.”
The feature is:

- author structurally
- compile canonically
- consume through an ergonomic mirror
- protect the canonical runtime keyspace with explicit rejection

---

## 3. Why this decision exists

This decision exists to preserve three good properties at the same time.

### 3.1 Structural authoring

Authors should be able to express real namespace structure directly:

```ts
defineSpec({
  params: {
    transport: {
      tempo: { kind: "f32" },
      swing: { kind: "f32" },
    },
  },
})
```

That is a better authored surface than hand-writing flat string keys everywhere.

### 3.2 Single canonical runtime identity

The runtime still needs one canonical keyspace.

Seqlok keeps dot-path keys as that keyspace:

- `transport.tempo`
- `transport.swing`

Those keys remain the runtime ABI.
They remain the planner-facing identity.
They remain the binding-facing identity.

### 3.3 Honest ergonomic projection

Consumers still need a typed ergonomic answer on the TypeScript side.

`keysOf(spec)` is that answer.

It returns a tree-shaped mirror of the authored namespace surface, but its leaves are canonical runtime keys:

```ts
const keys = keysOf(spec)

keys.params.transport.tempo
// "transport.tempo"
```

This gives ergonomic structural authoring and canonical runtime identity without inventing a second identity system.

---

## 4. Hard decisions

### 4.1 Recursive authored namespaces are first-class

Authored `params` and `meters` are allowed to be recursive namespace trees.

This is part of the authored contract, not a temporary convenience.

### 4.2 Flat dot-path keys remain canonical

The canonical runtime identity of a field is the flattened dot-path key produced during semantic compilation.

Nested structure is authored ergonomics.
The dot-path key is runtime identity.

### 4.3 `params` and `meters` are separate canonical spaces

Duplicate and conflict checks are enforced independently within `params` and within `meters`.

A param key and a meter key may share the same dot-path spelling without conflict because they belong to 
different ownership planes.

### 4.4 Ambiguous flattening is rejected

Semantic compilation must reject any authored input that would produce an ambiguous canonical keyspace.

This includes at least:

- duplicate canonical key outcomes in one plane
- leaf/namespace prefix conflicts in one plane
- invalid authored segments

No iteration-order winner behavior is permitted.
No silent overwrite is permitted.

### 4.5 Omitted authored `id` is allowed, fake fallback identity is not

Authored `id` remains optional.

If `id` is omitted, semantic compilation must generate a deterministic id from canonical compiled content excluding `id`.

A constant placeholder such as `"spec"` is not a valid normalized identity for anonymous specs.

### 4.6 `keysOf(spec)` is the official ergonomic answer

`keysOf(spec)` is the public API for obtaining a typed structural mirror whose leaves are canonical keys.

The helper must:

- always return `{ params, meters }`
- preserve the authored namespace shape
- return canonical dot-path strings at leaves
- avoid aliases
- avoid non-canonical alternative projections

---

## 5. Rejection cases now locked

The following authored inputs must reject during semantic compilation.

### 5.1 Invalid authored segment

Reject if any namespace segment or leaf key segment:

- is empty
- contains `.`

Examples:

```ts
defineSpec({
  params: {
    "": { kind: "f32" },
  },
})
```

```ts
defineSpec({
  params: {
    transport: {
      "tempo.bpm": { kind: "f32" },
    },
  },
})
```

### 5.2 Duplicate canonical key in one plane

Reject if two authored paths flatten to the same canonical key inside `params` or inside `meters`.

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

### 5.3 Leaf/namespace prefix conflict in one plane

Reject if a canonical path is used both as a leaf and as a namespace root.

Examples:

```ts
defineSpec({
  params: {
    transport: { kind: "f32" },
    transport: {
      tempo: { kind: "f32" },
    },
  },
})
```

```ts
defineSpec({
  params: {
    transport: {
      tempo: { kind: "f32" },
    },
    "transport.tempo": {
      swing: { kind: "f32" },
    },
  },
})
```

In plain language:

- `transport` cannot be both a field and a namespace
- `transport.tempo` cannot be both a field and a namespace

---

## 6. Consequences

### Positive

- authored structure becomes more honest and more readable
- the canonical runtime keyspace remains single and explicit
- consumer ergonomics improve without compromising ABI discipline
- semantic compilation becomes more correct and less traversal-order-sensitive
- anonymous authored specs gain stable normalized identity

### Costs

- semantic compilation must perform stronger validation
- error reporting must become more explicit
- test coverage must expand for conflict cases and anonymous-id behavior
- docs must stop teaching the old flat-string-first story as the primary path

---

## 7. Rejected alternatives

### 7.1 Keep flat hand-written strings as the primary story

Rejected.

That undersells the actual authored contract and leaves authors doing avoidable string work.

### 7.2 Treat nested authoring as a cosmetic layer over tolerant flattening

Rejected.

That would preserve silent ambiguity and traversal-order bugs.

### 7.3 Invent a second canonical identity model based on nested access paths

Rejected.

The runtime ABI stays dot-path based.

### 7.4 Add alias helpers or camelized projections

Rejected.

They would blur canonical identity and create multiple public spellings for the same field.

### 7.5 Keep anonymous specs normalized to a constant placeholder id

Rejected.

That is not identity.
That is a lie.

---

## 8. Implementation direction

The semantic-compilation boundary in `@seqlok/core` must now enforce this ADR.

That work includes:

- recursive traversal of authored namespace trees
- segment validation
- explicit tracking of namespace occupancy and leaf occupancy
- duplicate canonical-key rejection
- leaf/namespace conflict rejection
- deterministic anonymous id generation
- `keysOf(spec)` hardening and test coverage

The exact implementation contract is defined in:

- `packages/core/docs/spec/nested-spec-dsl-and-key-mirror-contract.md`

---

## 9. Acceptance bar

This ADR is only truly landed when all of the following are true:

- nested authored namespaces compile successfully in legal cases
- duplicate canonical keys reject
- leaf/namespace prefix conflicts reject
- invalid authored segments reject
- explicit authored `id` still wins
- omitted authored `id` produces deterministic generated identity
- `keysOf(spec)` returns canonical-key mirrors
- docs teach structural authoring plus canonical compilation plus `keysOf(spec)` consumption

---

## 10. Short version

Author structurally.
Compile canonically.
Consume through `keysOf(spec)`.

The namespace tree is the authored surface.
The dot-path key is the runtime identity.
Seqlok keeps both, but it only canonizes one.
