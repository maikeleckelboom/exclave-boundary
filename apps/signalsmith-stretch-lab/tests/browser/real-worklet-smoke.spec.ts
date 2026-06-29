import { writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

const SAMPLE_RATE = 48_000;
const SMOKE_WAV_SECONDS = 2;

test("primary demo keeps proof inspector collapsed until expanded", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator("#sourceDrop")).toBeVisible();
  await expect(page.locator("#waveform")).toBeVisible();
  await expect(
    page.locator("label").filter({ hasText: "Tonality limit" }),
  ).toBeVisible();
  await expect(page.locator("#listeningPreset")).toHaveValue("music-default");
  await expect(page.locator("#tonalityHz")).toHaveValue("8000");
  await expect(page.locator("#tonalityHzValue")).toHaveText("8000 Hz");
  await expect(page.locator("#formantCompensation")).not.toBeChecked();
  await expect(page.locator("#formantBaseAuto")).toBeChecked();
  await expect(page.locator("#formantBaseValue")).toHaveText("Auto (0)");
  await expect
    .poll(() => runtimeFact(page, "Voice/formant base"))
    .toBe("Auto (0)");
  await expect(page.locator("#advancedInspector")).not.toHaveAttribute("open");
  await expect(page.getByText("Exclave spec hash")).not.toBeVisible();

  await page.locator("#advancedInspector > summary").click();
  await expect(page.getByText("Exclave spec hash")).toBeVisible();
  await expect(page.getByText("Nested spec plan")).toBeVisible();

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
      page.evaluate(() => window.__audioContextOptions?.[0]?.sampleRate ?? 0),
    )
    .toBe(44_100);
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
      page.evaluate(() => window.__audioContextOptions?.[0]?.sampleRate ?? 0),
    )
    .toBe(44_100);
  await expect.poll(() => runtimeFact(page, "Sample rate")).toBe("44100 Hz");
});

test("real Worklet runtime handles chunked WAV transport controls", async ({
  page,
}, testInfo) => {
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

  const wavPath = testInfo.outputPath("signalsmith-smoke.wav");
  writeFileSync(wavPath, createSmokeWav());

  await page.locator("#fileInput").setInputFiles(wavPath);
  await expect(page.getByText("Runtime real-worklet")).toBeVisible();
  await expect(page.getByText("signalsmith-smoke.wav")).toBeVisible();
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
  await expect
    .poll(() => smokeFact(page, "sourceAcceptedMessages"))
    .toBeGreaterThanOrEqual(0);
  await expect
    .poll(() => smokeFact(page, "sourceAcceptedMessages"))
    .toBeLessThanOrEqual(1);

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
    .toBeLessThanOrEqual(1);

  await setRange(page, "#tonalityHz", "9000");
  await setRange(page, "#formantShift", "2");
  await page.locator("#formantCompensation").check();
  await page.locator("#formantBaseAuto").uncheck();
  await setRange(page, "#formantBase", "80");
  await expect
    .poll(() => runtimeFact(page, "Block / interval / split"))
    .toBe(blockIntervalBefore);

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
    .toContain("aligned reference preview");
  await page.locator("#splitCompareMode").check();
  await expect
    .poll(() => runtimeFact(page, "Monitor"))
    .toContain("split compare preview");
  await page.locator("#processedMode").check();

  await setRange(page, "#seekRange", "24000");
  await expect
    .poll(() => page.locator("#seekFrame").inputValue())
    .toBe("24000");

  await setRange(page, "#loopStart", "12000");
  await setRange(page, "#loopEnd", "36000");
  await page.locator("#setLoopButton").click();
  await expect
    .poll(() => runtimeFact(page, "Loop"))
    .toContain("12,000 to 36,000");
  await expect
    .poll(() => runtimeFact(page, "Source prefetch"))
    .toContain("ready");
  await expect
    .poll(() => runtimeFact(page, "Worklet source cache"))
    .toContain("MiB");

  await page.locator("#pauseButton").click();
  await expect.poll(() => runtimeFact(page, "State")).toBe("ready-paused");
});

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
