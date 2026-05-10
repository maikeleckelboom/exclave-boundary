# DESIGN-002: WebGPU Digital Twin Pattern

**Context**: High-performance visualization
**Target**: 10k+ entities, waveforms, analyzers
**Tech**: `@seqlok/core`, WebGPU, WGSL

---

## 1. Idea

A Seqlok domain exposes its **meters** as plain typed views on top of a `SharedArrayBuffer`. WebGPU consumes typed views as `GPUBuffer` data.

The "digital twin" pattern is:

> **Processor** updates meters → **Observer** snapshots → uploads to **GPU buffer** → WGSL shaders render the current state.

No JSON, no structural cloning, no per-frame allocations.

Data path:

```text
Processor (bindProcessor)
    └─ meters.publish(...)
         ↓
SharedArrayBuffer (Seqlok backing)
         ↓
Observer (bindObserver).meters.snapshot(...)
         ↓
GPUBuffer (WebGPU)
         ↓
WGSL shader
```

---

## 2. Data layout and alignment

WGSL has strict alignment rules (notably `vec3` padded to 16 bytes). To keep copies trivial:

- Use **SoA** (structure-of-arrays) in Seqlok as the default.
- Let WGSL bind one storage buffer per component, or pack into `vec4` on the GPU side.

Example: swarm / particle positions and energy.

```ts
const swarmVisSpec = defineSpec(({ meter }) => ({
  id: "swarm-visualization",

  meters: {
    posX: meter.f32.array({ length: MAX_AGENTS }),
    posY: meter.f32.array({ length: MAX_AGENTS }),
    posZ: meter.f32.array({ length: MAX_AGENTS }),
    energy: meter.f32.array({ length: MAX_AGENTS }),
  },
}));
```

SoA trade-offs:

- JS/TS side: simple, cache-friendly loops.
- WGSL side: more bindings (`@binding(0..N)`), but very explicit.

If you need AOS (array-of-struct) for certain shaders, you can add a packed `f32` array meter later and fill it from the primary SoA planes in the processor.

---

## 3. Observer → GPU buffer loop

The main-thread observer acts as a thin copy pipe from SAB → GPU buffer. The processor owns simulation; the renderer only reflects it.

```ts
// Observer binding
const observer = bindObserver(acceptedHandoff);

// Measure once for buffer sizes
const initial = observer.meters.snapshot(["posX", "posY", "posZ"]);
const gpuPosX = device.createBuffer({
  size: initial.posX.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const gpuPosY = device.createBuffer({
  size: initial.posY.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const gpuPosZ = device.createBuffer({
  size: initial.posZ.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

function frame() {
  // 1. Coherent meter snapshot
  const { posX, posY, posZ } = observer.meters.snapshot([
    "posX",
    "posY",
    "posZ",
  ]);

  // 2. Upload to GPU (no allocations, just blits)
  device.queue.writeBuffer(gpuPosX, 0, posX, 0, posX.byteLength);
  device.queue.writeBuffer(gpuPosY, 0, posY, 0, posY.byteLength);
  device.queue.writeBuffer(gpuPosZ, 0, posZ, 0, posZ.byteLength);

  // 3. Encode + submit render/compute pass
  const encoder = device.createCommandEncoder();
  // ... set pipelines, bind groups, draw/dispatch ...
  device.queue.submit([encoder.finish()]);

  requestAnimationFrame(frame);
}
```

The only per-frame work on the JS side is:

- `snapshot` (coherent view)
- a handful of `writeBuffer` calls
- encoding commands

Everything else (physics, shading, blending, trails, etc.) lives off-thread or on GPU.

---

## 4. WGSL bindings

WGSL maps directly to the Seqlok meter arrays.

SoA mapping:

```wgsl
@group(0) @binding(0) var<storage, read> posX : array<f32>;
@group(0) @binding(1) var<storage, read> posY : array<f32>;
@group(0) @binding(2) var<storage, read> posZ : array<f32>;

struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec4<f32>,
};

@vertex
fn vs(@builtin(instance_index) i : u32) -> VertexOut {
  let x = posX[i];
  let y = posY[i];
  let z = posZ[i];

  var out : VertexOut;
  out.position = vec4<f32>(x, y, z, 1.0);
  out.color = vec4<f32>(1.0, 1.0, 1.0, 1.0);
  return out;
}
```

If you introduce a packed `currentPos : array<vec4<f32>>` later, it's just another meter + GPU buffer; the pattern is the same.

---

## 5. Example: swarm twin

- **Domain**: `swarmPhysics` (processor owns simulation; meters include `posX/Y/Z`).
- **Observer**: `swarmTwin` in main thread (bindObserver).
- **Renderer**: instanced mesh in WebGPU.

Data flow:

- Physics Worker: updates `posX/Y/Z` meters at simulation rate.
- Main thread: `observer.meters.snapshot()` each rAF, pushes to GPU, draws.

---

## 6. Example: Dekzer waveform twin

Same pattern, different shape:

- AudioWorklet processor writes meters:

  - `waveformL : f32.array({ length: N })`
  - `waveformR : f32.array({ length: N })`
  - optional `spectralBands : f32.array({ length: BANDS })`

- UI observer snapshots meters and uploads them to GPU:

  - line strip / triangle strip for the waveform
  - bar/heatmap textures for spectrum

Seqlok doesn't know or care whether the reader is a DOM 2D canvas or WebGPU; it just provides a coherent SAB-backed array.

---

## 7. Invariants

- Renderer never mutates Seqlok planes.
- No dynamic allocation in the rendering hot path.
- Snapshot + `writeBuffer` are the only per-frame data movement.
- All higher-level policies (zoom, camera, color schemes) live outside Seqlok; they operate on snapshot views and GPU pipelines.
