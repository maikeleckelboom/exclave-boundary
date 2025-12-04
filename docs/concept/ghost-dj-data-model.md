# Ghost DJ Data Model Specification

> A formal specification for session logging, state representation, and training data architecture.

## 1. Conceptual Model

Ghost DJ is a learned policy over DJ session trajectories. A **session** is a sequence of state-action pairs:

$$
\tau = \{(s_k, a_k)\}_{k=0}^{K}
$$

Where:

- $s_k$ = state immediately **before** taking action $k$
- $a_k$ = action taken (play, crossfade, load track, etc.)

The goal: learn a policy $\pi_\theta(a \mid s)$ via imitation learning, so Ghost DJ produces similar actions in similar
states.

**Logging requirements reduce to:**

1. Capture enough information to reconstruct state vector $s_k$ at each decision point
2. Capture actions $a_k$ in a typed, unambiguous format

All complex feature engineering happens **offline** during dataset construction—runtime logging stays minimal.

**Time origin convention:** All times and frame indices in `CommandEvent` and `SessionState` are relative to the start
of the session (`tSeconds = 0`, `frameIndex = 0` immediately before the first command).

---

## 2. Track Representation

### 2.1 Core Track Features

The engine resamples all tracks to a common session sample rate $f_s$ (e.g., 48 kHz), defined in
`SessionMeta.sessionSampleRate`. All frame counts in `TrackFeatures` are at this engine rate;
`durationSeconds = durationFrames / sessionSampleRate`.

For each track $j$:

| Field             | Type                      | Description                               |
|-------------------|---------------------------|-------------------------------------------|
| `trackId`         | `string`                  | Unique identifier                         |
| `bpm`             | `number`                  | Beats per minute (constant or piecewise)  |
| `durationSeconds` | `number`                  | Total duration (derived from frames)      |
| `durationFrames`  | `number`                  | Canonical length in frames at engine rate |
| `musicalKey`      | `string \| null`          | e.g., `"F#m"`, `"Gm"`                     |
| `genre`           | `string \| null`          | e.g., `"hard-tek"`, `"industrial"`        |
| `energyPerBar`    | `readonly number[]`       | $E_j[k]$ = energy in bar $k$              |
| `sectionPerBar`   | `readonly SectionLabel[]` | $\sigma_j[k]$ = section label for bar $k$ |

```typescript
interface TrackFeatures {
  readonly trackId: string;
  readonly bpm: number;
  readonly durationSeconds: number;   // = durationFrames / sessionSampleRate
  readonly durationFrames: number;    // at sessionSampleRate
  readonly musicalKey: string | null;
  readonly genre: string | null;
  readonly energyPerBar: readonly number[];
  readonly sectionPerBar: readonly SectionLabel[];
}

type SectionLabel = 0 | 1 | 2 | 3 | 4;
// 0 = intro, 1 = build, 2 = drop, 3 = breakdown, 4 = outro
```

### 2.2 Beat and Bar Mathematics

#### Seconds-based formulation

Given track $j$ with BPM $b_j$ and playback time $t$ (seconds from track start):

**Beat index:**
$$
\text{beat}_j(t) = \frac{b_j}{60} \cdot t
$$

**Bar index (4/4 time):**
$$
\text{bar}_j(t) = \left\lfloor \frac{\text{beat}_j(t)}{4} \right\rfloor
$$

**Position within the current bar:**
$$
\phi_j(t) = \text{beat}_j(t) \bmod 4 \quad \in [0, 4)
$$

With rate adjustment $r$ (1.0 = original tempo, 1.03 = +3%):

$$
\text{beat}_j(t, r) = \frac{b_j}{60} \cdot t \cdot r
$$

#### Frame-based formulation

With integer frame index $n$ from track start and sample rate $f_s$ (Hz):

$$
t_j(n) = \frac{n}{f_s}
$$

$$
\text{beat}_j(n, r) = \frac{b_j}{60} \cdot \frac{n}{f_s} \cdot r
$$

$$
\text{bar}_j(n, r) = \left\lfloor \frac{\text{beat}_j(n, r)}{4} \right\rfloor
$$

$$
\phi_j(n, r) = \text{beat}_j(n, r) \bmod 4
$$

In practice, we track playback in frames and derive seconds and musical units from that. Frames are the canonical
timeline; seconds are a derived view for human readability and ML normalization.

### 2.3 Section Boundary Detection

Let $\sigma_j[k]$ be the section label for bar $k$.

**Next section change bar:**
$$
\kappa_j(\gamma) = \min\{k > \gamma \mid \sigma_j[k] \neq \sigma_j[\gamma]\}
$$

**Bars until next section change:**
$$
\Delta_{\text{section}}(\gamma) =
\begin{cases}
\kappa_j(\gamma) - \gamma, & \text{if } \kappa_j(\gamma) \text{ exists} \\
+\infty, & \text{otherwise}
\end{cases}
$$

---

### 2.4 Optional Harmonic & Fingerprint Features

The core data model does not require detailed pitch maps or audio fingerprints.  
Those are optional enrichments that can be added as they become useful for:

- Harmonic mixing (key/scale compatibility, avoiding clashes)
- Smarter track selection / recommendation
- Robust track identity (dedupe, matching across providers)

These features are computed offline from audio and attached to `TrackFeatures`
via optional nested objects keyed by `trackId`.

```typescript
// Pitch classes: 0 = C, 1 = C#, ..., 11 = B
type PitchClassIndex =
  | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

interface TrackHarmonicFeatures {
  /**
   * 12-dimensional chroma / pitch-class energy per bar.
   * Each inner array is length 12, normalized however the
   * analyzer defines (e.g., L2 or sum = 1).
   *
   * chromaPerBar[k][p] ≈ energy of pitch class `p` in bar `k`.
   */
  readonly chromaPerBar: readonly (readonly number[])[];

  /**
   * Estimated tonic as a pitch class, if available.
   * This can be used together with `musicalKey` or instead of it.
   */
  readonly tonicPitchClass: PitchClassIndex | null;

  /**
   * Confidence score for the key/tonic estimate, in [0, 1].
   */
  readonly keyConfidence: number | null;
}

type AudioFingerprintKind = 'chromaprint' | 'spectral' | 'custom';

interface TrackFingerprint {
  /**
   * Family of fingerprint used (for tooling / decoding).
   */
  readonly kind: AudioFingerprintKind;

  /**
   * Encoded fingerprint blob, e.g. base64 string.
   */
  readonly value: string;

  /**
   * Optional version/tag for the extractor implementation.
   */
  readonly version: string | null;
}

interface TrackFeatures {
  readonly trackId: string;
  readonly bpm: number;
  readonly durationSeconds: number;   // = durationFrames / sessionSampleRate
  readonly durationFrames: number;    // at sessionSampleRate
  readonly musicalKey: string | null;
  readonly genre: string | null;
  readonly energyPerBar: readonly number[];
  readonly sectionPerBar: readonly SectionLabel[];

  /**
   * Optional harmonic analysis attached offline.
   */
  readonly harmonic?: TrackHarmonicFeatures;

  /**
   * Optional audio fingerprint for dedupe / cross-provider ID.
   */
  readonly fingerprint?: TrackFingerprint;
}
```

## 3. Command Logging

### 3.1 Command Types

Commands are the raw actions logged at runtime. Each command has a timestamp and typed payload.

```typescript
type DeckId = 'A' | 'B';

// ─────────────────────────────────────────────────────────────
// Deck Commands
// ─────────────────────────────────────────────────────────────

interface CommandPlay {
  readonly type: 'deck.play';
  readonly deck: DeckId;
}

interface CommandStop {
  readonly type: 'deck.stop';
  readonly deck: DeckId;
}

interface CommandLoadTrack {
  readonly type: 'deck.loadTrack';
  readonly deck: DeckId;
  readonly trackId: string;
}

interface CommandSetRate {
  readonly type: 'deck.setRate';
  readonly deck: DeckId;
  readonly rate: number; // 1.0 = original, 1.03 = +3%
}

interface CommandSeek {
  readonly type: 'deck.seek';
  readonly deck: DeckId;
  readonly frameInTrack: number;      // canonical
  readonly tSeconds?: number;         // optional, derived
}

interface CommandSetCuePoint {
  readonly type: 'deck.setCuePoint';
  readonly deck: DeckId;
  readonly cueId: string;
  readonly frameInTrack: number;      // canonical
  readonly tSeconds?: number;         // optional, derived
}

// ─────────────────────────────────────────────────────────────
// Mixer Commands
// ─────────────────────────────────────────────────────────────

interface CommandCrossfader {
  readonly type: 'mixer.setCrossfader';
  readonly value: number; // -1 (full A) to +1 (full B)
}

interface CommandChannelGain {
  readonly type: 'mixer.setChannelGain';
  readonly deck: DeckId;
  readonly gainDb: number;
}

interface CommandFilter {
  readonly type: 'mixer.setFilter';
  readonly deck: DeckId;
  readonly frequencyHz: number;
  readonly resonance: number;
}

interface CommandEq {
  readonly type: 'mixer.setEq';
  readonly deck: DeckId;
  readonly band: 'low' | 'mid' | 'high';
  readonly gainDb: number;
}

// ─────────────────────────────────────────────────────────────
// Union
// ─────────────────────────────────────────────────────────────

export type GhostDjCommand =
  | CommandPlay
  | CommandStop
  | CommandLoadTrack
  | CommandSetRate
  | CommandSeek
  | CommandSetCuePoint
  | CommandCrossfader
  | CommandChannelGain
  | CommandFilter
  | CommandEq;
```

For commands that reference a position within the track (`deck.seek`, `deck.setCuePoint`), `frameInTrack` at engine
sample rate is canonical. `tSeconds` is optional and, if present, must equal `frameInTrack / sessionSampleRate`.

### 3.2 Command Events

Each logged event pairs timestamps with a command. `frameIndex` is the canonical engine timeline (sample-accurate);
`tSeconds = frameIndex / sessionSampleRate` is a convenience for humans and ML normalization.

```typescript
interface CommandEvent {
  readonly tSeconds: number;       // τ_k: seconds since session start (derived)
  readonly frameIndex: number;     // N_k: integer frames since session start at engine sample rate
  readonly command: GhostDjCommand;
}
```

This is exactly what `CommandBus` emits—`SessionRecorder` mirrors the stream to disk.

---

## 4. State Reconstruction

State is **derived offline** by replaying the command log against track features.

### 4.1 Per-Deck State

```typescript
interface DeckState {
  readonly deck: DeckId;
  readonly trackId: string | null;
  readonly isPlaying: boolean;

  // Playback position (frames are canonical, seconds derived)
  readonly rate: number;              // r_d(τ)
  readonly tSeconds: number;          // t_d(τ): seconds from track start
  readonly frameInTrack: number;      // n_d: integer frames from track start at engine rate

  // Beat/bar indices (derived from frameInTrack)
  readonly beatIndex: number;         // β_d = (b_j / 60) · (n_d / f_s) · r_d
  readonly barIndex: number;          // γ_d = floor(β_d / 4)
  readonly beatInBar: number;         // φ_d = β_d mod 4, ∈ [0, 4)
  readonly beatInBarQuantized: 0 | 1 | 2 | 3;

  // Track features at current position
  readonly barEnergy: number;         // E_j[γ_d]
  readonly barSection: SectionLabel;  // σ_j[γ_d]
  readonly barsUntilSectionChange: number;
}
```

### 4.2 Cross-Deck State

Captures inter-deck relationships:

```typescript
interface CrossDeckState {
  // Phase alignment: (φ_B - φ_A) mod 4, mapped to [-2, 2)
  readonly phaseOffsetBeats: number;

  // BPM difference: b_jB - b_jA
  readonly bpmDifference: number;

  // Which deck is "outgoing" vs "incoming" based on crossfader direction
  readonly transitionDirection: 'A->B' | 'B->A' | 'neutral';
}
```

### 4.3 Mixer State

```typescript
interface MixerState {
  readonly crossfader: number;        // x(τ) ∈ [-1, +1]
  readonly channelGainA: number;
  readonly channelGainB: number;
}
```

### 4.4 Full Session State

Assembled at each decision point. `frameIndex` is the primary timeline; `tSeconds` is derived as
`frameIndex / sessionSampleRate` and exists for human readability and ML normalization.

```typescript
interface SessionState {
  readonly tSeconds: number;          // τ_k (derived)
  readonly frameIndex: number;        // N_k (canonical)
  readonly decks: readonly [DeckState, DeckState];
  readonly crossDeck: CrossDeckState;
  readonly mixer: MixerState;
}
```

---

## 5. Transition Abstractions

Raw crossfader events form dense control signals. For training, we compress them into **transition primitives**
—higher-level actions the policy can predict.

### 5.1 Crossfade Transitions

A transition from deck L to deck R is a time interval $[\tau_s, \tau_e]$ where crossfader moves from near $-1$ to
near $+1$.

**Curve approximation:**
$$
x(\tau) \approx -1 + 2 \cdot f\left(\frac{\tau - \tau_s}{\tau_e - \tau_s}\right), \quad \tau \in [\tau_s, \tau_e]
$$

Where $f: [0,1] \to [0,1]$ is a shaping function:

| Curve Kind | Formula                   | Behavior                                           |
|------------|---------------------------|----------------------------------------------------|
| Linear     | $f(u) = u$                | Constant rate                                      |
| Power      | $f(u; \alpha) = u^\alpha$ | $\alpha < 1$: fast start; $\alpha > 1$: slow start |
| S-curve    | $f(u) = 3u^2 - 2u^3$      | Smooth ease-in/ease-out                            |

```typescript
interface CrossfadeTransition {
  readonly fromDeck: DeckId;
  readonly toDeck: DeckId;

  // Timing (frames canonical, seconds derived)
  readonly tStartSeconds: number;     // τ_s
  readonly tEndSeconds: number;       // τ_e
  readonly startFrame: number;        // N_s
  readonly endFrame: number;          // N_e

  // Duration in musical terms
  readonly barsDurationOnFrom: number;
  readonly barsDurationOnTo: number;

  // Curve shape
  readonly curveKind: 'linear' | 'power' | 's-curve';
  readonly curveAlpha: number;        // Only for 'power'
}
```

### 5.2 Filter Gestures

The same pattern applies to filter sweeps, EQ moves, etc.:

```typescript
interface FilterGesture {
  readonly deck: DeckId;
  readonly tStartSeconds: number;
  readonly tEndSeconds: number;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly freqStartHz: number;
  readonly freqEndHz: number;
  readonly resonance: number;
  readonly curveKind: 'linear' | 'power' | 'exponential';
}

interface EqGesture {
  readonly deck: DeckId;
  readonly band: 'low' | 'mid' | 'high';
  readonly tStartSeconds: number;
  readonly tEndSeconds: number;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly gainStartDb: number;
  readonly gainEndDb: number;
}
```

### 5.3 Transition Extraction Algorithm

From the replayed mixer curve $x(\tau)$ (or equivalently $x[n]$ over frame indices, where $\tau = n / f_s$):

1. Find windows where $x(\tau_s) \approx -1$ and $x(\tau_e) \approx +1$ (or vice versa)
2. Verify derivative is mostly monotonic between them
3. Fit curve parameters via least squares
4. Associate with state $s(\tau_s^-)$ at transition start

This converts dense fader spam into gesture-level actions for the policy.

---

## 6. Session Metadata

### 6.1 Session-Level Info

```typescript
interface SessionMeta {
  readonly sessionId: string;
  readonly startedAtIso: string;       // ISO 8601
  readonly sessionSampleRate: number;  // Engine sample rate for this session

  // Version tracking
  readonly engineVersion: string;      // Seqlok version / commit
  readonly hotswapVersion: string;     // @seqlok/hotswap version
  readonly ghostDjPolicyId: string;    // "human-maikel-v1", "rule-based-001"

  // Context
  readonly targetGenre: string | null; // "hard-tek", etc.
  readonly targetBpmRange: readonly [number, number] | null;
}
```

### 6.2 Session Outcome Labels

Post-hoc quality ratings for trajectory filtering:

```typescript
interface SessionOutcome {
  readonly sessionId: string;
  readonly rating: 1 | 2 | 3 | 4 | 5;
  readonly notes: string | null;

  // Optional fine-grained flags
  readonly floorDied?: boolean;
  readonly setType?: 'warmup' | 'peak' | 'afterhours';
}
```

**Usage:**

- Prefer trajectories with rating ≥ 4 for imitation
- Lower-rated sessions can train "what not to do" or be filtered out

### 6.3 Hotswap Engine Mode

Captures which engine variant was active at decision times:

```typescript
interface EngineModeSnapshot {
  readonly deck: DeckId;
  readonly engineKind: 'varispeed' | 'stretchLow' | 'stretchHigh';
  readonly phase: 'idle' | 'spawn' | 'prime' | 'preWarm' | 'crossFade' | 'retire';
}
```

Log at discrete mode changes or sample at command events.

---

## 7. Dataset Construction

### 7.1 Training Pairs

For each command event $e_k = (\tau_k, N_k, c_k)$:

1. Reconstruct state $s_k$ from replayed log + track features
2. Encode action $a_k$ from command $c_k$

Dataset:
$$
\mathcal{D} = \{(s_k, a_k)\}_{k=0}^{K_{\text{all}}}
$$

### 7.2 Context Windows

For sequence models, slice history:
$$
x_k = (s_{k-H}, \ldots, s_k)
$$

for some horizon $H$ (in beats, bars, or commands). No additional logging required—just how you window the sequence
during training.

### 7.3 Filtering and Weighting

- **By policy source:** Separate human vs. rule-based vs. learned policy sessions
- **By outcome rating:** Weight higher-rated sessions more
- **By engine version:** Filter out sessions from buggy engine versions

---

## 8. Minimum Viable Logging

### 8.1 Per Track (offline, pre-session)

Required:

- `trackId`
- `bpm`
- `durationFrames` (at `sessionSampleRate`)

Derived:

- `durationSeconds` = `durationFrames / sessionSampleRate`

Highly recommended:

- `energyPerBar: number[]` (RMS or spectral energy per bar)
- `sectionPerBar: SectionLabel[]`

Optional:

- `musicalKey`
- `genre`

### 8.2 Per Command (runtime)

Log exactly:

```typescript
interface CommandEvent {
  readonly tSeconds: number;
  readonly frameIndex: number;
  readonly command: GhostDjCommand;
}
```

That's it. Everything else derives offline.

### 8.3 Per Session (start/end)

At session start:

- `SessionMeta` with IDs, versions, and `sessionSampleRate`

At the session end:

- Optional `SessionOutcome` rating

---

## 9. Implementation Notes

### 9.1 Runtime Logging Flow

```
CommandBus.emit(command)
    │
    ├─► Engine executes command
    │
    └─► SessionRecorder.record({ tSeconds, frameIndex, command })
              │
              └─► Append to session log (NDJSON or binary)
```

### 9.2 Offline Dataset Builder

```
Load session logs
    │
    ├─► Load track features for referenced tracks
    │
    ├─► Replay log to reconstruct state at each event
    │   (using frameIndex as canonical timeline)
    │
    ├─► Extract transition primitives from mixer curves
    │
    └─► Emit (state, action) pairs to training dataset
```

### 9.3 File Formats

| Data             | Format                     | Notes                                   |
|------------------|----------------------------|-----------------------------------------|
| Session logs     | NDJSON                     | One `CommandEvent` per line, streamable |
| Track features   | JSON                       | Pre-computed, loaded at session start   |
| Training dataset | Apache Parquet or TFRecord | Columnar for efficient training         |

---

## 10. Scaling Guidance

### Phase 1: Engine + UX Proving

- **Tracks:** 4–8
- **Focus:** Prove hotswap correctness, prototype rule-based Ghost DJ
- No learning yet

### Phase 2: First Learning Experiments

- **Tracks:** 20–50 (focused on target genre)
- **Sessions:** 10–20 serious recordings per track
- **Data volume:** ~7,500+ distinct state-action pairs
- Enough for a small policy net to learn interesting behavior

### Phase 3: Scaling

- **Tracks:** 100–200
- Add genre diversity, edge cases (breaks, vocals, weird structures)
- Only after architecture is locked and a data pipeline is solid

---

## Appendix A: Example Session Log

```jsonl
{"tSeconds":0.0,"frameIndex":0,"command":{"type":"deck.loadTrack","deck":"A","trackId":"tk-001"}}
{"tSeconds":0.5,"frameIndex":24000,"command":{"type":"deck.play","deck":"A"}}
{"tSeconds":45.2,"frameIndex":2169600,"command":{"type":"deck.loadTrack","deck":"B","trackId":"tk-002"}}
{"tSeconds":60.0,"frameIndex":2880000,"command":{"type":"mixer.setCrossfader","value":-0.95}}
{"tSeconds":60.5,"frameIndex":2904000,"command":{"type":"deck.play","deck":"B"}}
{"tSeconds":62.0,"frameIndex":2976000,"command":{"type":"mixer.setCrossfader","value":-0.7}}
{"tSeconds":64.0,"frameIndex":3072000,"command":{"type":"mixer.setCrossfader","value":-0.3}}
{"tSeconds":66.0,"frameIndex":3168000,"command":{"type":"mixer.setCrossfader","value":0.1}}
{"tSeconds":68.0,"frameIndex":3264000,"command":{"type":"mixer.setCrossfader","value":0.5}}
{"tSeconds":70.0,"frameIndex":3360000,"command":{"type":"mixer.setCrossfader","value":0.9}}
{"tSeconds":75.0,"frameIndex":3600000,"command":{"type":"deck.stop","deck":"A"}}
```

(Assuming 48 kHz session sample rate)

---

## Appendix B: State Vector for Neural Policy

When converting `SessionState` to a numeric vector for training:

```typescript
function stateToVector(s: SessionState): Float32Array {
  // Normalize all features to roughly [-1, 1] or [0, 1] range
  return Float32Array.from([
    // Deck A
    s.decks[0].isPlaying ? 1 : 0,             // playing flag
    s.decks[0].rate - 1.0,                    // rate deviation
    s.decks[0].beatInBar / 4.0,               // phase in bar [0, 1)
    s.decks[0].barEnergy,                     // assume pre-normalized
    s.decks[0].barSection / 4.0,              // section label normalized
    Math.min(s.decks[0].barsUntilSectionChange, 64) / 64, // capped and normalized

    // Deck B
    s.decks[1].isPlaying ? 1 : 0,             // playing flag
    s.decks[1].rate - 1.0,
    s.decks[1].beatInBar / 4.0,
    s.decks[1].barEnergy,
    s.decks[1].barSection / 4.0,
    Math.min(s.decks[1].barsUntilSectionChange, 64) / 64,

    // Cross-deck
    s.crossDeck.phaseOffsetBeats / 4.0,       // [-0.5, 0.5]
    s.crossDeck.bpmDifference / 20.0,         // assume max ±20 BPM

    // Mixer
    s.mixer.crossfader,                        // already [-1, 1]
  ]);
}
```

Extend as needed with additional features—this is the minimal viable state representation.

---

## Appendix C: Frame/Time Conversion Reference

```typescript
// Session sample rate is the single source of truth for all frame conversions
const sessionSampleRate = 48000; // Hz

// ─────────────────────────────────────────────────────────────
// Session-level conversions
// ─────────────────────────────────────────────────────────────

function frameToSeconds(frameIndex: number): number {
  return frameIndex / sessionSampleRate;
}

function secondsToFrame(tSeconds: number): number {
  return Math.round(tSeconds * sessionSampleRate);
}

// ─────────────────────────────────────────────────────────────
// Track-level beat/bar from frames
// ─────────────────────────────────────────────────────────────

function frameToBeat(
  frameInTrack: number,
  bpm: number,
  rate: number
): number {
  const tSeconds = frameInTrack / sessionSampleRate;
  return (bpm / 60) * tSeconds * rate;
}

function frameToBar(
  frameInTrack: number,
  bpm: number,
  rate: number
): number {
  return Math.floor(frameToBeat(frameInTrack, bpm, rate) / 4);
}

function frameToBeatInBar(
  frameInTrack: number,
  bpm: number,
  rate: number
): number {
  return frameToBeat(frameInTrack, bpm, rate) % 4;
}
```
