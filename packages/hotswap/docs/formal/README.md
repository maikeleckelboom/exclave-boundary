# HotSwap Formal Bundle

> Entry point for the formal model, reference C++ spec, and English formal spec.

This directory holds the artefacts that make the hotswap protocol **provable**
and **cross-language**.

---

## 1. Supported vs experimental

The formal bundle is split by status.

### Supported

- **`single`** — base single-swap protocol
- **`reject-busy`** — Level 2 overlap policy
- **`persistent-handoff`** — continuity-class persistent handoff (once model lands)

### Experimental

- **`mailbox-latest`** — latest-wins mailbox policy

Experimental material lives under `experimental/` and must not be treated as part of the shipped supported surface.

Policy level and continuity class are different axes:

- **Policy axis** — `single`, `reject-busy`
- **Continuity axis** — `aligned`, `persistent`

See [`../adr/hotswap-continuity-classes-and-persistent-handoff.md`](../adr/hotswap-continuity-classes-and-persistent-handoff.md).

---

## 2. Contents

### Policies (TLA+ + English spec)

- **`single`**

  - [`policies/single/`](./policies/single/)

- **`reject-busy`**

  - [`policies/reject-busy/`](./policies/reject-busy/)

- **`persistent-handoff`**

  - [`policies/persistent-handoff/`](./policies/persistent-handoff/)

- **`mailbox-latest`** (experimental)
  - [`experimental/mailbox-latest/`](./experimental/mailbox-latest/)

Each policy folder is intended to be self-contained:
English spec + `tla/` module + TLC configs.

### Reference Implementation

- [`reference/cpp/hotswap_spec.reference.hpp`](reference/cpp/hotswap_spec.reference.hpp)  
  Header-only **reference C++ specification** of the protocol state machine.
  Kept in lockstep with the TypeScript spec for cross-language verification.

  > Not installed as public ABI; production code includes `<seqlok/hotswap_spec.hpp>`.

### Primitives (shared building blocks)

- [`primitives/README.md`](./primitives/README.md)

### Tooling

Outside this directory but part of the "formal bundle":

- `../../scripts/tla/run-hotswap.ts`  
  CLI helper for running TLC with policy-based selection.

---

## 3. How the pieces relate

High-level relationships:

- **HotSwapSingle.tla**  
  Canonical mathematical model of a single swap. Proves the base protocol is
  correct (2.9M states, 2+ minutes).

- **HotSwapRejectBusy.tla**  
  Extends the base model to verify multi-swap scenarios with reject-while-busy
  policy. Proves sequential swaps work correctly (~1k states, <1 second with
  request limit).

- **HotSwapPersistentHandoff.tla**  
  Models the persistent-handoff lifecycle: capture, install, catchup, and
  retire gating. Proves no silent downgrade and snapshot lineage consistency.

- **English policy docs**  
  Human-readable explanations of the models (phases, invariants, properties),
  one folder per policy under `policies/`.

- **reference C++** (`reference/cpp/`)  
  C++ template state machine matching the TS implementation and traceable to
  the TLA+ models. Good for:

  - Cross-language conformance tests
  - Native engine runtimes
  - Verifying RT surface is allocation-free / lock-free

- **primitives** (`primitives/`)  
  Shared building blocks (transport notes, mailbox primitive TLA+, planned ring/coherence stubs).

For overview / orientation of the whole package, see:

- [`../README.md`](../README.md)

---

## 4. Running the model

### 4.1 Via workspace script

From the repo root:

```bash
# Single-swap protocol (default)
pnpm tla:hotswap              # Fast invariants-only
pnpm tla:hotswap:full         # Full verification with liveness

# Multi-swap with reject-while-busy
pnpm tla:hotswap -- --policy reject-busy
pnpm tla:hotswap:full -- --policy reject-busy

# Persistent-handoff continuity class
pnpm tla:hotswap -- --policy persistent-handoff
pnpm tla:hotswap:full -- --policy persistent-handoff

# EXPERIMENTAL: mailbox-latest overlap handling (may currently fail invariants)
pnpm tla:hotswap -- --policy mailbox-latest
pnpm tla:hotswap:full -- --policy mailbox-latest
```

The script (`scripts/tla/run-hotswap.ts`) is responsible for:

- Selecting the correct `.tla` and `.cfg` based on `--policy` and mode (`invonly` vs `full`)
- Ensuring `tools/tla/tla2tools.jar` exists (run `pnpm tla:fetch` if missing)
- Forwarding any extra TLC CLI args (via pnpm `--`)
- Running TLC via `java` with a fixed worker count

### 4.2 Manually with TLA+ Toolbox / CLI

For ad-hoc runs or debugging:

**Single-swap:**

```bash
java -jar tla2tools.jar \
  -config packages/hotswap/docs/formal/policies/single/tla/HotSwapSingle.cfg \
  packages/hotswap/docs/formal/policies/single/tla/HotSwapSingle.tla
```

**Multi-swap:**

```bash
java -jar tla2tools.jar \
  -config packages/hotswap/docs/formal/policies/reject-busy/tla/HotSwapRejectBusy.cfg \
  packages/hotswap/docs/formal/policies/reject-busy/tla/HotSwapRejectBusy.tla
```

**Persistent-handoff:**

```bash
java -jar tla2tools.jar \
  -config packages/hotswap/docs/formal/policies/persistent-handoff/tla/HotSwapPersistentHandoff.cfg \
  packages/hotswap/docs/formal/policies/persistent-handoff/tla/HotSwapPersistentHandoff.tla
```

Or use TLA+ Toolbox GUI and open the respective .tla files.

Detailed step-by-step instructions live in the individual spec docs.

---

## 5. Invariants and properties

The canonical list of safety / liveness properties lives in:

- **Single-swap:** [`policies/single/HotSwapSingle.md`](./policies/single/HotSwapSingle.md)
- **Reject-busy:** [`policies/reject-busy/HotSwapRejectBusy.md`](./policies/reject-busy/HotSwapRejectBusy.md)
- **Persistent-handoff:** [`policies/persistent-handoff/HotSwapPersistentHandoff.md`](./policies/persistent-handoff/HotSwapPersistentHandoff.md)
- **Mailbox-latest (experimental):** [`experimental/mailbox-latest/HotSwapMailboxLatest.md`](./experimental/mailbox-latest/HotSwapMailboxLatest.md)
- The .tla files themselves contain the formal definitions

### Common Safety Invariants (all supported models)

- `TypeOK` - All variables in valid domains
- `AtMostTwoEngines` - Never more than 2 engines active
- `NoGapDuringCrossfade` - Both engines active during crossfade
- `NextEngineConsistency` - Next engine only during swaps
- `PhaseTicketConsistency` - Non-idle phases require active ticket

### Multi-Swap Specific Invariants

- `SequentialSwapsComplete` - Sequential swaps (A->B->C) end correctly
- `NoRejectedEngineInDecisions` - Rejected engines never appear in decisions
- `CompletedSwapsConsistency` - History tracking is accurate

### Persistent-Handoff Specific Invariants

- `NoSilentDowngrade` - Persistent-required swaps do not degrade silently
- `SnapshotLineageConsistency` - Consumed snapshot belongs to correct engine lineage
- `RetireAfterPersistentInstall` - Retire implies successful install and catchup

### Common Liveness Properties

- `EventuallyIdle` - Every accepted swap completes
- `NoLivelock` - Never stuck in intermediate phases

---

## 6. Policy-based naming

The TLA+ specs use **policy-based names**.

Supported levels:

- **Level 1** = `single`
- **Level 2** = `reject-busy`
- **Level 3+** = experimental/future (not part of supported taxonomy)

| Policy Name          | TLA+ Spec                    | Requirements Doc | What It Proves                        |
| -------------------- | ---------------------------- | ---------------- | ------------------------------------- |
| `single`             | HotSwapSingle.tla            | Level 1          | Base protocol for one in-flight swap  |
| `reject-busy`        | HotSwapRejectBusy.tla        | Level 2          | Overlap defined as reject-while-busy  |
| `persistent-handoff` | HotSwapPersistentHandoff.tla | Continuity       | Persistent handoff lifecycle          |
| `mailbox-latest`     | HotSwapMailboxLatest.tla     | Level 3          | **EXPERIMENTAL**: latest-wins mailbox |

---

## 7. Verification results

As of the latest run:

| Spec                     | Mode    | States | Time | Result |
| ------------------------ | ------- | ------ | ---- | ------ |
| HotSwapSingle            | invonly | 2.3M   | ~8s  | PASS   |
| HotSwapRejectBusy        | invonly | ~80k   | ~2s  | PASS   |
| HotSwapPersistentHandoff | invonly | 14M    | ~71s | PASS   |
| HotSwapMailboxLatest     | invonly | ~1k    | ~1s  | FAIL   |

**Notes:**

- `HotSwapSingle` and `HotSwapRejectBusy` are the original supported models.
- `HotSwapPersistentHandoff` is now a supported formal model. The invariants-only run passes. The full run (safety + liveness) is valid but slower due to the larger state space.
- `HotSwapMailboxLatest` currently fails the `AccountingOK` invariant. This is a known model issue; it remains **experimental** and is not part of the supported surface.

---

## 8. Updating the specs

If you add or change invariants:

1. Update the relevant .tla file (HotSwapSingle, HotSwapRejectBusy, or HotSwapPersistentHandoff)
2. Update the corresponding .md file with English descriptions
3. Update conformance tests if behavior changes
4. Run both TS and C++ test suites to verify parity

This keeps TS, C++, and the formal models in lockstep.

---

## 9. Further reading

- [Lamport's TLA+ Home](https://lamport.azurewebsites.net/tla/tla.html)
- [Learn TLA+ (Practical Guide)](https://learntla.com/)
- [Specifying Systems (Free Book)](https://lamport.azurewebsites.net/tla/book.html)
- [Hillel Wayne's TLA+ Guide](https://www.hillelwayne.com/post/tla-messages/)

---

## 10. Why this matters for real-time audio

In RT audio, bugs don't just cause crashes - they cause **audible glitches**
that destroy user experience. The constraints are unforgiving:

- No allocation in the hot path
- No blocking
- Bounded, predictable execution time
- No race conditions or torn reads

By formally specifying the protocol and proving safety/liveness properties, we
have mathematical confidence that the **design** is correct before writing
implementation code.

The implementation can still have bugs (wrong array index, off-by-one, etc.),
but the **protocol structure** is proven sound.
