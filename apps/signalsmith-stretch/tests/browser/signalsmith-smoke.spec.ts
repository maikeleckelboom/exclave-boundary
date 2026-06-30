import { writeFileSync } from "node:fs";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

const SAMPLE_RATE = 48_000;
const SMOKE_WAV_SECONDS = 2;

test("primary demo loads the default comparison track and keeps proof diagnostics collapsed", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator("#sourceDrop")).toBeVisible();
  await expect(page.locator("#sourcePrimary")).toHaveText(
    "signalsmith-demo-loop.wav",
  );
  await expect(page.locator("#sourceSecondary")).toHaveText(
    "Official Signalsmith demo loop, converted to WAV for comparison.",
  );
  await expect(page.locator("#sourceState")).toHaveText(
    "WAV chunked PCM 16-bit 48000 Hz stereo",
  );
  await expect(page.locator("#sourceStatusBadge")).toHaveText("Source loaded");
  await expect(page.locator("#waveformPanel")).toBeVisible();
  await expect(page.locator("#waveform")).toBeVisible();
  await expect(page.getByText("Deterministic simulator source")).toHaveCount(0);
  await expect(page.getByText("1:34.0")).toBeHidden();
  await expect(page.getByText("34.4 MiB")).toBeHidden();
  await expect(
    page.getByText("Applied playhead and requested seek"),
  ).toHaveCount(0);
  await expect.poll(() => canvasHasPaint(page, "#waveform")).toBe(true);

  await expect(page.locator("#playButton")).toBeEnabled();
  await expect(page.locator("#pauseButton")).toBeEnabled();
  await expect(page.locator("#seekRange")).toBeEnabled();
  await expect(page.locator("#loopStart")).toBeEnabled();
  await expect(page.locator("#processedMode")).toBeEnabled();
  await expect(page.locator("#rate")).toBeEnabled();
  await expect(page.locator("#pitch")).toBeEnabled();
  await expect(page.locator("#transitionFrames")).toHaveCount(0);
  await expect(
    page.locator("label").filter({ hasText: "Transition" }),
  ).toHaveCount(0);
  await expect(page.locator("#configPreset")).toBeEnabled();
  await expect(page.locator("#controlsHint")).toBeHidden();

  await expect(
    page.locator("label").filter({ hasText: "Tonality limit" }),
  ).toBeVisible();
  await expect(page.locator("#listeningPreset")).toHaveValue("music-default");
  await expect(page.locator("#rangeMode")).toHaveValue("musical");
  await expect(page.locator("#rate")).toHaveAttribute("min", "0.5");
  await expect(page.locator("#rate")).toHaveAttribute("max", "2");
  await expect(page.locator("#pitch")).toHaveAttribute("min", "-7");
  await expect(page.locator("#pitch")).toHaveAttribute("max", "7");
  await expect(page.locator("#formantShift")).toHaveAttribute("min", "-7");
  await expect(page.locator("#formantShift")).toHaveAttribute("max", "7");
  await expect(page.locator("#configPreset")).toHaveValue("balanced");
  await expect(page.locator("#tonalityHz")).toHaveValue("8000");
  await expect(page.locator("#tonalityHzValue")).toHaveText("8000 Hz");
  await expect(page.locator("#formantCompensation")).not.toBeChecked();
  await expect(page.locator("#formantBaseAuto")).toBeChecked();
  await expect(page.locator("#formantBaseValue")).toHaveText("Auto (0)");
  await expect(page.locator("#advancedInspector")).not.toHaveAttribute("open");
  await expect(page.getByText("Exclave spec hash")).not.toBeVisible();

  await page.locator("#advancedInspector > summary").click();
  await expect(page.getByText("Exclave spec hash")).toBeVisible();
  await expect(page.getByText("Nested spec plan")).toBeVisible();
  await expect.poll(() => runtimeFact(page, "Source mode")).toBe("chunked WAV");
  await expect
    .poll(() => runtimeFact(page, "Source format"))
    .toBe("WAV chunked PCM 16-bit 48000 Hz stereo");
  await expect
    .poll(() => runtimeFact(page, "Voice/formant base"))
    .toBe("Auto (0)");

  await page.locator("#rangeMode").selectOption("extended");
  await expect(page.locator("#rate")).toHaveAttribute("max", "4");
  await expect(page.locator("#pitch")).toHaveAttribute("min", "-12");
  await expect(page.locator("#pitch")).toHaveAttribute("max", "12");

  await page.locator("#rangeMode").selectOption("extreme");
  await expect(page.locator("#rate")).toHaveAttribute("min", "0.05");
  await expect(page.locator("#rate")).toHaveAttribute("max", "8");
  await expect(page.locator("#pitch")).toHaveAttribute("max", "48");
  await expect(page.locator("#rangeModeWarning")).toBeVisible();

  await setRange(page, "#rate", "8");
  await setRange(page, "#pitch", "24");
  await setRange(page, "#formantShift", "12");
  await page.locator("#rangeMode").selectOption("musical");
  await expect(page.locator("#rate")).toHaveValue("2");
  await expect(page.locator("#pitch")).toHaveValue("7");
  await expect(page.locator("#formantShift")).toHaveValue("7");
  await expect(page.locator("#rangeModeWarning")).toBeHidden();
});

test("primary controls enable after a source loads", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  const wavPath = testInfo.outputPath("controls-enable.wav");
  writeFileSync(wavPath, createSmokeWav());

  await page.locator("#fileInput").setInputFiles(wavPath);
  await expect(page.locator("#sourcePrimary")).toHaveText(
    "controls-enable.wav",
  );
  await expect(page.locator("#waveformPanel")).toBeVisible();
  await expect(page.locator("#waveform")).toBeVisible();
  await expect(page.locator("#playButton")).toBeEnabled();
  await expect(page.locator("#seekRange")).toBeEnabled();
  await expect(page.locator("#processedMode")).toBeEnabled();
  await expect(page.locator("#rate")).toBeEnabled();
  await expect(page.locator("#pitch")).toBeEnabled();
  await expect(page.locator("#configPreset")).toBeEnabled();
  await expect(page.locator("#configPreset")).toHaveValue("balanced");
  await expect(page.locator("#controlsHint")).toBeHidden();
  await expect.poll(() => runtimeFact(page, "Source format")).toContain("WAV");
  await expect
    .poll(() => runtimeFact(page, "Waveform mode"))
    .toContain("actual");

  await page.locator("#formantBaseAuto").uncheck();
  await setRange(page, "#formantBase", "10");
  await expect
    .poll(() => runtimeFact(page, "Voice/formant base"))
    .toBe("50 Hz");
  await setRange(page, "#formantBase", "1000");
  await expect
    .poll(() => runtimeFact(page, "Voice/formant base"))
    .toBe("500 Hz");
  await page.locator("#formantBaseAuto").check();
  await expect
    .poll(() => runtimeFact(page, "Voice/formant base"))
    .toBe("Auto (0)");
});

test("reports refused WAV sample-rate contexts without resampling", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const optionsSeen: AudioContextOptions[] = [];
    Object.defineProperty(window, "__audioContextOptions", {
      configurable: true,
      value: optionsSeen,
    });

    class RefusingAudioContext {
      readonly sampleRate = 48_000;
      readonly state: AudioContextState = "running";

      constructor(options: AudioContextOptions = {}) {
        optionsSeen.push(options);
      }

      close(): Promise<void> {
        return Promise.resolve();
      }

      resume(): Promise<void> {
        return Promise.resolve();
      }
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: RefusingAudioContext,
    });
  });

  await page.goto("/");

  const wavPath = testInfo.outputPath("sample-rate-mismatch.wav");
  writeFileSync(wavPath, createSmokeWav(44_100));

  await page.locator("#fileInput").setInputFiles(wavPath);

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__audioContextOptions?.map(
            (options) => options.sampleRate ?? 0,
          ) ?? [],
      ),
    )
    .toContain(44_100);
  await expect.poll(() => runtimeFact(page, "WAV mode")).toBe("unsupported");
  await expect(page.locator("#status")).toContainText("resampling is required");
  await expect(page.locator("#status")).toContainText("not implemented yet");
});

test("requests a 44.1 kHz AudioContext for a 44.1 kHz WAV", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    const optionsSeen: AudioContextOptions[] = [];
    Object.defineProperty(window, "__audioContextOptions", {
      configurable: true,
      value: optionsSeen,
    });

    class TrackingAudioContext extends NativeAudioContext {
      constructor(options: AudioContextOptions = {}) {
        optionsSeen.push(options);
        super(options);
      }
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: TrackingAudioContext,
    });
  });

  await page.goto("/");

  const wavPath = testInfo.outputPath("sample-rate-44100.wav");
  writeFileSync(wavPath, createSmokeWav(44_100, 1));

  await page.locator("#fileInput").setInputFiles(wavPath);

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__audioContextOptions?.map(
            (options) => options.sampleRate ?? 0,
          ) ?? [],
      ),
    )
    .toContain(44_100);
  await expect.poll(() => runtimeFact(page, "Sample rate")).toBe("44100 Hz");
});

test("real Worklet runtime handles chunked WAV transport controls", async ({
  page,
}, testInfo) => {
  test.skip(
    !isRealAdapterRun(testInfo),
    "Real Worklet smoke requires pnpm signalsmith:prepare and pnpm signalsmith:test:browser:real.",
  );

  await page.addInitScript(() => {
    const state = { sourceAcceptedMessages: 0 };
    Object.defineProperty(window, "__stretchSmoke", {
      configurable: true,
      value: state,
    });

    const listeners = new WeakMap<MessagePort, EventListener>();
    const handlers = new WeakMap<MessagePort, MessagePort["onmessage"]>();

    Object.defineProperty(MessagePort.prototype, "onmessage", {
      configurable: true,
      get(this: MessagePort) {
        return handlers.get(this) ?? null;
      },
      set(this: MessagePort, handler: MessagePort["onmessage"]) {
        const previous = listeners.get(this);

        if (previous) {
          this.removeEventListener("message", previous);
        }

        handlers.set(this, handler);

        if (typeof handler !== "function") {
          return;
        }

        const listener = (event: Event): void => {
          const message = event as MessageEvent<unknown>;

          if (
            isRecord(message.data) &&
            message.data.type === "sourceAccepted"
          ) {
            state.sourceAcceptedMessages += 1;
          }

          const callback = handler as (
            this: MessagePort,
            nextEvent: MessageEvent<unknown>,
          ) => void;
          callback.call(this, message);
        };

        listeners.set(this, listener);
        this.addEventListener("message", listener);
        this.start();
      },
    });
  });

  await page.goto("/");

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const context = new AudioContext();

        try {
          return {
            audioContext: true,
            audioWorklet: Boolean(context.audioWorklet),
            crossOriginIsolated: window.crossOriginIsolated,
            sharedArrayBuffer: typeof window.SharedArrayBuffer !== "undefined",
          };
        } finally {
          void context.close();
        }
      }),
    )
    .toMatchObject({
      audioContext: true,
      audioWorklet: true,
      crossOriginIsolated: true,
      sharedArrayBuffer: true,
    });

  await expectRealAdapterAssetsAvailable(page);

  const wavPath = testInfo.outputPath("signalsmith-smoke.wav");
  writeFileSync(wavPath, createSmokeWav());

  await page.locator("#fileInput").setInputFiles(wavPath);
  await expect(page.locator("#sourcePrimary")).toHaveText(
    "signalsmith-smoke.wav",
  );
  await expect(page.locator("#status")).toContainText("Real Worklet active.");
  await expect(page.locator("#runtimeModeBadge")).toHaveText(
    "Real Worklet active",
  );
  await expect.poll(() => runtimeFact(page, "Source format")).toContain("WAV");
  await expect.poll(() => runtimeFact(page, "WAV mode")).toBe("chunked");
  await expect.poll(() => runtimeFact(page, "Worklet mode")).toBe("real");

  await expect
    .poll(() => runtimeFact(page, "Source prefetch"))
    .toContain("ready");
  await expect.poll(() => runtimeFact(page, "Cache status")).toContain("ready");
  await expect
    .poll(() => runtimeFact(page, "Waveform mode"))
    .toContain("actual");
  const sourceAcceptedAfterLoad = await smokeFact(
    page,
    "sourceAcceptedMessages",
  );
  expect(sourceAcceptedAfterLoad).toBeGreaterThanOrEqual(0);
  expect(sourceAcceptedAfterLoad).toBeLessThanOrEqual(2);

  await page.locator("#playButton").click();
  await expect.poll(() => runtimeFact(page, "State")).toBe("playing");
  await expect
    .poll(async () =>
      outputFrameFact(await runtimeFact(page, "Runtime frames")),
    )
    .toBeGreaterThan(0);

  const blockIntervalBefore = await runtimeFact(
    page,
    "Block / interval / split",
  );
  await page.locator("#listeningPreset").selectOption("music-default");
  await expect(page.locator("#tonalityHz")).toHaveValue("8000");
  await expect(page.locator("#formantShift")).toHaveValue("0");
  await expect(page.locator("#formantCompensation")).not.toBeChecked();
  await expect(page.locator("#formantBaseAuto")).toBeChecked();
  await expect
    .poll(() => runtimeFact(page, "Voice/formant base"))
    .toBe("Auto (0)");
  await setRange(page, "#rate", "1.25");
  await setRange(page, "#pitch", "3");
  await expect
    .poll(() => page.locator("#rateValue").textContent())
    .toBe("1.250x");
  await expect
    .poll(() => runtimeFact(page, "Block / interval / split"))
    .toBe(blockIntervalBefore);
  await expect
    .poll(() => smokeFact(page, "sourceAcceptedMessages"))
    .toBe(sourceAcceptedAfterLoad);

  await setRange(page, "#tonalityHz", "9000");
  await setRange(page, "#formantShift", "2");
  await page.locator("#formantCompensation").check();
  await page.locator("#formantBaseAuto").uncheck();
  await setRange(page, "#formantBase", "80");
  await expect
    .poll(() => runtimeFact(page, "Block / interval / split"))
    .toBe(blockIntervalBefore);

  await page.locator("#configPreset").selectOption("custom");
  await expect(page.locator("#engineConfigFields")).toBeVisible();
  await setRange(page, "#blockMs", "150");
  await expect
    .poll(() => page.locator("#blockMsNumber").inputValue())
    .toBe("150");
  await expect
    .poll(() => page.locator("#configPreset").inputValue())
    .toBe("custom");
  await expect
    .poll(() => runtimeFact(page, "Block / interval / split"))
    .toContain("150 ms");
  await expect
    .poll(() => runtimeFact(page, "Block / interval / split"))
    .toContain("7200");
  await expect
    .poll(() => runtimeFact(page, "Block / interval / split"))
    .not.toBe(blockIntervalBefore);

  await setRange(page, "#overlap", "5");
  await expect
    .poll(() => page.locator("#overlapNumber").inputValue())
    .toBe("5.0");
  await expect
    .poll(() => runtimeFact(page, "Block / interval / split"))
    .toContain("30.0 ms");
  await expect
    .poll(() => runtimeFact(page, "Block / interval / split"))
    .toContain("1440");

  const blockIntervalAfterConfig = await runtimeFact(
    page,
    "Block / interval / split",
  );
  await setRange(page, "#rate", "0.75");
  await setRange(page, "#pitch", "-4");
  await expect
    .poll(() => runtimeFact(page, "Block / interval / split"))
    .toBe(blockIntervalAfterConfig);

  await page.locator("#alignedSourceMode").check();
  await expect
    .poll(() => runtimeFact(page, "Monitor"))
    .toContain("Original preview");
  await page.locator("#splitCompareMode").check();
  await expect.poll(() => runtimeFact(page, "Monitor")).toContain("Compare");
  await page.locator("#processedMode").check();
  await page.locator("#pauseButton").click();
  await expect.poll(() => runtimeFact(page, "State")).toBe("ready-paused");

  await setSeekFrame(page, "12000");
  await expect.poll(() => sourceFrameNear(page, 12_000, 2_048)).toBe(true);
  await page.locator("#markLoopStartButton").click();
  await expect(page.locator("#loopDraft")).toContainText("not set");

  await setSeekFrame(page, "36000");
  await expect.poll(() => sourceFrameNear(page, 36_000, 2_048)).toBe(true);
  await page.locator("#markLoopEndButton").click();
  await expect(page.locator("#loopDraft")).toContainText("12,");
  await expect(page.locator("#loopDraft")).toContainText("36,000");
  await expect(page.locator("#loopValidation")).toContainText("Ready");

  await page.locator("#playLoopButton").click();
  await expect(page.locator("#loopApplied")).toContainText("12,000 to 36,000");
  await expect
    .poll(() => runtimeFact(page, "Loop"))
    .toContain("12,000 to 36,000");
  await expect.poll(() => runtimeFact(page, "State")).toBe("playing");
  await expect
    .poll(() => numericRuntimeFact(page, "Audible source frame"), {
      timeout: 10_000,
    })
    .toBeGreaterThan(30_000);
  await expect
    .poll(() => numericRuntimeFact(page, "Audible source frame"), {
      timeout: 15_000,
    })
    .toBeLessThan(28_000);
  await expect.poll(() => runtimeFact(page, "State")).toBe("playing");
  await expect
    .poll(() => runtimeFact(page, "Source prefetch"))
    .toContain("ready");
  await expect
    .poll(() => runtimeFact(page, "Worklet source cache"))
    .toContain("MiB");

  await page.locator("#clearLoopButton").click();
  await expect.poll(() => runtimeFact(page, "Loop")).toBe("inactive");
  await expect(page.locator("#loopDraft")).toHaveText("none");

  await setSeekFrame(page, "96000");
  await expect.poll(() => sourceFrameNear(page, 96_000, 2_048)).toBe(true);
  await page.locator("#playButton").click();
  await expect.poll(() => runtimeFact(page, "State")).toBe("playing");
  await expect
    .poll(() => numericRuntimeFact(page, "Audible source frame"))
    .toBeLessThan(8_000);

  await page.locator("#pauseButton").click();
  await expect.poll(() => runtimeFact(page, "State")).toBe("ready-paused");
});

function isRealAdapterRun(testInfo: TestInfo): boolean {
  return testInfo.config.metadata.signalsmithRuntime === "real-adapter";
}

async function expectRealAdapterAssetsAvailable(page: Page): Promise<void> {
  const generatedModuleUrl = new URL(
    "/__signalsmith-stretch/signalsmith-stretch.module.js",
    page.url(),
  ).toString();
  const response = await page.request.get(generatedModuleUrl);

  expect(
    response.ok(),
    `Expected real-adapter Vite server to serve ${generatedModuleUrl}, got HTTP ${response.status().toString()}.`,
  ).toBe(true);
  const generatedModuleSource = await response.text();
  expect(
    generatedModuleSource,
    "Expected generated module to be real Emscripten Signalsmith output, not a missing or shimmed asset.",
  ).toContain("SignalsmithStretchModule");
  await expect(
    page.locator("#adapterAvailability"),
    "Real browser smoke requires prepared real-adapter assets before loading a source.",
  ).toHaveText("Ready for a decoded source.");
  await expect(
    page.locator("#runtimeModeBadge"),
    "The real suite must start from real Worklet readiness, not simulator fallback.",
  ).toHaveText("Real Worklet ready");
  await expect
    .poll(() => runtimeFact(page, "Vendored source"), {
      message:
        "Expected vendored Signalsmith sources to be visible in the inspector.",
    })
    .toBe("Stretch present; Linear present");
  await expect
    .poll(() => runtimeFact(page, "Generated module"), {
      message:
        "Expected the generated Signalsmith module to be visible in the inspector.",
    })
    .toBe("present");
}

async function runtimeFact(page: Page, name: string): Promise<string> {
  return page.evaluate((factName) => {
    for (const term of document.querySelectorAll("dt")) {
      if (term.textContent === factName) {
        return term.nextElementSibling?.textContent ?? "";
      }
    }

    return "";
  }, name);
}

async function smokeFact(
  page: Page,
  name: "sourceAcceptedMessages",
): Promise<number> {
  return page.evaluate((factName) => {
    const smoke = window.__stretchSmoke;

    if (!smoke) {
      return -1;
    }

    return smoke[factName];
  }, name);
}

async function canvasHasPaint(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) {
      throw new Error("Expected canvas.");
    }

    const context = element.getContext("2d");
    if (!context) {
      return false;
    }

    const data = context.getImageData(0, 0, element.width, element.height).data;

    for (let index = 3; index < data.length; index += 4) {
      if ((data[index] ?? 0) !== 0) {
        return true;
      }
    }

    return false;
  });
}

async function numericRuntimeFact(page: Page, name: string): Promise<number> {
  return parseFrameFact(await runtimeFact(page, name));
}

async function sourceFrameNear(
  page: Page,
  expected: number,
  tolerance: number,
): Promise<boolean> {
  const frame = await numericRuntimeFact(page, "Audible source frame");

  return Math.abs(frame - expected) <= tolerance;
}

async function setRange(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  await page.locator(selector).evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error("Expected range input.");
    }

    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function setSeekFrame(page: Page, value: string): Promise<void> {
  await page.locator("#seekFrame").evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error("Expected seek frame input.");
    }

    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

function createSmokeWav(
  sampleRate = SAMPLE_RATE,
  seconds = SMOKE_WAV_SECONDS,
): Buffer {
  const channels = 2;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const frames = sampleRate * seconds;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const bytes = Buffer.alloc(44 + dataBytes);

  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * blockAlign, 28);
  bytes.writeUInt16LE(blockAlign, 32);
  bytes.writeUInt16LE(bitsPerSample, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataBytes, 40);

  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 12_000,
    );
    const offset = 44 + frame * blockAlign;

    bytes.writeInt16LE(sample, offset);
    bytes.writeInt16LE(sample, offset + bytesPerSample);
  }

  return bytes;
}

function outputFrameFact(value: string): number {
  return parseFrameFact(value);
}

function parseFrameFact(value: string): number {
  const [outputFrame = "0"] = value.split(" ");

  return Number(outputFrame.replaceAll(",", ""));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

declare global {
  interface Window {
    readonly __audioContextOptions?: readonly AudioContextOptions[];
    readonly __stretchSmoke?: {
      readonly sourceAcceptedMessages: number;
    };
  }
}
