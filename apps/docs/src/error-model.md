# Error Model

Exclave Boundary throws `BoundaryError` for structured library errors. Each error has a code, message, and typed details payload. Use `isBoundaryError(...)` when catching unknown values at an application boundary.

```ts twoslash
import { getErrorMeta, interpretHealth, isBoundaryError } from "@exclave/boundary";

export function classify(error: unknown) {
  if (!isBoundaryError(error)) {
    return { status: "unknown" as const };
  }

  error.code;

  const meta = getErrorMeta(error.code);
  const health = interpretHealth(meta);

  return {
    status: health.status,
    code: error.code,
    json: error.toJSON(),
  };
}
```

## Error Domains

Error codes are grouped by package domain:

| Domain | Typical cause |
| --- | --- |
| `env.*` | Runtime support is missing or unsuitable. |
| `spec.*` | Authored or canonical spec input is invalid. |
| `plan.*` | Layout planning cannot produce a valid memory plan. |
| `backing.*` | Shared backing allocation or mapping fails. |
| `handoff.*` | Handoff shape, version, hash, or backing does not match the contract. |
| `binding.*` | Role binding or snapshot/write operations receive invalid inputs. |
| `diagnostics.*` | Diagnostics counters or support helpers are used incorrectly. |

## Handling Policy

Use structured codes for logs, tests, and operator hints. Avoid matching on message text. If an error crosses your own application boundary, serialize with `toJSON()` and attach application context separately.
