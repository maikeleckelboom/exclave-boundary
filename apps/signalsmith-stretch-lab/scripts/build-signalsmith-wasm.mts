import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, "..");
const INPUT = path.join(
  APP_ROOT,
  "vendor",
  "signalsmith-stretch",
  "web",
  "emscripten",
  "main.cpp",
);
const OUTPUT = path.join(
  APP_ROOT,
  "generated",
  "signalsmith-stretch.module.js",
);

const INCLUDE_DIRS = [
  path.join(APP_ROOT, "vendor", "signalsmith-stretch", "include"),
  path.join(APP_ROOT, "vendor", "signalsmith-stretch"),
  path.join(APP_ROOT, "vendor", "signalsmith-linear", "include"),
  path.join(APP_ROOT, "vendor", "signalsmith-linear"),
] as const;

const EXPORTED_FUNCTIONS = [
  "_malloc",
  "_free",
  "_setBuffers",
  "_blockSamples",
  "_intervalSamples",
  "_inputLatency",
  "_outputLatency",
  "_reset",
  "_presetDefault",
  "_presetCheaper",
  "_configure",
  "_setTransposeFactor",
  "_setTransposeSemitones",
  "_setFormantFactor",
  "_setFormantSemitones",
  "_setFormantBase",
  "_seek",
  "_process",
  "_flush",
] as const;

const EXPORTED_RUNTIME_METHODS = ["HEAPF32"] as const;

const COMPILE_FLAGS = [
  "-std=c++11",
  "-O3",
  "-ffast-math",
  "-fno-math-errno",
  "-fno-exceptions",
  "-fno-rtti",
  "-Wall",
  "-Wextra",
  "-Wpedantic",
  "-Wfatal-errors",
] as const;

const LINK_FLAGS = [
  "-sSTRICT=1",
  "-sSINGLE_FILE=1",
  "-sINITIAL_MEMORY=64mb",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sMEMORY_GROWTH_GEOMETRIC_STEP=2.0",
  "-sMALLOC=emmalloc",
  "-sSTACK_SIZE=64kb",
  "-sABORTING_MALLOC=1",
  "-sDYNAMIC_EXECUTION=0",
  "-sFILESYSTEM=0",
  "-sENVIRONMENT=worker",
  "-sMODULARIZE=1",
  "-sEXPORT_ES6=1",
  "-sASSERTIONS=0",
] as const;

function emscriptenCommand(): string {
  if (process.env.EMXX) {
    return process.env.EMXX;
  }

  if (process.env.EMCC) {
    return process.env.EMCC;
  }

  return process.platform === "win32" ? "em++.exe" : "em++";
}

function emList(values: readonly string[]): string {
  return JSON.stringify(values);
}

function shellForCommand(command: string): boolean {
  return process.platform === "win32" && /\.(?:bat|cmd)$/iu.test(command);
}

async function run(
  command: string,
  args: readonly string[],
  options: { readonly quiet?: boolean } = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: APP_ROOT,
      shell: shellForCommand(command),
      stdio: options.quiet === true ? "ignore" : "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${String(code)}`,
        ),
      );
    });
  });
}

async function ensureEmpp(command: string): Promise<void> {
  try {
    if (process.platform === "win32" && !path.isAbsolute(command)) {
      await run("where.exe", [command], { quiet: true });
    } else {
      await run(command, ["--version"], { quiet: true });
    }
  } catch {
    throw new Error(
      [
        "em++ not found.",
        "Install and activate the Emscripten SDK so em++ is on PATH, or set EMXX to its executable.",
        "The normal build:wasm command does not emit a fake proof artifact.",
      ].join(" "),
    );
  }
}

async function writeShim(): Promise<void> {
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(
    OUTPUT,
    [
      "// Generated smoke shim for SIGNALSMITH_WASM_SHIM=1 only.",
      "// This is not a Signalsmith Stretch proof artifact.",
      "export default async function createSignalsmithStretchShim() {",
      "  const heap = new Float32Array(1024);",
      "  return {",
      "    HEAPF32: heap,",
      "    _malloc() { return 0; },",
      "    _free() {},",
      "    _setBuffers() { return 0; },",
      "    _blockSamples() { return 0; },",
      "    _intervalSamples() { return 0; },",
      "    _inputLatency() { return 0; },",
      "    _outputLatency() { return 0; },",
      "    _reset() {},",
      "    _presetDefault() {},",
      "    _presetCheaper() {},",
      "    _configure() {},",
      "    _setTransposeFactor() {},",
      "    _setTransposeSemitones() {},",
      "    _setFormantFactor() {},",
      "    _setFormantSemitones() {},",
      "    _setFormantBase() {},",
      "    _seek() {},",
      "    _process() { return 0; },",
      "    _flush() {},",
      "  };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`Wrote explicit smoke shim: ${path.relative(APP_ROOT, OUTPUT)}`);
}

async function build(): Promise<void> {
  const shimRequested =
    process.env.SIGNALSMITH_WASM_SHIM === "1" ||
    process.argv.includes("--shim");

  if (shimRequested) {
    await writeShim();
    return;
  }

  if (!existsSync(INPUT)) {
    throw new Error(
      `Missing ${path.relative(APP_ROOT, INPUT)}. Run pnpm --filter @exclave/signalsmith-stretch-lab vendor first.`,
    );
  }

  for (const includeDir of INCLUDE_DIRS) {
    if (!existsSync(includeDir)) {
      throw new Error(
        `Missing include path ${path.relative(APP_ROOT, includeDir)}. Run the vendor script first.`,
      );
    }
  }

  const command = emscriptenCommand();
  await ensureEmpp(command);
  await mkdir(path.dirname(OUTPUT), { recursive: true });

  const args = [
    INPUT,
    "-o",
    OUTPUT,
    ...INCLUDE_DIRS.flatMap((includeDir) => ["-I", includeDir]),
    ...COMPILE_FLAGS,
    ...LINK_FLAGS,
    `-sEXPORT_NAME=SignalsmithStretchModule`,
    `-sEXPORTED_FUNCTIONS=${emList(EXPORTED_FUNCTIONS)}`,
    `-sEXPORTED_RUNTIME_METHODS=${emList(EXPORTED_RUNTIME_METHODS)}`,
  ];

  console.log(
    `Building ${path.relative(APP_ROOT, OUTPUT)} from ${path.relative(APP_ROOT, INPUT)}`,
  );
  await run(command, args);
  console.log(`Built ${path.relative(APP_ROOT, OUTPUT)}`);
}

await build().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
