# Primitives

Shared building blocks and architecture notes used by multiple hotswap policies.

These primitives are supporting material, not shipped hotswap contract law by themselves.

## Contents

- **Transport decision**: [`TransportArchitecture.md`](./TransportArchitecture.md)
- **Latest mailbox (TLA+)**:
  - Spec: [`tla/LatestMailboxProtocol.tla`](./tla/LatestMailboxProtocol.tla)
  - Configs:
    - [`tla/LatestMailboxProtocol.cfg`](./tla/LatestMailboxProtocol.cfg)
    - [`tla/LatestMailboxProtocol.invonly.cfg`](./tla/LatestMailboxProtocol.invonly.cfg)
- **Design stubs**
  - [`CommandRingProtocol.md`](./CommandRingProtocol.md)
  - [`SeqlokCoreProtocol.md`](./SeqlokCoreProtocol.md)

See also:

- [`../policies/single/`](../policies/single/) — supported base policy
- [`../policies/reject-busy/`](../policies/reject-busy/) — supported Level 2 policy
- [`../policies/persistent-handoff/`](../policies/persistent-handoff/) — continuity-class model
- [`../experimental/mailbox-latest/`](../experimental/mailbox-latest/) — experimental policy
