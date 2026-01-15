import { createWorkletMountError } from "../errors";
import { assertWasmBinary, toU8View, type WmWasmBytes } from "../protocol";

import type { EmscriptenFactory, EmscriptenModule } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFactory<T extends EmscriptenModule>(
  value: unknown,
): value is EmscriptenFactory<T> {
  return typeof value === "function";
}

function pickExportedFactory<T extends EmscriptenModule>(
  moduleExports: unknown,
  exportsObj: Record<string, unknown>,
  returned: unknown,
  maybeModuleSymbol: unknown,
): EmscriptenFactory<T> | undefined {
  if (isFactory<T>(moduleExports)) {
    return moduleExports;
  }
  if (isRecord(moduleExports) && isFactory<T>(moduleExports.default)) {
    return moduleExports.default;
  }

  if (isFactory<T>(exportsObj.default)) {
    return exportsObj.default;
  }
  if (isFactory<T>(exportsObj.Module)) {
    return exportsObj.Module;
  }
  if (isFactory<T>(exportsObj.factory)) {
    return exportsObj.factory;
  }

  if (isFactory<T>(returned)) {
    return returned;
  }
  if (isRecord(returned) && isFactory<T>(returned.default)) {
    return returned.default;
  }

  if (isFactory<T>(maybeModuleSymbol)) {
    return maybeModuleSymbol;
  }

  return undefined;
}

/**
 * Evaluate runtime wrapper JS text into an Emscripten MODULARIZE factory.
 *
 * NOTE: ES module syntax (`export default`) cannot be eval'd via Function().
 * For modern wrappers, prefer registry-first (static import + omit wrapperJs).
 */
export function createDynamicFactory<T extends EmscriptenModule>(
  args: Readonly<{
    key: string;
    seq: number;
    wrapperJs: string;
    wasmBytes: WmWasmBytes;
  }>,
): EmscriptenFactory<T> {
  const { key, seq, wrapperJs, wasmBytes } = args;

  assertWasmBinary(wasmBytes, "worklet.createDynamicFactory");

  const moduleObj: { exports?: unknown } = {};
  const exportsObj: Record<string, unknown> = {};

  let evaluator: (
    moduleArg: { exports?: unknown },
    exportsArg: Record<string, unknown>,
  ) => unknown;

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    evaluator = new Function(
      "module",
      "exports",
      [
        `"use strict";`,
        wrapperJs,
        `let __maybeModule;`,
        `try { __maybeModule = Module; } catch { __maybeModule = undefined; }`,
        `return { returned: (typeof __result !== "undefined" ? __result : undefined), maybeModule: __maybeModule };`,
      ].join("\n"),
    ) as typeof evaluator;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw createWorkletMountError(
      "dynamicWrapperEvalFailed",
      {
        key,
        seq,
        stage: "compile",
        errorMessage: msg,
      },
      err,
    );
  }

  let evalOut: unknown;
  try {
    evalOut = evaluator(moduleObj, exportsObj);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw createWorkletMountError(
      "dynamicWrapperEvalFailed",
      {
        key,
        seq,
        stage: "execute",
        errorMessage: msg,
      },
      err,
    );
  }

  const returned =
    isRecord(evalOut) && "returned" in evalOut ? evalOut.returned : undefined;
  const maybeModuleSymbol =
    isRecord(evalOut) && "maybeModule" in evalOut
      ? evalOut.maybeModule
      : undefined;

  const exported = pickExportedFactory<T>(
    moduleObj.exports,
    exportsObj,
    returned,
    maybeModuleSymbol,
  );

  if (!exported) {
    throw createWorkletMountError("dynamicWrapperNoFactory", {
      key,
      seq,
      reason:
        "Wrapper evaluated successfully but did not expose an Emscripten MODULARIZE factory (module.exports/default/exports.default/Module/factory/return value).",
    });
  }

  const forcedBinary = toU8View(wasmBytes);

  return (opts) => exported({ ...opts, wasmBinary: forcedBinary });
}
