# @seqlok/schema

`@seqlok/schema` publishes the canonical authored spec AST for Seqlok, with structural validation, deterministic authored normalization, and a versioned JSON Schema artifact. `@seqlok/core` owns semantic compilation and all runtime-facing contract behavior beyond that boundary.

This package is deliberately narrow. It describes authored structure. It does not compile that structure into runtime meaning.

## What This Package Owns

- Authored AST TypeScript types: `SpecAstInput`, `SpecNamespace`, `ParamDef`, `MeterDef`, and their leaf definition types.
- `validateSpecAst(...)` for structural validation of authored AST objects.
- `SchemaValidationError` for structural validation failures.
- `normalizeSpecAst(...)` for deterministic authored-layer normalization.
- `SPEC_AST_V1_ID`, the `$id` of the published AST artifact.
- `spec-ast/v1.json`, the versioned JSON Schema artifact for the authored AST.

## What This Package Does Not Own

- Builder DSL sugar.
- `defineSpec(...)`.
- Semantic compilation.
- Runtime namespace flattening.
- Canonical runtime key generation.
- Runtime defaults.
- Anonymous runtime id generation.
- Spec hashing or compatibility policy.
- Planning, backing, handoff, or bindings.
- Product semantics or convenience helpers over runtime behavior.

Those responsibilities belong to `@seqlok/core`.

## Structural Validation Only

`validateSpecAst(...)` checks authored structure:

- legal top-level keys
- legal param and meter leaf kinds
- required fields for enum and array leaves
- enum vocabulary shape
- positive integer array lengths
- recursive namespace shape
- unknown property rejection

It does not check semantic meaning. In particular, schema does not decide whether `min < max`, whether namespaces collide after flattening, how runtime defaults are filled, whether a plan is legal, or whether two runtime contracts are compatible.

## Authored Normalization Only

`normalizeSpecAst(...)` first runs structural validation, then returns a deterministic authored AST copy.

It may:

- sort authored object keys deterministically
- preserve enum order
- preserve namespace nesting
- omit empty `params` and `meters` planes

It must not:

- flatten namespaces
- fill runtime defaults
- generate runtime identities
- compute canonical runtime keys
- hash specs
- interpret authored meaning beyond structural legality

## Versioned Artifact

Current artifact: `spec-ast/v1.json`

Current `$id`: `https://seqlok.dev/schema/spec-ast/v1.json`

`v1` is the authored AST artifact version. It is not a runtime contract version, planner version, handoff version, or compatibility policy.

```ts
import schema from "@seqlok/schema/spec-ast/v1.json";
import { SPEC_AST_V1_ID } from "@seqlok/schema";

console.assert(schema.$id === SPEC_AST_V1_ID);
```

## Usage

```ts
import {
  normalizeSpecAst,
  validateSpecAst,
  type SpecAstInput,
} from "@seqlok/schema";

const ast: SpecAstInput = {
  id: "transport",
  params: {
    tempo: { kind: "f32", min: 40, max: 240 },
    mode: { kind: "enum", values: ["vinyl", "cdj", "sync"] },
  },
};

validateSpecAst(ast);
const normalizedAst = normalizeSpecAst(ast);
```

Pass authored ASTs to `defineSpec(...)` in `@seqlok/core` when you want semantic compilation into the runtime contract consumed by planning.
