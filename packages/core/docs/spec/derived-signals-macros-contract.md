# Derived Signals (Macros) DSL — Implementation Contract

**Status:** ✅ *Design locked for future implementation* · 🚫 *Not implemented yet* (core stability first)  
**Scope:** Defines how Seqlok/Dekzer will express "one knob → many parameters / routing" mappings (DDJ-style Color FX,
macro controls, piecewise behavior) in a way that is deterministic, serializable, and audio-thread safe.

---

## 1. Why this exists

Modern DJ controls are often **macros**:

* One knob drives **multiple DSP parameters** (cutoff, resonance, wet, send, feedback, etc.).
* One knob is **piecewise** (left half does LPF, right half does HPF, neutral center).
* A mode selector (`enum`) changes the meaning of the same knob (NOISE vs FILTER vs DUB ECHO vs SPACE…).

We want to author these behaviors in the Seqlok spec without:

* leaking "wiring logic" into UI code,
* writing derived values back into param planes,
* shipping JS closures across host/worklet,
* or making the audio thread depend on defs that may be absent (handoff scenario).

---

## 2. Non-negotiable invariants

### 2.1 Plane discipline

* **Params are written by control/UI threads; read by audio thread.**
* **Audio thread MUST NOT write into param planes** (`PF32`, `PI32`, `PB`, etc.).
* Derived values are ephemeral signals feeding DSP directly.
* If derived values must be visible to UI/diagnostics, **publish them as meters**.

This preserves the "params are not telemetry" invariant from the plane architecture doc.

### 2.2 Determinism and portability

**Determinism guarantee (v0):**

- **Within a runtime:** Given identical inputs, state, and engine constants (`sampleRate`, `blockFrames`), macro
  evaluation produces identical outputs.
- **Cross-platform:** Numerically stable within tolerances (see below) for operations using transcendentals.
- **Testing:** Use epsilon comparisons for floating operations; exact comparisons only for integer-like paths.

**Numerical tolerances:**

- `absTol = 1e-6` (absolute tolerance for near-zero values)
- `relTol = 1e-6` (relative tolerance for larger values)
- Exact comparison only for int-like values (bool, enum, small constants)

**Value model:**

- VM **semantic type** is `f32`.
- Implementation may compute in JS `number` (f64) but must **round to f32** at:
  - `store_out` (mandatory)
  - After each op in debug builds (recommended for validation)
- This ensures cross-platform consistency and matches golden test expectations.

**Integer-like values:**

- `cmpEq` is **legal only for**:
  - Values derived from `enum` or `bool` deps
  - Compile-time constants ≤ 2^20 (safe margin below f32 exact integer limit)
- `i32`/`u32` deps (if allowed in future) are treated as **numeric only**—no equality semantics.
- **Recommendation for v0:** Restrict deps to `{f32, bool, enum}` only.

**Canonicalization rules:**

- **bool → f32:** `false → 0.0`, `true → 1.0` (any nonzero treated as true during conversion)
- **enum → f32:** Exact integer index (0.0, 1.0, 2.0, ...), range validated at compile time

**Comparison output canonicalization:**

- `cmpLt`, `cmpGt`, `cmpEq` **must** output **exactly** `0.0` or `1.0` (after f32 rounding).
- This ensures `select(cond, t, f)` receives canonical boolean values.

### 2.3 Finite output guarantee

* All macro outputs are **guaranteed finite** (no NaN, no ±Inf).
* Implementation strategy:
  - Compiler marks ops that can produce non-finite (`div`, `logLerp`, `pow`, `onePoleTauMs`).
  - Insert guards around marked ops + at `store_out`.
  - Dev builds may guard every op for debugging.
* Non-finite intermediates clamp to `0.0` (with optional dev telemetry counter).

**Rationale:** One NaN in DSP can poison an entire filter bank. Defense in depth.

### 2.4 Explicit dependency graph

* Every macro declares `deps`.
* Cycles are rejected at compile time.
* Dependency order is stable and validated at plan/build time.
* Macros may depend on other macros (topological sort required).

**Stable evaluation order:**

- **Macro evaluation order:** Macros are compiled/evaluated in **lexicographic order by macro key** (UTF-16 code unit
  order, i.e., JS string sort), after topological sort constraints are applied.
  - Topological sort uses **Kahn's algorithm** with a **lexicographic priority queue** for the "ready" set to ensure
    deterministic ordering when multiple valid orderings exist.
- **Dep binding order:** Deps are bound in **lexicographic order by dep name** (the local dep identifier in the macro
  def), not by authoring object insertion order.
- **Output order:** Outputs are stored in **lexicographic order by output name**.
- This ensures plans built on different machines produce identical binding/program layouts.

### 2.5 Feedback is explicitly opt-in and 1-block delayed

If a macro reads meters and affects DSP (a control loop):

* it must be explicitly documented,
* feedback is **always 1-block delayed** (see execution phases),
* should strongly prefer param inputs unless there's a real reason for meter feedback.

---

## 3. The three-layer architecture

This is the core design lock-in.

### Layer A — Authoring DSL (ergonomic)

Humans author macros using builder helpers:

* `deadzone`, `leftHalf`, `rightHalf`, `triWeight`, `logLerpHz`, `onePoleMs`, etc.
* This layer prioritizes readability and musical intent.

### Layer B — Canonical IR (primitive AST)

Authoring helpers expand into a small set of primitive operations:

* clamp/select/compare
* mix/lerp/logLerp
* deadzone magnitude
* triangle weights
* smoothing (one-pole)
* basic arithmetic

This IR is:

* serializable
* easy to validate
* easy to compile
* the **source of truth** for semantics

### Layer C — Compiled Program (execution format)

Canonical IR compiles into a compact program evaluated per block in the audio thread:

* Expression tree (v0) or bytecode (future optimization)
* Zero alloc
* Bounded state
* Versioned format for forward compatibility

**Key rule:** The verbose object-only form may exist for debugging, but should be **generated**, not hand-authored. The
authoring DSL is what people write.

---

## 4. Block execution phases (immutable)

**The 4-phase execution model:**

1. **Snapshot inputs:** Read params (current tick), read meters (**previous block's committed values**).

- All macro deps are read from a **single coherent snapshot** per block (no mixed-time reads).
- **Latch rule:** Params/meters are **latched at phase 1** and treated as constant for the entire block. No
  intra-block reads.

2. **Evaluate macros:** Process all macro programs using snapshotted inputs + macro state.
3. **Run DSP graph:** Feed macro outputs to DSP nodes, compute audio + meters.
4. **Commit meters:** Write meter values (including any macro `publish` outputs).

**Feedback loop semantics:**

- Macros reading meters see **1-block-delayed** values (from phase 1).
- Macros publishing to meters don't see their own outputs until next block.
- This is **explicit and documented**, not a bug.
- A macro cannot create a same-block feedback loop (provably 1-block delay minimum).

---

## 5. Spec surface (future)

### 5.1 Conceptual shape

Macros live alongside params/meters in the controller spec:

```typescript
type ControllerSpec = {
  params: Record<string, ParamDef>;
  meters: Record<string, MeterDef>;
  macros?: Record<string, MacroDef>;
};
```

### 5.2 Macro definition

A macro definition contains:

* `deps`: named inputs mapped to param/meter keys
* `out`: named derived outputs as expressions
* optional `publish`: map of outputs → meter keys (telemetry/debug only)

**Authoring form (ergonomic):**

```typescript
// Example using future authoring DSL (not yet implemented)
const macros = {
  colorFilter: macro.outputs({
    deps: {x: dep.param("fx.color")},
    out: ({x}: { x: number }) => ({
      lpfHz: fx.onePoleHz(
        fx.logLerpHz(20_000, 200, fx.leftHalf(fx.deadzone(x - 0.5, 0.03))),
        8,
        "lpf",
      ),
      hpfHz: fx.onePoleHz(
        fx.logLerpHz(20, 4_000, fx.rightHalf(fx.deadzone(x - 0.5, 0.03))),
        8,
        "hpf",
      ),
    }),
  }),
};
```

**Input normalization contract:**

- Control params arrive **pre-normalized** (0..1 for unipolar, -1..1 for bipolar).
- UI/control layer does the normalization based on defs.
- Macros **never** assume knowledge of param units/ranges from defs (because defs may be absent in handoff).
- Example: `deadzone(x - 0.5, 0.03)` assumes `x ∈ [0, 1]` by contract, not by inspection of defs.

**Canonical object form (generated/debug):**

```typescript
// Canonical IR representation (generated from authoring DSL)
const canonicalMacro = {
  deps: {x: {src: "param" as const, key: "fx.color"}},
  out: {
    // Primitive AST representation (structure TBD during implementation)
    type: "outputs",
    outputs: { /* ... */}
  },
  publish: {
    // Optional: map outputs to meter keys for telemetry
    // lpfHz: "meter.fx.lpf"
  }
};
```

---

## 6. Runtime compilation format

**No runtime keys:**

- `deps` compile to `{slotIndex, kind}` bindings.
- `publish` compiles to meter slot indices.
- VM operates on indices only, never string keys.

**Compiled macro format:**

```typescript
const derivedSignalsMacrosContract = {
  magic: Uint8Array,          // 4 bytes: ASCII "MACR" [0x4D, 0x41, 0x43, 0x52]
  version: number,            // u32 little-endian, v0 = 1
  flags: number,              // u32 little-endian, v0 must be 0, unknown bits ignored
  program: {
    kind: "tree-v1",          // or "bytecode-v1" in future
    bytes: Uint8Array,        // encoded expression tree (v0) or bytecode (future)
  },
  inputBindings: [                    // deps → plan slots (lexicographic by dep name)
    {slotIndex: 42, kind: "PF32"},  // param.fx.color
    {slotIndex: 17, kind: "PB"},    // param.fx.on
  ],
  outputBindings: [                   // macro outputs (lexicographic by output name)
    {name: "lpfHz", dspIndex: 8},   // where DSP expects it
    {name: "hpfHz", dspIndex: 9, meterSlot: 103 | undefined}, // optional publish
  ],
  stateSlots: [                       // smoothing state
    {id: "lpf", init: "followInput"}, // v0: always init from first input
  ],
}
```

**Serialization details:**

- `magic`: 4 raw bytes equal to ASCII `"MACR"` (0x4D, 0x41, 0x43, 0x52), not a u32.
- `version`: u32 little-endian (v0 = 1).
- `flags`: u32 little-endian (v0 must be 0, unknown bits ignored for forward compatibility).
- All numeric scalars in program/const pools are **IEEE-754 binary32** (f32).
- Binary blobs use **little-endian** encoding for multi-byte fields.

**Program encoding (v0):**

- v0 encodes an expression tree into the binary blob (`program.bytes`) with a versioned schema.
- Bytecode is a future optimization; the tree structure is serialized directly.

### 6.1 Compile time (plan/build time)

The planner (or a dedicated macro compiler step) will:

1. Validate deps exist and have supported kinds (scalar kinds only, initially).
2. Validate macro AST:

* no cycles (within and across macros),
* indices/ranges (enum domain, bool canonicalization expectations),
* `logLerp` endpoints > 0,
* smoothing state ids unique and bounded.

3. Enforce resource caps (see below).
4. Compile canonical AST → program (expression tree or bytecode) + const pool.
5. Sort bindings/outputs in lexicographic order for determinism.
6. Emit compiled macro programs into the **plan/handoff**.

**Resource caps (v0):**

- Max ops per macro: **1024** (prevents pathological macros)
- Max state slots per macro: **32** (bounded memory footprint)
- Max outputs per macro: **64** (reasonable routing complexity)
- Max total macro work per controller per block: **4096 ops** (total across all macros)
- **Op counting:** Measured **after lowering to canonical primitive ops** (i.e., the IR node/opcode count), not
  authoring DSL calls.

These caps are conservative and may be adjusted in future versions with plan format versioning.

### 6.2 Runtime (audio thread, per block)

1. Snapshot params/meters from coherent view (phase 1, latched for entire block).
2. Build macro input vector in stable lexicographic order.
3. Evaluate macro program(s) **once per block** in stable order (lexicographic by macro key, respecting topological
   constraints).
4. Feed derived outputs directly into DSP graph inputs.
5. Optionally publish selected derived values into meter planes (phase 4).

**Default cadence:** per-block.  
**Per-sample evaluation is a non-goal:** If you need per-sample evaluation, you need a DSP node, not a macro.

---

## 7. Minimal primitive op set (v0)

This is the intentionally small set the canonical IR targets:

### Loads / outputs

* `load_in(index)`, `load_const(value)`, `store_out(index, value)`

### Arithmetic / shaping

* `add`, `sub`, `mul`, `div`
* `abs`, `min`, `max`
* `clamp01`, `clamp(x, lo, hi)`

### Comparisons + branching (branchless)

* `cmpLt(a, b)`, `cmpGt(a, b)`, `cmpEq(a, b)` (int-like only for `cmpEq`)
  - All comparison ops output **exactly** `0.0` or `1.0` (canonical boolean values)
* `select(cond, t, f)` (cond must be 0.0 or 1.0)

### Curves / mixing

* `lerp(a, b, t)`
* `logLerp(a, b, t)` (requires a>0, b>0)
  - Centralizes domain validation, ensures consistent mapping semantics, gives compiler hook for future approximations
* `pow(x, exp)`
  - Uses IEEE semantics; if result is non-finite (including NaN from negative base + fractional exponent), it is clamped
    per the finite-output policy

### DJ-specific helpers

* `deadzoneMag(x, dz, halfRange)`
* `triCw(x, center, halfWidth)` (conditional: keep only if profiling shows hot path; otherwise expressible as
  `max(0, 1 - abs((x - center) / halfWidth))`)
* `onePoleTauMs(x, tauMs, stateId)` (bounded state, see semantics below)

**Op admission policy:**

An operation is added to the canonical IR only if it satisfies **both**:

1. **Cannot be expressed** using existing primitives without significant loss (numerical stability, performance, or
   clarity).
2. **Has demonstrated need** from real macro authoring (not speculative).

**Examples:**

- ✅ `onePoleTauMs`: Stateful, can't be expressed without adding state management everywhere.
- ✅ `logLerp`: Centralizes domain validation (`a>0`, `b>0`), ensures consistent mapping semantics, gives compiler hook
  for future approximations.
- ❓ `triCw`: Can be expressed as `max(0, 1 - abs((x - center) / halfWidth))`. **Keep only if profiling shows it's hot.**
- ❌ `remap(x, inMin, inMax, outMin, outMax)`: Sugar for `lerp(outMin, outMax, (x - inMin) / (inMax - inMin))`. Use a DSL
  helper that expands to primitives.

**Additions require demonstrated need.** This set should stay lean.

---

## 8. `onePoleTauMs` semantics (physics-precise)

This is the **only stateful op** in v0, so it deserves specification-level clarity.

**Physics:**

```
alpha = 1 - exp(-blockFrames / (sampleRate * tauMs / 1000))
state[stateId] = state[stateId] + (input - state[stateId]) * alpha
output = state[stateId]
```

**State initialization:**

- Strategy: `"followInput"` (v0 default)
- First evaluation sets `state[stateId] = input` (no startup ramp, prevents clicks).
- Future (v1): May add `{ const: value }` for explicit init values.

**State scoping:**

- State slots are scoped per `(macroId, controllerId)` pair automatically.
- The `stateId` is just a local name within that scope.
- Multiple instances (e.g., 4 decks with same macro) get separate state.

**Non-finite handling:**

- If `input` is NaN/Inf: clamp to `0.0`, increment dev telemetry counter.
- If `state` becomes non-finite (shouldn't happen): reset to `0.0`.

**Reset policy (v0):**

- State **persists** across macro evaluations (even mode changes).
- Rationale: Knob smoothing should be continuous. Mode-gated weights smooth from current input anyway.
- **Future (v1):** Add `resetKey` parameter for explicit reset-on-value-change if needed.

**Block-rate alpha:**

- Alpha is computed **once per block** (not per sample—macro evaluation is block-rate).
- This is a block-rate one-pole filter applied to the macro's per-block output.

---

## 9. Constraints and non-goals (v0)

### 9.1 v0 constraints

* Macro deps: **scalar** params/meters only (initially):
  * `f32`, `bool`, `enum` (no `i32`/`u32` until demonstrated need)
* No loops, no user-defined functions, no allocations.
* No arbitrary external calls (pure evaluation only, except stateful smoothing).
* Resource caps enforced at compile time (see section 6.1).

### 9.2 Non-goals

* This is **not** a scripting language.
* This does **not** replace the DSP graph.
* This does **not** create new planes or new storage formats.
* This does **not** allow audio thread to write params.

---

## 10. Plan/handoff contract

Macro programs must be part of the emitted plan so the worklet can evaluate them even when defs/spec aren't present.

* Plans must remain self-sufficient:
  * include slot `kind` metadata (already locked in)
  * include compiled macro programs (this feature)
  * string keys compiled to slot indices
* Version macro program format (`magic`, `version`, `flags`) for forwards compatibility.
* Lexicographic ordering ensures deterministic builds across machines.

---

## 11. Testing strategy (future)

### 11.1 Golden tests (numerical)

* Given fixed inputs over multiple blocks:
  * outputs match expected values (with appropriate tolerances)
  * smoothing behaves predictably
* Use `absTol` and `relTol` for floating ops; exact for int-like paths.

### 11.2 Continuity tests ("feel tests")

* No discontinuity at neutral center beyond deadzone.
* No discontinuity when switching modes (weights ramp smoothly).
* Monotonicity where intended (e.g., cutoff moves one direction).

### 11.3 Runtime constraints

* Zero alloc checks (where possible)
* Bounded state
* Deterministic ordering (stable input vector, stable deps resolution)
* Finite output validation (no NaN/Inf escapes)

---

## 12. Canonical behaviors we must support

### 12.1 Pioneer "COLOR" knob archetype

Inputs:

* `colorFx.mode : enum` (mode buttons: FILTER, NOISE, DUB ECHO, SPACE, CRUSH, etc.)
* `colorFx.knob : f32` (0..1 or bipolar)
* optional `colorFx.on : bool`

Derived:

* routing weights: `wetFilter`, `wetNoise`, `wetEcho`, `wetSpace`, `wetCrush`
* shaped params per mode (cutoffs, sends, feedback, etc.)
* anti-click behavior via smoothing on weights and/or key params

### 12.2 Piecewise bipolar mapping

"Left does LOW, right does HI, neutral center."

Must support:

* deadzone around center
* sign split (`leftHalf`, `rightHalf`)
* independent shaping for left vs right
* log-frequency mapping + smoothing

### 12.3 Mode gating without clicks

Switching mode should not click:

* smooth routing weights with one-pole (5–20ms typical)
* optionally smooth sensitive parameters
* weights ramp from previous state, not from zero

---

## 13. Roadmap and gating

**This feature is locked as a direction, but gated behind core stability.**

### When we start implementing

We implement in this order:

1. Canonical AST + validation (no runtime yet)
2. Compiler to program format (serializable, deterministic)
3. Interpreter (per-block, expression tree evaluator in worklet)
4. Minimal authoring DSL sugar + domain helpers
5. Optional meter publish path
6. Only then consider optimizations (bytecode, per-sample eval, richer ops)

### Minimal macro to prove architecture

Start with the simplest possible macro:

```typescript
// Simple bipolar filter (no mode switching, no piecewise complexity, no smoothing)
const macros = {
  simpleFilter: macro.outputs({
    deps: {x: dep.param("filter.knob")},  // -1..1
    out: ({x}: { x: number }) => ({
      lpfGain: fx.lerp(0, 1, fx.max(0, -x)),  // left half
      hpfGain: fx.lerp(0, 1, fx.max(0, x)),   // right half
    }),
  }),
};
```

Implement just enough compiler/interpreter to make this work. No smoothing, no enums, no state. Then add incrementally.

### Criteria to proceed

* Core plane + kinds + plan contracts stable
* No ongoing refactors that would churn plan format
* Clear first consumer (Sound Color FX / macro controls) with golden tests

---

## 14. Development tooling

### 14.1 Macro REPL (early priority)

Build a **macro REPL** for iteration:

- Paste in macro def
- Feed test inputs (params/meters)
- See outputs + intermediate values
- Essential for authoring and debugging

### 14.2 Trace mode

When a macro misbehaves (wrong output, clicks, NaNs):

- **Trace mode:** Emit all intermediate register values to debug buffer.
- **Assertions:** NaN checks, range checks (did `logLerp` get negative input?).
- Dev builds only (high overhead).

---

## 15. Summary (what we locked)

* ✅ Macros/Derived Signals will exist in spec as serializable, deterministic derived graphs.
* ✅ No param-plane writes from audio thread; derived values feed DSP directly; publish to meters if needed.
* ✅ Three layers: ergonomic authoring → primitive IR → compiled program.
* ✅ Minimal op set, grows only by demonstrated need with strict admission criteria.
* ✅ Plan/handoff will carry compiled macro programs to keep worklet self-sufficient.
* ✅ Strong testing strategy to preserve "feel" (continuity, no clicks, determinism).
* ✅ **4-phase execution model** with explicit 1-block-delayed feedback semantics.
* ✅ **Latch rule:** Params/meters latched at phase 1, constant for entire block.
* ✅ **Finite output guarantee** to prevent NaN poisoning DSP.
* ✅ **Precise `onePoleTauMs` physics** with init-from-input and per-block alpha.
* ✅ **Input normalization contract** independent of defs at runtime.
* ✅ **Value model** as f32 semantic type with explicit rounding points.
* ✅ **Bool/enum canonicalization** rules for cross-platform consistency.
* ✅ **Comparison ops output canonical 0.0/1.0** for boolean consistency.
* ✅ **Stable lexicographic ordering** for deterministic builds across machines.
* ✅ **Serialization format** (little-endian, IEEE-754 binary32, magic as raw ASCII bytes, flags field) for
  cross-platform safety.
* ✅ **Resource caps** make "bounded" enforceable at compile time.
* ✅ **Domain semantics for `pow`** documented with finite-output policy.

---

**This is an implementation contract.** Every semantic choice is explicit, every edge case has a policy, every future
implementer can build this without inventing semantics in the margins. Future work is engineering, not archaeology.
