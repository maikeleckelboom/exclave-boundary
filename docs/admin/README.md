# Admin docs

This folder holds Seqlok admin documentation.  
It covers how the project is run, not the runtime API.

Typical readers are:

- future me (what did I do, when and why)
- tax and R&D authorities (WBSO-style evidence of work)
- reviewers or partners who want to see process and governance

These docs are internal and not shipped with any public bundle.

## Layout

Core files:

- `rd-log-2025.md` – running R&D log for 2025
- `rd-log-2026.md` – next year once the calendar flips
- `release-checklist.md` – (planned) steps to cut a release safely
- `governance.md` – (planned) notes on roles, decisions and process

More files can appear here as the project grows.  
Rule of thumb: if it is about how we work rather than what the code does, it lives in `docs/admin`.

## R&D log conventions

Each R&D log file tracks one calendar year:

- `rd-log-2025.md`
- `rd-log-2026.md`
- and so on

Inside a file:

- one section per day: `## YYYY-MM-DD (Nh)`  
  - the total hours for that day in parentheses are optional but recommended
- under each date, a small number of tagged entries (1–4 is typical)
- each entry uses this shape:

```md
[comma, separated, tags] 3h
Short, concrete description of what changed or was learned.
Can span multiple lines if needed.
````

**Tags** are free-form but should roughly mirror the architecture and work domains, for example:

- `errors`, `base`, `primitives`, `introspect`, `core`
- `commands`, `hotswap`, `integration`
- `docs`, `tooling`, `perf`, `arch`, `planning`

Keep entries short and technical.
This is for evidence and recall, not personal journaling.

### Example

```md
## 2025-11-29 (7.5h)

[errors, base, primitives, introspect] 3.5h
Completed the split of the error system into @seqlok/base, @seqlok/primitives,
and @seqlok/introspect. Wired core to consume the new domains, fixed imports,
and kept tests and type checks passing.

[health, diagnostics] 2h
Moved health helpers into base as a portable lens over ErrorMeta. Finished
ALL_DOMAINS aggregation, numeric code mapping, registry export helpers, and
runWithIntrospect wiring on top of the new layout.

[tooling, perf, docs] 2h
Hooked up strip-extra-dts and shared Vitest config across packages, re-ran
benches and refreshed generated bench docs. Updated Status Matrix, Package
Readiness, Gravity Well, and this R&D log to reflect the new reality.
```

Any consistent tagging scheme is fine as long as:

- you can skim a month and see where the time went, and
- a future script can parse `[tags] Nh` lines without guessing.
