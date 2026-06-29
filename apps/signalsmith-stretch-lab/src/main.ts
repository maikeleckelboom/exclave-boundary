import "./styles.css";

import {
  createLabAudioContext,
  detectAudioRuntimeSupport,
  resumeAudioContext,
} from "./audio/audio-context";
import { decodeFileSource } from "./audio/decode-source";
import { LatestPrefetchGate } from "./audio/latest-prefetch-gate";
import {
  simulatedSourceFromPcm,
  type ChunkedWavPcmSource,
  type LabPcmSource,
  type PcmSourceFacts,
} from "./audio/pcm-source";
import { SourcePrefetch } from "./audio/source-prefetch";
import { StretchWorkletRuntime } from "./audio/stretch-node";
import { selectStretchRuntimeMode } from "./audio/stretch-runtime";
import {
  createStretchCommandTransport,
  type StretchCommandName,
} from "./boundary/commands";
import {
  createStretchBoundarySession,
  describeBoundaryError,
  disposeStretchBoundarySession,
  initializeDesiredControls,
  readDesiredControls,
  readPlanSummaries,
  readProcessedLevels,
  readRuntimeStatus,
  readSourceStatus,
  writeDesiredControls,
} from "./boundary/session";
import { FakeStretchEngine } from "./runtime/fake-stretch-engine";
import {
  SIGNALSMITH_LINEAR_REF,
  SIGNALSMITH_LINEAR_SOURCE_TAG,
  SIGNALSMITH_STRETCH_REF,
  SIGNALSMITH_STRETCH_SOURCE_BRANCH,
} from "./signalsmith/upstream";
import {
  readSignalsmithWorkletAssets,
  type SignalsmithWorkletAssetFacts,
} from "./signalsmith/worklet-assets";
import {
  defaultDesiredControls,
  defaultSimulatedSource,
  type DesiredStretchControls,
  type LoopPreview,
  type ProcessedLevelsSnapshot,
  type RuntimeStatusSnapshot,
  type SimulatedSource,
  type SourceStatusSnapshot,
} from "./types";
import { renderAppShell, renderUnsupported } from "./ui/dom";
import { createWaveformPeaks, drawWaveform } from "./ui/waveform";

import type { PlanarFrameChunk } from "./audio/chunked-wav-source";

const root = document.querySelector("#app");

if (!(root instanceof HTMLElement)) {
  throw new Error("Missing app root");
}

if (typeof SharedArrayBuffer === "undefined") {
  renderUnsupported(
    root,
    "SharedArrayBuffer is unavailable in this browser context.",
  );
} else {
  startLab(root);
}

function startLab(appRoot: HTMLElement): void {
  try {
    const elements = renderAppShell(appRoot);
    const signalsmithAssets = readSignalsmithWorkletAssets();
    const runtimeSupport = detectAudioRuntimeSupport();
    const session = createStretchBoundarySession();
    const commands = createStretchCommandTransport();
    let audioContext: AudioContext | null = null;
    let acceptedSource: LabPcmSource | null = null;
    let desired = defaultDesiredControls();
    let loadSequence = 1;
    let prefetch: SourcePrefetch | null = null;
    const prefetchGate = new LatestPrefetchGate<PlanarFrameChunk>();
    let realRuntime: StretchWorkletRuntime | null = null;
    let source = defaultSimulatedSource();
    let sourceFacts: PcmSourceFacts | null = null;
    let sourceRevision = 1;
    let sourceStatusText = "deterministic simulator source";
    let peaks = createWaveformPeaks(source);
    let requestedSeekFrame: number | null = null;
    let loopRevision = 1;
    let loopPreview: LoopPreview = {
      enabled: false,
      endFrame: source.frames,
      revision: loopRevision,
      startFrame: 0,
    };
    let clipBaselineLeft = 0;
    let clipBaselineRight = 0;

    initializeDesiredControls(session, desired);

    renderAdapterHeader(elements, signalsmithAssets, "simulator");

    const engine = new FakeStretchEngine(session, commands, { source });
    engine.tick({ renderQuantum: 128 });

    updateSourceLimits();
    updateControlOutputs();
    render();

    elements.playButton.addEventListener("click", () => {
      void resumeForGesture().then(() => {
        enqueueCommand("play");
      });
    });
    elements.pauseButton.addEventListener("click", () => {
      enqueueCommand("pause");
    });
    elements.stopButton.addEventListener("click", () => {
      requestedSeekFrame = null;
      enqueueCommand("stop");
    });
    elements.staleButton.addEventListener("click", () => {
      engine.simulateStaleRead(3);
      render();
    });
    elements.faultButton.addEventListener("click", () => {
      engine.setFault();
      render();
    });
    elements.resetFaultButton.addEventListener("click", () => {
      enqueueCommand("resetFault");
    });
    elements.resetControlsButton.addEventListener("click", () => {
      desired = {
        ...defaultDesiredControls(),
        desiredSequence: nextSequence(desired.desiredSequence),
      };
      applyControlsToInputs(desired, elements);
      writeDesiredControls(session, desired);
      updateControlOutputs();
      render();
    });
    elements.clearClipButton.addEventListener("click", () => {
      const levels = readProcessedLevels(session);
      clipBaselineLeft = levels.fullScaleLeftTotal;
      clipBaselineRight = levels.fullScaleRightTotal;
      render();
    });

    for (const input of [
      elements.rate,
      elements.pitch,
      elements.transitionFrames,
      elements.tonalityEnabled,
      elements.tonalityHz,
      elements.formantShift,
      elements.formantCompensation,
      elements.formantBase,
    ]) {
      input.addEventListener("input", () => {
        desired = collectDesiredFromInputs(
          elements,
          nextSequence(desired.desiredSequence),
          desired,
        );
        writeDesiredControls(session, desired);
        updateControlOutputs();
        render();
      });
    }

    elements.seekRange.addEventListener("input", () => {
      commitSeek(Number(elements.seekRange.value));
    });
    elements.seekFrame.addEventListener("change", () => {
      commitSeek(Number(elements.seekFrame.value));
    });
    elements.loopStart.addEventListener("input", () => {
      updateLoopPreview();
    });
    elements.loopEnd.addEventListener("input", () => {
      updateLoopPreview();
    });
    elements.setLoopButton.addEventListener("click", () => {
      updateLoopPreview();
      loopRevision += 1;
      loopPreview = { ...loopPreview, enabled: true, revision: loopRevision };
      commands.enqueue("setLoop", {
        loopEndFrame: loopPreview.endFrame,
        loopStartFrame: loopPreview.startFrame,
      });
      prefetchForFrame(loopPreview.startFrame, { latest: false });
      prefetchForFrame(loopPreview.endFrame, { latest: false });
      render();
    });
    elements.clearLoopButton.addEventListener("click", () => {
      loopRevision += 1;
      loopPreview = {
        enabled: false,
        endFrame: source.frames,
        revision: loopRevision,
        startFrame: 0,
      };
      commands.enqueue("clearLoop");
      render();
    });

    elements.fileInput.addEventListener("change", () => {
      const file = elements.fileInput.files?.item(0);
      if (file) {
        void loadFileSource(file);
      }
    });
    elements.sourceDrop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        elements.fileInput.click();
      }
    });
    elements.sourceDrop.addEventListener("dragover", (event) => {
      event.preventDefault();
      elements.sourceDrop.classList.add("is-dragging");
    });
    elements.sourceDrop.addEventListener("dragleave", () => {
      elements.sourceDrop.classList.remove("is-dragging");
    });
    elements.sourceDrop.addEventListener("drop", (event) => {
      event.preventDefault();
      elements.sourceDrop.classList.remove("is-dragging");
      const file = event.dataTransfer?.files.item(0);
      if (file) {
        void loadFileSource(file);
      }
    });
    elements.processedMode.addEventListener("change", render);
    elements.alignedSourceMode.addEventListener("change", render);

    let lastTickAt = 0;
    const animate = (time: number): void => {
      if (time - lastTickAt >= 80) {
        lastTickAt = time;
        if (realRuntimeOwnsCommandRing()) {
          maybePrefetchFromRuntime();
        } else {
          engine.tick({ renderQuantum: 256 });
        }
        clearAppliedSeekGhost();
        render();
      }
      window.requestAnimationFrame(animate);
    };
    window.requestAnimationFrame(animate);
    window.addEventListener("beforeunload", () => {
      realRuntime?.dispose();
      disposeStretchBoundarySession(session);
    });

    function enqueueCommand(name: StretchCommandName): void {
      const nextActive =
        name === "play"
          ? true
          : name === "pause" || name === "stop"
            ? false
            : desired.active;

      if (nextActive !== desired.active) {
        desired = {
          ...desired,
          active: nextActive,
          desiredSequence: nextSequence(desired.desiredSequence),
        };
        writeDesiredControls(session, desired);
      }

      commands.enqueue(name);
      if (!realRuntimeOwnsCommandRing()) {
        engine.tick({ renderQuantum: 128 });
      }
      render();
    }

    function commitSeek(value: number): void {
      const frame = clamp(value, 0, source.frames);
      requestedSeekFrame = frame;
      elements.seekRange.value = String(frame);
      elements.seekFrame.value = String(frame);
      prefetchForFrame(frame);
      commands.enqueue("seek", { targetSourceFrame: frame });
      if (!realRuntimeOwnsCommandRing()) {
        engine.tick({ renderQuantum: 128 });
      }
      render();
    }

    function updateLoopPreview(): void {
      const startFrame = clamp(
        Number(elements.loopStart.value),
        0,
        source.frames,
      );
      const endFrame = clamp(Number(elements.loopEnd.value), 0, source.frames);
      loopPreview = {
        enabled: endFrame > startFrame,
        endFrame,
        revision: loopRevision,
        startFrame,
      };
      elements.loopStartValue.textContent = formatFrame(startFrame);
      elements.loopEndValue.textContent = formatFrame(endFrame);
      render();
    }

    async function loadFileSource(file: File): Promise<void> {
      const context = await ensureAudioContext();
      const nextLoadSequence = loadSequence + 1;
      const nextSourceRevision = sourceRevision + 1;

      try {
        sourceStatusText = `Reading ${file.name}`;
        render();

        const loaded = await decodeFileSource(context, {
          expectedSampleRate: context.sampleRate,
          file,
          loadSequence: nextLoadSequence,
          previousFacts: sourceFacts,
          session,
          sourceRevision: nextSourceRevision,
        });

        acceptedSource = loaded;
        loadSequence = nextLoadSequence;
        sourceRevision = nextSourceRevision;
        sourceFacts = loaded;
        source = simulatedSourceFromPcm(loaded);
        sourceStatusText = loaded.formatSummary;
        peaks = createWaveformPeaks(source);
        loopRevision += 1;
        loopPreview = {
          enabled: false,
          endFrame: source.frames,
          revision: loopRevision,
          startFrame: 0,
        };
        requestedSeekFrame = null;
        engine.loadSource(source);
        updateSourceLimits();

        if (loaded.kind === "chunked-wav") {
          await prepareRealRuntime(loaded);
          commands.enqueue("loadSource", {
            sourceRevision: loaded.sourceRevision,
          });
        } else {
          realRuntime?.dispose();
          realRuntime = null;
          prefetch = null;
        }
      } catch (error) {
        sourceStatusText =
          error instanceof Error ? error.message : String(error);
      }

      render();
    }

    async function ensureAudioContext(): Promise<AudioContext> {
      audioContext ??= createLabAudioContext();

      await resumeAudioContext(audioContext);
      return audioContext;
    }

    async function resumeForGesture(): Promise<void> {
      const context = await ensureAudioContext();
      await resumeAudioContext(context);
      if (realRuntime) {
        await realRuntime.resume();
      }
    }

    async function prepareRealRuntime(
      loaded: ChunkedWavPcmSource,
    ): Promise<void> {
      const context = await ensureAudioContext();
      prefetch = new SourcePrefetch(loaded.source, {
        windowFrames: Math.max(4_096, Math.floor(loaded.sampleRate * 2)),
      });
      const initialChunk = await prefetch.prefetchWindow(
        0,
        Math.max(4_096, Math.floor(loaded.sampleRate * 2)),
      );

      if (!signalsmithAssets.generatedModuleUrl) {
        return;
      }

      if (!realRuntime || realRuntime.status.failed) {
        realRuntime?.dispose();
        realRuntime = await StretchWorkletRuntime.create({
          audioContext: context,
          commands,
          generatedModuleUrl: signalsmithAssets.generatedModuleUrl,
          initialChunk,
          session,
          source: loaded,
        });
      } else {
        realRuntime.postSource(loaded, initialChunk);
      }
    }

    function prefetchForFrame(
      frame: number,
      options: { readonly latest?: boolean } = {},
    ): void {
      if (!prefetch || acceptedSource?.kind !== "chunked-wav") {
        return;
      }

      const sourceForPost = acceptedSource;
      const prefetcher = prefetch;
      const postChunk = (chunk: PlanarFrameChunk): void => {
        if (acceptedSource !== sourceForPost) {
          return;
        }

        realRuntime?.postChunk(sourceForPost.sourceRevision, chunk);
      };

      if (options.latest === false) {
        void prefetcher.prefetchAround(frame).then(postChunk);
        return;
      }

      prefetchGate.request(() => prefetcher.prefetchAround(frame), postChunk);
    }

    function maybePrefetchFromRuntime(): void {
      if (!prefetch || prefetchGate.busy) {
        return;
      }

      const runtime = readRuntimeStatus(session);
      prefetchForFrame(
        runtime.sourceFrame + Math.max(0, runtime.inputLatencyFrames),
      );
    }

    function realRuntimeOwnsCommandRing(): boolean {
      return realRuntime !== null && !realRuntime.status.failed;
    }

    function updateSourceLimits(): void {
      for (const input of [
        elements.seekRange,
        elements.seekFrame,
        elements.loopStart,
        elements.loopEnd,
      ]) {
        input.max = String(source.frames);
      }
      elements.seekRange.value = "0";
      elements.seekFrame.value = "0";
      elements.loopStart.value = "0";
      elements.loopEnd.value = String(source.frames);
      elements.loopStartValue.textContent = "0";
      elements.loopEndValue.textContent = formatFrame(source.frames);
    }

    function updateControlOutputs(): void {
      elements.rateValue.textContent = `${Number(elements.rate.value).toFixed(3)}x`;
      elements.pitchValue.textContent = `${Number(elements.pitch.value).toFixed(1)} st`;
      elements.transitionFramesValue.textContent = `${Math.round(Number(elements.transitionFrames.value)).toString()} frames`;
      elements.tonalityHzValue.textContent = `${Math.round(Number(elements.tonalityHz.value)).toString()} Hz`;
      elements.formantShiftValue.textContent = `${Number(elements.formantShift.value).toFixed(1)} st`;
      elements.formantBaseValue.textContent =
        Number(elements.formantBase.value) === 0
          ? "Auto"
          : `${Math.round(Number(elements.formantBase.value)).toString()} Hz`;
    }

    function render(): void {
      const desiredSnapshot = readDesiredControls(session);
      const runtime = readRuntimeStatus(session);
      const levels = readProcessedLevels(session);
      const sourceStatus = readSourceStatus(session);
      const plans = readPlanSummaries(session);
      const realStatus = realRuntime?.status ?? null;
      const runtimeSelection = selectStretchRuntimeMode({
        audioWorkletAvailable:
          runtimeSupport.audioWorklet &&
          audioContext?.audioWorklet !== undefined,
        crossOriginIsolated: runtimeSupport.crossOriginIsolated,
        generatedModuleUrl: signalsmithAssets.generatedModuleUrl,
        sharedArrayBufferAvailable: runtimeSupport.sharedArrayBuffer,
        sourceAccepted:
          (realStatus?.sourceAccepted ?? false) ||
          (acceptedSource?.kind === "chunked-wav" &&
            sourceStatus.state === "accepted" &&
            sourceStatus.sourceRevision === acceptedSource.sourceRevision),
        sourceDecoded: acceptedSource?.kind === "chunked-wav",
        workletReady:
          (realStatus?.workletReady ?? false) ||
          runtime.adapterMode === "real-worklet",
      });
      const monitor = elements.alignedSourceMode.checked
        ? "Aligned source mock"
        : runtimeSelection.mode === "real-worklet"
          ? "Processed real Worklet"
          : "Processed simulation";
      const pending =
        desiredSnapshot.desiredSequence !==
          runtime.lastAppliedDesiredSequence ||
        desiredSnapshot.configSequence !== runtime.lastAppliedConfigSequence;
      const clipLeft = levels.fullScaleLeftTotal - clipBaselineLeft;
      const clipRight = levels.fullScaleRightTotal - clipBaselineRight;

      renderAdapterHeader(elements, signalsmithAssets, runtimeSelection.mode);
      elements.transportState.textContent = runtime.state;
      elements.appliedSequence.textContent = `${runtime.lastAppliedDesiredSequence.toString()} desired, ${runtime.lastAppliedConfigSequence.toString()} config, ${runtime.lastAppliedCommandSequence.toString()} command`;
      elements.pendingState.textContent = pending
        ? `waiting for control ${desiredSnapshot.desiredSequence.toString()} / config ${desiredSnapshot.configSequence.toString()}`
        : "none";
      elements.commandDrops.textContent =
        runtime.commandDroppedTotal.toString();
      elements.loopApplied.textContent = runtime.loopEnabled
        ? `${formatFrame(runtime.loopStartFrame)} to ${formatFrame(runtime.loopEndFrame)} rev ${runtime.loopRevision.toString()}`
        : "inactive";
      elements.playhead.textContent = `${formatTime(runtime.sourceFrame, source.sampleRate)} / ${formatTime(source.frames, source.sampleRate)}`;
      elements.seekRange.value = String(Math.floor(runtime.sourceFrame));
      if (requestedSeekFrame === null) {
        elements.seekFrame.value = String(Math.floor(runtime.sourceFrame));
      }

      renderMetadata(source);
      renderLevels(levels, clipLeft, clipRight);
      renderInspector(
        plans,
        desiredSnapshot,
        runtime,
        sourceStatus,
        levels,
        runtimeSelection,
      );

      elements.status.classList.toggle("is-error", runtime.lastErrorCode !== 0);
      elements.status.textContent = [
        runtime.lastErrorCode === 0
          ? `Runtime ${runtimeSelection.mode}; ${runtimeSelection.reason}.`
          : `Recoverable runtime fault ${runtime.lastErrorCode.toString()}.`,
        sourceStatusText,
        realStatus?.lastError ? `Worklet error ${realStatus.lastError}.` : "",
        pending
          ? "Desired controls are pending runtime acknowledgement."
          : "Desired controls match applied acknowledgement.",
        monitor,
      ]
        .filter(Boolean)
        .join(" ");

      drawWaveform(elements.waveform, peaks, {
        appliedLoop: {
          enabled: runtime.loopEnabled || loopPreview.enabled,
          endFrame: runtime.loopEnabled
            ? runtime.loopEndFrame
            : loopPreview.endFrame,
          revision: runtime.loopEnabled
            ? runtime.loopRevision
            : loopPreview.revision,
          startFrame: runtime.loopEnabled
            ? runtime.loopStartFrame
            : loopPreview.startFrame,
        },
        levels: levels.historyPeak,
        requestedSeekFrame,
        runtime,
        source,
      });
    }

    function renderMetadata(currentSource: SimulatedSource): void {
      renderKeyValues(elements.metadata, [
        ["Name", currentSource.name],
        ["Mode", currentSource.status],
        ["Format", sourceFacts?.formatSummary ?? sourceStatusText],
        [
          "Duration",
          formatTime(currentSource.frames, currentSource.sampleRate),
        ],
        ["Channels", currentSource.channels.toString()],
        ["Sample rate", `${currentSource.sampleRate.toString()} Hz`],
        ["PCM memory", formatBytes(currentSource.memoryBytes)],
      ]);
    }

    function renderLevels(
      levels: ProcessedLevelsSnapshot,
      clipLeft: number,
      clipRight: number,
    ): void {
      renderKeyValues(elements.levelsSummary, [
        ["Probe", levels.probeState],
        ["RMS L/R", `${dbfs(levels.rmsLeft)} / ${dbfs(levels.rmsRight)}`],
        ["Peak L/R", `${dbfs(levels.peakLeft)} / ${dbfs(levels.peakRight)}`],
        [
          "Full-scale latch",
          clipLeft > 0 || clipRight > 0
            ? `latched L ${clipLeft.toString()} / R ${clipRight.toString()}`
            : "clear",
        ],
        ["Window", `${levels.windowFrames.toString()} frames`],
      ]);
    }

    function renderInspector(
      plans: ReturnType<typeof readPlanSummaries>,
      desiredSnapshot: DesiredStretchControls,
      runtime: RuntimeStatusSnapshot,
      sourceStatus: SourceStatusSnapshot,
      levels: ProcessedLevelsSnapshot,
      runtimeSelection: ReturnType<typeof selectStretchRuntimeMode>,
    ): void {
      renderKeyValues(elements.inspector, [
        ["Signalsmith Stretch branch", SIGNALSMITH_STRETCH_SOURCE_BRANCH],
        ["Signalsmith Stretch SHA", SIGNALSMITH_STRETCH_REF],
        [
          "Signalsmith Linear ref",
          `${SIGNALSMITH_LINEAR_SOURCE_TAG} (${SIGNALSMITH_LINEAR_REF})`,
        ],
        ["Vendored source", vendorFact(signalsmithAssets)],
        [
          "Generated module",
          signalsmithAssets.generatedModuleExists ? "present" : "missing",
        ],
        ["Runtime", runtimeSelection.mode],
        ["Runtime selection", runtimeSelection.reason],
        ["Adapter mode", runtime.adapterMode],
        ["Source format", sourceFacts?.formatSummary ?? sourceStatusText],
        ["Desired active", desiredSnapshot.active ? "true" : "false"],
        [
          "Applied sequence",
          `${runtime.lastAppliedDesiredSequence.toString()} desired / ${runtime.lastAppliedConfigSequence.toString()} config / ${runtime.lastAppliedCommandSequence.toString()} command`,
        ],
        ["Effective rate", `${runtime.effectiveRate.toFixed(3)}x`],
        [
          "Block / interval",
          `${runtime.blockSamples.toString()} / ${runtime.intervalSamples.toString()} samples`,
        ],
        [
          "Input / output latency",
          `${formatFrame(runtime.inputLatencyFrames)} / ${formatFrame(runtime.outputLatencyFrames)} frames`,
        ],
        ["Duration", formatTime(runtime.durationFrames, source.sampleRate)],
        ["Source state", sourceStatus.state],
        ["Source revision", sourceStatus.sourceRevision.toString()],
        [
          "AudioWorklet frame/time",
          `${runtime.audioWorkletFrameHi.toString()}:${runtime.audioWorkletFrameLo.toString()} / ${runtime.audioWorkletTimeSeconds.toFixed(3)}s`,
        ],
        [
          "Source prefetch",
          prefetch
            ? `${prefetch.facts.ready ? "ready" : "pending"}; ${formatFrame(prefetch.facts.cachedFrameCount)} frames cached; underruns ${prefetch.facts.underrunTotal.toString()}`
            : "inactive",
        ],
        ["Desired plan", planFact(plans.desired)],
        ["Runtime plan", planFact(plans.runtime)],
        ["Source plan", planFact(plans.source)],
        ["Levels plan", planFact(plans.levels)],
        ["PU/MU versions", versionFact(plans)],
        [
          "Runtime frames",
          `${formatFrame(runtime.outputFrame)} out / ${formatFrame(runtime.sourceFrame)} src`,
        ],
        ["Stale reads", runtime.staleReadTotal.toString()],
        ["Invalid transitions", runtime.invalidTransitionTotal.toString()],
        [
          "Level probe",
          `${levels.probeState}; RMS ${dbfs(levels.rmsLeft)} / ${dbfs(levels.rmsRight)}; peak ${dbfs(levels.peakLeft)} / ${dbfs(levels.peakRight)}`,
        ],
      ]);
    }

    function clearAppliedSeekGhost(): void {
      if (requestedSeekFrame === null) {
        return;
      }

      const runtime = readRuntimeStatus(session);
      if (Math.abs(runtime.sourceFrame - requestedSeekFrame) < 512) {
        requestedSeekFrame = null;
      }
    }
  } catch (error) {
    renderUnsupported(appRoot, describeBoundaryError(error));
  }
}

function renderAdapterHeader(
  elements: ReturnType<typeof renderAppShell>,
  assets: SignalsmithWorkletAssetFacts,
  runtimeMode: "real-worklet" | "simulator",
): void {
  elements.runtimeModeBadge.textContent =
    runtimeMode === "real-worklet" ? "Real Worklet" : "Simulator fallback";
  elements.adapterAvailability.textContent = assets.realAdapterStatus;
}

function collectDesiredFromInputs(
  elements: ReturnType<typeof renderAppShell>,
  desiredSequence: number,
  previousControls: DesiredStretchControls,
): DesiredStretchControls {
  return {
    ...previousControls,
    desiredSequence,
    formantBaseHz: Number(elements.formantBase.value),
    formantCompensation: elements.formantCompensation.checked,
    formantSemitones: Number(elements.formantShift.value),
    pitchSemitones: Number(elements.pitch.value),
    rate: Number(elements.rate.value),
    tonalityEnabled: elements.tonalityEnabled.checked,
    tonalityHz: Number(elements.tonalityHz.value),
    transitionFrames: Math.round(Number(elements.transitionFrames.value)),
  };
}

function applyControlsToInputs(
  controls: DesiredStretchControls,
  elements: ReturnType<typeof renderAppShell>,
): void {
  elements.rate.value = String(controls.rate);
  elements.pitch.value = String(controls.pitchSemitones);
  elements.transitionFrames.value = String(controls.transitionFrames);
  elements.tonalityEnabled.checked = controls.tonalityEnabled;
  elements.tonalityHz.value = String(controls.tonalityHz);
  elements.formantShift.value = String(controls.formantSemitones);
  elements.formantCompensation.checked = controls.formantCompensation;
  elements.formantBase.value = String(controls.formantBaseHz);
}

function renderKeyValues(
  container: HTMLElement,
  rows: readonly (readonly [string, string])[],
): void {
  const list = document.createElement("dl");
  list.className = "fact-list";

  for (const [label, value] of rows) {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    item.append(term, detail);
    list.append(item);
  }

  container.replaceChildren(list);
}

function planFact(
  plan: ReturnType<typeof readPlanSummaries>["desired"],
): string {
  const planes = [
    `PF32 ${plan.planes.PF32.toString()}`,
    `PI32 ${plan.planes.PI32.toString()}`,
    `PB ${plan.planes.PB.toString()}`,
    `PU ${plan.planes.PU.toString()}`,
    `MF32 ${plan.planes.MF32.toString()}`,
    `MF64 ${plan.planes.MF64.toString()}`,
    `MU32 ${plan.planes.MU32.toString()}`,
    `MU ${plan.planes.MU.toString()}`,
  ].join(", ");

  return `${plan.id}; hash ${plan.hash.slice(0, 12)}; ${plan.bytesTotal.toString()} bytes; lock ${plan.lockStrideBytes.toString()} bytes; handoff v${plan.handoffVersion.toString()} ${plan.handoffPacking}; ${planes}`;
}

function versionFact(plans: ReturnType<typeof readPlanSummaries>): string {
  return [
    `desired ${plans.desired.paramVersion.toString()}/${plans.desired.meterVersion.toString()}`,
    `runtime ${plans.runtime.paramVersion.toString()}/${plans.runtime.meterVersion.toString()}`,
    `source ${plans.source.paramVersion.toString()}/${plans.source.meterVersion.toString()}`,
    `levels ${plans.levels.paramVersion.toString()}/${plans.levels.meterVersion.toString()}`,
  ].join("; ");
}

function vendorFact(assets: SignalsmithWorkletAssetFacts): string {
  const stretch = assets.stretchVendorMeta
    ? "Stretch present"
    : "Stretch missing";
  const linear = assets.linearVendorMeta ? "Linear present" : "Linear missing";

  return `${stretch}; ${linear}`;
}

function nextSequence(current: number): number {
  const next = (current + 1) >>> 0;
  return next === 0 ? 1 : next;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function formatFrame(frame: number): string {
  return Math.floor(frame).toLocaleString("en-US");
}

function formatTime(frame: number, sampleRate: number): string {
  const seconds = Math.max(0, frame / sampleRate);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes.toString()}:${rest.toFixed(1).padStart(4, "0")}`;
}

function formatBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return `${mib.toFixed(1)} MiB`;
}

function dbfs(value: number): string {
  if (value <= 0) {
    return "-inf dBFS";
  }

  return `${(20 * Math.log10(value)).toFixed(1)} dBFS`;
}
