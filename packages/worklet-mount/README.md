# @seqlok/worklet-mount

AudioWorklet-focused WASM bootstrap primitive, promoted to a first-class Seqlok citizen.

This package is intentionally split into **public entrypoints** (via `exports`)
and **internal implementation folders**. Treat non-exported paths as private.

## Public entrypoints

- `@seqlok/worklet-mount`
  - Host-facing API: errors, shared protocol types, and mounting helpers
- `@seqlok/worklet-mount/worklet`
  - AudioWorklet-scope implementation:
    - processor base class
    - environment-agnostic core for tests
    - dynamic backend helper (legacy / dev)

## Source layout

Entry points are folders with an `index.ts`:

- `src/worklet/index.ts` (public worklet-side API)

Root `src/index.ts` is the front door barrel for the host-side API.

Implementation folders (not public):

- `src/protocol/` - Message types, guards, and `wasmBytes` helpers
- `src/mount/` - Main-thread helpers to mount a worklet runtime

## Backends

The kernel supports two instantiation backends behind one protocol:

- **Bundled (CSP-safe):** omit `wrapperJs`, resolve factory via registry by `key`.
  - Supports modern Emscripten ES module wrappers (`EXPORT_ES6=1`) via static import.
- **Dynamic (dev/compat):** include `wrapperJs`, instantiate via `new Function()` and
  export-detection shim.
  - Requires CSP allowing runtime code generation (`unsafe-eval`).

## Protocol

Message types are `wm:*`:

- `wm:mount` (host -> worklet)
- `wm:ready`, `wm:error`, `wm:log` (worklet -> host)

`wasmBytes` accepts `ArrayBuffer | SharedArrayBuffer | ArrayBufferView` (e.g. `Uint8Array`).

## Notes

- `@seqlok/worklet-mount/worklet` is a worklet-side API surface.
  Keep it isolated from host-only dependencies.
- Non-exported paths may change without notice.
