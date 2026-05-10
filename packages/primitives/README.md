# @seqlok/primitives

`@seqlok/primitives` is the hot-path foundation of Seqlok.

It provides the low-level shared-memory mechanisms that higher layers build on:

- seqlock read/write primitives for coherent multi-word exchange
- SWSR ring allocation and producer/consumer binding
- plane identifiers and packing helpers for ABI-level memory layout
- small atomics helpers used by runtime code
- the `primitives.*` error domain

This package is intentionally **schema-free**.
It owns mechanisms, not product meaning.

If you need shared-state bindings, handoff, or spec DSL, that belongs in `@seqlok/core`.
If you need typed command transport, that belongs in `@seqlok/commands`.
If you need RT-safe telemetry schemas and SAB rings, that belongs in `@seqlok/diagnostics`.

---

## What belongs here

- seqlock mechanics
- ring mechanics
- plane vocabulary and memory packing helpers
- atomics utilities
- primitive-level error domains

## What does not belong here

- params/meters DSL
- spec validation
- layout planning policy
- handoff envelopes
- command semantics
- telemetry snapshot schemas
- UI decoding, dashboards, counters, or analysis tools
- any domain concepts like decks, BPM, tracks, cues, or host workflow policy

If a type starts to describe _what_ the data means rather than _how_ it moves or is stored, it probably does not belong in `@seqlok/primitives`.

---

## Current public surface

Today this package exports five families of things.

### 1. Seqlock

Single-writer, multi-reader coherence for multi-word shared state.

Public surface includes:

- `createSeqPair(...)`
- `tryRead(...)`
- `publish(...)`
- `beginWrite(...)`
- `endWrite(...)`

And the related types:

- `SeqPair`
- `ReadStatus`
- `TryReadOptions`
- `TryReadResult`

The core idea is simple:

- writer marks the write window
- reader retries until it sees a stable even sequence
- higher layers choose the retry policy they want on top

### 2. Planes

Plane identifiers and packing vocabulary shared across layout/backing code.

Public surface includes:

- `ALL_PLANES`
- `BYTES_PER_ELEM`
- `PLANE_PACK_ORDER`
- `isPlaneKey(...)`
- `assertPlaneKey(...)`
- `roundUpTo(...)`

And the related types:

- `PlaneKey`
- `PlaneRecord`

This is ABI-level vocabulary, not UI vocabulary.

### 3. Atomics helpers

Small helpers around low-level shared-memory coordination:

- `addU32(...)`
- `loadU32(...)`
- `spinUntilEven(...)`

These are intentionally tiny.
They exist so higher layers do not rewrite the same unsafe low-level moves repeatedly.

### 4. SWSR ring

Single-writer, single-reader ring primitive over `SharedArrayBuffer`.

Public surface includes:

- `allocateSwsrRing(...)`
- `bindSwsrRingProducer(...)`
- `bindSwsrRingConsumer(...)`

Header constants:

- `SWSR_HEADER_DROPPED`
- `SWSR_HEADER_WORDS`
- `SWSR_HEADER_READ_INDEX`
- `SWSR_HEADER_WRITE_INDEX`
- `SWSR_HEADER_WRITE_SEQ`

And the related types:

- `SwsrRingBacking`
- `SwsrRingLayout`
- `SwsrRingProducer`
- `SwsrRingConsumer`
- `SwsrRingEncode`
- `SwsrRingDecode`
- `SwsrRingStats`

This is the mechanical substrate underneath higher layers like `@seqlok/commands` and stream transport.

### 5. Primitive errors

The `primitives.*` error domain is also defined here.

Public surface includes:

- `PRIMITIVES_ERRORS`
- `PRIMITIVES_DOMAIN`
- `createPrimitivesError(...)`

And the related types for code, key, details, and domain mapping.

---

## Seqlock example

```ts
import {
  createSeqPair,
  tryRead,
  beginWrite,
  endWrite,
} from "@seqlok/primitives";

const pair = createSeqPair(sab, lockIndex, seqIndex);

// writer side
beginWrite(pair);
try {
  // mutate shared payload here
} finally {
  endWrite(pair);
}

// reader side
const result = tryRead(pair, () => {
  return {
    valueA: sharedView[0],
    valueB: sharedView[1],
  };
});

if (result.ok) {
  console.log(result.value);
}
```

This package does not decide whether retries should degrade, throw, or surface counters.
That policy belongs above the primitive.

---

## SWSR ring example

```ts
import {
  allocateSwsrRing,
  bindSwsrRingProducer,
  bindSwsrRingConsumer,
} from "@seqlok/primitives";

const backing = allocateSwsrRing({
  capacity: 256,
  wordsPerSlot: 4,
});

const producer = bindSwsrRingProducer(backing, {
  encode(command, dst, wordOffset) {
    // encode one fixed-width slot
  },
});

const consumer = bindSwsrRingConsumer(backing, {
  decode(src, wordOffset) {
    // decode one fixed-width slot
  },
});

producer.enqueue(command);

consumer.drain((decoded) => {
  handleDecoded(decoded);
});
```

If you want typed mailboxes, codec contracts, or bus composition, go to `@seqlok/commands`.
Those are not primitive responsibilities.

---

## Relationship to the rest of Seqlok

Use this package when you need the mechanism itself.

- Reach **up** to `@seqlok/core` when you want spec → plan → backing → handoff → bindings.
- Reach **up** to `@seqlok/commands` when you want typed command transport.
- Reach **sideways** to `@seqlok/diagnostics` when you want RT-safe telemetry structures.
- Reach **up** to `@seqlok/introspect` when you want analysis, counters, sinks, registry export, or tooling.

That split is deliberate.
`@seqlok/primitives` stays small by refusing to own semantics.

---

## Source of truth

For exact exported symbols, use:

- `src/index.ts`

For how the package fits into the workspace, use:

- `../README.md`
