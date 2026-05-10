# HotSwap Rust reference files (Levels 1–2)

Drop this folder into your repo and wire it in as a module directory.

Suggested use:

```rust
// in your crate (e.g. src/hotswap_ref/mod.rs)
pub mod hotswap_ref;
```

Then re-export what you want:

- Level 1/2 gate: `hotswap_lane_level12::LaneRuntime`
- Shared wrapper: `hotswap_lane_shared::LaneShared`
- Host helper: `hotswap_host_orchestrator::HostOrchestrator`
- RT lane: `hotswap_rt_lane::RtLane`

Notes

- Levels 1–2 are **bounded** and contain **no multi-ticket buffering semantics**.
- "Spam hotswap" UX is implemented host-side via a **single-slot latest intent** mailbox.
- Anything multi-ticket / retarget / coalesce belongs to Level 3+ and is intentionally absent here.
- Persistent-handoff reference work is a future follow-up after the model and API land.
- `latest_intent_mailbox.rs` covers experimental mailbox-latest semantics and is not part of the supported surface.
