# @seqlok/commands

Typed command transport for Seqlok.

This package sits between the low-level SWSR rings in `@seqlok/primitives`
and product code (audio software, live transition drivers, etc.). It provides:

- A `commands.*` error domain for transport failures
- Contracts for typed command codecs and logical mailboxes
- A SWSR ring-backed command mailbox
- A fan-in bus over multiple command consumers

## Core concepts

- **CommandCodec\<C\>**  
  Encodes/decodes a discriminated union `C` into fixed-width slots
  (`wordsPerSlot` 32-bit words).

- **CommandProducer / CommandConsumer**  
  Logical ends of a mailbox. Producers enqueue commands; consumers drain
  them and report `CommandDrainStats`.

- **SWSR mailbox**  
  `createCommandMailbox` allocates a `SwsrRingBacking` and returns
  `{ backing, producer, consumer }`. The `backing.sab` can be passed across
  threads (`postMessage`, `AudioWorklet`, etc.).

- **Command bus**  
  `createCommandBus` drains multiple `CommandConsumer` instances and
  aggregates per-source stats into `CommandBusDrainStats`.

This package stays semantic-free: concrete command unions like
`HotswapCommand` live in higher layers.
