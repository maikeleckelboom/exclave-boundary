import { createWorkletMountError } from "../errors";
import {
  assertWasmBinary,
  type WmLogLevel,
  type WmMessageOut,
  type WmMountMessage,
  isWmMountMessage,
  toU8View,
} from "../protocol";
import { createDynamicFactory } from "./backend-dynamic";
import {
  getErrorCode,
  getErrorDetails,
  isRecord,
  isSeq,
  phaseForWire,
  zeroOutputs,
} from "./processor-utils";

import type { ProcessorPhase, WorkletMountState } from "./processor-base";
import type {
  EmscriptenFactory,
  EmscriptenModule,
  Registry,
  RuntimeInstance,
  RuntimeModule,
} from "./types";

type State = "idle" | "loading" | "ready" | "faulted";

type PostFn = (msg: WmMessageOut) => void;

type AllocApi = Readonly<{
  malloc: (bytes: number) => number;
  free: (ptr: number) => void;
}>;

type UrlGlobal = typeof globalThis & {
  URL?: unknown;
};

type Urlish = Readonly<{
  href: string;
  toString(): string;
}>;

function hasScheme(s: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s);
}

function stripQueryAndHash(s: string): string {
  const q = s.indexOf("?");
  const h = s.indexOf("#");
  const cut = q === -1 ? (h === -1 ? -1 : h) : h === -1 ? q : Math.min(q, h);
  return cut === -1 ? s : s.slice(0, cut);
}

function normalizePath(path: string): string {
  const leadingSlash = path.startsWith("/");
  const parts = path.split("/").filter((p) => p.length > 0);

  const out: string[] = [];
  for (const p of parts) {
    if (p === ".") {
      continue;
    }
    if (p === "..") {
      out.pop();
      continue;
    }
    out.push(p);
  }

  const joined = (leadingSlash ? "/" : "") + out.join("/");
  return joined.length === 0 && leadingSlash ? "/" : joined;
}

function splitOriginAndPath(
  url: string,
): Readonly<{ origin: string; path: string }> {
  const idx = url.indexOf("://");
  if (idx === -1) {
    return { origin: "", path: url };
  }

  const after = idx + 3;
  const slash = url.indexOf("/", after);
  if (slash === -1) {
    return { origin: url, path: "/" };
  }

  return { origin: url.slice(0, slash), path: url.slice(slash) };
}

/**
 * Ensure `URL` exists in environments where the AudioWorklet global scope
 * is missing it at runtime.
 *
 * @remarks
 * This is a minimal polyfill intended to support common Emscripten wrapper
 * patterns like `new URL("module.wasm", import.meta.url).href`.
 * It is not a full WHATWG `URL` implementation.
 */
function ensureUrlCtor(): void {
  if (typeof URL !== "undefined") {
    return;
  }

  class URLPolyfill implements Urlish {
    readonly href: string;

    constructor(input: string, base?: string) {
      if (hasScheme(input)) {
        this.href = input;
        return;
      }

      if (base === undefined) {
        this.href = input;
        return;
      }

      const baseClean = stripQueryAndHash(base);

      // If base has a scheme://origin, keep origin stable and normalize only path.
      const { origin, path } = splitOriginAndPath(baseClean);

      if (origin.length > 0) {
        if (input.startsWith("/")) {
          this.href = origin + normalizePath(input);
          return;
        }

        const dir = path.replace(/[^/]*$/, ""); // keep trailing slash
        this.href = origin + normalizePath(dir + input);
        return;
      }

      // Fallback for schemes without `://` (blob:, data:, etc.) or plain paths.
      // We do a conservative join based on last '/' and normalize the tail.
      const lastSlash = baseClean.lastIndexOf("/");
      if (lastSlash === -1) {
        this.href = input;
        return;
      }

      const head = baseClean.slice(0, lastSlash + 1);
      const tail = baseClean.slice(lastSlash + 1);

      void tail;

      // Try to normalize relative segments after the head.
      // (Head may include scheme prefixes like "blob:..."; normalization stays on the suffix.)
      const joined = head + input;
      const headSlash = head.lastIndexOf("/");
      if (headSlash === -1) {
        this.href = joined;
        return;
      }

      const headPrefix = head.slice(0, headSlash + 1);
      const headSuffix = head.slice(headSlash + 1);

      void headSuffix;

      // Normalize only the portion after the final slash in the head prefix.
      // This is intentionally conservative to avoid corrupting nonstandard schemes.
      this.href = headPrefix + normalizePath(joined.slice(headPrefix.length));
    }

    toString(): string {
      return this.href;
    }
  }

  const g = globalThis as unknown as UrlGlobal;
  Object.defineProperty(g, "URL", {
    value: URLPolyfill,
    writable: true,
    configurable: true,
  });
}

/**
 * Worklet-core loader/runtime harness for Emscripten modules.
 *
 * @remarks
 * This is the “logic kernel” behind an AudioWorkletProcessor integration:
 * it owns mount validation, factory resolution (bundled vs dynamic wrapper),
 * state transitions, RT safety rules (no allocation once `ready`), and a small
 * message protocol (`wm:ready`, `wm:error`, `wm:log`).
 *
 * The class is deliberately opinionated:
 * - setup phase (`phase="setup"`): allocation via `malloc/free` is permitted.
 * - real-time phase (`phase="rt"`): any allocation attempt throws a domains error.
 * - any runtime exception faults the core and forces silence for the current block.
 */
export class WorkletMountProcessorCore<T extends EmscriptenModule> {
  #state: WorkletMountState = "idle";
  #phase: ProcessorPhase = "setup";

  #currentKey = "";
  #currentSeq = 0;

  #runtime: RuntimeInstance<T> | undefined;
  #alloc: AllocApi | undefined;

  #loadToken = 0;

  readonly #post: PostFn;
  readonly #getBundledRegistry: () => Registry<T>;
  readonly #onWasmLoaded: (inst: RuntimeInstance<T>) => void;
  readonly #onWasmUnloaded: (inst: RuntimeInstance<T>) => void;

  constructor(
    args: Readonly<{
      /**
       * Transport for protocol events emitted by the core.
       */
      post: PostFn;

      /**
       * Returns a registry of bundled factories keyed by worklet runtime key.
       */
      getBundledRegistry: () => Registry<T>;

      /**
       * Called after a module is instantiated and installed as the current runtime,
       * while still in setup phase (alloc permitted).
       */
      onWasmLoaded: (inst: RuntimeInstance<T>) => void;

      /**
       * Called when a prior runtime is being replaced/unloaded.
       */
      onWasmUnloaded?: (inst: RuntimeInstance<T>) => void;
    }>,
  ) {
    this.#post = args.post;
    this.#getBundledRegistry = args.getBundledRegistry;
    this.#onWasmLoaded = args.onWasmLoaded;
    this.#onWasmUnloaded =
      args.onWasmUnloaded ??
      ((inst) => {
        void inst;
      });
  }

  /** Current lifecycle state. */
  get state(): State {
    return this.#state;
  }

  /** Current mounted key (empty string when idle). */
  get key(): string {
    return this.#currentKey;
  }

  /** Current mounted sequence number. */
  get seq(): number {
    return this.#currentSeq;
  }

  /**
   * Current runtime instance (undefined when idle/faulted/not-yet-ready).
   *
   * @remarks
   * This exists once a module has been instantiated. It can be present during
   * setup and during RT. Consumers should still respect `state`/`phase`.
   */
  get runtime(): RuntimeInstance<T> | undefined {
    return this.#runtime;
  }

  /** Convenience accessor for the underlying runtime module. */
  get runtimeModule(): RuntimeModule<T> | undefined {
    return this.#runtime?.module;
  }

  /**
   * Allocate bytes via the underlying module.
   *
   * @remarks
   * Allowed only during setup. During RT this throws `rtAllocationForbidden`.
   */
  malloc(bytes: number): number {
    if (
      (this.#state !== "loading" && this.#state !== "ready") ||
      !this.#runtime ||
      !this.#alloc
    ) {
      throw createWorkletMountError("moduleNotAvailable", {
        op: "malloc",
      });
    }

    if (this.#phase !== "setup") {
      throw createWorkletMountError("rtAllocationForbidden", {
        op: "malloc",
        phase: phaseForWire(this.#phase),
        key: this.#currentKey,
      });
    }

    return this.#alloc.malloc(bytes);
  }

  /**
   * Free bytes via the underlying module.
   *
   * @remarks
   * Allowed only during setup. During RT this throws `rtAllocationForbidden`.
   */
  free(ptr: number): void {
    if (
      (this.#state !== "loading" && this.#state !== "ready") ||
      !this.#runtime ||
      !this.#alloc
    ) {
      throw createWorkletMountError("moduleNotAvailable", { op: "free" });
    }

    if (this.#phase !== "setup") {
      throw createWorkletMountError("rtAllocationForbidden", {
        op: "free",
        phase: phaseForWire(this.#phase),
        key: this.#currentKey,
      });
    }

    this.#alloc.free(ptr);
  }

  /**
   * Allocate a float32 array in module memory.
   */
  mallocF32(length: number): number {
    const bytes = (length >>> 0) * Float32Array.BYTES_PER_ELEMENT;
    return this.malloc(bytes);
  }

  /**
   * Loads a worklet runtime from a validated mount message.
   *
   * @remarks
   * - If already loading, responds with `busyLoading`.
   * - Validates key and wasm bytes and reports precise protocol errors.
   * - Resolves factory from `wrapperJs` (dynamic) or from the bundled registry.
   * - Installs runtime and enters RT mode (`state="ready"`, `phase="rt"`).
   */
  async load(msg: WmMountMessage): Promise<void> {
    if (this.#state === "loading") {
      this.#postError(
        msg.key,
        msg.seq,
        createWorkletMountError("busyLoading", {
          requestedKey: msg.key,
          requestedSeq: msg.seq,
          currentKey: this.#currentKey,
          currentSeq: this.#currentSeq,
        }),
      );
      return;
    }

    try {
      if (msg.key.length === 0) {
        throw createWorkletMountError("emptyKey", { op: "wm:mount" });
      }
      assertWasmBinary(msg.wasmBytes, "wm:mount");
    } catch (err) {
      this.#postError(msg.key, msg.seq, err);
      return;
    }

    this.#loadToken += 1;
    const token = this.#loadToken;

    this.#state = "loading";
    this.#phase = "setup";
    this.#currentKey = msg.key;
    this.#currentSeq = msg.seq;

    if (this.#runtime) {
      try {
        this.#onWasmUnloaded(this.#runtime);
      } catch (err) {
        this.postLog("warn", `unload warning: ${this.#toErrorMessage(err)}`);
      }
    }

    this.#runtime = undefined;
    this.#alloc = undefined;

    try {
      // Some AudioWorklet realms omit `URL` at runtime; Emscripten wrappers often rely on it.
      ensureUrlCtor();

      const factory = this.#resolveFactory(msg);

      const opts: Readonly<
        Record<string, unknown> & { wasmBinary: Uint8Array }
      > = {
        ...(msg.moduleOpts ?? {}),
        noInitialRun: true,
        wasmBinary: toU8View(msg.wasmBytes),

        // Emscripten can call these with non-strings; normalize defensively.
        print: (m: unknown) => {
          this.postLog("info", String(m));
        },
        printErr: (m: unknown) => {
          this.postLog("error", String(m));
        },
      };

      const instance = await factory(opts);

      // A newer mount started while this one was in flight.
      if (token !== this.#loadToken) {
        try {
          const stale: RuntimeInstance<T> = { key: msg.key, module: instance };
          this.#onWasmUnloaded(stale);
        } catch {
          // ignore
        }
        return;
      }

      // Capture alloc API while we are still in setup phase.
      this.#alloc = {
        malloc: instance._malloc.bind(instance),
        free: instance._free.bind(instance),
      };

      const runtime: RuntimeInstance<T> = { key: msg.key, module: instance };
      this.#runtime = runtime;

      // Allow subclass/consumer setup while alloc is permitted.
      this.#onWasmLoaded(runtime);

      // Defense-in-depth: forbid allocation from RT via the module surface too.
      instance._malloc = () => {
        throw createWorkletMountError("rtAllocationForbidden", {
          op: "malloc",
          phase: "rt",
          key: this.#currentKey,
        });
      };
      instance._free = () => {
        throw createWorkletMountError("rtAllocationForbidden", {
          op: "free",
          phase: "rt",
          key: this.#currentKey,
        });
      };

      // IMPORTANT: `ready` implies RT mode. (This fixes your failing test.)
      this.#phase = "rt";
      this.#state = "ready";

      this.#post({ type: "wm:ready", key: msg.key, seq: msg.seq });
    } catch (err) {
      if (token !== this.#loadToken) {
        return;
      }

      this.#state = "faulted";
      // Load failures are "loading", not "rt".
      this.#phase = "setup";
      this.#runtime = undefined;
      this.#alloc = undefined;

      const normalized =
        getErrorCode(err) !== undefined
          ? err
          : createWorkletMountError(
              "runtimeFaulted",
              {
                key: msg.key,
                seq: msg.seq,
                phase: "loading",
                errorMessage: this.#toErrorMessage(err),
              },
              err,
            );

      this.#postError(msg.key, msg.seq, normalized);
    }
  }

  /**
   * Runs the supplied function against the current runtime module in RT mode.
   *
   * @remarks
   * Any thrown error faults the core, forces silence for this block, and emits
   * `wm:error` with `runtimeFaulted`.
   */
  runRt(
    outputs: Float32Array[][],
    fn: (mod: RuntimeModule<T>) => boolean,
  ): boolean {
    const runtime = this.#runtime;

    if (this.#state !== "ready" || !runtime) {
      return true;
    }

    try {
      return fn(runtime.module);
    } catch (err) {
      this.#state = "faulted";
      this.#phase = "rt";
      this.#runtime = undefined;
      this.#alloc = undefined;

      zeroOutputs(outputs);

      const msg = `CRASH: ${this.#toErrorMessage(err)}`;
      this.postLog("critical", msg);

      const normalized =
        getErrorCode(err) !== undefined
          ? err
          : createWorkletMountError(
              "runtimeFaulted",
              {
                key: this.#currentKey,
                seq: this.#currentSeq,
                phase: "rt",
                errorMessage: msg,
              },
              err,
            );

      this.#postError(this.#currentKey, this.#currentSeq, normalized);
      return true;
    }
  }

  /**
   * Emits a worklet-originated log message.
   *
   * @remarks
   * No-op if no key is currently installed.
   */
  postLog(level: WmLogLevel, msg: string): void {
    if (this.#currentKey.length === 0) {
      return;
    }
    this.#post({
      type: "wm:log",
      key: this.#currentKey,
      seq: this.#currentSeq,
      level,
      msg,
    });
  }

  /**
   * Handles incoming messages (typically `port.onmessage` payloads).
   *
   * @remarks
   * The core only understands `wm:mount`. Everything else is ignored here.
   */
  onMessage(data: unknown): void {
    if (isWmMountMessage(data)) {
      void this.load(data);
      return;
    }

    // If it *claims* to be wm:mount but fails guards, treat it as a protocol error.
    if (isRecord(data) && data.type === "wm:mount") {
      const key = typeof data.key === "string" ? data.key : "";
      const seq = isSeq(data.seq) ? data.seq : 0;

      const err =
        key.length === 0
          ? createWorkletMountError("emptyKey", { op: "wm:mount" })
          : createWorkletMountError("invalidMountMessage", {
              reason: "mount message failed structural validation",
              receivedType: "wm:mount",
              receivedKeys: Object.keys(data),
            });

      this.#postError(key, seq, err);
    }
  }

  #resolveFactory(msg: WmMountMessage): EmscriptenFactory<T> {
    if (msg.wrapperJs !== undefined) {
      return createDynamicFactory<T>({
        key: msg.key,
        seq: msg.seq,
        wrapperJs: msg.wrapperJs,
        wasmBytes: msg.wasmBytes,
      });
    }

    const reg = this.#getBundledRegistry();
    const factory = reg[msg.key];

    if (factory === undefined) {
      throw createWorkletMountError("bundledFactoryNotFound", {
        key: msg.key,
        registeredKeys: Object.keys(reg),
      });
    }

    return factory;
  }

  #postError(key: string, seq: number, err: unknown): void {
    const message = this.#toErrorMessage(err);
    const phase = phaseForWire(this.#phase);

    const code = getErrorCode(err);
    const details = getErrorDetails(err);

    this.#post({
      type: "wm:error",
      key,
      seq,
      phase,
      message,
      ...(code !== undefined ? { code } : {}),
      ...(details !== undefined ? { details } : {}),
    });
  }

  #toErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      return err.message.length > 0 ? err.message : err.name;
    }
    return String(err);
  }
}
