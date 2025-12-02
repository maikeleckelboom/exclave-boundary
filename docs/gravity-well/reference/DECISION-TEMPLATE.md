# Decision Template

**Purpose**: Quick capture for architectural decisions that align with DoD.

Use this template to document decisions, then file in `/docs/adr/` if significant.

---

## Decision Template

```markdown
# [DECISION-XXX] Brief Title

**Date**: YYYY-MM-DD
**Status**: [Proposed | Accepted | Deprecated | Superseded]
**Deciders**: [Names]
**Tags**: [architecture | api | performance | interop | testing]

---

## Context

What is the issue or situation that requires a decision?

- Current state: ...
- Problem: ...
- Constraints: ...

---

## Decision

What is the change we're making?

**We will**: [Concrete decision statement]

---

## Options Considered

### Option 1: [Name]
**Pros**:
- ...

**Cons**:
- ...

### Option 2: [Name]
**Pros**:
- ...

**Cons**:
- ...

### Option 3: [Name]
**Pros**:
- ...

**Cons**:
- ...

---

## Decision Rationale

Why this option over the others?

- **Correctness**: Does it maintain invariants?
- **Performance**: Does it meet budgets?
- **API Surface**: Does it expand or simplify?
- **Cross-Language**: Does it work in Rust/C++?
- **DoD Alignment**: Does it move us toward v1.0?

---

## Consequences

### Positive
- ...

### Negative
- ...

### Neutral
- ...

---

## Implementation Notes

- **Packages Affected**: ...
- **Breaking Changes**: Yes/No
- **Migration Path**: ...
- **Timeline**: ...

---

## References

- Related ADRs: ...
- DoD Sections: ...
- GitHub Issues: ...
- Discussions: ...

---

## Sign-off

- [ ] Decision reviewed by technical lead
- [ ] Aligns with DoD
- [ ] Doesn't block v1.0
- [ ] Implementation plan exists
```

---

## Quick Decision Checklist

Before documenting a decision, ask:

### 1. Is this a real decision point?
- [ ] Multiple viable options exist
- [ ] Decision has non-trivial consequences
- [ ] Decision affects public API or semantics

If no to all, it's an implementation detail, not a decision.

### 2. Does it align with DoD?
- [ ] Decision moves us toward v1.0
- [ ] Decision doesn't expand scope unnecessarily
- [ ] Decision maintains correctness guarantees

### 3. Should it be an ADR or just a note?
**ADR** if:
- Affects multiple packages
- Changes public API surface
- Has long-term implications (6+ months)

**Note** if:
- Implementation detail
- Local to one package
- Easily reversible

---

## Example Decisions

### Good Decision Examples

#### Example 1: Small, Focused Decision
```markdown
# [DECISION-042] Use Object API for Snapshot Reads

**Date**: 2025-11-20
**Status**: Accepted
**Deciders**: Maikel

## Context
Observer needs to read meters. We can expose:
1. Object API: `snapshot({ position, level })`
2. Positional API: `snapshotInto(['position', 'level'])`

## Decision
**We will**: Provide **both** APIs, with object API as primary.

## Rationale
- Object API is ergonomic for TypeScript users (type inference)
- Positional API enables zero-copy in hot paths
- Both share same underlying snapshot logic

## Consequences
- API surface slightly larger
- Both documented and tested
- Users choose based on needs

## DoD Alignment
- ✅ Maintains correctness (coherent reads)
- ✅ No performance penalty
- ✅ Doesn't block v1.0
```

#### Example 2: Larger, Cross-Package Decision
```markdown
# [DECISION-057] Commands Package Uses SWSR Ring

**Date**: 2025-11-25
**Status**: Accepted
**Deciders**: Maikel

## Context
Commands can use:
1. SWSR (Single Writer, Single Reader) ring
2. MWSR (Multiple Writers, Single Reader) ring
3. MWMR (Multiple Writers, Multiple Readers) ring

Constraint: v1.0 timeline is tight.

## Decision
**We will**: Implement SWSR for v1.0, defer MWSR to v1.1+.

## Rationale
- SWSR is simplest and fastest
- Dekzer use case: one controller thread → one processor thread
- MWSR adds complexity (ticket system, ordering)
- v1.1 can add MWSR without breaking changes

## Consequences
- ✅ Faster v1.0 ship
- ✅ Lower complexity
- ⚠️ Multi-controller scenarios require workarounds (merge commands)

## Implementation
- Packages Affected: `@seqlok/commands`
- Breaking Changes: No (additive in v1.1)
- Timeline: Week 2 of Phase 1

## DoD Alignment
- ✅ Moves us toward v1.0 (simpler impl)
- ✅ Doesn't block critical use cases
- ✅ Can evolve without breaking API
```

---

## Bad Decision Examples (Anti-Patterns)

### Anti-Pattern 1: Premature Optimization
```markdown
# [BAD] Cache Last Param Read for 10ms

**Why Bad**:
- Adds state and complexity
- No evidence it's needed
- Breaks coherence guarantees
- Doesn't align with correctness-first principle

**Better**: Profile first, optimize if proven bottleneck.
```

### Anti-Pattern 2: Scope Creep
```markdown
# [BAD] Add Plugin API to Commands for Middleware

**Why Bad**:
- Expands scope significantly
- Not in DoD
- No v1.0 use case
- Delays ship

**Better**: Defer to v1.1 backlog.
```

### Anti-Pattern 3: Vague Decision
```markdown
# [BAD] Make Error System "Better"

**Why Bad**:
- No concrete problem statement
- No options considered
- No decision criteria
- No implementation plan

**Better**: Define specific problem, propose concrete changes.
```

---

## Decision Workflow

### 1. Identify Decision Point
When you encounter:
- API design choice
- Performance trade-off
- Implementation strategy
- Architecture pattern

### 2. Use This Template
Fill out:
- Context (why now?)
- Options (at least 2)
- Decision (what we'll do)
- Rationale (why this option?)

### 3. Review Against DoD
Ask:
- Does it block v1.0?
- Does it maintain correctness?
- Does it expand API surface?
- Does it work cross-language?

### 4. Document
- For quick decisions: keep in this file or package DECISIONS.md
- For significant decisions: create ADR in `/docs/adr/`

### 5. Implement
- Update affected packages
- Add tests
- Update docs
- Link to decision in PR

---

## Decision Log (Recent)

**NOTE**: This section should be updated as decisions are made. For full history, see `/docs/adr/`.

### 2025-11-24: Package Naming (integration vs integration)
**Status**: Proposed  
**Decision**: Keep `@seqlok/integration` name, add alias in docs to `integration`  
**Rationale**: Existing code uses `integration`, renaming is disruptive  
**DoD Impact**: Minimal (docs update only)

### 2025-11-24: SPARBB Harness Scope
**Status**: Accepted  
**Decision**: Build minimal harness for v1.0, expand in v1.1  
**Rationale**: Core invariants can be tested with simpler harness  
**DoD Impact**: Moves toward v1.0 faster

### 2025-11-20: Object + Positional Snapshot APIs
**Status**: Accepted  
**Decision**: Expose both, document trade-offs  
**Rationale**: Different use cases benefit from different styles  
**DoD Impact**: Minor API surface increase

---

## Review Cadence

- **Weekly**: Review recent decisions, ensure alignment
- **Monthly**: Audit decisions for obsolescence
- **Pre-Release**: Validate all accepted decisions are implemented

---

**Last Updated**: 2025-11-24  
**Maintained By**: Maikel
