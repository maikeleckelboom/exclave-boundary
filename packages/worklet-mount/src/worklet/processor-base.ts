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

import type {
  EmscriptenFactory,
  EmscriptenModule,
  Registry,
  RuntimeInstance,
} from "./types";

/**
 * High-level lifecycle state of the worklet-mounted runtime hosted by this processor.
 *
 * - `"idle"`: no module loaded; awaiting a mount message.
 * - `"loading"`: a mount is in flight; the module is being instantiated.
 * - `"ready"`: module loaded and the processor can execute RT blocks.
 * - `"faulted"`: an unrecoverable error occurred; outputs are silenced until remounted.
 */
export type WorkletMountState = "idle" | "loading" | "ready" | "faulted";

/**
 * Internal phase used for enforcing RT constraints (notably: no allocation during `"rt"`).
 *
 * This is converted to the protocol-level {@link WmPhase} with {@link phaseForWire}.
 */
export type ProcessorPhase = "setup" | "rt";

/**
 * User-supplied Emscripten module options passed through from the host.
 *
 * `print` and `printErr` are treated specially:
 * - The runtime always installs its own handlers to forward logs to the host.
 * - If the user provides `print/printErr` functions, they are invoked after forwarding.
 */
type UserModuleOpts = Readonly<
  Record<string, unknown> & {
    print?: unknown;
    printErr?: unknown;
  }
>;

/**
 * Narrow type guard for callable values.
 *
 * @param value - Unknown value to test.
 * @returns `true` if `value` is a function.
 */
function isFunction(
  value: unknown,
): value is (...args: readonly unknown[]) => unknown {
  return typeof value === "function";
}

/**
 * Base class for AudioWorklet processors which host a WASM-backed worklet runtime
 * (Emscripten MODULARIZE/ES6 factory style).
 *
 * Responsibilities:
 * - Receives and validates `wm:mount` messages.
 * - Loads either a dynamic wrapper factory or a bundled factory from the registry.
 * - Enforces RT safety by disallowing `malloc/free` after setup completes.
 * - Provides structured logging and error reporting back to the host.
 * - Silences outputs on faults to avoid propagating garbage audio.
 *
 * Subclasses provide:
 * - A bundled registry ({@link getBundledRegistry}).
 * - A setup hook ({@link onWasmLoaded}) where allocations are allowed.
 * - The RT block processor ({@link processBlock}).
 * - Optional message handling ({@link onMessage}) for non-mount messages.
 *
 * @typeParam T - Concrete Emscripten module type exported by the worklet build.
 */
export abstract class WorkletMountAudioWorkletProcessor<
  T extends EmscriptenModule,
> extends AudioWorkletProcessor {
  /** Currently loaded module instance, if any. */
  #module: T | null = null;

  /** Lifecycle state for guarding operations and reporting. */
  #state: WorkletMountState = "idle";

  /** Phase for enforcing setup-vs-RT constraints. */
  #phase: ProcessorPhase = "setup";

  /** Active mount key (used for correlation/logging). */
  #key = "";

  /** Active mount sequence number (used for correlation/logging). */
  #seq = 0;

  /** Ensures we emit at most one "fault" notification per mounted instance. */
  #faultNotified = false;

  /**
   * Monotonic token used to invalidate stale async mount completions.
   * Incremented on each new mount attempt.
   */
  #loadToken = 0;

  constructor() {
    super();

    // Route wm:mount internally, and forward everything else to subclass hook.
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;

      if (isWmMountMessage(data)) {
        void this.#handleMount(data);
        return;
      }

      // If it claims to be wm:mount but fails guards, treat it as a protocol error.
      if (isRecord(data) && data.type === "wm:mount") {
        this.#handleInvalidMountMessage(data);
        return;
      }

      this.onMessage(event);
    };
  }

  /**
   * AudioWorklet callback.
   *
   * Default behavior:
   * - If not ready: silence outputs and keep running.
   * - If ready: call {@link processBlock}.
   * - If {@link processBlock} throws: fault the instance, silence outputs, keep running.
   *
   * The processor remains alive even after a fault; recovery occurs by sending a new mount.
   *
   * @param inputs - Input audio buses/channels (AudioWorklet layout).
   * @param outputs - Output audio buses/channels (AudioWorklet layout).
   * @param params - Param map (AudioParam-style arrays).
   * @returns `true` to keep the processor alive.
   */
  public override process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean {
    if (this.#state !== "ready" || this.#module === null) {
      zeroOutputs(outputs);
      return true;
    }

    try {
      const inst: RuntimeInstance<T> = { key: this.#key, module: this.#module };
      return this.processBlock(inst, inputs, outputs, params);
    } catch (err) {
      this.#fault("CRASH", err);
      zeroOutputs(outputs);
      return true;
    }
  }

  /**
   * Returns the registry of bundled worklet runtime factories (key → Emscripten factory).
   *
   * Used when `wm:mount` does not provide a dynamic wrapper (`wrapperJs`).
   *
   * @returns Registry mapping mount keys to factories.
   */
  protected abstract getBundledRegistry(): Registry<T>;

  /**
   * Setup hook invoked after a module is successfully instantiated.
   *
   * Allocation is permitted here via {@link malloc}/{@link free} while the phase is `"setup"`.
   * After this hook returns, the runtime transitions to `"rt"` and forbids allocations.
   *
   * @param module - Loaded module instance.
   */
  protected abstract onWasmLoaded(module: T): void;

  /**
   * Teardown hook invoked before replacing/unloading a previously loaded module.
   *
   * This hook is best-effort: exceptions are caught and reported as warnings.
   *
   * @param module - Module being unloaded.
   */
  protected onWasmUnloaded(module: T): void {
    void module;
  }

  /**
   * Real-time processing hook invoked from {@link process}.
   *
   * Implementations must obey the AudioWorklet RT contract:
   * - no blocking
   * - no async
   * - no unbounded work
   * - no allocation through this runtime (malloc/free are forbidden in `"rt"`)
   *
   * Any thrown exception will fault the instance and silence outputs.
   *
   * @param inst - Runtime instance wrapper containing the active module and key.
   * @param inputs - Input audio buffers.
   * @param outputs - Output audio buffers.
   * @param params - Audio params for this block.
   * @returns `true` to keep the processor alive.
   */
  protected abstract processBlock(
    inst: RuntimeInstance<T>,
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;

  /**
   * Optional message hook for non-mount messages received on the processor port.
   *
   * Subclasses can override to implement additional control messages.
   *
   * @param event - MessageEvent posted from the host.
   */
  protected onMessage(event: MessageEvent<unknown>): void {
    void event;
  }

  /**
   * Allocates bytes from the module heap during `"setup"`.
   *
   * RT rules:
   * - Allowed only while {@link #phase} is `"setup"`.
   * - Forbidden once the processor transitions to `"rt"`.
   *
   * @param bytes - Number of bytes to allocate.
   * @returns Pointer (module address) to the allocated region.
   * @throws WorkletMountError when the module is unavailable/not ready or allocation is forbidden.
   */
  protected malloc(bytes: number): number {
    if (this.#state !== "ready" && this.#state !== "loading") {
      throw createWorkletMountError("moduleNotAvailable", {
        op: "malloc",
      });
    }
    if (this.#phase !== "setup") {
      throw createWorkletMountError("rtAllocationForbidden", {
        op: "malloc",
        phase: phaseForWire(this.#phase),
        key: this.#key,
      });
    }

    const mod = this.#module;
    if (!mod) {
      throw createWorkletMountError("moduleNotReady", {
        op: "malloc",
        state: this.#state,
      });
    }

    return mod._malloc(bytes);
  }

  /**
   * Convenience allocator for a `Float32Array`-sized region in the module heap.
   *
   * @param length - Number of float32 elements.
   * @returns Pointer to the allocated region (byte size = `length * 4`).
   */
  protected mallocF32(length: number): number {
    const bytes = (length >>> 0) * Float32Array.BYTES_PER_ELEMENT;
    return this.malloc(bytes);
  }

  /**
   * Frees a previously allocated pointer during `"setup"`.
   *
   * @param ptr - Pointer returned by {@link malloc} / {@link mallocF32}.
   * @throws WorkletMount runtime errors when the module is unavailable/not ready or freeing is forbidden.
   */
  protected free(ptr: number): void {
    if (this.#state !== "ready" && this.#state !== "loading") {
      throw createWorkletMountError("moduleNotAvailable", { op: "free" });
    }
    if (this.#phase !== "setup") {
      throw createWorkletMountError("rtAllocationForbidden", {
        op: "free",
        phase: phaseForWire(this.#phase),
        key: this.#key,
      });
    }

    const mod = this.#module;
    if (!mod) {
      throw createWorkletMountError("moduleNotReady", {
        op: "free",
        state: this.#state,
      });
    }

    mod._free(ptr);
  }

  /**
   * Handles a message that claims to be `wm:mount` but fails the structural guards.
   *
   * This path aims to produce a helpful protocol error rather than ignoring the message.
   *
   * @param data - Untrusted message object (already known to be `Record<string, unknown>`).
   */
  #handleInvalidMountMessage(data: Record<string, unknown>): void {
    const key = typeof data.key === "string" ? data.key : "";
    const seq = isSeq(data.seq) ? data.seq : 0;

    let err: unknown;

    if (key.length === 0) {
      err = createWorkletMountError("emptyKey", { op: "wm:mount" });
    } else if (!isSeq(data.seq)) {
      err = createWorkletMountError("invalidMountMessage", {
        reason: "seq must be a non-negative safe integer",
        receivedType: "wm:mount",
        receivedKeys: Object.keys(data),
      });
    } else {
      // Fall back: let wasm validation pick the most precise error.
      try {
        assertWasmBinary(data.wasmBytes, "wm:mount");
        err = createWorkletMountError("invalidMountMessage", {
          reason: "mount message failed structural validation",
          receivedType: "wm:mount",
          receivedKeys: Object.keys(data),
        });
      } catch (e) {
        err = e;
      }
    }

    this.#postError(key, seq, err);
  }

  /**
   * Mount handler for `wm:mount`.
   *
   * Behavior:
   * - Rejects concurrent mounts while already `"loading"`.
   * - Validates the wasm binary payload.
   * - Unloads any previous module (best-effort).
   * - Selects either a dynamic wrapper factory or a bundled registry factory.
   * - Instantiates the module, runs setup hook, then transitions to RT mode.
   * - On success: posts `wm:ready`.
   * - On failure: posts `wm:error` with structured details.
   *
   * Concurrency note:
   * Uses `#loadToken` to ignore stale async completions when a newer mount arrives.
   *
   * @param msg - Validated mount message.
   */
  async #handleMount(msg: WmMountMessage): Promise<void> {
    if (this.#state === "loading") {
      const err = createWorkletMountError("busyLoading", {
        requestedKey: msg.key,
        requestedSeq: msg.seq,
        currentKey: this.#key,
        currentSeq: this.#seq,
      });
      this.#postError(msg.key, msg.seq, err);
      return;
    }

    try {
      assertWasmBinary(msg.wasmBytes, "wm:mount");
    } catch (err) {
      this.#postError(msg.key, msg.seq, err);
      return;
    }

    this.#loadToken += 1;
    const token = this.#loadToken;

    if (this.#module) {
      try {
        this.onWasmUnloaded(this.#module);
      } catch (err) {
        this.#postLog(
          msg.key,
          msg.seq,
          "warn",
          `unload warning: ${this.#errToString(err)}`,
        );
      }
    }

    this.#module = null;
    this.#faultNotified = false;

    this.#state = "loading";
    this.#phase = "setup";

    this.#key = msg.key;
    this.#seq = msg.seq;

    try {
      const factory = this.#selectFactory(msg);
      const opts = this.#buildModuleOpts(msg);

      const instance = await factory(opts);

      // A newer mount has superseded this one; unload and exit.
      if (token !== this.#loadToken) {
        try {
          this.onWasmUnloaded(instance);
        } catch {
          // ignore
        }
        return;
      }

      this.#module = instance;

      this.onWasmLoaded(instance);

      // Setup complete, the audio callback is RT and must not allocate (no malloc/free).
      // We override `_malloc/_free` to throw if touched in RT.
      // Need runtime memory? use a WASM arena/pool.
      instance._malloc = () => {
        throw createWorkletMountError("rtAllocationForbidden", {
          op: "malloc",
          phase: "rt",
          key: this.#key,
        });
      };
      instance._free = () => {
        throw createWorkletMountError("rtAllocationForbidden", {
          op: "free",
          phase: "rt",
          key: this.#key,
        });
      };

      this.#phase = "rt";
      this.#state = "ready";

      this.#post({ type: "wm:ready", key: msg.key, seq: msg.seq });
    } catch (err) {
      if (token !== this.#loadToken) {
        return;
      }

      this.#state = "faulted";
      this.#module = null;

      const normalized =
        getErrorCode(err) !== undefined
          ? err
          : createWorkletMountError(
              "runtimeFaulted",
              {
                key: msg.key,
                seq: msg.seq,
                phase: "loading",
                errorMessage: this.#errToString(err),
              },
              err,
            );

      this.#postError(msg.key, msg.seq, normalized);
    }
  }

  /**
   * Selects the appropriate Emscripten factory for the requested mount.
   *
   * - If `wrapperJs` is provided, a dynamic backend factory is created.
   * - Otherwise, the factory is resolved from the bundled registry.
   *
   * @param msg - Mount message.
   * @returns Emscripten factory for instantiating the module.
   * @throws WorkletMountError when the bundled factory key is not registered.
   */
  #selectFactory(msg: WmMountMessage): EmscriptenFactory<T> {
    if (typeof msg.wrapperJs === "string") {
      return createDynamicFactory<T>({
        key: msg.key,
        seq: msg.seq,
        wrapperJs: msg.wrapperJs,
        wasmBytes: msg.wasmBytes,
      });
    }

    const registry = this.getBundledRegistry();
    const factory = registry[msg.key];

    if (!factory) {
      throw createWorkletMountError("bundledFactoryNotFound", {
        key: msg.key,
        registeredKeys: Object.keys(registry),
      });
    }

    return factory;
  }

  /**
   * Builds the options object passed to the Emscripten factory.
   *
   * Ensures:
   * - `wasmBinary` is a `Uint8Array` view of the validated binary payload.
   * - `noInitialRun` is enabled (host controls entrypoints).
   * - `print/printErr` forward logs to the host via `wm:log`, while optionally
   *   chaining any user-supplied handlers.
   *
   * @param msg - Mount message.
   * @returns Factory options including `wasmBinary`.
   */
  #buildModuleOpts(
    msg: WmMountMessage,
  ): Readonly<Record<string, unknown> & { wasmBinary: Uint8Array }> {
    const user = (msg.moduleOpts ?? {}) as UserModuleOpts;

    const userPrint = user.print;
    const userPrintErr = user.printErr;

    const print = (m: unknown): void => {
      this.#postLog(msg.key, msg.seq, "info", String(m));
      if (isFunction(userPrint)) {
        userPrint(m);
      }
    };

    const printErr = (m: unknown): void => {
      this.#postLog(msg.key, msg.seq, "error", String(m));
      if (isFunction(userPrintErr)) {
        userPrintErr(m);
      }
    };

    return {
      ...user,
      wasmBinary: toU8View(msg.wasmBytes),
      noInitialRun: true,
      print,
      printErr,
    };
  }

  /**
   * Transitions the processor into a faulted state and emits a single fault notification.
   *
   * Idempotent:
   * - If already `"faulted"`, does nothing.
   * - If a fault was already notified for this instance, does not notify again.
   *
   * Side effects:
   * - Sets state to `"faulted"`, phase to `"rt"`, clears the module reference.
   * - Logs a `critical` message.
   * - Posts a normalized `wm:error`.
   *
   * @param tag - Short tag used to categorize the fault (e.g. "CRASH").
   * @param err - Original thrown value.
   */
  #fault(tag: string, err: unknown): void {
    if (this.#state === "faulted") {
      return;
    }

    this.#state = "faulted";
    this.#phase = "rt";
    this.#module = null;

    if (this.#faultNotified) {
      return;
    }

    this.#faultNotified = true;

    const msg = `${tag}: ${this.#errToString(err)}`;
    this.#postLog(this.#key, this.#seq, "critical", msg);

    const normalized =
      getErrorCode(err) !== undefined
        ? err
        : createWorkletMountError(
            "runtimeFaulted",
            {
              key: this.#key,
              seq: this.#seq,
              phase: "rt",
              errorMessage: msg,
            },
            err,
          );

    this.#postError(this.#key, this.#seq, normalized);
  }

  /**
   * Posts a `wm:log` message to the host.
   *
   * @param key - Worklet mount key (mount key).
   * @param seq - Mount sequence number.
   * @param level - Log severity level.
   * @param msg - Log message text.
   */
  #postLog(key: string, seq: number, level: WmLogLevel, msg: string): void {
    this.#post({ type: "wm:log", key, seq, level, msg });
  }

  /**
   * Posts a `wm:error` message to the host, including optional structured fields.
   *
   * When available, the message includes:
   * - `code`: extracted error code (string)
   * - `details`: extracted JSON object details
   *
   * @param key - Worklet mount key (mount key).
   * @param seq - Mount sequence number.
   * @param err - Unknown error value.
   */
  #postError(key: string, seq: number, err: unknown): void {
    const msg = this.#errToString(err);
    const phase = phaseForWire(this.#phase);

    const code = getErrorCode(err);
    const details = getErrorDetails(err);

    this.#post({
      type: "wm:error",
      key,
      seq,
      phase,
      message: msg,
      ...(code !== undefined ? { code } : {}),
      ...(details !== undefined ? { details } : {}),
    });
  }

  /**
   * Posts an outbound protocol message to the host.
   *
   * @param message - Outbound message.
   */
  #post(message: WmMessageOut): void {
    this.port.postMessage(message);
  }

  /**
   * Converts unknown error values into a reasonable message string.
   *
   * - For `Error` instances: prefers `.message`, falling back to `.name` if empty.
   * - For everything else: uses `String(err)`.
   *
   * @param err - Unknown error value.
   * @returns Human-readable error message.
   */
  #errToString(err: unknown): string {
    if (err instanceof Error) {
      return err.message.length > 0 ? err.message : err.name;
    }
    return String(err);
  }
}
