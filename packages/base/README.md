# @seqlok/base

`@seqlok/base` provides the smallest shared vocabulary for Seqlok across TypeScript and native ports

It defines shapes and algebra but not domains or error codes

- JSON value shapes for portable data
- error metadata and envelopes
- the shared `SeqlokError` runtime class
- a generic `createErrorFactory` for domain specific registries

Everything that depends on Seqlok lives on top of this package

## Scope

What belongs here

- structural types that must match in every language
- `JsonValue` and related helpers
- `ErrorMeta`, `ErrorDetails`, `ErrorEnvelope`
- the `SeqlokError<Code>` class
- `createErrorFactory` which turns a local registry into a typed constructor

What never belongs here

- concrete error domains like `backing.*`, `binding.*`, `env.*`, `internal.*`
- layout logic
- bindings or handoff logic
- any reference to Web Audio, decks, tracks or BPM

If you see a domain code or a module that can break into a separate package later, it probably does not belong in base

## Error model contract

All errors in Seqlok are expected to follow this model

- every error is a `SeqlokError<Code>` in TypeScript
- every error can be turned into an `ErrorEnvelope` via `toJSON`
- `details` is always JSON serializable and safe to send across worker or FFI boundaries
- `meta` tells diagnostics and hosts how to treat the error in terms of severity and recovery

Other languages should mirror this with

- a tagged error type that carries `code`, `message`, `details`, `meta`
- a way to serialize the envelope without losing information

## Domain registry pattern

Domain specific packages define their own registries and factories on top of `@seqlok/base`

Example in a higher layer

```ts
import { createErrorFactory } from "@seqlok/base";
import type { ErrorMeta, ErrorDetails, SeqlokError } from "@seqlok/base";

const BACKING_ERRORS = {
  allocFailed: {
    code: "backing.allocFailed",
    message: "Failed to allocate backing buffer",
    meta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: true,
    } satisfies ErrorMeta,
  },
} as const;

type BackingErrorCode =
  (typeof BACKING_ERRORS)[keyof typeof BACKING_ERRORS]["code"];

const createBackingError = createErrorFactory(BACKING_ERRORS);

function allocateBacking(): void {
  throw createBackingError("allocFailed", {
    where: "backing.allocateShared",
  } satisfies ErrorDetails);
}
```

The important points

- base does not know about `backing` or its codes
- the registry holds the fully qualified code string and metadata
- call sites only name local keys like `allocFailed`
- native ports can recreate the same registry from a shared descriptor
