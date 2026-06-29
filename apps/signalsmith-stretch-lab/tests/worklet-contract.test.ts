import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { selectStretchRuntimeMode } from "../src/audio/stretch-runtime";
import { SIGNALSMITH_ADAPTER_CONTRACT } from "../src/signalsmith/adapter-contract";
import { SIGNALSMITH_STRETCH_GENERATED_MODULE } from "../src/signalsmith/module-types";

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKLET_PROCESSOR = join(
  APP_ROOT,
  "src",
  "worklet",
  "stretch-processor.ts",
);
const BOUNDARY_BINDINGS = join(
  APP_ROOT,
  "src",
  "worklet",
  "boundary-bindings.ts",
);
const WORKLET_MODULE = join(
  APP_ROOT,
  "src",
  "worklet",
  "signalsmith-module.ts",
);
const WORKLET_ASSETS = join(
  APP_ROOT,
  "src",
  "signalsmith",
  "worklet-assets.ts",
);
const PROCESSOR_NAME = join(APP_ROOT, "src", "worklet", "processor-name.ts");
const VITE_CONFIG = join(APP_ROOT, "vite.config.ts");

describe("Signalsmith real Worklet contract", () => {
  it("uses generated module naming instead of generated processor naming", () => {
    expect(SIGNALSMITH_STRETCH_GENERATED_MODULE).toBe(
      "generated/signalsmith-stretch.module.js",
    );
    expect(SIGNALSMITH_ADAPTER_CONTRACT.generatedModule.output).toBe(
      "generated/signalsmith-stretch.module.js",
    );
    expect(
      readFileSync(WORKLET_ASSETS, "utf8").includes(
        "signalsmith-stretch.worklet.js",
      ),
    ).toBe(false);
  });

  it("adds an authored Worklet processor with the expected registration name", () => {
    expect(existsSync(WORKLET_PROCESSOR)).toBe(true);
    const source = readFileSync(WORKLET_PROCESSOR, "utf8");

    expect(source).toContain("registerProcessor");
    expect(readFileSync(PROCESSOR_NAME, "utf8")).toContain(
      "signalsmith-stretch-lab-processor",
    );
  });

  it("passes the generated module URL into the Worklet instead of naming the processor after it", () => {
    const processor = readFileSync(WORKLET_PROCESSOR, "utf8");
    const assets = readFileSync(WORKLET_ASSETS, "utf8");

    expect(processor).toContain("moduleUrl");
    expect(assets).toContain("signalsmith-stretch.module.js");
    expect(processor).not.toContain("signalsmith-stretch.worklet.js");
  });

  it("bundles the generated Signalsmith factory into the served Worklet module", () => {
    const viteConfig = readFileSync(VITE_CONFIG, "utf8");
    const moduleLoader = readFileSync(WORKLET_MODULE, "utf8");

    expect(viteConfig).toContain("signalsmith-stretch.module.js");
    expect(viteConfig).toContain(
      "__SIGNALSMITH_STRETCH_MODULE_FACTORY__ = SignalsmithStretchModule",
    );
    expect(viteConfig).toContain("var crypto = globalThis.crypto");
    expect(viteConfig).toContain("getRandomValues(view)");
    expect(viteConfig).toContain("expected default export");
    expect(moduleLoader).toContain("__SIGNALSMITH_STRETCH_MODULE_FACTORY__");
  });

  it("binds accepted Exclave handoffs for desired, runtime, source, and levels", () => {
    const source = readFileSync(BOUNDARY_BINDINGS, "utf8");

    expect(source).toContain("acceptHandoff(handoffs.desired)");
    expect(source).toContain("acceptHandoff(handoffs.runtime)");
    expect(source).toContain("acceptHandoff(handoffs.source)");
    expect(source).toContain("acceptHandoff(handoffs.levels)");
    expect(source).toContain("bindProcessor");
  });

  it("reads flat desired params and does not use nested control/config keys", () => {
    const source = readFileSync(WORKLET_PROCESSOR, "utf8");

    for (const key of [
      "params.active",
      "params.rate",
      "params.pitchSemitones",
      "params.configSequence",
      "params.blockMs",
      "params.intervalMs",
      "params.splitComputation",
    ]) {
      expect(source).toContain(key);
    }

    expect(source).not.toMatch(/params\.(control|config)\./u);
  });

  it("publishes flat runtime, source, and level meters", () => {
    const source = [
      readFileSync(WORKLET_PROCESSOR, "utf8"),
      readFileSync(
        join(APP_ROOT, "src", "worklet", "runtime-meters.ts"),
        "utf8",
      ),
      readFileSync(join(APP_ROOT, "src", "worklet", "level-probe.ts"), "utf8"),
    ].join("\n");

    for (const key of [
      '"effectiveRate"',
      '"blockSamples"',
      '"audioWorkletTimeSeconds"',
      '"sourceRevision"',
      '"durationFrames"',
      '"rmsLeft"',
      '"peakLeft"',
    ]) {
      expect(source).toContain(key);
    }

    expect(source).not.toMatch(/"(runtime|source|levels)\./u);
  });

  it("centers buffered source reads on the Signalsmith input and output latency window", () => {
    const source = readFileSync(WORKLET_PROCESSOR, "utf8");

    expect(source).toContain("this.inputLatencyFrames +");
    expect(source).toContain("this.outputLatencyFrames");
    expect(source).toContain("module._seek(this.bufferLengthFrames");
    expect(source).toContain("module._process(0, outputFrameCount)");
  });

  it("selects simulator when generated module is missing", () => {
    expect(
      selectStretchRuntimeMode({
        audioWorkletAvailable: true,
        crossOriginIsolated: true,
        generatedModuleUrl: null,
        sharedArrayBufferAvailable: true,
        sourceAccepted: true,
        sourceDecoded: true,
        workletReady: true,
      }),
    ).toMatchObject({ mode: "simulator" });
  });

  it("identifies real adapter availability after module, source, and Worklet acceptance are present", () => {
    expect(
      selectStretchRuntimeMode({
        audioWorkletAvailable: true,
        crossOriginIsolated: true,
        generatedModuleUrl: "/assets/signalsmith-stretch.module.js",
        sharedArrayBufferAvailable: true,
        sourceAccepted: true,
        sourceDecoded: true,
        workletReady: true,
      }),
    ).toMatchObject({ mode: "real-worklet" });
  });

  it("serves dev and preview with SharedArrayBuffer isolation headers", () => {
    const source = readFileSync(VITE_CONFIG, "utf8");

    expect(source).toContain('"Cross-Origin-Opener-Policy": "same-origin"');
    expect(source).toContain('"Cross-Origin-Embedder-Policy": "require-corp"');
    expect(source).toContain('"Cross-Origin-Resource-Policy": "same-origin"');
    expect(source).toContain("server: {");
    expect(source).toContain("preview: {");
    expect(source).toMatch(/server:\s*\{\s*headers:\s*isolationHeaders/su);
    expect(source).toMatch(/preview:\s*\{\s*headers:\s*isolationHeaders/su);
  });
});
