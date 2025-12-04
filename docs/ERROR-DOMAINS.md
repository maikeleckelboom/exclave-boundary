# Error Domain ID Allocation

This document defines the domain ID allocation for Seqlok error codes.

Domain IDs are 8-bit integers (0–255).  
They form the high byte of the numeric error code; the low 24 bits are a
domain-local ordinal.

> **Note**  
> These IDs are intended to be ABI-stable from v1.0 onward.  
> While Seqlok is still pre-1.0, this table may evolve – the source of truth
> is `@seqlok/base/src/errors/domains.ts`.

## Ranges by package

- `0` – unknown / unregistered (fallback)
- `1–9` – `@seqlok/base` (internal/meta)
- `10–49` – `@seqlok/core` (env/backing/binding/spec/plan/handoff)
- `50–59` – `@seqlok/introspect` (diagnostics / observability)
- `60–69` – `@seqlok/commands` (command transport)
- `70–79` – `@seqlok/hotswap` (engine lifecycle / swap protocol)
- `200–254` – extensions / third-party domains
- `255` – reserved sentinel (never assign)

## Concrete domains in use

| Domain ID | Prefix       | Owner                | Notes                              |
|----------:|--------------|----------------------|------------------------------------|
|         0 | *(none)*     | n/a                  | Unknown/unregistered               |
|         1 | `internal`   | `@seqlok/base`       | Base/internal invariants           |
|        10 | `env`        | `@seqlok/core`       | Environment / feature gating       |
|        11 | `backing`    | `@seqlok/core`       | Shared memory / layout allocation  |
|        12 | `primitives` | `@seqlok/primitives` | Seqlocks, SWSR ring, atomics       |
|        13 | `binding`    | `@seqlok/core`       | Controller/processor/observer glue |
|        14 | `spec`       | `@seqlok/core`       | Spec definition / validation       |
|        15 | `plan`       | `@seqlok/core`       | Layout planning / packing          |
|        16 | `handoff`    | `@seqlok/core`       | Handoff envelopes / adoption       |
|        50 | `introspect` | `@seqlok/introspect` | Counters / sessions / budgets      |
|        60 | `commands`   | `@seqlok/commands`   | Command ring / mailbox errors      |
|        70 | `hotswap`    | `@seqlok/hotswap`    | Engine lifecycle / swap protocol   |
