import { createTicketId, type SwapTicketRT } from "@seqlok/hotswap";
import {
  computed,
  type ComputedRef,
  onBeforeUnmount,
  ref,
  type Ref,
  watch,
} from "vue";

import { type SwapTraceFrame, traceSwap } from "./trace";

const MAX_AUTO_BLOCKS = 400;
const TARGET_VIEW_BLOCKS = 256;
const PLAYBACK_BASE_FPS = 60; // 1.0x speed ≈ 60 blocks/sec

const GAIN_TOP = 4;
const GAIN_BOTTOM = 46;
const GAIN_HEIGHT = GAIN_BOTTOM - GAIN_TOP;

export enum EngineKind {
  None = 0,
  Current = 1,
  Next = 2,
}

export type PhaseId = SwapTraceFrame<EngineKind>["state"]["phase"];
export type DecisionKind = SwapTraceFrame<EngineKind>["decision"]["kind"];

export type EngineActivityLabel =
  | "idle"
  | "running"
  | "prewarm"
  | "fading"
  | "retire"
  | "done"
  | "active";

export interface EngineActivity {
  readonly current: EngineActivityLabel;
  readonly next: EngineActivityLabel;
}

export interface EngineGains {
  readonly current: number;
  readonly next: number;
}

export interface PhaseSegment {
  readonly phase: PhaseId;
  readonly startBlock: number;
  readonly endBlock: number;
  readonly blockCount: number;
  readonly startPct: number;
  readonly endPct: number;
  readonly widthPct: number;
  readonly color: string;
}

export interface BlockTick {
  readonly blockIndex: number;
  readonly xPct: number;
  readonly isMajor: boolean;
}

export type CrossfadeCurveId = "equalPower" | "linear" | "fastIn" | "fastOut";

export interface CrossfadeCurveDescriptor {
  readonly id: CrossfadeCurveId;
  readonly label: string;
  readonly description: string;
}

export const CROSSFADE_CURVES: readonly CrossfadeCurveDescriptor[] = [
  {
    id: "equalPower",
    label: "Equal-power",
    description: "sin/cos; near-constant perceived loudness",
  },
  {
    id: "linear",
    label: "Linear",
    description: "straight-line gains; loudness dip in the middle",
  },
  {
    id: "fastIn",
    label: "Fast-in",
    description: "next engine ramps early; current drops faster",
  },
  {
    id: "fastOut",
    label: "Fast-out",
    description: "current lingers; next ramps late",
  },
];

function clamp01(v: number): number {
  if (v < 0) {
    return 0;
  }
  if (v > 1) {
    return 1;
  }
  return v;
}

function gainToY(gain: number): number {
  const clamped = clamp01(gain);
  return GAIN_TOP + (1 - clamped) * GAIN_HEIGHT;
}

function equalPowerGains(tRaw: number): EngineGains {
  const t = clamp01(tRaw);
  const angle = (t * Math.PI) / 2;
  return {
    current: Math.cos(angle),
    next: Math.sin(angle),
  };
}

function linearGains(tRaw: number): EngineGains {
  const t = clamp01(tRaw);
  return {
    current: 1 - t,
    next: t,
  };
}

function fastInGains(tRaw: number): EngineGains {
  const t = clamp01(tRaw);
  const shaped = t * t;
  return {
    current: 1 - shaped,
    next: shaped,
  };
}

function fastOutGains(tRaw: number): EngineGains {
  const t = clamp01(tRaw);
  const shaped = Math.sqrt(t);
  return {
    current: 1 - shaped,
    next: shaped,
  };
}

function gainsForCurve(curveId: CrossfadeCurveId, tRaw: number): EngineGains {
  switch (curveId) {
    case "linear":
      return linearGains(tRaw);
    case "fastIn":
      return fastInGains(tRaw);
    case "fastOut":
      return fastOutGains(tRaw);
    case "equalPower":
    default:
      return equalPowerGains(tRaw);
  }
}

export interface HotswapLabApi {
  readonly blockFrames: Ref<number>;
  readonly fadeFrames: Ref<number>;
  readonly preWarmBlocks: Ref<number>;

  readonly frames: Ref<readonly SwapTraceFrame<EngineKind>[]>;
  readonly cursor: Ref<number>;

  readonly currentFrame: ComputedRef<SwapTraceFrame<EngineKind> | null>;
  readonly engineGains: ComputedRef<EngineGains>;
  readonly currentStepKind: ComputedRef<DecisionKind>;
  readonly engineActivity: ComputedRef<EngineActivity>;

  readonly phaseSegments: ComputedRef<readonly PhaseSegment[]>;
  readonly blockTicks: ComputedRef<readonly BlockTick[]>;
  readonly majorBlockTicks: ComputedRef<readonly BlockTick[]>;
  readonly cursorPct: ComputedRef<number>;
  readonly totalBlocks: ComputedRef<number>;
  readonly blocksPerSlot: ComputedRef<number>;
  readonly estimatedBlocks: ComputedRef<number>;

  readonly sumGainPath: ComputedRef<string>;
  readonly currentGainPath: ComputedRef<string>;
  readonly nextGainPath: ComputedRef<string>;

  readonly crossfadeCurveId: Ref<CrossfadeCurveId>;
  readonly crossfadeCurves: readonly CrossfadeCurveDescriptor[];

  readonly playbackSpeed: Ref<number>;
  readonly playbackSpeedOptions: readonly number[];

  readonly isPlaying: Ref<boolean>;
  readonly isLooping: Ref<boolean>;

  generateTrace(options?: GenerateTraceOptions): void;
  togglePlayback(): void;
  toggleLoop(): void;
  stepForward(): void;
  stepBackward(): void;
  goToBlock(index: number): void;
  stopPlayback(): void;
}

export interface GenerateTraceOptions {
  readonly preserveCursorPosition?: boolean;
}

export function useHotswapLab(): HotswapLabApi {
  const blockFrames = ref(128);
  const fadeFrames = ref(8192);
  const preWarmBlocks = ref(4);

  const playbackSpeedOptions: readonly number[] = [0.25, 0.5, 1, 2, 4];
  const playbackSpeed = ref(1);

  const frames = ref<readonly SwapTraceFrame<EngineKind>[]>([]);
  const baseBlocks = ref(0);
  const cursor = ref(0);

  const crossfadeCurveId = ref<CrossfadeCurveId>("equalPower");
  const crossfadeCurves = CROSSFADE_CURVES;

  const isPlaying = ref(false);
  const isLooping = ref(false);
  let playbackRafId: number | null = null;
  let playbackAccumulator = 0;
  let lastPlaybackTimestamp: number | null = null;

  const currentFrame = computed<SwapTraceFrame<EngineKind> | null>(() => {
    return frames.value[cursor.value] ?? null;
  });

  const phaseColors: Record<PhaseId, string> = {
    idle: "#52525b",
    spawn: "#3b82f6",
    prime: "#10b981",
    prewarm: "#f59e0b",
    crossfade: "#a855f7",
    retire: "#ef4444",
  };

  const phaseSegments = computed<readonly PhaseSegment[]>(() => {
    const localFrames = frames.value;
    const total = localFrames.length;
    if (total === 0) {
      return [];
    }

    const rawSegments: {
      phase: PhaseId;
      startBlock: number;
      endBlock: number;
      blockCount: number;
    }[] = [];

    const idle: PhaseId = "idle";
    let currentPhase: PhaseId = localFrames[0]?.state.phase ?? idle;
    let startIndex = 0;

    for (let index = 1; index <= total; index += 1) {
      const nextPhase: PhaseId | null =
        index < total ? (localFrames[index]?.state.phase ?? null) : null;

      if (nextPhase !== currentPhase || index === total) {
        const endIndex = index - 1;
        const blockCount = endIndex - startIndex + 1;

        rawSegments.push({
          phase: currentPhase,
          startBlock: startIndex,
          endBlock: endIndex,
          blockCount,
        });

        if (nextPhase !== null) {
          currentPhase = nextPhase;
        }
        startIndex = index;
      }
    }

    const result: PhaseSegment[] = [];
    let pctCursorLocal = 0;

    for (const segment of rawSegments) {
      const widthPct = (segment.blockCount / total) * 100;
      const color = phaseColors[segment.phase];

      result.push({
        ...segment,
        startPct: pctCursorLocal,
        endPct: pctCursorLocal + widthPct,
        widthPct,
        color,
      });

      pctCursorLocal += widthPct;
    }

    return result;
  });

  const crossfadeSegment = computed<PhaseSegment | null>(() => {
    const segment = phaseSegments.value.find(
      (entry) => entry.phase === "crossfade",
    );
    return segment ?? null;
  });

  const cursorPct = computed<number>(() => {
    const total = frames.value.length;
    if (total <= 1) {
      return 0;
    }
    return (cursor.value / (total - 1)) * 100;
  });

  const blockTicks = computed<readonly BlockTick[]>(() => {
    const total = frames.value.length;
    if (total <= 1) {
      return [];
    }

    const targetTicks = 16;
    const approximateStep = Math.max(1, Math.round(total / targetTicks));

    let step = 1;
    while (step < approximateStep) {
      step *= 2;
    }

    const ticks: BlockTick[] = [];
    for (let index = 0; index < total; index += step) {
      const xPct = (index / (total - 1)) * 100;
      const isMajor = index % (step * 4) === 0;
      ticks.push({ blockIndex: index, xPct, isMajor });
    }
    return ticks;
  });

  const majorBlockTicks = computed<readonly BlockTick[]>(() =>
    blockTicks.value.filter((tick) => tick.isMajor),
  );

  const totalBlocks = computed<number>(() => baseBlocks.value);

  const blocksPerSlot = computed<number>(() => {
    const total = frames.value.length;
    if (total === 0) {
      return 0;
    }
    return total / 42;
  });

  const estimatedBlocks = computed<number>(() => {
    return (
      preWarmBlocks.value + Math.ceil(fadeFrames.value / blockFrames.value) + 8
    );
  });

  const engineGains = computed<EngineGains>(() => {
    const frame = currentFrame.value;
    if (!frame) {
      return { current: 1, next: 0 };
    }

    const { phase, hasTicket } = frame.state;

    switch (phase) {
      case "crossfade":
        return gainsForCurve(crossfadeCurveId.value, frame.fadeProgress);
      case "retire":
        return { current: 0, next: 1 };
      case "idle":
        return hasTicket ? { current: 1, next: 0 } : { current: 0, next: 1 };
      default:
        return { current: 1, next: 0 };
    }
  });

  const currentStepKind = computed<DecisionKind>(() => {
    const frame = currentFrame.value;
    if (!frame) {
      return "idle";
    }

    const { phase, hasTicket } = frame.state;

    switch (phase) {
      case "idle":
        return hasTicket ? "runCurrentOnly" : "idle";
      case "spawn":
      case "prime":
        return "runCurrentOnly";
      case "prewarm":
        return "runCurrentAndPrewarmNext";
      case "crossfade":
        return "runBothForCrossfade";
      case "retire":
        return "retireNow";
      default:
        return frame.decision.kind;
    }
  });

  const engineActivity = computed<EngineActivity>(() => {
    const frame = currentFrame.value;
    if (!frame) {
      return { current: "idle", next: "idle" };
    }

    const { phase, hasTicket } = frame.state;

    switch (phase) {
      case "idle":
        if (!hasTicket) {
          return { current: "done", next: "active" };
        }
        return { current: "running", next: "idle" };
      case "spawn":
      case "prime":
        return { current: "running", next: "idle" };
      case "prewarm":
        return { current: "running", next: "prewarm" };
      case "crossfade":
        return { current: "fading", next: "fading" };
      case "retire":
        return { current: "retire", next: "active" };
      default:
        return { current: "idle", next: "idle" };
    }
  });

  function buildSumGainPath(
    segment: PhaseSegment | null,
    curveId: CrossfadeCurveId,
  ): string {
    if (!segment) {
      const yFlat = gainToY(1);
      return `M 0 ${String(yFlat)} L 100 ${String(yFlat)}`;
    }

    const points: string[] = [
      `M 0 ${String(gainToY(1))}`,
      `L ${String(segment.startPct)} ${String(gainToY(1))}`,
    ];

    const steps = 40;
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const xPct = segment.startPct + t * segment.widthPct;
      const { current, next } = gainsForCurve(curveId, t);
      const magnitude = Math.sqrt(current * current + next * next);
      points.push(`L ${String(xPct)} ${String(gainToY(magnitude))}`);
    }

    points.push(`L 100 ${String(gainToY(1))}`);
    return points.join(" ");
  }

  function buildFullGainPath(
    segment: PhaseSegment | null,
    which: "current" | "next",
    curveId: CrossfadeCurveId,
  ): string {
    if (!segment) {
      const base = which === "current" ? 1 : 0;
      const y = gainToY(base);
      return `M 0 ${String(y)} L 100 ${String(y)}`;
    }

    const startValue = which === "current" ? 1 : 0;
    const endValue = which === "current" ? 0 : 1;

    const points: string[] = [
      `M 0 ${String(gainToY(startValue))}`,
      `L ${String(segment.startPct)} ${String(gainToY(startValue))}`,
    ];

    const steps = 40;
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const xPct = segment.startPct + t * segment.widthPct;
      const gains = gainsForCurve(curveId, t);
      const value = which === "current" ? gains.current : gains.next;
      points.push(`L ${String(xPct)} ${String(gainToY(value))}`);
    }

    points.push(`L 100 ${String(gainToY(endValue))}`);
    return points.join(" ");
  }

  const sumGainPath = computed<string>(() =>
    buildSumGainPath(crossfadeSegment.value, crossfadeCurveId.value),
  );

  const currentGainPath = computed<string>(() =>
    buildFullGainPath(
      crossfadeSegment.value,
      "current",
      crossfadeCurveId.value,
    ),
  );

  const nextGainPath = computed<string>(() =>
    buildFullGainPath(crossfadeSegment.value, "next", crossfadeCurveId.value),
  );

  function buildTicket(): SwapTicketRT<EngineKind> {
    return {
      ticketId: createTicketId(1),
      engineKind: EngineKind.Next,
      atFrame: 0,
      fadeFrames: fadeFrames.value,
      preWarmBlocks: preWarmBlocks.value,
    };
  }

  function findInitialCursorIndex(
    rawFrames: readonly SwapTraceFrame<EngineKind>[],
  ): number {
    if (rawFrames.length === 0) {
      return 0;
    }

    const crossIndex = rawFrames.findIndex(
      (frame) => frame.state.phase === "crossfade",
    );
    if (crossIndex >= 0) {
      return crossIndex;
    }

    const firstNonIdle = rawFrames.findIndex(
      (frame) => frame.state.phase !== "idle",
    );
    if (firstNonIdle >= 0) {
      return firstNonIdle;
    }

    return 0;
  }

  function generateTrace(options?: GenerateTraceOptions): void {
    const preserveCursorPosition = options?.preserveCursorPosition === true;

    const previousFrames = frames.value;
    const previousTotal = previousFrames.length;

    let previousRatio = 0;
    if (preserveCursorPosition && previousTotal > 1) {
      previousRatio = cursor.value / (previousTotal - 1);
      if (previousRatio < 0) {
        previousRatio = 0;
      } else if (previousRatio > 1) {
        previousRatio = 1;
      }
    }

    const rawFrames = traceSwap<EngineKind>({
      ticket: buildTicket(),
      blockFrames: blockFrames.value,
      activeKind: EngineKind.Current,
      nextKind: EngineKind.Next,
      noneKindSentinel: EngineKind.None,
    });

    baseBlocks.value = rawFrames.length;

    let nextFrames: readonly SwapTraceFrame<EngineKind>[];

    if (rawFrames.length > 0 && rawFrames.length < TARGET_VIEW_BLOCKS) {
      const last = rawFrames.at(-1);
      if (!last) {
        return;
      }

      const padding: SwapTraceFrame<EngineKind>[] = [];
      const needed = TARGET_VIEW_BLOCKS - rawFrames.length;

      for (let index = 1; index <= needed; index += 1) {
        padding.push({
          ...last,
          blockIndex: last.blockIndex + index,
        });
      }

      nextFrames = [...rawFrames, ...padding];
    } else {
      nextFrames = rawFrames;
    }

    let nextCursorIndex: number;

    if (preserveCursorPosition && previousTotal > 1 && nextFrames.length > 0) {
      const maxIndex = nextFrames.length - 1;
      nextCursorIndex = Math.round(previousRatio * maxIndex);
    } else {
      nextCursorIndex = findInitialCursorIndex(nextFrames);
    }

    frames.value = nextFrames;
    cursor.value = nextCursorIndex;

    stopPlayback();
  }

  function stopPlayback(): void {
    isPlaying.value = false;
    playbackAccumulator = 0;
    lastPlaybackTimestamp = null;

    if (playbackRafId !== null) {
      cancelAnimationFrame(playbackRafId);
      playbackRafId = null;
    }
  }

  function playbackLoop(timestamp: number): void {
    if (!isPlaying.value) {
      return;
    }

    const total = frames.value.length;
    if (total === 0) {
      stopPlayback();
      return;
    }

    if (lastPlaybackTimestamp === null) {
      lastPlaybackTimestamp = timestamp;
      playbackRafId = requestAnimationFrame(playbackLoop);
      return;
    }

    const deltaMs = timestamp - lastPlaybackTimestamp;
    lastPlaybackTimestamp = timestamp;

    const baseFrameMs = 1000 / PLAYBACK_BASE_FPS;
    const logicalSteps = playbackSpeed.value * (deltaMs / baseFrameMs);

    playbackAccumulator += logicalSteps;

    while (playbackAccumulator >= 1) {
      const latestTotal = frames.value.length;
      if (latestTotal === 0) {
        stopPlayback();
        return;
      }

      const maxIndex = latestTotal - 1;

      if (cursor.value < maxIndex) {
        cursor.value += 1;
        playbackAccumulator -= 1;
      } else if (isLooping.value && latestTotal > 0) {
        cursor.value = 0;
        playbackAccumulator -= 1;
      } else {
        stopPlayback();
        return;
      }
    }

    playbackRafId = requestAnimationFrame(playbackLoop);
  }

  function togglePlayback(): void {
    if (isPlaying.value) {
      stopPlayback();
      return;
    }

    if (frames.value.length === 0) {
      return;
    }

    if (cursor.value >= frames.value.length - 1) {
      cursor.value = 0;
    }

    playbackAccumulator = 0;
    lastPlaybackTimestamp = null;
    isPlaying.value = true;
    playbackRafId = requestAnimationFrame(playbackLoop);
  }

  function toggleLoop(): void {
    isLooping.value = !isLooping.value;
  }

  function stepForward(): void {
    stopPlayback();

    const total = frames.value.length;
    if (total === 0) {
      return;
    }

    if (cursor.value < total - 1) {
      cursor.value += 1;
    } else if (isLooping.value) {
      cursor.value = 0;
    }
  }

  function stepBackward(): void {
    stopPlayback();

    const total = frames.value.length;
    if (total === 0) {
      return;
    }

    if (cursor.value > 0) {
      cursor.value -= 1;
    } else if (isLooping.value) {
      cursor.value = total - 1;
    }
  }

  function goToBlock(index: number): void {
    stopPlayback();
    if (index < 0 || index >= frames.value.length) {
      return;
    }
    cursor.value = index;
  }

  watch(
    [blockFrames, fadeFrames, preWarmBlocks],
    () => {
      if (estimatedBlocks.value <= MAX_AUTO_BLOCKS) {
        generateTrace({ preserveCursorPosition: true });
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    stopPlayback();
  });

  return {
    blockFrames,
    fadeFrames,
    preWarmBlocks,
    frames,
    cursor,
    currentFrame,
    engineGains,
    currentStepKind,
    engineActivity,
    phaseSegments,
    blockTicks,
    majorBlockTicks,
    cursorPct,
    totalBlocks,
    blocksPerSlot,
    estimatedBlocks,
    sumGainPath,
    currentGainPath,
    nextGainPath,
    crossfadeCurveId,
    crossfadeCurves,
    playbackSpeed,
    playbackSpeedOptions,
    isPlaying,
    isLooping,
    generateTrace,
    togglePlayback,
    toggleLoop,
    stepForward,
    stepBackward,
    goToBlock,
    stopPlayback,
  };
}
