# DESIGN-003: Telemetry Bridge Pattern (Node/UDP)

**Context**: hardware / out-of-process consumers
**Target**: drones, lights, robots, mixers
**Tech**: Node.js, UDP/TCP, `@seqlok/core`

---

## 1. Idea

A **Telemetry Bridge** is a runtime that:

- attaches to a Seqlok domain as an **observer**;
- periodically snapshots params/meters;
- packs those values into a binary protocol;
- sends them over UDP/TCP/serial.

It never mutates Seqlok state. It just mirrors the current world into the outside world.

---

## 2. Pattern

Steps:

1. `bindObserver(acceptedHandoff)` in the bridge process / worker.
2. Pre-allocate all buffers and sockets.
3. Run a bounded-frequency loop (e.g. 20–60 Hz).
4. In each tick:

- snapshot Seqlok meters/params;
- fill a reusable packet buffer;
- send via socket.

---

## 3. Implementation sketch (Node + UDP)

```ts
import dgram from "node:dgram";
import { setTimeout as sleep } from "node:timers/promises";
import { bindObserver } from "@seqlok/core";

// 1. Setup
const socket = dgram.createSocket("udp4");
const observer = bindObserver(acceptedHandoff); // swarm domains

// Example shape: vec4 per agent: [x, y, z, w]
const DRONE_COUNT = MAX_AGENTS;
const DRONE_PORT = 14550;

// Reusable packet buffer: id (u32) + pos (3×f32) + vel (3×f32) ≈ 4 + 12 + 12 = 28 bytes
const PACKET_SIZE = 32;
const packet = Buffer.allocUnsafe(PACKET_SIZE);

const droneIps: readonly string[] = /* provisioned elsewhere */ [];

// 2. Drift-aware loop instead of bare setInterval
async function runTelemetryBridge(tickMs: number): Promise<void> {
  let running = true;
  let next = performance.now();

  while (running) {
    const now = performance.now();
    if (now >= next) {
      step();
      next += tickMs;
    }

    const delay = Math.max(0, next - performance.now());
    if (delay > 0) {
      await sleep(delay);
    }
  }
}

function step(): void {
  // Snapshot: coherent, zero-allocation view
  const { currentPos, velocity } = observer.meters.snapshot([
    "currentPos",
    "velocity",
  ]);
  const { targetPos } = observer.params.snapshot(["targetPos"]);

  // Hot loop: pack and send
  for (let i = 0; i < DRONE_COUNT; i += 1) {
    const base = i * 4;

    // id
    packet.writeUInt32BE(i, 0);

    // position
    packet.writeFloatBE(currentPos[base + 0], 4);
    packet.writeFloatBE(currentPos[base + 1], 8);
    packet.writeFloatBE(currentPos[base + 2], 12);

    // velocity
    packet.writeFloatBE(velocity[base + 0], 16);
    packet.writeFloatBE(velocity[base + 1], 20);
    packet.writeFloatBE(velocity[base + 2], 24);

    // (optional) target position could go in the remaining bytes

    socket.send(packet, DRONE_PORT, droneIps[i]);
  }
}
```

Notes:

- All allocations happen **outside** `step()`.
- The loop uses a simple drift-correcting schedule rather than `setInterval`.
- The bridge operates purely on SAB-backed typed arrays and Node Buffers.

---

## 4. Invariants

- The bridge is **read-only**: it never calls any controller or processor APIs.
- The bridge has a **bounded send rate**; it decouples simulation rate from network rate.
- No `new` inside the hot loop; all packet buffers and sockets are reused.
- If state looks wrong, the fix lives in the processor/controller, not in the bridge.

---

## 5. Examples

- **Drone swarm**: map `currentPos` and `velocity` meters to MAVLink/Protobuf packets.
- **Stage lighting**: read `meter.color` and `meter.intensity` planes and emit DMX/ArtNet.
- **Mixer / FOH bridge**: read mixer meters and output OSC for external controllers.
