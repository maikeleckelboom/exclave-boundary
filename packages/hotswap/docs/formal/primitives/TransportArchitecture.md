# Transport Architecture: Mailbox vs Ring

This document records the architectural decision for how the host communicates
swap intent to the RT lane when requests may overlap.

The hotswap protocol itself has a shared 6-phase lifecycle:

`idle → spawn → prime → prewarm → crossfade → retire → idle`

Policies differ primarily in **overlap handling** and therefore in the transport
they require.

---

## 1. Two transport families

### 1.1 Mailbox (latest-wins signal)

**Model:** single-slot, overwrite allowed, coalescing.

- Producer writes _latest intent_ (may overwrite unread).
- Consumer samples at RT cadence and may skip intermediate values.
- Often paired with a **monotonic seqno** to detect missed updates.

This is a **signal transport**, not a FIFO buffer.

**Best when:**

- The UI may spam changes (sliders/knobs/preset auditioning).
- Only the latest value matters.
- You want bounded memory and bounded RT work per block.

**Used by:**

- `mailbox-latest` policy (hotswap overlap: latest intent wins)

### 1.2 Ring (FIFO command buffer)

**Model:** bounded SPSC ring buffer, FIFO.

- Producer inserts commands in order.
- Consumer removes commands in order.
- Capacity is bounded; full-ring behavior must be explicit (reject, overwrite-oldest, etc.).

This is a **command transport**.

**Best when:**

- You must preserve ordering (e.g. "set A, then set B, then commit").
- Commands are discrete events, not coalescing signals.
- You want deterministic replay/test-vector alignment.

**Used by:**

- Current and planned command delivery (tickets, engine lifecycle commands), see
  `CommandRingProtocol.md` (planned formalization).

---

## 2. Policy mapping (real-world fitness)

| Policy           | Overlap behavior              | Transport fit | Example use case                 |
| ---------------- | ----------------------------- | ------------- | -------------------------------- |
| `single`         | Not modeled / no overlap      | (n/a)         | Manual DJ mixing (human-paced)   |
| `reject-busy`    | Reject overlapping requests   | Ring-like     | Conservative automation          |
| `mailbox-latest` | Overwrite pending with latest | Mailbox       | Responsive UI spam / auditioning |

---

## 3. Design constraints (RT)

Regardless of transport:

- **No allocation** on the RT thread.
- **No blocking** (lock-free / wait-free where possible).
- **Bounded work** per audio block.
- **Coherence**: RT must never observe torn/invalid intent.

Mailbox is preferred when semantics allow, because it naturally enforces bounded
work and bounded memory while matching “latest wins” UX expectations.
