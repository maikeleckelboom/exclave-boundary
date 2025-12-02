# Error Governance

This document defines the rules for maintaining the Seqlok error universe: domains, numeric codes, deprecation, and extensions.

For technical details on how the error system works, see [error-system.md](./error-system.md). This document assumes familiarity with `SeqlokError`, `ErrorMeta`, `ErrorNumericCode`, and the domain/registry architecture described there.

## Purpose and scope

The error system provides stable string codes and numeric codes that downstream systems rely on: logs, telemetry, native bindings, and external tooling. Breaking changes to this universe can silently corrupt historical data or cause cross-language bindings to misinterpret errors.

This governance applies to:

- All Seqlok workspace packages (`@seqlok/base`, `@seqlok/core`, `@seqlok/primitives`, `@seqlok/introspect`, `@seqlok/commands`, `@seqlok/hotswap`).
- Recommended practices for third-party extensions using the `200–254` range.

The core principle is **append-only evolution**: new codes can be added, but existing codes are never removed, reordered, or reassigned.

## Adding a new domain

### Choosing a prefix

- The prefix MUST be a short, lowercase identifier (e.g. `"hotswap"`, `"myEngine"`).
- The prefix MUST be unique across all domains in the error universe.
- The prefix becomes part of the fully-qualified string code (`"${prefix}.${key}"`), so choose something stable and descriptive.

### Selecting a domain ID

- Consult `ERROR_DOMAINS.md` and `DOMAIN_RANGES` in `@seqlok/base` for the appropriate range:
  - `1–9` — `@seqlok/base`
  - `10–49` — `@seqlok/core` and core-adjacent runtime domains (includes `primitives.*` in the same numeric band, owned by `@seqlok/primitives`)
  - `50–59` — `@seqlok/introspect`
  - `60–69` — `@seqlok/commands`
  - `70–79` — `@seqlok/hotswap`
  - `200–254` — third-party / extension domains
- Prefer the next unallocated ID within the range. Gaps are allowed but should be rare and justified in the PR.
- IDs `0` and `255` are reserved sentinels and MUST NOT be used.

### Required updates

When adding a new built-in domain:

1. **`@seqlok/base`**: Add the new prefix and ID to `DOMAIN_IDS`. If the domain expands a range, update `DOMAIN_RANGES`.
2. **`ERROR_DOMAINS.md`**: Add a row to the "Concrete domains in use" table with the domain ID, prefix, owner package, and a brief description.
3. **Domain module**: Create the domain definition in the owning package using `buildErrorDomain(prefix, domainId, defs)`.
4. **`@seqlok/introspect`**: Import the new domain's registry and add it to `ALL_DOMAINS` so it appears in `listErrors()` and registry exports.

SHOULD use `buildErrorDomain` for built-in domains so numeric codes are attached at definition time and the `DomainDescriptor` is immediately available for aggregation.

## Adding a new error code within a domain

### Append-only rule

- New codes MUST be appended to the end of the domain's definition record.
- Existing keys MUST NOT be reordered, renamed, or removed.
- The domain-local ordinal is derived from definition order. Changing the order of keys changes numeric codes, which breaks compatibility.

### Procedure

1. Add the new key at the end of the `DEFS` object in the domain module.
2. Define `message` and `meta` (including `severity`, `recoverable`, `boundarySafe`).
3. If the domain uses per-key detail types, add the corresponding detail interface and update the `DetailsByKey` map.
4. Run the introspect test suite to verify no duplicate codes or ordinal collisions.

### Non-reuse guarantee

Once a numeric code is assigned to a string code, that assignment is permanent. Even if the error is later deprecated, the numeric code MUST NOT be reassigned to a different string code.

## Renaming, moving, or deprecating error codes

### Renaming or moving

Renaming a domain prefix or moving a code between domains is equivalent to:

1. Adding a new code (with a new string code and numeric code).
2. Deprecating the old code.

The old and new codes will have different numeric codes. This is intentional; it preserves the stability guarantee for systems that stored the old numeric code.

### Deprecation procedure

To deprecate an error code:

1. Keep the old entry in the domain's definition record. Do not remove it.
2. Add a `"deprecated"` tag to `ErrorMeta.tags`.
3. Optionally update the message to indicate deprecation (e.g. `"[Deprecated] Original message"`).
4. Document the replacement code (if any) in the code's JSDoc or in release notes.
5. Update internal callers to use the replacement code.

### What not to do

- MUST NOT silently delete an existing code from the definition record.
- MUST NOT repurpose an existing code for a different failure condition.
- MUST NOT change the `message` or `meta` in ways that alter the semantic meaning of the code (cosmetic clarifications are acceptable).

## Third-party and extension domains

### The extension range

Domain IDs `200–254` are reserved for third-party and extension domains. Core Seqlok will not allocate IDs in this range.

### Guidance for external engine authors

1. Pick a stable **prefix** that does not collide with existing domains. Check `ERROR_DOMAINS.md` and any known extensions.
2. Pick a stable **domain ID** within `200–254`. If your extension is public, consider documenting your chosen ID to avoid collisions with other extensions.
3. Use `buildErrorDomain(prefix, domainId, defs)` to define the domain. This gives you a typed factory and a `DomainDescriptor` for your own tooling.
4. Follow the same append-only rules as built-in domains if you want stable numeric codes across releases.

### Blessed extensions in the monorepo

If an extension lives in the Seqlok monorepo and is intended for general use:

- Register the domain in `ERROR_DOMAINS.md`.
- Aggregate it in `@seqlok/introspect` so it appears in `ALL_DOMAINS` and registry exports.
- Follow all governance rules as if it were a built-in domain.

## Versioning and compatibility expectations

### What "backwards compatible" means

| Change | Compatible? |
|--------|-------------|
| Adding new domains | Yes |
| Adding new codes to existing domains (append-only) | Yes |
| Deprecating codes while keeping their numeric mapping | Yes |
| Changing `message` text (cosmetic) | Yes |
| Adding optional fields to `ErrorMeta` | Yes |
| Removing or reusing a code | **No** |
| Reordering keys in a domain definition | **No** |
| Changing `severity` or `boundarySafe` semantics | **No** (may affect downstream routing) |

### Native bindings

Bindings generated from `ErrorRegistrySchema` can rely on:

- Numeric codes being stable across releases.
- String codes being stable across releases.
- New codes appearing in future schema exports (bindings should handle unknown codes gracefully, e.g. map to an "unknown" variant).

Bindings SHOULD NOT assume the set of codes is fixed; they should be resilient to new codes appearing.

### Schema versioning

Changes to the shape of `ErrorRegistrySchema` itself (adding or removing top-level fields, changing `schemaVersion`) are a separate compatibility layer. Bump `schemaVersion` when making structural changes, and document migration guidance for binding generators.

## Operational guidance for reviewers

When reviewing PRs that touch error definitions, use this checklist:

### Changes to `DOMAIN_IDS` or `DOMAIN_RANGES`

- [ ] Is the new domain ID within the correct range for the owning package?
- [ ] Is `ERROR_DOMAINS.md` updated with the new domain?
- [ ] Is `@seqlok/introspect` updated to aggregate the new domain?

### Changes to domain definition modules

- [ ] Are new codes appended at the end of the `DEFS` object?
- [ ] Are existing codes left in place (no reordering, no removal)?
- [ ] Do new codes have complete `message` and `meta` definitions?
- [ ] If per-key detail types exist, is the `DetailsByKey` map updated?

### Deprecations

- [ ] Is the deprecated code still present in the definition record?
- [ ] Is there a `"deprecated"` tag in `ErrorMeta.tags`?
- [ ] Is the replacement code (if any) documented?

### General

- [ ] Do the introspect tests pass (no duplicate codes, no ordinal collisions)?
- [ ] If this is a new domain, does `listErrors()` include its codes?
- [ ] Are any changes to `ErrorRegistrySchema` shape accompanied by a `schemaVersion` bump?

## Error manifest

### Purpose

The file `packages/introspect/error-manifest.json` is a committed snapshot of all `code → numericCode` mappings. It exists to catch accidental ordinal drift caused by reordering keys in domain definitions.

### Guarantees

The manifest test suite (`error-manifest.test.ts`) enforces:

- Every code in the registry has a manifest entry.
- Numeric codes match the committed snapshot (no drift).
- The manifest contains no stale entries for removed codes.

If any of these checks fail, CI fails with an actionable message.

### Workflow for adding new codes

1. Add the new key at the end of the domain's `DEFS` object.
2. Run `pnpm -F @seqlok/introspect run errors:manifest:generate`.
3. Inspect the diff — it should show a single new line in alphabetical position.
4. Commit both the code change and the manifest update together.

### Workflow for reviewers

When reviewing PRs that touch domain definitions:

- [ ] Does the manifest diff show only additions (new codes)?
- [ ] Are there any numeric code changes for existing codes? (This is almost always wrong.)
- [ ] If codes were "removed", are they actually deprecated in place rather than deleted?

### CI integration

Add to your CI pipeline:

```yaml
- name: Check error manifest
  run: pnpm errors:manifest:check
```

This runs before tests and fails fast if the manifest is out of sync, with a clear message showing exactly what changed.
