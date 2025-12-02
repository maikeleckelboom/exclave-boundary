# Seqlok

Seqlok is a real-time shared-state substrate for low-latency, multithreaded engines.

It provides:

- Param and meter bindings over SharedArrayBuffer with seqlock-style coherence
- Lock-free SPSC command rings for cross-thread control
- A generic engine swap protocol (spawn, prime, initialize, blend, retire)

> Seqlok does **not** know about audio, decks, BPM, tracks or cues.
> Those concerns live entirely in the applications built on top of it.

Audio and DSP are the first clients. The primitives are designed to work equally well for
GPU simulations, live video pipelines, physics engines or any system that needs
glitch-free transitions between stateful processors.

## Documentation

- [Developer CLI guide](./docs/DEVELOPER-CLI.md) for workspace scripts, dev flow and verification pipeline
- Additional architecture and planning documents live under [docs/](./docs)
