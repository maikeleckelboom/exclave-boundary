// File: packages/worklet-mount/src/mount/mount.ts

import { createWorkletMountError } from "../errors";
import {
  assertWasmBinary,
  isWmErrorMessage,
  type WmLogMessage,
  type WmMountMessage,
  type WmWasmBytes,
} from "../protocol";

export interface MountWorkletArgs {
  readonly key: string;
  /**
   * Monotonic sequence number chosen by the host.
   * Used to correlate responses when reloading the same key.
   */
  readonly seq: number;

  /**
   * Emscripten wrapper URL (dynamic backend).
   *
   * Omit to use bundled backend (CSP-safe).
   */
  readonly wrapperUrl?: string;

  /** WASM binary URL. */
  readonly wasmUrl: string;

  /** Optional module options forwarded to the Emscripten factory. */
  readonly moduleOpts?: Readonly<Record<string, unknown>>;
}

export interface MountWorkletOptions {
  /**
   * Called for worklet-originated logs during mount.
   * This also receives logs after mount if you keep the handler installed elsewhere.
   */
  readonly onLog?: (msg: WmLogMessage) => void;
}

function looksLikeHtml(text: string): boolean {
  return text.trimStart().startsWith("<");
}

function ensureNonEmptyKey(key: string, op: string): void {
  if (key.length === 0) {
    throw createWorkletMountError("emptyKey", { op });
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw createWorkletMountError("fetchFailed", {
      resource: "wrapper",
      url,
      status: res.status,
    });
  }
  return res.text();
}

async function fetchWasm(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw createWorkletMountError("fetchFailed", {
      resource: "wasm",
      url,
      status: res.status,
    });
  }
  return res.arrayBuffer();
}

function transferListFor(bytes: WmWasmBytes): Transferable[] {
  if (bytes instanceof ArrayBuffer) {
    return [bytes];
  }
  return [];
}

/**
 * Mount by sending a `wm:mount` message over a MessagePort (i.e. `AudioWorkletNode.port`).
 */
export async function mountWorkletOnPort(
  port: MessagePort,
  msg: WmMountMessage,
  opts: MountWorkletOptions = {},
): Promise<void> {
  ensureNonEmptyKey(msg.key, "mountWorkletOnPort");

  return new Promise<void>((resolve, reject) => {
    const handler = (e: MessageEvent<unknown>) => {
      const data: unknown = e.data;
      if (data === null || typeof data !== "object") {
        return;
      }
      const rec = data as Record<string, unknown>;

      if (rec.key !== msg.key || rec.seq !== msg.seq) {
        return;
      }

      if (rec.type === "wm:log") {
        opts.onLog?.(rec as unknown as WmLogMessage);
        return;
      }

      if (rec.type === "wm:ready") {
        port.removeEventListener("message", handler);
        resolve();
        return;
      }

      if (rec.type === "wm:error") {
        port.removeEventListener("message", handler);

        if (!isWmErrorMessage(data)) {
          reject(
            createWorkletMountError("invalidMountMessage", {
              reason:
                "worklet sent wm:error but it failed structural validation",
              receivedType: "wm:error",
              receivedKeys: Object.keys(rec),
            }),
          );
          return;
        }

        const errMsg = data;

        reject(
          createWorkletMountError("workletError", {
            key: msg.key,
            seq: msg.seq,
            phase: errMsg.phase,
            message: errMsg.message,
            ...(errMsg.code !== undefined ? { workletCode: errMsg.code } : {}),
            ...(errMsg.details !== undefined
              ? { workletDetails: errMsg.details }
              : {}),
          }),
        );
        return;
      }
    };

    port.addEventListener("message", handler);
    port.start();

    port.postMessage(msg, transferListFor(msg.wasmBytes));
  });
}

export async function mountWorkletOnPortFromUrls(
  port: MessagePort,
  args: MountWorkletArgs,
  opts: MountWorkletOptions = {},
): Promise<void> {
  const { key, seq, wrapperUrl, wasmUrl, moduleOpts } = args;

  ensureNonEmptyKey(key, "mountWorkletOnPortFromUrls");

  const [wrapperJs, wasmBytes] = await Promise.all([
    wrapperUrl
      ? fetchText(wrapperUrl)
      : Promise.resolve<string | undefined>(undefined),
    fetchWasm(wasmUrl),
  ]);

  if (wrapperJs !== undefined && looksLikeHtml(wrapperJs)) {
    throw createWorkletMountError("wrapperReturnedHtml", {
      url: wrapperUrl ?? "",
    });
  }

  assertWasmBinary(wasmBytes, "host.mountWorkletOnPortFromUrls");

  const msg: WmMountMessage = toMountMessage({
    type: "wm:mount",
    key,
    seq,
    wasmBytes,
    wrapperJs,
    moduleOpts,
  });

  await mountWorkletOnPort(port, msg, opts);
}

/**
 * Convenience wrapper around {@link mountWorkletOnPortFromUrls} for AudioWorkletNode.
 */
export async function mountWorkletOnNode(
  node: AudioWorkletNode,
  args: MountWorkletArgs,
  opts: MountWorkletOptions = {},
): Promise<void> {
  return mountWorkletOnPortFromUrls(node.port, args, opts);
}

type ToMountMessageInit = Readonly<{
  /**
   * Optional so callers can pass either:
   * - { key, seq, wasmBytes, ... }
   * - { type: "wm:mount", key, seq, wasmBytes, ... }
   */
  type?: "wm:mount" | undefined;

  readonly key: string;
  readonly seq: number;
  readonly wasmBytes: WmWasmBytes;
  readonly wrapperJs?: string | undefined;
  readonly moduleOpts?: Readonly<Record<string, unknown>> | undefined;
}>;

function ensureValidSeq(seq: number, op: string): void {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw createWorkletMountError("invalidMountMessage", {
      reason: "seq must be a non-negative safe integer",
      receivedType: "wm:mount",
      receivedKeys: [op],
    });
  }
}

function buildMountMessage(
  init: ToMountMessageInit,
  op: string,
): WmMountMessage {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (init.type !== undefined && init.type !== "wm:mount") {
    throw createWorkletMountError("invalidMountMessage", {
      reason: `unexpected message type: ${String(init.type)}`,
      receivedType: String(init.type),
      receivedKeys: Object.keys(init),
    });
  }

  ensureNonEmptyKey(init.key, op);
  ensureValidSeq(init.seq, op);
  assertWasmBinary(init.wasmBytes, `host.${op}`);

  return {
    type: "wm:mount",
    key: init.key,
    seq: init.seq,
    wasmBytes: init.wasmBytes,
    ...(init.wrapperJs !== undefined ? { wrapperJs: init.wrapperJs } : {}),
    ...(init.moduleOpts !== undefined ? { moduleOpts: init.moduleOpts } : {}),
  };
}

export function toMountMessage(init: ToMountMessageInit): WmMountMessage;
export function toMountMessage(
  key: string,
  seq: number,
  wasmBytes: WmWasmBytes,
  wrapperJs?: string,
  moduleOpts?: Readonly<Record<string, unknown>>,
): WmMountMessage;
export function toMountMessage(
  keyOrInit: string | ToMountMessageInit,
  seq?: number,
  wasmBytes?: WmWasmBytes,
  wrapperJs?: string,
  moduleOpts?: Readonly<Record<string, unknown>>,
): WmMountMessage {
  if (typeof keyOrInit === "string") {
    if (seq === undefined || wasmBytes === undefined) {
      throw createWorkletMountError("invalidMountMessage", {
        reason:
          "toMountMessage(key, seq, wasmBytes, ...) requires both seq and wasmBytes",
        receivedType: "host.toMountMessage",
        receivedKeys: ["key", "seq", "wasmBytes"],
      });
    }

    return buildMountMessage(
      { key: keyOrInit, seq, wasmBytes, wrapperJs, moduleOpts },
      "toMountMessage",
    );
  }

  // Object form
  return buildMountMessage(keyOrInit, "toMountMessage");
}
