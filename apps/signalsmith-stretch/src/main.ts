import "./styles.css";

import {
  createProofAudioContext,
  detectAudioRuntimeSupport,
  resumeAudioContext,
} from "./audio/audio-context";
import { decodeFileSource } from "./audio/decode-source";
import { LatestPrefetchGate } from "./audio/latest-prefetch-gate";
import {
  simulatedSourceFromPcm,
  type ChunkedWavPcmSource,
  type ProofPcmSource,
  type PcmSourceFacts,
} from "./audio/pcm-source";
import { SourcePrefetch } from "./audio/source-prefetch";
import {
  SourceReferenceMonitor,
  type SourceReferenceMonitorStatus,
} from "./audio/source-reference-monitor";
import { StretchWorkletRuntime } from "./audio/stretch-node";
import { selectStretchRuntimeMode } from "./audio/stretch-runtime";
import {
  chooseTransportRefill,
  emptyTransportBufferExpectation,
  noteTransportChunkPosted,
  reconcileTransportBufferExpectation,
  speculativeTransportBufferEndFrame,
  type TransportBufferExpectation,
  type TransportBufferExpectationState,
  type TransportRefillDecision,
  type TransportRefillReason,
} from "./audio/transport-refill";
import { probeWavFile, type WavProbe } from "./audio/wav-probe";
import {
  computeChunkedWaveformPeaks,
  computePlanarWaveformPeaks,
  createEmptyWaveformPeaks,
  type WaveformPeakMode,
} from "./audio/waveform-peaks";
import {
  createStretchCommandTransport,
  type EnqueueCommandOptions,
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
import { enqueueApplyLoop, enqueuePlayLoop } from "./loop/loop-commands";
import {
  validateLoopRange,
  type LoopRange,
  type LoopValidationResult,
} from "./loop/loop-validation";
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
  applyListeningPreset,
  clampManualFormantBaseHz,
  clampTonalityLimitHz,
  defaultDesiredControls,
  defaultSimulatedSource,
  FORMANT_BASE_AUTO_HZ,
  FORMANT_BASE_MANUAL_DEFAULT_HZ,
  LISTENING_PRESETS,
  matchingListeningPreset,
  type DesiredStretchControls,
  type ListeningPreset,
  type ProcessedLevelsSnapshot,
  type RuntimeStatusSnapshot,
  type SimulatedSource,
  type SourceStatusSnapshot,
} from "./types";
import { renderAppShell, renderUnsupported } from "./ui/dom";
import { drawWaveform } from "./ui/waveform";

import type { PlanarFrameChunk } from "./audio/chunked-wav-source";

const root = document.querySelector("#app");

type WavLoadMode =
  | "browser decoded"
  | "chunked"
  | "none"
  | "probing"
  | "unsupported";

type RangeMode = "musical" | "extended" | "extreme";
type TransportPumpReason =
  | "audio-context-statechange"
  | "command"
  | "interval"
  | "loop"
  | "monitor-change"
  | "refill-complete"
  | "seek"
  | "source-load"
  | "startup"
  | "visibilitychange";
type QualityPreset =
  | "responsive"
  | "balanced"
  | "smooth"
  | "low-cpu"
  | "custom";

interface ControlRanges {
  readonly formant: {
    readonly max: number;
    readonly min: number;
  };
  readonly pitch: {
    readonly max: number;
    readonly min: number;
  };
  readonly rate: {
    readonly max: number;
    readonly min: number;
  };
}

interface QualityConfig {
  readonly blockMs: number;
  readonly intervalMs: number;
  readonly preset: DesiredStretchControls["preset"];
  readonly splitComputation: boolean;
}

interface SourceLoadOptions {
  readonly origin: SourceOrigin;
  readonly resumeAudio: boolean;
}

type SourceOrigin = "default" | "local";

interface AudioTransportDiagnostics {
  audioContextState: AudioContextState | "none";
  documentVisibility: DocumentVisibilityState;
  expectedBufferEndFrame: number;
  expectedBufferObservedEndFrame: number;
  expectedBufferState: TransportBufferExpectationState;
  expectedBufferUnconfirmedPumpCount: number;
  hiddenTransitionCount: number;
  lastAheadFrames: number;
  lastInputWindowEndFrame: number;
  lastPumpAtMs: number;
  lastPumpReason: TransportPumpReason | "none";
  lastRefillAtMs: number;
  lastRefillFrameCount: number;
  lastRefillReason: TransportRefillReason | "none";
  lastRefillStartFrame: number;
  lastSafeFloorFrames: number;
  lastTargetAheadFrames: number;
  pumpCount: number;
  refillInFlight: boolean;
  refillSequence: number;
  visibleTransitionCount: number;
}

const DEFAULT_SOURCE = {
  fileName: "signalsmith-demo-loop.wav",
  label: "official Signalsmith demo loop",
  url: "/audio/signalsmith-demo-loop.wav",
} as const;
const RECENT_SEEK_MARK_WINDOW_MS = 1_500;
const TRANSPORT_PUMP_INTERVAL_MS = 250;
const VISUAL_RENDER_INTERVAL_MS = 80;

const RANGE_MODE_LIMITS: Record<RangeMode, ControlRanges> = {
  extended: {
    formant: { max: 12, min: -12 },
    pitch: { max: 12, min: -12 },
    rate: { max: 4, min: 0.25 },
  },
  extreme: {
    formant: { max: 12, min: -12 },
    pitch: { max: 48, min: -48 },
    rate: { max: 8, min: 0.05 },
  },
  musical: {
    formant: { max: 7, min: -7 },
    pitch: { max: 7, min: -7 },
    rate: { max: 2, min: 0.5 },
  },
};

const QUALITY_CONFIGS: Record<
  Exclude<QualityPreset, "custom">,
  QualityConfig
> = {
  balanced: {
    blockMs: 120,
    intervalMs: 30,
    preset: "custom",
    splitComputation: true,
  },
  "low-cpu": {
    blockMs: 240,
    intervalMs: 60,
    preset: "custom",
    splitComputation: true,
  },
  responsive: {
    blockMs: 80,
    intervalMs: 80 / 3,
    preset: "custom",
    splitComputation: false,
  },
  smooth: {
    blockMs: 180,
    intervalMs: 30,
    preset: "custom",
    splitComputation: true,
  },
};

interface LoopDraft {
  readonly endFrame: number;
  readonly hasEnd: boolean;
  readonly hasStart: boolean;
  readonly revision: number;
  readonly startFrame: number;
}

interface LoopDraftStatus {
  readonly complete: boolean;
  readonly draft: LoopDraft;
  readonly validation: LoopValidationResult;
}

if (!(root instanceof HTMLElement)) {
  throw new Error("Missing app root");
}

if (typeof SharedArrayBuffer === "undefined") {
  renderUnsupported(
    root,
    "SharedArrayBuffer is unavailable in this browser context.",
  );
} else {
  startSignalsmithStretch(root);
}

function startSignalsmithStretch(appRoot: HTMLElement): void {
  try {
    const elements = renderAppShell(appRoot);
    const signalsmithAssets = readSignalsmithWorkletAssets();
    const runtimeSupport = detectAudioRuntimeSupport();
    const session = createStretchBoundarySession();
    const commands = createStretchCommandTransport();
    let audioContext: AudioContext | null = null;
    let acceptedSource: ProofPcmSource | null = null;
    let desired = defaultDesiredControls();
    let loadSequence = 1;
    let prefetch: SourcePrefetch | null = null;
    const prefetchGate = new LatestPrefetchGate<PlanarFrameChunk>();
    let realRuntime: StretchWorkletRuntime | null = null;
    let referenceMonitor: SourceReferenceMonitor | null = null;
    let transportRefillInFlight = false;
    let transportBufferExpectation = emptyTransportBufferExpectation();
    const transportDiagnostics = createAudioTransportDiagnostics();
    let qualityPreset: QualityPreset = "balanced";
    let rangeMode: RangeMode = "musical";
    let source = defaultSimulatedSource();
    let sourceFacts: PcmSourceFacts | null = null;
    let sourceRevision = 1;
    let selectedFileName: string | null = null;
    let sourceLoadRequestId = 0;
    let sourceOrigin: SourceOrigin | null = null;
    let defaultSourceLoadCancelled = false;
    let lastFileInputToken: string | null = null;
    let lastWavProbe: WavProbe | null = null;
    let wavMode: WavLoadMode = "none";
    let sourceStatusText = "No source loaded.";
    let waveform = createEmptyWaveformPeaks();
    let waveformMode: WaveformPeakMode = waveform.mode;
    let waveformAbort: AbortController | null = null;
    let requestedSeekFrame: number | null = null;
    let recentSeekFrame: number | null = null;
    let recentSeekAt = 0;
    let loopRevision = 1;
    let loopDraft = createLoopDraft(source.frames, loopRevision);
    let clipBaselineLeft = 0;
    let clipBaselineRight = 0;

    initializeDesiredControls(session, desired);
    applyRangeModeToInputs(rangeMode, elements);
    applyControlsToInputs(desired, elements, rangeMode);

    renderAdapterHeader(elements, signalsmithAssets, runtimeSupport, {
      hasLoadedSource: false,
      runtimeMode: "simulator",
    });

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
      qualityPreset = "balanced";
      rangeMode = "musical";
      desired = {
        ...defaultDesiredControls(),
        configSequence: nextSequence(desired.configSequence),
        desiredSequence: nextSequence(desired.desiredSequence),
      };
      applyRangeModeToInputs(rangeMode, elements);
      applyControlsToInputs(desired, elements, rangeMode);
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
      elements.tonalityEnabled,
      elements.tonalityHz,
      elements.formantShift,
      elements.formantCompensation,
      elements.formantBaseAuto,
      elements.formantBase,
    ]) {
      input.addEventListener("input", () => {
        desired = collectDesiredFromInputs(
          elements,
          nextSequence(desired.desiredSequence),
          desired,
          rangeMode,
        );
        writeDesiredControls(session, desired);
        updateControlOutputs();
        render();
      });
    }

    elements.rangeMode.addEventListener("change", () => {
      rangeMode = coerceRangeMode(elements.rangeMode.value);
      applyRangeModeToInputs(rangeMode, elements);
      desired = clampDesiredControlsToRangeMode(
        {
          ...desired,
          desiredSequence: nextSequence(desired.desiredSequence),
        },
        rangeMode,
      );
      applyControlsToInputs(desired, elements, rangeMode);
      writeDesiredControls(session, desired);
      updateControlOutputs();
      render();
    });

    elements.listeningPreset.addEventListener("change", () => {
      const preset = coerceListeningPreset(elements.listeningPreset.value);

      if (!preset) {
        updateControlOutputs();
        return;
      }

      desired = {
        ...applyListeningPreset(desired, preset),
        desiredSequence: nextSequence(desired.desiredSequence),
      };
      desired = clampDesiredControlsToRangeMode(desired, rangeMode);
      applyControlsToInputs(desired, elements, rangeMode);
      writeDesiredControls(session, desired);
      updateControlOutputs();
      render();
    });

    elements.configPreset.addEventListener("change", () => {
      qualityPreset = coerceQualityPreset(elements.configPreset.value);
      desired = collectConfigFromInputs(
        elements,
        nextSequence(desired.configSequence),
        desired,
        { forceCustom: false, source: "preset" },
      );
      writeDesiredControls(session, desired);
      updateControlOutputs();
      render();
    });

    for (const input of [
      elements.blockMs,
      elements.blockMsNumber,
      elements.overlap,
      elements.overlapNumber,
      elements.intervalMs,
      elements.splitComputation,
    ]) {
      input.addEventListener("input", () => {
        qualityPreset = "custom";
        desired = collectConfigFromInputs(
          elements,
          nextSequence(desired.configSequence),
          desired,
          {
            forceCustom: input !== elements.splitComputation,
            source:
              input === elements.intervalMs
                ? "interval"
                : input === elements.blockMs
                  ? "block-range"
                  : input === elements.blockMsNumber
                    ? "block-number"
                    : input === elements.overlapNumber
                      ? "overlap-number"
                      : "overlap-range",
          },
        );
        writeDesiredControls(session, desired);
        updateControlOutputs();
        render();
      });
    }

    elements.seekRange.addEventListener("input", () => {
      commitSeek(Number(elements.seekRange.value));
    });
    elements.seekFrame.addEventListener("input", () => {
      commitSeek(Number(elements.seekFrame.value));
    });
    elements.seekFrame.addEventListener("change", () => {
      commitSeek(Number(elements.seekFrame.value));
    });
    elements.loopStart.addEventListener("input", () => {
      updateLoopDraftFromInputs("start");
    });
    elements.loopEnd.addEventListener("input", () => {
      updateLoopDraftFromInputs("end");
    });
    elements.markLoopStartButton.addEventListener("click", () => {
      markLoopBoundary("start");
    });
    elements.markLoopEndButton.addEventListener("click", () => {
      markLoopBoundary("end");
    });
    elements.setLoopButton.addEventListener("click", () => {
      applyDraftLoop();
    });
    elements.playLoopButton.addEventListener("click", () => {
      void resumeForGesture().then(() => {
        playDraftLoop();
      });
    });
    elements.clearLoopButton.addEventListener("click", () => {
      clearDraftAndAppliedLoop();
    });

    const handleFileInput = (): void => {
      const file = elements.fileInput.files?.item(0);
      if (file) {
        const token = `${file.name}:${file.size.toString()}:${file.lastModified.toString()}`;
        if (token === lastFileInputToken) {
          return;
        }

        lastFileInputToken = token;
        void loadFileSource(file, { origin: "local", resumeAudio: true });
      }
    };
    elements.fileInput.addEventListener("input", handleFileInput);
    elements.fileInput.addEventListener("change", handleFileInput);
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
        void loadFileSource(file, { origin: "local", resumeAudio: true });
      }
    });
    for (const mode of [
      elements.processedMode,
      elements.alignedSourceMode,
      elements.splitCompareMode,
    ]) {
      mode.addEventListener("change", () => {
        syncMonitorGains();
        runTransportPump("monitor-change");
        render();
      });
    }

    let lastVisualTickAt = 0;
    const animate = (time: number): void => {
      if (time - lastVisualTickAt >= VISUAL_RENDER_INTERVAL_MS) {
        lastVisualTickAt = time;
        syncMonitorGains();
        clearAppliedSeekGhost();
        render();
      }
      window.requestAnimationFrame(animate);
    };
    const transportPumpTimer = window.setInterval(
      () => {
        runTransportPump("interval");
      },
      TRANSPORT_PUMP_INTERVAL_MS,
    );
    window.requestAnimationFrame(animate);
    runTransportPump("startup");
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", () => {
      window.clearInterval(transportPumpTimer);
      referenceMonitor?.dispose();
      realRuntime?.dispose();
      disposeStretchBoundarySession(session);
    });
    void loadDefaultSource();

    function enqueueCommand(name: StretchCommandName): void {
      if (name === "play" || name === "stop") {
        recentSeekFrame = null;
      }

      const nextActive =
        name === "play"
          ? true
          : name === "pause" || name === "stop"
            ? false
            : desired.active;

      setDesiredActive(nextActive);

      enqueueRuntimeCommand(name);
      render();
    }

    function setDesiredActive(active: boolean): void {
      if (active === desired.active) {
        return;
      }

      desired = {
        ...desired,
        active,
        desiredSequence: nextSequence(desired.desiredSequence),
      };
      writeDesiredControls(session, desired);
    }

    function enqueueRuntimeCommand(
      name: StretchCommandName,
      options?: EnqueueCommandOptions,
    ): ReturnType<typeof commands.enqueue> {
      const result = commands.enqueue(name, options);
      if (realRuntimeOwnsCommandRing()) {
        realRuntime?.postCommand(result.command);
      }
      runTransportPump("command");
      return result;
    }

    function notifyPendingRealCommands(): void {
      if (!realRuntimeOwnsCommandRing()) {
        return;
      }

      const runtime = readRuntimeStatus(session);
      const stats = commands.stats();
      if (
        stats.writeIndex !== stats.readIndex ||
        stats.writeSeq !== runtime.lastAppliedCommandSequence
      ) {
        realRuntime?.notifyCommandsAvailable();
      }
    }

    function commitSeek(value: number): void {
      const frame = clamp(value, 0, source.frames);
      requestedSeekFrame = frame;
      recentSeekFrame = frame;
      recentSeekAt = performance.now();
      elements.seekRange.value = String(frame);
      elements.seekFrame.value = String(frame);
      prefetchForFrame(frame);
      enqueueRuntimeCommand("seek", { targetSourceFrame: frame });
      runTransportPump("seek");
      render();
    }

    function updateLoopDraftFromInputs(boundary: "end" | "start"): void {
      const startFrame = clamp(
        Number(elements.loopStart.value),
        0,
        source.frames,
      );
      const endFrame = clamp(Number(elements.loopEnd.value), 0, source.frames);
      loopDraft = {
        ...loopDraft,
        endFrame,
        hasEnd: boundary === "end" ? true : loopDraft.hasEnd,
        hasStart: boundary === "start" ? true : loopDraft.hasStart,
        revision: nextLoopRevision(),
        startFrame,
      };
      syncLoopDraftInputs();
      render();
    }

    function markLoopBoundary(boundary: "end" | "start"): void {
      const runtime = readRuntimeStatus(session);
      const frame = clamp(
        recentSeekFrameForMark(runtime.state) ?? runtime.sourceFrame,
        0,
        source.frames,
      );

      loopDraft =
        boundary === "start"
          ? {
              ...loopDraft,
              hasStart: true,
              revision: nextLoopRevision(),
              startFrame: frame,
            }
          : {
              ...loopDraft,
              endFrame: frame,
              hasEnd: true,
              revision: nextLoopRevision(),
            };
      syncLoopDraftInputs();
      render();
    }

    function recentSeekFrameForMark(runtimeState: string): number | null {
      if (requestedSeekFrame !== null) {
        return requestedSeekFrame;
      }

      if (recentSeekFrame === null) {
        return null;
      }

      if (runtimeState !== "playing") {
        return recentSeekFrame;
      }

      return performance.now() - recentSeekAt <= RECENT_SEEK_MARK_WINDOW_MS
        ? recentSeekFrame
        : null;
    }

    function applyDraftLoop(): void {
      const runtime = readRuntimeStatus(session);
      const status = validateLoopDraft(runtime);

      if (!status.complete || !status.validation.valid) {
        render();
        return;
      }

      prefetchForLoop(status.validation.range, runtime);
      enqueueApplyLoop(
        { enqueue: enqueueRuntimeCommand },
        status.validation.range,
        loopFacts(runtime),
      );
      runTransportPump("loop");
      render();
    }

    function playDraftLoop(): void {
      const runtime = readRuntimeStatus(session);
      const status = validateLoopDraft(runtime);

      if (!status.complete || !status.validation.valid) {
        render();
        return;
      }

      recentSeekFrame = null;
      setDesiredActive(true);
      prefetchForLoop(status.validation.range, runtime);
      enqueuePlayLoop(
        { enqueue: enqueueRuntimeCommand },
        status.validation.range,
        loopFacts(runtime),
      );
      runTransportPump("loop");
      render();
    }

    function clearDraftAndAppliedLoop(): void {
      loopDraft = createLoopDraft(source.frames, nextLoopRevision());
      syncLoopDraftInputs();
      enqueueRuntimeCommand("clearLoop");
      render();
    }

    async function loadDefaultSource(): Promise<void> {
      const loadRequestBaseline = sourceLoadRequestId;
      sourceStatusText = `Loading ${DEFAULT_SOURCE.label}`;
      render();

      try {
        const response = await fetch(DEFAULT_SOURCE.url);
        if (!response.ok) {
          throw new Error(
            `Default source request failed with ${response.status.toString()}.`,
          );
        }

        if (shouldSkipDefaultSource(loadRequestBaseline)) {
          return;
        }

        const file = new File(
          [await response.blob()],
          DEFAULT_SOURCE.fileName,
          {
            type: "audio/wav",
          },
        );

        if (shouldSkipDefaultSource(loadRequestBaseline)) {
          return;
        }

        await loadFileSource(file, { origin: "default", resumeAudio: false });
      } catch (error) {
        if (shouldSkipDefaultSource(loadRequestBaseline)) {
          return;
        }

        sourceStatusText =
          error instanceof Error ? error.message : String(error);
        render();
      }
    }

    async function loadFileSource(
      file: File,
      options: SourceLoadOptions,
    ): Promise<void> {
      if (options.origin === "local") {
        defaultSourceLoadCancelled = true;
      }

      const loadRequestId = sourceLoadRequestId + 1;
      sourceLoadRequestId = loadRequestId;
      const nextLoadSequence = loadSequence + 1;
      const nextSourceRevision = sourceRevision + 1;
      selectedFileName = file.name;
      sourceOrigin = options.origin;
      lastWavProbe = null;
      wavMode = "probing";
      let loadWasWav = isLikelyWavFile(file);

      try {
        sourceStatusText = `Probing ${file.name}`;
        render();

        const wavProbe = await probeWavFile(file);
        loadWasWav = loadWasWav || wavProbe.isWav;
        if (!wavProbe.isWav && isLikelyWavFile(file)) {
          wavMode = "unsupported";
          throw new Error("Input .wav file is not a RIFF/WAVE file.");
        }

        const context = await ensureAudioContextForProbe(wavProbe, {
          resumeAudio: options.resumeAudio,
        });

        sourceStatusText = `Reading ${file.name}`;
        render();

        const loaded = await decodeFileSource(context, {
          ...(wavProbe.isWav && wavProbe.sampleRate !== null
            ? { expectedSampleRate: wavProbe.sampleRate }
            : {}),
          file,
          loadSequence: nextLoadSequence,
          previousFacts: sourceFacts,
          session,
          sourceRevision: nextSourceRevision,
        });

        if (loadRequestId !== sourceLoadRequestId) {
          return;
        }

        acceptedSource = loaded;
        loadSequence = nextLoadSequence;
        sourceRevision = nextSourceRevision;
        sourceFacts = loaded;
        source = simulatedSourceFromPcm(loaded);
        sourceStatusText = loaded.formatSummary;
        wavMode = loaded.kind === "chunked-wav" ? "chunked" : "browser decoded";
        resetWaveformForLoadedSource(loaded);
        loopDraft = createLoopDraft(source.frames, nextLoopRevision());
        requestedSeekFrame = null;
        recentSeekFrame = null;
        engine.loadSource(source);
        updateSourceLimits();

        if (loaded.kind === "chunked-wav") {
          startActualWaveformPeaks(loaded);
          let realRuntimePrepared = false;
          try {
            realRuntimePrepared = await prepareRealRuntime(loaded, {
              loadRequestId,
              resumeAudio: options.resumeAudio,
            });
          } catch {
            realRuntime?.dispose();
            realRuntime = null;
          }

          if (loadRequestId !== sourceLoadRequestId) {
            return;
          }

          if (realRuntimePrepared) {
            enqueueRuntimeCommand("loadSource", {
              sourceRevision: loaded.sourceRevision,
            });
          }
        } else {
          realRuntime?.dispose();
          realRuntime = null;
          referenceMonitor?.stop();
          prefetch = null;
          resetTransportBufferExpectation();
        }

        if (options.origin === "default") {
          applyDefaultSourceLoop();
        }
      } catch (error) {
        if (loadRequestId !== sourceLoadRequestId) {
          return;
        }

        wavMode = loadWasWav ? "unsupported" : "browser decoded";
        sourceStatusText =
          error instanceof Error ? error.message : String(error);
      }

      render();
    }

    function applyDefaultSourceLoop(): void {
      const range: LoopRange = {
        endFrame: source.frames,
        startFrame: 0,
      };
      const runtime = readRuntimeStatus(session);
      const validation = validateLoopRange(range, loopFacts(runtime));

      if (!validation.valid) {
        return;
      }

      loopDraft = {
        endFrame: validation.range.endFrame,
        hasEnd: true,
        hasStart: true,
        revision: nextLoopRevision(),
        startFrame: validation.range.startFrame,
      };
      syncLoopDraftInputs();
      prefetchForLoop(validation.range, runtime);
      enqueueApplyLoop({ enqueue: enqueueRuntimeCommand }, validation.range, {
        blockSamples: runtime.blockSamples,
        intervalSamples: runtime.intervalSamples,
      });
      runTransportPump("loop");
    }

    function shouldSkipDefaultSource(loadRequestBaseline: number): boolean {
      return (
        defaultSourceLoadCancelled ||
        sourceLoadRequestId !== loadRequestBaseline ||
        acceptedSource !== null
      );
    }

    async function ensureAudioContextForProbe(
      wavProbe: Awaited<ReturnType<typeof probeWavFile>>,
      options: { readonly resumeAudio: boolean },
    ): Promise<AudioContext> {
      if (!wavProbe.isWav) {
        lastWavProbe = null;
        wavMode = "browser decoded";
        return ensureAudioContext({ resumeAudio: options.resumeAudio });
      }

      lastWavProbe = wavProbe;
      if (wavProbe.sampleRate === null) {
        wavMode = "unsupported";
        throw new Error("Unsupported WAV header: missing fmt sample rate.");
      }

      const context = await ensureAudioContext({
        resumeAudio: options.resumeAudio,
        sampleRate: wavProbe.sampleRate,
      });

      if (context.sampleRate !== wavProbe.sampleRate) {
        wavMode = "unsupported";
        throw new Error(
          `WAV sample rate ${wavProbe.sampleRate.toString()} Hz requires an AudioContext at the same rate, but this browser opened ${context.sampleRate.toString()} Hz; resampling is required and is not implemented yet.`,
        );
      }

      return context;
    }

    async function ensureAudioContext(
      options: {
        readonly resumeAudio?: boolean;
        readonly sampleRate?: number;
      } = {},
    ): Promise<AudioContext> {
      if (
        options.sampleRate !== undefined &&
        audioContext &&
        audioContext.sampleRate !== options.sampleRate
      ) {
        realRuntime?.dispose();
        realRuntime = null;
        referenceMonitor?.dispose();
        referenceMonitor = null;
        prefetch = null;
        resetTransportBufferExpectation();

        const previous = audioContext;
        audioContext = null;
        if (previous.state !== "closed") {
          await previous.close().catch(() => undefined);
        }
      }

      audioContext ??= createProofAudioContext(
        options.sampleRate === undefined
          ? {}
          : { sampleRate: options.sampleRate },
      );
      attachAudioContextDiagnostics(audioContext);

      if (options.resumeAudio ?? true) {
        await resumeAudioContext(audioContext);
      }
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
      options: {
        readonly loadRequestId: number;
        readonly resumeAudio: boolean;
      },
    ): Promise<boolean> {
      const context = await ensureAudioContext({
        resumeAudio: options.resumeAudio,
      });
      const nextPrefetch = new SourcePrefetch(loaded.source, {
        windowFrames: Math.max(4_096, Math.floor(loaded.sampleRate * 2)),
      });
      const initialChunk = await nextPrefetch.prefetchWindow(
        0,
        Math.max(4_096, Math.floor(loaded.sampleRate * 2)),
      );

      if (options.loadRequestId !== sourceLoadRequestId) {
        return false;
      }

      referenceMonitor ??= new SourceReferenceMonitor(context);
      syncMonitorGains();
      prefetch = nextPrefetch;
      transportBufferExpectation = noteTransportChunkPosted({
        current: transportBufferExpectation,
        endFrame: initialChunk.startFrame + initialChunk.frameCount,
        sourceFrameCount: loaded.durationFrames,
        sourceRevision: loaded.sourceRevision,
      });
      syncTransportBufferExpectationDiagnostics();

      if (!signalsmithAssets.generatedModuleUrl) {
        return false;
      }

      const previousRuntime = realRuntime;
      const nextRuntime = await StretchWorkletRuntime.create({
        audioContext: context,
        commands,
        generatedModuleUrl: signalsmithAssets.generatedModuleUrl,
        initialChunk,
        session,
        source: loaded,
      });

      if (options.loadRequestId !== sourceLoadRequestId) {
        nextRuntime.dispose();
        return false;
      }

      previousRuntime?.dispose();
      realRuntime = nextRuntime;
      runTransportPump("source-load");

      return !realRuntime.status.failed;
    }

    function prefetchForFrame(
      frame: number,
      options: { readonly latest?: boolean } = {},
    ): void {
      prefetchWithGate(
        (prefetcher) => prefetcher.prefetchAround(frame),
        options,
      );
    }

    function prefetchForWindow(
      startFrame: number,
      frameCount: number,
      options: { readonly latest?: boolean } = {},
    ): void {
      prefetchWithGate(
        (prefetcher) => prefetcher.prefetchWindow(startFrame, frameCount),
        options,
      );
    }

    function prefetchWithGate(
      load: (prefetcher: SourcePrefetch) => Promise<PlanarFrameChunk>,
      options: { readonly latest?: boolean },
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
        void load(prefetcher).then(postChunk);
        return;
      }

      prefetchGate.request(() => load(prefetcher), postChunk);
    }

    function prefetchForLoop(
      range: LoopRange,
      runtime: RuntimeStatusSnapshot,
    ): void {
      const prefetchFrames = loopPrefetchFrames(runtime);
      const halfWindow = Math.floor(prefetchFrames / 2);

      prefetchForFrame(range.startFrame, { latest: false });
      prefetchForWindow(
        Math.max(0, range.startFrame - halfWindow),
        prefetchFrames,
        { latest: false },
      );
      prefetchForWindow(
        Math.max(0, range.endFrame - prefetchFrames),
        prefetchFrames,
        { latest: false },
      );
      prefetchForFrame(range.endFrame, { latest: false });
      prefetchForWindow(
        Math.max(0, range.endFrame - halfWindow),
        prefetchFrames,
        { latest: false },
      );
    }

    function loopPrefetchFrames(runtime: RuntimeStatusSnapshot): number {
      return Math.max(
        4_096,
        runtime.bufferLengthFrames,
        runtime.blockSamples + runtime.intervalSamples,
      );
    }

    function validateLoopDraft(
      runtime: RuntimeStatusSnapshot,
    ): LoopDraftStatus {
      return {
        complete: loopDraft.hasStart && loopDraft.hasEnd,
        draft: loopDraft,
        validation: validateLoopRange(loopDraft, loopFacts(runtime)),
      };
    }

    function loopFacts(runtime: RuntimeStatusSnapshot): {
      readonly blockSamples: number;
      readonly intervalSamples: number;
    } {
      return {
        blockSamples: runtime.blockSamples,
        intervalSamples: runtime.intervalSamples,
      };
    }

    function syncLoopDraftInputs(): void {
      elements.loopStart.value = String(loopDraft.startFrame);
      elements.loopEnd.value = String(loopDraft.endFrame);
      elements.loopStartValue.textContent = loopDraft.hasStart
        ? formatFrame(loopDraft.startFrame)
        : "not set";
      elements.loopEndValue.textContent = loopDraft.hasEnd
        ? formatFrame(loopDraft.endFrame)
        : "not set";
    }

    function nextLoopRevision(): number {
      loopRevision += 1;
      return loopRevision;
    }

    function realRuntimeOwnsCommandRing(): boolean {
      return realRuntime !== null && !realRuntime.status.failed;
    }

    function runTransportPump(reason: TransportPumpReason): void {
      transportDiagnostics.pumpCount += 1;
      transportDiagnostics.lastPumpAtMs = performance.now();
      transportDiagnostics.lastPumpReason = reason;
      transportDiagnostics.documentVisibility = document.visibilityState;
      transportDiagnostics.audioContextState = audioContext?.state ?? "none";

      if (realRuntimeOwnsCommandRing()) {
        notifyPendingRealCommands();
        scheduleTransportRefill();
      } else {
        engine.tick({ renderQuantum: 256 });
      }

      updateReferencePreview();
    }

    function scheduleTransportRefill(): void {
      if (
        transportRefillInFlight ||
        !prefetch ||
        acceptedSource?.kind !== "chunked-wav" ||
        !realRuntimeOwnsCommandRing()
      ) {
        transportDiagnostics.refillInFlight = transportRefillInFlight;
        return;
      }

      const runtime = readRuntimeStatus(session);
      const sourceStatus = readSourceStatus(session);
      transportBufferExpectation = reconcileTransportBufferExpectation({
        current: transportBufferExpectation,
        sourceFrameCount: acceptedSource.durationFrames,
        sourceRevision: acceptedSource.sourceRevision,
        sourceStatus,
      });
      syncTransportBufferExpectationDiagnostics(sourceStatus);

      const decision = chooseTransportRefill({
        active: true,
        expectedBufferEndFrame: speculativeTransportBufferEndFrame(
          transportBufferExpectation,
        ),
        runtime,
        sourceFrameCount: acceptedSource.durationFrames,
        sourceSampleRate: acceptedSource.sampleRate,
        sourceStatus,
      });

      if (!decision) {
        return;
      }

      postTransportRefill(acceptedSource, prefetch, decision);
    }

    function postTransportRefill(
      sourceForPost: ChunkedWavPcmSource,
      prefetcher: SourcePrefetch,
      decision: TransportRefillDecision,
    ): void {
      transportRefillInFlight = true;
      transportDiagnostics.refillInFlight = true;
      transportDiagnostics.refillSequence += 1;
      transportDiagnostics.lastAheadFrames = decision.aheadFrames;
      transportDiagnostics.lastInputWindowEndFrame =
        decision.inputWindowEndFrame;
      transportDiagnostics.lastRefillAtMs = performance.now();
      transportDiagnostics.lastRefillFrameCount = decision.frameCount;
      transportDiagnostics.lastRefillReason = decision.reason;
      transportDiagnostics.lastRefillStartFrame = decision.startFrame;
      transportDiagnostics.lastSafeFloorFrames = decision.safeFloorFrames;
      transportDiagnostics.lastTargetAheadFrames = decision.targetAheadFrames;

      void prefetcher
        .prefetchWindow(decision.startFrame, decision.frameCount)
        .then((chunk) => {
          if (acceptedSource !== sourceForPost || chunk.frameCount === 0) {
            return;
          }

          realRuntime?.postChunk(sourceForPost.sourceRevision, chunk);
          transportBufferExpectation = noteTransportChunkPosted({
            current: transportBufferExpectation,
            endFrame: chunk.startFrame + chunk.frameCount,
            sourceFrameCount: sourceForPost.durationFrames,
            sourceRevision: sourceForPost.sourceRevision,
          });
          syncTransportBufferExpectationDiagnostics();
        })
        .catch(() => {
          prefetcher.markUnderrun();
        })
        .finally(() => {
          transportRefillInFlight = false;
          transportDiagnostics.refillInFlight = false;
          runTransportPump("refill-complete");
        });
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
      syncLoopDraftInputs();
    }

    function updateControlOutputs(): void {
      elements.rateValue.textContent = `${Number(elements.rate.value).toFixed(3)}x`;
      elements.pitchValue.textContent = `${Number(elements.pitch.value).toFixed(1)} st`;
      elements.tonalityHzValue.textContent = `${Math.round(Number(elements.tonalityHz.value)).toString()} Hz`;
      elements.formantShiftValue.textContent = `${Number(elements.formantShift.value).toFixed(1)} st`;
      elements.formantBase.disabled = elements.formantBaseAuto.checked;
      elements.formantBaseValue.textContent = elements.formantBaseAuto.checked
        ? "Auto (0)"
        : `${Math.round(Number(elements.formantBase.value)).toString()} Hz`;
      elements.listeningPreset.value = matchingListeningPreset(desired);
      elements.configPreset.value = qualityPreset;
      elements.blockMs.value = desired.blockMs.toFixed(0);
      elements.blockMsNumber.value = desired.blockMs.toFixed(0);
      elements.intervalMs.min = (desired.blockMs / 8).toFixed(1);
      elements.intervalMs.max = (desired.blockMs / 2).toFixed(1);
      elements.intervalMs.value = desired.intervalMs.toFixed(1);
      elements.overlap.value = overlapFromConfig(desired).toFixed(1);
      elements.overlapNumber.value = overlapFromConfig(desired).toFixed(1);
      elements.splitComputation.checked = desired.splitComputation;
      elements.engineConfigFields.hidden = qualityPreset !== "custom";
      elements.rangeMode.value = rangeMode;
      elements.rangeModeWarning.hidden = rangeMode !== "extreme";
    }

    function resetWaveformForLoadedSource(loaded: ProofPcmSource): void {
      waveformAbort?.abort();
      waveformAbort = null;
      waveform =
        loaded.kind === "decoded-pcm"
          ? computePlanarWaveformPeaks(loaded.planar, loaded.durationFrames)
          : createEmptyWaveformPeaks();
      waveformMode = waveform.mode;
    }

    function startActualWaveformPeaks(loaded: ChunkedWavPcmSource): void {
      waveformAbort?.abort();
      const abort = new AbortController();
      waveformAbort = abort;

      void computeChunkedWaveformPeaks(loaded.source, {
        onProgress: (state) => {
          if (abort.signal.aborted || acceptedSource !== loaded) {
            return;
          }

          waveform = state;
          waveformMode = state.mode;
          render();
        },
        signal: abort.signal,
      }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        sourceStatusText =
          error instanceof Error ? error.message : String(error);
        render();
      });
    }

    function selectedMonitorMode(): "processed" | "reference" | "split" {
      if (elements.splitCompareMode.checked) {
        return "split";
      }

      return elements.alignedSourceMode.checked ? "reference" : "processed";
    }

    function monitorLabel(): string {
      const mode = selectedMonitorMode();

      if (mode === "reference") {
        return acceptedSource?.kind === "chunked-wav"
          ? "Original preview"
          : "Original preview unavailable";
      }

      if (mode === "split") {
        return acceptedSource?.kind === "chunked-wav"
          ? "Compare"
          : "Compare unavailable";
      }

      return "Processed";
    }

    function syncMonitorGains(): void {
      const mode = selectedMonitorMode();
      const processedGain =
        mode === "reference" ? 0 : mode === "split" ? 0.62 : 1;
      const referenceGain =
        mode === "processed" ? 0 : mode === "split" ? 0.62 : 1;

      realRuntime?.setOutputGain(processedGain);
      referenceMonitor?.setGain(referenceGain);

      if (mode === "processed") {
        referenceMonitor?.stop();
      }
    }

    function updateReferencePreview(): void {
      const mode = selectedMonitorMode();
      const runtime = readRuntimeStatus(session);

      if (
        mode === "processed" ||
        acceptedSource?.kind !== "chunked-wav" ||
        runtime.state !== "playing"
      ) {
        referenceMonitor?.stop();
        return;
      }

      if (!referenceMonitor) {
        return;
      }

      referenceMonitor.sync(
        acceptedSource,
        runtime.sourceFrame,
        runtime.effectiveRate,
      );
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
      const hasLoadedSource = acceptedSource !== null;
      const monitor = monitorLabel();
      const pending =
        desiredSnapshot.desiredSequence !==
          runtime.lastAppliedDesiredSequence ||
        desiredSnapshot.configSequence !== runtime.lastAppliedConfigSequence;
      const clipLeft = levels.fullScaleLeftTotal - clipBaselineLeft;
      const clipRight = levels.fullScaleRightTotal - clipBaselineRight;
      const loopStatus = validateLoopDraft(runtime);
      const loopReady = loopStatus.complete && loopStatus.validation.valid;
      const appliedLoopText = runtime.loopEnabled
        ? `${formatFrame(runtime.loopStartFrame)} to ${formatFrame(runtime.loopEndFrame)} rev ${runtime.loopRevision.toString()}`
        : "inactive";

      renderAdapterHeader(elements, signalsmithAssets, runtimeSupport, {
        hasLoadedSource,
        runtimeMode: runtimeSelection.mode,
      });
      syncMonitorGains();
      syncProductState(hasLoadedSource);
      elements.transportState.textContent = runtime.state;
      elements.appliedSequence.textContent = `${runtime.lastAppliedDesiredSequence.toString()} desired, ${runtime.lastAppliedConfigSequence.toString()} config, ${runtime.lastAppliedCommandSequence.toString()} command`;
      elements.pendingState.textContent = pending
        ? `waiting for control ${desiredSnapshot.desiredSequence.toString()} / config ${desiredSnapshot.configSequence.toString()}`
        : "none";
      elements.commandDrops.textContent =
        runtime.commandDroppedTotal.toString();
      elements.loopApplied.textContent = appliedLoopText;
      elements.loopAppliedSummary.textContent = appliedLoopText;
      elements.loopSourceFrame.textContent = formatLoopSourceFrame(runtime);
      elements.loopSourceFrame.classList.toggle(
        "is-valid",
        runtime.loopEnabled && runtime.loopSourceFrameInside,
      );
      elements.loopSourceFrame.classList.toggle(
        "is-invalid",
        runtime.loopEnabled && !runtime.loopSourceFrameInside,
      );
      elements.loopCacheCoverage.textContent = formatLoopCacheCoverage(runtime);
      elements.loopCacheCoverage.classList.toggle(
        "is-valid",
        runtime.loopEnabled && loopCacheMissingFrames(runtime) === 0,
      );
      elements.loopCacheCoverage.classList.toggle(
        "is-invalid",
        runtime.loopEnabled && loopCacheMissingFrames(runtime) > 0,
      );
      elements.loopDraft.textContent = formatLoopDraft(loopStatus);
      elements.loopValidation.textContent = formatLoopValidation(loopStatus);
      elements.loopValidation.classList.toggle("is-valid", loopReady);
      elements.loopValidation.classList.toggle(
        "is-invalid",
        loopStatus.complete && !loopStatus.validation.valid,
      );
      elements.setLoopButton.disabled = !hasLoadedSource || !loopReady;
      elements.playLoopButton.disabled = !hasLoadedSource || !loopReady;
      elements.playhead.textContent = hasLoadedSource
        ? `${formatTime(runtime.sourceFrame, source.sampleRate)} / ${formatTime(source.frames, source.sampleRate)}`
        : "";
      elements.seekRange.value = String(Math.floor(runtime.sourceFrame));
      if (requestedSeekFrame === null) {
        elements.seekFrame.value = String(Math.floor(runtime.sourceFrame));
      }

      renderSourceWell(hasLoadedSource);
      renderMetadata(source, runtimeSelection, hasLoadedSource);
      renderLevels(levels, clipLeft, clipRight, monitor);
      renderInspector(
        plans,
        desiredSnapshot,
        runtime,
        sourceStatus,
        levels,
        runtimeSelection,
        hasLoadedSource,
      );

      elements.status.classList.toggle("is-error", runtime.lastErrorCode !== 0);
      elements.status.textContent = renderStatusText({
        hasLoadedSource,
        monitor,
        pending,
        realStatusError: realStatus?.lastError ?? null,
        runtime,
        runtimeSelection,
      });

      if (hasLoadedSource) {
        drawWaveform(elements.waveform, waveform.peaks, {
          appliedLoop: {
            enabled: runtime.loopEnabled,
            endFrame: runtime.loopEndFrame,
            revision: runtime.loopRevision,
            startFrame: runtime.loopStartFrame,
          },
          draftLoop: {
            enabled:
              loopDraft.hasStart &&
              loopDraft.hasEnd &&
              loopDraft.endFrame > loopDraft.startFrame,
            endFrame: loopDraft.endFrame,
            revision: loopDraft.revision,
            startFrame: loopDraft.startFrame,
          },
          levels: levels.historyPeak,
          requestedSeekFrame,
          runtime,
          source,
        });
      }
    }

    function renderMetadata(
      currentSource: SimulatedSource,
      runtimeSelection: ReturnType<typeof selectStretchRuntimeMode>,
      hasLoadedSource: boolean,
    ): void {
      if (!hasLoadedSource) {
        elements.metadata.replaceChildren();
        return;
      }

      renderChips(elements.metadata, [
        [
          "Format",
          sourceFormatFact(sourceFacts, lastWavProbe, sourceStatusText),
        ],
        ["Sample rate", sourceSampleRateFact(currentSource, lastWavProbe)],
        ["Channels", sourceChannelCountFact(currentSource, lastWavProbe)],
        ["Duration", sourceDurationFact(currentSource, lastWavProbe)],
        ["Worklet mode", workletModeFact(runtimeSelection.mode)],
        ["Waveform mode", waveformModeLabel(waveformMode)],
      ]);
    }

    function renderLevels(
      levels: ProcessedLevelsSnapshot,
      clipLeft: number,
      clipRight: number,
      monitor: string,
    ): void {
      renderKeyValues(elements.levelsSummary, [
        ["Monitor", monitor],
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

    function renderSourceWell(hasLoadedSource: boolean): void {
      if (!hasLoadedSource) {
        elements.sourcePrimary.textContent = "Drop a WAV file to begin";
        elements.sourceSecondary.textContent =
          "Chunked WAV playback, real-time pitch and time stretch.";
        elements.sourceState.textContent =
          sourceStatusText === "No source loaded."
            ? "No source loaded"
            : sourceStatusText;
        return;
      }

      elements.sourcePrimary.textContent = selectedFileName ?? source.name;
      elements.sourceSecondary.textContent =
        sourceOrigin === "default"
          ? "Official Signalsmith demo loop, converted to WAV for comparison."
          : "Source loaded for real-time pitch and time stretch.";
      elements.sourceState.textContent = sourceStatusText;
    }

    function syncProductState(hasLoadedSource: boolean): void {
      elements.shell.classList.toggle("is-unloaded", !hasLoadedSource);
      elements.shell.classList.toggle("is-loaded", hasLoadedSource);
      elements.waveformPanel.hidden = !hasLoadedSource;
      elements.waveform.hidden = !hasLoadedSource;
      elements.levelsPanel.hidden = !hasLoadedSource;
      elements.controlsHint.hidden = hasLoadedSource;
      elements.controlGrid.classList.toggle("is-unloaded", !hasLoadedSource);

      for (const panel of elements.controlGrid.querySelectorAll(
        ".control-panel",
      )) {
        panel.classList.toggle("is-inactive", !hasLoadedSource);
      }

      for (const input of processingInputs(elements)) {
        input.disabled = !hasLoadedSource;
      }

      elements.rangeMode.disabled = false;
      elements.formantBase.disabled =
        !hasLoadedSource || elements.formantBaseAuto.checked;
    }

    function renderStatusText(options: {
      readonly hasLoadedSource: boolean;
      readonly monitor: string;
      readonly pending: boolean;
      readonly realStatusError: string | null;
      readonly runtime: RuntimeStatusSnapshot;
      readonly runtimeSelection: ReturnType<typeof selectStretchRuntimeMode>;
    }): string {
      if (!options.hasLoadedSource) {
        return sourceStatusText === "No source loaded."
          ? "No source loaded. Drop a WAV file to enable processing."
          : `No source loaded. ${sourceStatusText}`;
      }

      return [
        options.runtime.lastErrorCode === 0
          ? runtimeStatusLabel(options.runtimeSelection.mode)
          : `Recoverable runtime fault ${options.runtime.lastErrorCode.toString()}.`,
        sourceStatusText,
        `Waveform ${waveformModeLabel(waveformMode)}.`,
        options.realStatusError
          ? `Worklet error ${options.realStatusError}.`
          : "",
        options.pending
          ? "Desired controls are pending runtime acknowledgement."
          : "Desired controls match applied acknowledgement.",
        `Monitor ${options.monitor}.`,
      ]
        .filter(Boolean)
        .join(" ");
    }

    function renderInspector(
      plans: ReturnType<typeof readPlanSummaries>,
      desiredSnapshot: DesiredStretchControls,
      runtime: RuntimeStatusSnapshot,
      sourceStatus: SourceStatusSnapshot,
      levels: ProcessedLevelsSnapshot,
      runtimeSelection: ReturnType<typeof selectStretchRuntimeMode>,
      hasLoadedSource: boolean,
    ): void {
      const referenceStatus = referenceMonitor?.status ?? null;

      renderKeyValues(elements.inspector, [
        ["Signalsmith Stretch branch", SIGNALSMITH_STRETCH_SOURCE_BRANCH],
        ["Signalsmith Stretch SHA", SIGNALSMITH_STRETCH_REF],
        [
          "Signalsmith Linear ref",
          `${SIGNALSMITH_LINEAR_SOURCE_TAG} (${SIGNALSMITH_LINEAR_REF})`,
        ],
        ["Vendored source", vendorFact(signalsmithAssets)],
        ["Generated module", generatedModuleFact(signalsmithAssets)],
        [
          "Runtime",
          runtimeSelection.mode === "real-worklet"
            ? "real-worklet"
            : "simulator fallback",
        ],
        ["Worklet mode", workletModeFact(runtimeSelection.mode)],
        ["Runtime selection", runtimeSelection.reason],
        ["Adapter mode", runtime.adapterMode],
        [
          "Source mode",
          sourceModeFact(acceptedSource, source, hasLoadedSource),
        ],
        [
          "Source format",
          hasLoadedSource
            ? (sourceFacts?.formatSummary ?? sourceStatusText)
            : "No source loaded",
        ],
        [
          "Sample rate",
          hasLoadedSource
            ? sourceSampleRateFact(source, lastWavProbe)
            : "No source loaded",
        ],
        [
          "Channel count",
          hasLoadedSource
            ? sourceChannelCountFact(source, lastWavProbe)
            : "No source loaded",
        ],
        ["WAV mode", wavMode],
        ["Waveform mode", waveformModeLabel(waveformMode)],
        ["Exclave spec hash", plans.stretch.hash],
        ["Nested spec plan", planFact(plans.stretch)],
        ["Pitch shift", `${desiredSnapshot.pitchSemitones.toFixed(1)} st`],
        [
          "Tonality limit",
          desiredSnapshot.tonalityEnabled
            ? `${Math.round(desiredSnapshot.tonalityHz).toString()} Hz`
            : "disabled",
        ],
        [
          "Voice/formant shift",
          `${desiredSnapshot.formantSemitones.toFixed(1)} st`,
        ],
        [
          "Voice/formant compensation",
          desiredSnapshot.formantCompensation ? "on" : "off",
        ],
        [
          "Voice/formant base",
          desiredSnapshot.formantBaseHz === FORMANT_BASE_AUTO_HZ
            ? "Auto (0)"
            : `${Math.round(desiredSnapshot.formantBaseHz).toString()} Hz`,
        ],
        ["Desired active", desiredSnapshot.active ? "true" : "false"],
        [
          "Applied sequence",
          `${runtime.lastAppliedDesiredSequence.toString()} desired / ${runtime.lastAppliedConfigSequence.toString()} config / ${runtime.lastAppliedCommandSequence.toString()} command`,
        ],
        ["Effective rate", `${runtime.effectiveRate.toFixed(3)}x`],
        [
          "Block / interval / split",
          `${desiredSnapshot.blockMs.toFixed(0)} ms / ${desiredSnapshot.intervalMs.toFixed(1)} ms / ${desiredSnapshot.splitComputation ? "split" : "single"}; runtime ${runtime.blockSamples.toString()} / ${runtime.intervalSamples.toString()} samples`,
        ],
        [
          "Input / output latency",
          `${formatFrame(runtime.inputLatencyFrames)} / ${formatFrame(runtime.outputLatencyFrames)} frames`,
        ],
        ["Processing center frame", formatFrame(runtime.processingCenterFrame)],
        ["Audible source frame", formatFrame(runtime.sourceFrame)],
        ["Loop source frame", formatLoopSourceFrame(runtime)],
        ["Loop cache coverage", formatLoopCacheCoverage(runtime)],
        ["Output frame", formatFrame(runtime.outputFrame)],
        [
          "Duration",
          hasLoadedSource
            ? formatTime(runtime.durationFrames, source.sampleRate)
            : "No source loaded",
        ],
        ["Source state", sourceStatus.state],
        ["Source revision", sourceStatus.sourceRevision.toString()],
        [
          "AudioWorklet frame/time",
          `${runtime.audioWorkletFrameHi.toString()}:${runtime.audioWorkletFrameLo.toString()} / ${runtime.audioWorkletTimeSeconds.toFixed(3)}s`,
        ],
        [
          "Runtime buffer",
          `ready ${formatFrame(runtime.bufferReadyFrames)} / length ${formatFrame(runtime.bufferLengthFrames)}; underruns ${runtime.underrunTotal.toString()}`,
        ],
        ["Browser visibility", transportVisibilityFact(transportDiagnostics)],
        ["Audio context", transportDiagnostics.audioContextState],
        ["Transport pump", transportPumpFact(transportDiagnostics)],
        ["Transport refill", transportRefillFact(transportDiagnostics)],
        [
          "Source prefetch",
          prefetch
            ? `${prefetch.facts.ready ? "ready" : "pending"}; ${formatBytes(prefetch.facts.cachedBytes)} host cache; ${formatFrame(prefetch.facts.cachedFrameCount)} frames cached; read ${formatFrame(prefetch.facts.lastReadStartFrame)}-${formatFrame(prefetch.facts.lastReadEndFrame)}; underruns ${prefetch.facts.underrunTotal.toString()}`
            : "inactive",
        ],
        ["Cache status", cacheStatusFact(prefetch)],
        [
          "Worklet source cache",
          hasLoadedSource
            ? `${formatBytes(sourceStatus.memoryBytes)}; dropped ${sourceStatus.droppedBufferTotal.toString()}`
            : "inactive",
        ],
        [
          "Command ring",
          `${commands.capacity.toString()} slots; dropped ${runtime.commandDroppedTotal.toString()}`,
        ],
        [
          "Scheduled command queue",
          `${runtime.scheduledCommandQueueSize.toString()} queued; dropped ${runtime.scheduledCommandDroppedTotal.toString()}`,
        ],
        [
          "Reference preview",
          referenceStatus
            ? referencePreviewFact(referenceStatus)
            : "inactive",
        ],
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

    function attachAudioContextDiagnostics(context: AudioContext): void {
      transportDiagnostics.audioContextState = context.state;
      context.onstatechange = () => {
        transportDiagnostics.audioContextState = context.state;
        runTransportPump("audio-context-statechange");
        render();
      };
    }

    function handleVisibilityChange(): void {
      transportDiagnostics.documentVisibility = document.visibilityState;

      if (document.visibilityState === "hidden") {
        transportDiagnostics.hiddenTransitionCount += 1;
      } else {
        transportDiagnostics.visibleTransitionCount += 1;
      }

      runTransportPump("visibilitychange");
      render();
    }

    function resetTransportBufferExpectation(): void {
      transportBufferExpectation = emptyTransportBufferExpectation();
      syncTransportBufferExpectationDiagnostics();
    }

    function syncTransportBufferExpectationDiagnostics(
      sourceStatus?: SourceStatusSnapshot,
    ): void {
      writeTransportBufferExpectationDiagnostics(
        transportDiagnostics,
        transportBufferExpectation,
        sourceStatus,
      );
    }
  } catch (error) {
    renderUnsupported(appRoot, describeBoundaryError(error));
  }
}

function createAudioTransportDiagnostics(): AudioTransportDiagnostics {
  return {
    audioContextState: "none",
    documentVisibility: document.visibilityState,
    expectedBufferEndFrame: 0,
    expectedBufferObservedEndFrame: 0,
    expectedBufferState: "none",
    expectedBufferUnconfirmedPumpCount: 0,
    hiddenTransitionCount: 0,
    lastAheadFrames: 0,
    lastInputWindowEndFrame: 0,
    lastPumpAtMs: 0,
    lastPumpReason: "none",
    lastRefillAtMs: 0,
    lastRefillFrameCount: 0,
    lastRefillReason: "none",
    lastRefillStartFrame: 0,
    lastSafeFloorFrames: 0,
    lastTargetAheadFrames: 0,
    pumpCount: 0,
    refillInFlight: false,
    refillSequence: 0,
    visibleTransitionCount: 0,
  };
}

function renderAdapterHeader(
  elements: ReturnType<typeof renderAppShell>,
  assets: SignalsmithWorkletAssetFacts,
  runtimeSupport: ReturnType<typeof detectAudioRuntimeSupport>,
  options: {
    readonly hasLoadedSource: boolean;
    readonly runtimeMode: "real-worklet" | "simulator";
  },
): void {
  const realWorkletReady =
    assets.realAdapterAvailable &&
    runtimeSupport.audioContext &&
    runtimeSupport.audioWorklet &&
    runtimeSupport.crossOriginIsolated &&
    runtimeSupport.sharedArrayBuffer;

  elements.runtimeModeBadge.textContent =
    options.hasLoadedSource && options.runtimeMode === "real-worklet"
      ? "Real Worklet active"
      : realWorkletReady
        ? "Real Worklet ready"
        : "Worklet unavailable";
  elements.adapterAvailability.textContent = realWorkletReady
    ? "Ready for a decoded source."
    : assets.realAdapterStatus;
  elements.sourceStatusBadge.textContent = options.hasLoadedSource
    ? "Source loaded"
    : "No source loaded";
}

function createLoopDraft(durationFrames: number, revision: number): LoopDraft {
  return {
    endFrame: clamp(durationFrames, 0, durationFrames),
    hasEnd: false,
    hasStart: false,
    revision,
    startFrame: 0,
  };
}

function formatLoopDraft(status: LoopDraftStatus): string {
  const range = status.validation.range;

  if (!status.complete) {
    if (!status.draft.hasStart && !status.draft.hasEnd) {
      return "none";
    }

    return [
      status.draft.hasStart
        ? `start ${formatFrame(status.draft.startFrame)}`
        : "start not set",
      status.draft.hasEnd
        ? `end ${formatFrame(status.draft.endFrame)}`
        : "end not set",
    ].join("; ");
  }

  return `${formatFrame(range.startFrame)} to ${formatFrame(range.endFrame)} (${formatFrame(status.validation.lengthFrames)} frames)`;
}

function formatLoopValidation(status: LoopDraftStatus): string {
  if (!status.complete) {
    return "Mark start and end";
  }

  if (!status.validation.valid) {
    return status.validation.reason === "too-short"
      ? `${status.validation.message}; minimum ${formatFrame(status.validation.minimumLoopFrames)} frames`
      : status.validation.message;
  }

  return `Ready; minimum ${formatFrame(status.validation.minimumLoopFrames)} frames`;
}

function formatLoopSourceFrame(runtime: RuntimeStatusSnapshot): string {
  if (!runtime.loopEnabled) {
    return "inactive";
  }

  return `${runtime.loopSourceFrameInside ? "inside" : "outside"} (${formatFrame(runtime.sourceFrame)})`;
}

function formatLoopCacheCoverage(runtime: RuntimeStatusSnapshot): string {
  if (!runtime.loopEnabled) {
    return "inactive";
  }

  return `current ${formatFrame(runtime.inputWindowMissingFrames)} missing; start ${formatFrame(runtime.loopStartMissingFrames)}; end ${formatFrame(runtime.loopEndMissingFrames)}`;
}

function loopCacheMissingFrames(runtime: RuntimeStatusSnapshot): number {
  return (
    runtime.inputWindowMissingFrames +
    runtime.loopStartMissingFrames +
    runtime.loopEndMissingFrames
  );
}

function collectDesiredFromInputs(
  elements: ReturnType<typeof renderAppShell>,
  desiredSequence: number,
  previousControls: DesiredStretchControls,
  rangeMode: RangeMode,
): DesiredStretchControls {
  const ranges = RANGE_MODE_LIMITS[rangeMode];
  const formantBaseHz = readFormantBaseHz(elements);
  const formantSemitones = clampFloat(
    Number(elements.formantShift.value),
    ranges.formant.min,
    ranges.formant.max,
  );
  const pitchSemitones = clampFloat(
    Number(elements.pitch.value),
    ranges.pitch.min,
    ranges.pitch.max,
  );
  const rate = clampFloat(
    Number(elements.rate.value),
    ranges.rate.min,
    ranges.rate.max,
  );
  const tonalityHz = clampTonalityLimitHz(Number(elements.tonalityHz.value));

  elements.formantShift.value = String(formantSemitones);
  elements.pitch.value = String(pitchSemitones);
  elements.rate.value = String(rate);
  elements.tonalityHz.value = String(tonalityHz);

  return {
    ...previousControls,
    desiredSequence,
    formantBaseHz,
    formantCompensation: elements.formantCompensation.checked,
    formantSemitones,
    pitchSemitones,
    rate,
    tonalityEnabled: elements.tonalityEnabled.checked,
    tonalityHz,
  };
}

function collectConfigFromInputs(
  elements: ReturnType<typeof renderAppShell>,
  configSequence: number,
  previousControls: DesiredStretchControls,
  options: {
    readonly forceCustom: boolean;
    readonly source:
      | "block-number"
      | "block-range"
      | "interval"
      | "overlap-number"
      | "overlap-range"
      | "preset";
  },
): DesiredStretchControls {
  if (options.source === "preset") {
    const quality = coerceQualityPreset(elements.configPreset.value);

    if (quality !== "custom") {
      return {
        ...previousControls,
        ...QUALITY_CONFIGS[quality],
        configSequence,
      };
    }
  }

  const blockMs = clampFloat(
    Number(
      options.source === "block-number"
        ? elements.blockMsNumber.value
        : elements.blockMs.value,
    ),
    50,
    240,
  );
  const overlap = clampFloat(
    Number(
      options.source === "overlap-number"
        ? elements.overlapNumber.value
        : elements.overlap.value,
    ),
    2,
    8,
  );
  const intervalMs =
    options.source === "interval"
      ? clampFloat(Number(elements.intervalMs.value), blockMs / 8, blockMs / 2)
      : blockMs / overlap;

  elements.configPreset.value = "custom";

  return {
    ...previousControls,
    blockMs,
    configSequence,
    intervalMs,
    preset: "custom",
    splitComputation: elements.splitComputation.checked,
  };
}

function applyControlsToInputs(
  controls: DesiredStretchControls,
  elements: ReturnType<typeof renderAppShell>,
  rangeMode: RangeMode,
): void {
  applyRangeModeToInputs(rangeMode, elements);
  const ranges = RANGE_MODE_LIMITS[rangeMode];
  elements.rate.value = String(
    clampFloat(controls.rate, ranges.rate.min, ranges.rate.max),
  );
  elements.pitch.value = String(
    clampFloat(controls.pitchSemitones, ranges.pitch.min, ranges.pitch.max),
  );
  elements.tonalityEnabled.checked = controls.tonalityEnabled;
  elements.tonalityHz.value = String(clampTonalityLimitHz(controls.tonalityHz));
  elements.formantShift.value = String(
    clampFloat(
      controls.formantSemitones,
      ranges.formant.min,
      ranges.formant.max,
    ),
  );
  elements.formantCompensation.checked = controls.formantCompensation;
  elements.formantBaseAuto.checked =
    controls.formantBaseHz === FORMANT_BASE_AUTO_HZ;
  elements.formantBase.value = String(
    controls.formantBaseHz === FORMANT_BASE_AUTO_HZ
      ? FORMANT_BASE_MANUAL_DEFAULT_HZ
      : clampManualFormantBaseHz(controls.formantBaseHz),
  );
  elements.listeningPreset.value = matchingListeningPreset(controls);
  elements.configPreset.value = matchingQualityPreset(controls);
  elements.blockMs.value = String(controls.blockMs);
  elements.blockMsNumber.value = String(controls.blockMs);
  elements.intervalMs.min = (controls.blockMs / 8).toFixed(1);
  elements.intervalMs.max = (controls.blockMs / 2).toFixed(1);
  elements.intervalMs.value = String(controls.intervalMs);
  elements.overlap.value = overlapFromConfig(controls).toFixed(1);
  elements.overlapNumber.value = overlapFromConfig(controls).toFixed(1);
  elements.splitComputation.checked = controls.splitComputation;
}

function readFormantBaseHz(
  elements: ReturnType<typeof renderAppShell>,
): number {
  const manualBaseHz = clampManualFormantBaseHz(
    Number(elements.formantBase.value),
  );
  elements.formantBase.value = String(manualBaseHz);

  return elements.formantBaseAuto.checked ? FORMANT_BASE_AUTO_HZ : manualBaseHz;
}

function coerceListeningPreset(value: string): ListeningPreset | null {
  return LISTENING_PRESETS.includes(value as ListeningPreset)
    ? (value as ListeningPreset)
    : null;
}

function coerceRangeMode(value: string): RangeMode {
  return value === "extended" || value === "extreme" ? value : "musical";
}

function applyRangeModeToInputs(
  rangeMode: RangeMode,
  elements: ReturnType<typeof renderAppShell>,
): void {
  const ranges = RANGE_MODE_LIMITS[rangeMode];
  elements.rangeMode.value = rangeMode;
  elements.rate.min = String(ranges.rate.min);
  elements.rate.max = String(ranges.rate.max);
  elements.pitch.min = String(ranges.pitch.min);
  elements.pitch.max = String(ranges.pitch.max);
  elements.formantShift.min = String(ranges.formant.min);
  elements.formantShift.max = String(ranges.formant.max);
}

function clampDesiredControlsToRangeMode(
  controls: DesiredStretchControls,
  rangeMode: RangeMode,
): DesiredStretchControls {
  const ranges = RANGE_MODE_LIMITS[rangeMode];

  return {
    ...controls,
    formantSemitones: clampFloat(
      controls.formantSemitones,
      ranges.formant.min,
      ranges.formant.max,
    ),
    pitchSemitones: clampFloat(
      controls.pitchSemitones,
      ranges.pitch.min,
      ranges.pitch.max,
    ),
    rate: clampFloat(controls.rate, ranges.rate.min, ranges.rate.max),
  };
}

function coerceQualityPreset(value: string): QualityPreset {
  return value === "responsive" ||
    value === "smooth" ||
    value === "low-cpu" ||
    value === "custom"
    ? value
    : "balanced";
}

function matchingQualityPreset(
  controls: DesiredStretchControls,
): QualityPreset {
  for (const [preset, config] of Object.entries(QUALITY_CONFIGS) as readonly [
    Exclude<QualityPreset, "custom">,
    QualityConfig,
  ][]) {
    if (qualityMatches(controls, config)) {
      return preset;
    }
  }

  return "custom";
}

function qualityMatches(
  controls: DesiredStretchControls,
  config: QualityConfig,
): boolean {
  return (
    controls.preset === config.preset &&
    nearlyEqual(controls.blockMs, config.blockMs) &&
    nearlyEqual(controls.intervalMs, config.intervalMs) &&
    controls.splitComputation === config.splitComputation
  );
}

function processingInputs(
  elements: ReturnType<typeof renderAppShell>,
): readonly (HTMLButtonElement | HTMLInputElement | HTMLSelectElement)[] {
  return [
    elements.alignedSourceMode,
    elements.blockMs,
    elements.blockMsNumber,
    elements.clearClipButton,
    elements.clearLoopButton,
    elements.configPreset,
    elements.faultButton,
    elements.formantBase,
    elements.formantBaseAuto,
    elements.formantCompensation,
    elements.formantShift,
    elements.intervalMs,
    elements.listeningPreset,
    elements.loopEnd,
    elements.loopStart,
    elements.markLoopEndButton,
    elements.markLoopStartButton,
    elements.overlap,
    elements.overlapNumber,
    elements.pauseButton,
    elements.pitch,
    elements.playButton,
    elements.playLoopButton,
    elements.processedMode,
    elements.rate,
    elements.resetControlsButton,
    elements.resetFaultButton,
    elements.seekFrame,
    elements.seekRange,
    elements.setLoopButton,
    elements.splitCompareMode,
    elements.splitComputation,
    elements.staleButton,
    elements.stopButton,
    elements.tonalityEnabled,
    elements.tonalityHz,
  ];
}

function renderChips(
  container: HTMLElement,
  rows: readonly (readonly [string, string])[],
): void {
  const chips = document.createElement("div");
  chips.className = "metadata-chips";

  for (const [label, value] of rows) {
    const chip = document.createElement("span");
    chip.className = "metadata-chip";
    chip.dataset.label = label;

    const term = document.createElement("span");
    const detail = document.createElement("strong");
    term.textContent = label;
    detail.textContent = value;
    chip.append(term, detail);
    chips.append(chip);
  }

  container.replaceChildren(chips);
}

function runtimeStatusLabel(mode: "real-worklet" | "simulator"): string {
  return mode === "real-worklet"
    ? "Real Worklet active."
    : "Simulator fallback active.";
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
  plan: ReturnType<typeof readPlanSummaries>["stretch"],
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
    `proof ${plans.stretch.paramVersion.toString()}/${plans.stretch.meterVersion.toString()}`,
  ].join("; ");
}

function vendorFact(assets: SignalsmithWorkletAssetFacts): string {
  const stretch = assets.stretchVendorMeta
    ? "Stretch present"
    : "Stretch missing";
  const linear = assets.linearVendorMeta ? "Linear present" : "Linear missing";

  return `${stretch}; ${linear}`;
}

function generatedModuleFact(assets: SignalsmithWorkletAssetFacts): string {
  if (assets.generatedModuleExists) {
    return "present";
  }

  return assets.realAdapterEnabled
    ? "missing"
    : "not exposed in simulator mode";
}

function sourceModeFact(
  acceptedSource: ProofPcmSource | null,
  source: SimulatedSource,
  hasLoadedSource: boolean,
): string {
  if (!hasLoadedSource) {
    return "none";
  }

  if (acceptedSource?.kind === "chunked-wav") {
    return "chunked WAV";
  }

  if (acceptedSource?.kind === "decoded-pcm") {
    return "browser decoded";
  }

  return source.status === "deterministic" ? "simulator" : "browser decoded";
}

function sourceFormatFact(
  facts: PcmSourceFacts | null,
  probe: WavProbe | null,
  fallback: string,
): string {
  if (facts) {
    return facts.formatSummary;
  }

  if (!probe) {
    return fallback;
  }

  const format =
    probe.audioFormat === null
      ? "unknown"
      : probe.audioFormat === 1
        ? "PCM"
        : probe.audioFormat === 3
          ? "float"
          : `format ${probe.audioFormat.toString()}`;
  const bits =
    probe.bitsPerSample === null
      ? "unknown bit depth"
      : `${probe.bitsPerSample.toString()}-bit`;

  return ["WAV", format, bits].join(" ");
}

function sourceDurationFact(
  source: SimulatedSource,
  probe: WavProbe | null,
): string {
  const durationFrames = probe?.durationFrames ?? null;
  const sampleRate = probe?.sampleRate ?? null;

  if (durationFrames !== null && sampleRate !== null) {
    return formatTime(durationFrames, sampleRate);
  }

  return formatTime(source.frames, source.sampleRate);
}

function sourceChannelCountFact(
  source: SimulatedSource,
  probe: WavProbe | null,
): string {
  return (probe?.channelCount ?? source.channels).toString();
}

function sourceSampleRateFact(
  source: SimulatedSource,
  probe: WavProbe | null,
): string {
  return `${(probe?.sampleRate ?? source.sampleRate).toString()} Hz`;
}

function cacheStatusFact(prefetch: SourcePrefetch | null): string {
  if (!prefetch) {
    return "inactive";
  }

  const state =
    prefetch.facts.underrunTotal > 0
      ? "underrun"
      : prefetch.facts.ready
        ? "ready"
        : "prefetching";

  return `${state}; ${formatBytes(prefetch.facts.cachedBytes)} host cache`;
}

function transportVisibilityFact(
  diagnostics: AudioTransportDiagnostics,
): string {
  return `${diagnostics.documentVisibility}; hidden ${diagnostics.hiddenTransitionCount.toString()} / visible ${diagnostics.visibleTransitionCount.toString()}`;
}

function transportPumpFact(diagnostics: AudioTransportDiagnostics): string {
  const lastPump =
    diagnostics.lastPumpAtMs > 0
      ? `${Math.round(diagnostics.lastPumpAtMs).toString()} ms`
      : "never";

  return `${diagnostics.pumpCount.toString()} ticks; last ${diagnostics.lastPumpReason} at ${lastPump}`;
}

function transportRefillFact(diagnostics: AudioTransportDiagnostics): string {
  if (diagnostics.refillSequence === 0) {
    return `none; expected ${diagnostics.expectedBufferState} end ${formatFrame(diagnostics.expectedBufferEndFrame)} observed ${formatFrame(diagnostics.expectedBufferObservedEndFrame)} wait ${diagnostics.expectedBufferUnconfirmedPumpCount.toString()}`;
  }

  const busy = diagnostics.refillInFlight ? "busy" : "idle";

  return `${busy}; seq ${diagnostics.refillSequence.toString()} ${diagnostics.lastRefillReason} at ${Math.round(diagnostics.lastRefillAtMs).toString()} ms; input end ${formatFrame(diagnostics.lastInputWindowEndFrame)}; start ${formatFrame(diagnostics.lastRefillStartFrame)} count ${formatFrame(diagnostics.lastRefillFrameCount)}; ahead ${formatFrame(diagnostics.lastAheadFrames)} floor ${formatFrame(diagnostics.lastSafeFloorFrames)} target ${formatFrame(diagnostics.lastTargetAheadFrames)}; expected ${diagnostics.expectedBufferState} end ${formatFrame(diagnostics.expectedBufferEndFrame)} observed ${formatFrame(diagnostics.expectedBufferObservedEndFrame)} wait ${diagnostics.expectedBufferUnconfirmedPumpCount.toString()}`;
}

function writeTransportBufferExpectationDiagnostics(
  diagnostics: AudioTransportDiagnostics,
  expectation: TransportBufferExpectation,
  sourceStatus?: SourceStatusSnapshot,
): void {
  diagnostics.expectedBufferEndFrame = expectation.endFrame;
  diagnostics.expectedBufferObservedEndFrame = sourceStatus?.bufferEndFrame ?? 0;
  diagnostics.expectedBufferState = expectation.state;
  diagnostics.expectedBufferUnconfirmedPumpCount =
    expectation.unconfirmedPumpCount;
}

function referencePreviewFact(
  status: SourceReferenceMonitorStatus,
): string {
  return `${status.active ? "active" : "idle"}; t ${status.currentTimeSeconds.toFixed(3)}s; frame ${formatFrame(status.lastFrame)} predicted ${formatFrame(status.predictedFrame)} drift ${formatFrame(status.driftFrames)}; rate ${status.playbackRate.toFixed(3)}x; queued ${status.scheduledSourceCount.toString()} until ${formatFrame(status.scheduledUntilFrame)}; resyncs ${status.resyncTotal.toString()}; pending ${status.pending ? "true" : "false"}`;
}

function workletModeFact(mode: "real-worklet" | "simulator"): string {
  return mode === "real-worklet" ? "real" : "simulator fallback";
}

function isLikelyWavFile(file: File): boolean {
  return /\.wav$/iu.test(file.name);
}

function waveformModeLabel(mode: WaveformPeakMode): string {
  switch (mode) {
    case "actual-coarse":
      return "actual coarse";
    case "actual-complete":
      return "actual complete";
    case "empty":
      return "not loaded";
    case "synthetic":
      return "synthetic";
  }
}

function nextSequence(current: number): number {
  const next = (current + 1) >>> 0;
  return next === 0 ? 1 : next;
}

function overlapFromConfig(controls: DesiredStretchControls): number {
  if (controls.intervalMs <= 0) {
    return 4;
  }

  return clampFloat(controls.blockMs / controls.intervalMs, 2, 8);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.001;
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
