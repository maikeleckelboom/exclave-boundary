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
import { SourceReferenceMonitor } from "./audio/source-reference-monitor";
import { StretchWorkletRuntime } from "./audio/stretch-node";
import { selectStretchRuntimeMode } from "./audio/stretch-runtime";
import { probeWavFile, type WavProbe } from "./audio/wav-probe";
import {
  computeChunkedWaveformPeaks,
  createSyntheticWaveformPeaks,
  type WaveformPeakMode,
} from "./audio/waveform-peaks";
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
  clampFormantShiftSemitones,
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
  | "probing"
  | "synthetic"
  | "unsupported";

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
    let referenceMonitor: SourceReferenceMonitor | null = null;
    let source = defaultSimulatedSource();
    let sourceFacts: PcmSourceFacts | null = null;
    let sourceRevision = 1;
    let selectedFileName: string | null = null;
    let lastWavProbe: WavProbe | null = null;
    let wavMode: WavLoadMode = "synthetic";
    let sourceStatusText = "deterministic simulator source";
    let waveform = createSyntheticWaveformPeaks(source);
    let waveformMode: WaveformPeakMode = waveform.mode;
    let waveformAbort: AbortController | null = null;
    let requestedSeekFrame: number | null = null;
    let loopRevision = 1;
    let loopDraft = createLoopDraft(source.frames, loopRevision);
    let clipBaselineLeft = 0;
    let clipBaselineRight = 0;

    initializeDesiredControls(session, desired);
    applyControlsToInputs(desired, elements);

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
        configSequence: nextSequence(desired.configSequence),
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
      elements.formantBaseAuto,
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
      applyControlsToInputs(desired, elements);
      writeDesiredControls(session, desired);
      updateControlOutputs();
      render();
    });

    elements.configPreset.addEventListener("change", () => {
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
    for (const mode of [
      elements.processedMode,
      elements.alignedSourceMode,
      elements.splitCompareMode,
    ]) {
      mode.addEventListener("change", () => {
        syncMonitorGains();
        render();
      });
    }

    let lastTickAt = 0;
    const animate = (time: number): void => {
      if (time - lastTickAt >= 80) {
        lastTickAt = time;
        if (realRuntimeOwnsCommandRing()) {
          maybePrefetchFromRuntime();
        } else {
          engine.tick({ renderQuantum: 256 });
        }
        syncMonitorGains();
        updateReferencePreview();
        clearAppliedSeekGhost();
        render();
      }
      window.requestAnimationFrame(animate);
    };
    window.requestAnimationFrame(animate);
    window.addEventListener("beforeunload", () => {
      referenceMonitor?.dispose();
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

      setDesiredActive(nextActive);

      commands.enqueue(name);
      pumpSimulatorCommandRing();
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

    function pumpSimulatorCommandRing(): void {
      if (!realRuntimeOwnsCommandRing()) {
        engine.tick({ renderQuantum: 128 });
      }
    }

    function commitSeek(value: number): void {
      const frame = clamp(value, 0, source.frames);
      requestedSeekFrame = frame;
      elements.seekRange.value = String(frame);
      elements.seekFrame.value = String(frame);
      prefetchForFrame(frame);
      commands.enqueue("seek", { targetSourceFrame: frame });
      pumpSimulatorCommandRing();
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
      const frame = clamp(runtime.sourceFrame, 0, source.frames);

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

    function applyDraftLoop(): void {
      const runtime = readRuntimeStatus(session);
      const status = validateLoopDraft(runtime);

      if (!status.complete || !status.validation.valid) {
        render();
        return;
      }

      prefetchForLoop(status.validation.range, runtime);
      enqueueApplyLoop(commands, status.validation.range, loopFacts(runtime));
      pumpSimulatorCommandRing();
      render();
    }

    function playDraftLoop(): void {
      const runtime = readRuntimeStatus(session);
      const status = validateLoopDraft(runtime);

      if (!status.complete || !status.validation.valid) {
        render();
        return;
      }

      setDesiredActive(true);
      prefetchForLoop(status.validation.range, runtime);
      enqueuePlayLoop(commands, status.validation.range, loopFacts(runtime));
      pumpSimulatorCommandRing();
      render();
    }

    function clearDraftAndAppliedLoop(): void {
      loopDraft = createLoopDraft(source.frames, nextLoopRevision());
      syncLoopDraftInputs();
      commands.enqueue("clearLoop");
      pumpSimulatorCommandRing();
      render();
    }

    async function loadFileSource(file: File): Promise<void> {
      const nextLoadSequence = loadSequence + 1;
      const nextSourceRevision = sourceRevision + 1;
      selectedFileName = file.name;
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

        const context = await ensureAudioContextForProbe(wavProbe);

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

        acceptedSource = loaded;
        loadSequence = nextLoadSequence;
        sourceRevision = nextSourceRevision;
        sourceFacts = loaded;
        source = simulatedSourceFromPcm(loaded);
        sourceStatusText = loaded.formatSummary;
        wavMode = loaded.kind === "chunked-wav" ? "chunked" : "browser decoded";
        resetWaveformToSynthetic();
        loopDraft = createLoopDraft(source.frames, nextLoopRevision());
        requestedSeekFrame = null;
        engine.loadSource(source);
        updateSourceLimits();

        if (loaded.kind === "chunked-wav") {
          startActualWaveformPeaks(loaded);
          await prepareRealRuntime(loaded);
          commands.enqueue("loadSource", {
            sourceRevision: loaded.sourceRevision,
          });
        } else {
          realRuntime?.dispose();
          realRuntime = null;
          referenceMonitor?.stop();
          prefetch = null;
        }
      } catch (error) {
        wavMode = loadWasWav ? "unsupported" : "browser decoded";
        sourceStatusText =
          error instanceof Error ? error.message : String(error);
      }

      render();
    }

    async function ensureAudioContextForProbe(
      wavProbe: Awaited<ReturnType<typeof probeWavFile>>,
    ): Promise<AudioContext> {
      if (!wavProbe.isWav) {
        lastWavProbe = null;
        wavMode = "browser decoded";
        return ensureAudioContext();
      }

      lastWavProbe = wavProbe;
      if (wavProbe.sampleRate === null) {
        wavMode = "unsupported";
        throw new Error("Unsupported WAV header: missing fmt sample rate.");
      }

      const context = await ensureAudioContext({
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

        const previous = audioContext;
        audioContext = null;
        if (previous.state !== "closed") {
          await previous.close().catch(() => undefined);
        }
      }

      audioContext ??= createLabAudioContext(
        options.sampleRate === undefined
          ? {}
          : { sampleRate: options.sampleRate },
      );

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
      referenceMonitor ??= new SourceReferenceMonitor(context);
      syncMonitorGains();
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
      syncLoopDraftInputs();
    }

    function updateControlOutputs(): void {
      elements.rateValue.textContent = `${Number(elements.rate.value).toFixed(3)}x`;
      elements.pitchValue.textContent = `${Number(elements.pitch.value).toFixed(1)} st`;
      elements.transitionFramesValue.textContent = `${Math.round(Number(elements.transitionFrames.value)).toString()} frames`;
      elements.tonalityHzValue.textContent = `${Math.round(Number(elements.tonalityHz.value)).toString()} Hz`;
      elements.formantShiftValue.textContent = `${Number(elements.formantShift.value).toFixed(1)} st`;
      elements.formantBase.disabled = elements.formantBaseAuto.checked;
      elements.formantBaseValue.textContent = elements.formantBaseAuto.checked
        ? "Auto (0)"
        : `${Math.round(Number(elements.formantBase.value)).toString()} Hz`;
      elements.listeningPreset.value = matchingListeningPreset(desired);
      elements.configPreset.value = desired.preset;
      elements.blockMs.value = desired.blockMs.toFixed(0);
      elements.blockMsNumber.value = desired.blockMs.toFixed(0);
      elements.intervalMs.min = (desired.blockMs / 8).toFixed(1);
      elements.intervalMs.max = (desired.blockMs / 2).toFixed(1);
      elements.intervalMs.value = desired.intervalMs.toFixed(1);
      elements.overlap.value = overlapFromConfig(desired).toFixed(1);
      elements.overlapNumber.value = overlapFromConfig(desired).toFixed(1);
      elements.splitComputation.checked = desired.splitComputation;
    }

    function resetWaveformToSynthetic(): void {
      waveformAbort?.abort();
      waveformAbort = null;
      waveform = createSyntheticWaveformPeaks(source);
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

    function monitorLabel(runtimeMode: "real-worklet" | "simulator"): string {
      const mode = selectedMonitorMode();

      if (mode === "reference") {
        return acceptedSource?.kind === "chunked-wav"
          ? "aligned reference preview"
          : "source reference unavailable";
      }

      if (mode === "split") {
        return acceptedSource?.kind === "chunked-wav"
          ? "split compare preview"
          : "split compare unavailable";
      }

      return runtimeMode === "real-worklet"
        ? "processed real Worklet"
        : "processed simulator fallback";
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
        if (mode === "processed") {
          referenceMonitor?.stop();
        }
        return;
      }

      if (!referenceMonitor) {
        return;
      }

      void referenceMonitor.previewAt(acceptedSource, runtime.sourceFrame);
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
      const monitor = monitorLabel(runtimeSelection.mode);
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

      renderAdapterHeader(elements, signalsmithAssets, runtimeSelection.mode);
      syncMonitorGains();
      elements.transportState.textContent = runtime.state;
      elements.appliedSequence.textContent = `${runtime.lastAppliedDesiredSequence.toString()} desired, ${runtime.lastAppliedConfigSequence.toString()} config, ${runtime.lastAppliedCommandSequence.toString()} command`;
      elements.pendingState.textContent = pending
        ? `waiting for control ${desiredSnapshot.desiredSequence.toString()} / config ${desiredSnapshot.configSequence.toString()}`
        : "none";
      elements.commandDrops.textContent =
        runtime.commandDroppedTotal.toString();
      elements.loopApplied.textContent = appliedLoopText;
      elements.loopAppliedSummary.textContent = appliedLoopText;
      elements.loopDraft.textContent = formatLoopDraft(loopStatus);
      elements.loopValidation.textContent = formatLoopValidation(loopStatus);
      elements.loopValidation.classList.toggle("is-valid", loopReady);
      elements.loopValidation.classList.toggle(
        "is-invalid",
        loopStatus.complete && !loopStatus.validation.valid,
      );
      elements.setLoopButton.disabled = !loopReady;
      elements.playLoopButton.disabled = !loopReady;
      elements.playhead.textContent = `${formatTime(runtime.sourceFrame, source.sampleRate)} / ${formatTime(source.frames, source.sampleRate)}`;
      elements.seekRange.value = String(Math.floor(runtime.sourceFrame));
      if (requestedSeekFrame === null) {
        elements.seekFrame.value = String(Math.floor(runtime.sourceFrame));
      }

      renderMetadata(source, runtimeSelection);
      renderLevels(levels, clipLeft, clipRight, monitor);
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
        `Waveform ${waveformModeLabel(waveformMode)}.`,
        realStatus?.lastError ? `Worklet error ${realStatus.lastError}.` : "",
        pending
          ? "Desired controls are pending runtime acknowledgement."
          : "Desired controls match applied acknowledgement.",
        `Monitor ${monitor}.`,
      ]
        .filter(Boolean)
        .join(" ");

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

    function renderMetadata(
      currentSource: SimulatedSource,
      runtimeSelection: ReturnType<typeof selectStretchRuntimeMode>,
    ): void {
      renderKeyValues(elements.metadata, [
        ["Name", selectedFileName ?? currentSource.name],
        ["Load status", sourceStatusText],
        [
          "Source format",
          sourceFormatFact(sourceFacts, lastWavProbe, sourceStatusText),
        ],
        ["Duration", sourceDurationFact(currentSource, lastWavProbe)],
        ["Channel count", sourceChannelCountFact(currentSource, lastWavProbe)],
        ["Sample rate", sourceSampleRateFact(currentSource, lastWavProbe)],
        ["WAV mode", wavMode],
        ["Waveform mode", waveformModeLabel(waveformMode)],
        ["Cache status", cacheStatusFact(prefetch)],
        ["Worklet mode", workletModeFact(runtimeSelection.mode)],
        ["PCM memory", formatBytes(currentSource.memoryBytes)],
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
        [
          "Runtime",
          runtimeSelection.mode === "real-worklet"
            ? "real-worklet"
            : "simulator fallback",
        ],
        ["Runtime selection", runtimeSelection.reason],
        ["Adapter mode", runtime.adapterMode],
        ["Source mode", sourceModeFact(acceptedSource, source)],
        ["Source format", sourceFacts?.formatSummary ?? sourceStatusText],
        ["Waveform mode", waveformModeLabel(waveformMode)],
        ["Exclave spec hash", plans.lab.hash],
        ["Nested spec plan", planFact(plans.lab)],
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
        ["Output frame", formatFrame(runtime.outputFrame)],
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
            ? `${prefetch.facts.ready ? "ready" : "pending"}; ${formatBytes(prefetch.facts.cachedBytes)} host cache; ${formatFrame(prefetch.facts.cachedFrameCount)} frames cached; read ${formatFrame(prefetch.facts.lastReadStartFrame)}-${formatFrame(prefetch.facts.lastReadEndFrame)}; underruns ${prefetch.facts.underrunTotal.toString()}`
            : "inactive",
        ],
        [
          "Worklet source cache",
          `${formatBytes(sourceStatus.memoryBytes)}; dropped ${sourceStatus.droppedBufferTotal.toString()}`,
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
          referenceMonitor
            ? `${referenceMonitor.status.active ? "active" : "idle"}; frame ${formatFrame(referenceMonitor.status.lastFrame)}; pending ${referenceMonitor.status.pending ? "true" : "false"}`
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

function collectDesiredFromInputs(
  elements: ReturnType<typeof renderAppShell>,
  desiredSequence: number,
  previousControls: DesiredStretchControls,
): DesiredStretchControls {
  const formantBaseHz = readFormantBaseHz(elements);
  const formantSemitones = clampFormantShiftSemitones(
    Number(elements.formantShift.value),
  );
  const tonalityHz = clampTonalityLimitHz(Number(elements.tonalityHz.value));

  elements.formantShift.value = String(formantSemitones);
  elements.tonalityHz.value = String(tonalityHz);

  return {
    ...previousControls,
    desiredSequence,
    formantBaseHz,
    formantCompensation: elements.formantCompensation.checked,
    formantSemitones,
    pitchSemitones: Number(elements.pitch.value),
    rate: Number(elements.rate.value),
    tonalityEnabled: elements.tonalityEnabled.checked,
    tonalityHz,
    transitionFrames: Math.round(Number(elements.transitionFrames.value)),
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
  const preset = (
    options.forceCustom ? "custom" : elements.configPreset.value
  ) as DesiredStretchControls["preset"];

  elements.configPreset.value = preset;

  return {
    ...previousControls,
    blockMs,
    configSequence,
    intervalMs,
    preset,
    splitComputation: elements.splitComputation.checked,
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
  elements.tonalityHz.value = String(clampTonalityLimitHz(controls.tonalityHz));
  elements.formantShift.value = String(
    clampFormantShiftSemitones(controls.formantSemitones),
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
  elements.configPreset.value = controls.preset;
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

function planFact(plan: ReturnType<typeof readPlanSummaries>["lab"]): string {
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
    `lab ${plans.lab.paramVersion.toString()}/${plans.lab.meterVersion.toString()}`,
  ].join("; ");
}

function vendorFact(assets: SignalsmithWorkletAssetFacts): string {
  const stretch = assets.stretchVendorMeta
    ? "Stretch present"
    : "Stretch missing";
  const linear = assets.linearVendorMeta ? "Linear present" : "Linear missing";

  return `${stretch}; ${linear}`;
}

function sourceModeFact(
  acceptedSource: LabPcmSource | null,
  source: SimulatedSource,
): string {
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
