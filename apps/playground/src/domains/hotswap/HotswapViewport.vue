<script setup lang="ts">
import {
  computed,
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from "vue";
import type { SwapTraceFrame } from "./trace";
import type { EngineGains, PhaseSegment, BlockTick } from "./useHotswapLab";
import IconCircleLetterAFilled from "../../icons/IconCircleLetterAFilled.vue";
import IconSquareLetterBFilled from "../../icons/IconSquareLetterBFilled.vue";

// ---- Visual constants -------------------------------------------------------

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP_FACTOR = 1.1;

const SVG_HEIGHT = 50;
const GAIN_TOP = 4;
const GAIN_BOTTOM = 46;
const GAIN_HEIGHT = GAIN_BOTTOM - GAIN_TOP;

// ---- Props ------------------------------------------------------------------

const props = defineProps<{
  readonly frames: readonly SwapTraceFrame<number>[];
  readonly cursor: number;

  readonly engineGains: EngineGains;

  readonly phaseSegments: readonly PhaseSegment[];
  readonly blockTicks: readonly BlockTick[];
  readonly majorBlockTicks: readonly BlockTick[];

  readonly cursorPct: number;
  readonly totalBlocks: number;
  readonly blocksPerSlot: number;

  readonly sumGainPath: string;
  readonly currentGainPath: string;
  readonly nextGainPath: string;

  readonly isPlaying: boolean;
  readonly isLooping: boolean;

  readonly onTogglePlayback: () => void;
  readonly onToggleLoop: () => void;
  readonly onStepForward: () => void;
  readonly onStepBackward: () => void;
  readonly onStopPlayback: () => void;
}>();

const emit = defineEmits<{
  (event: "update:cursor", value: number): void;
}>();

// ---- Local state ------------------------------------------------------------

const scrollContainer = ref<HTMLDivElement | null>(null);
const chartInner = ref<HTMLDivElement | null>(null);
const minimapRef = ref<HTMLDivElement | null>(null);

const viewportLeftPct = ref(0);
const viewportWidthPct = ref(100);

// Cached geometry to avoid layout reads in hot paths
const viewportTotalWidth = ref(0);
const viewportClientWidth = ref(0);
const viewportMaxScroll = ref(0);

const isScrubbing = ref(false);
const isMinimapScrubbing = ref(false);
const isWheelZooming = ref(false);

let scrollRafId: number | null = null;

const zoom = ref(1);
const autoCenter = ref(true);

const frameCount = computed<number>(() => props.frames.length);

const cursorModel = computed<number>({
  get() {
    return props.cursor;
  },
  set(value) {
    emit("update:cursor", value);
  },
});

// ---- Helpers ----------------------------------------------------------------

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

function gainToPct(gain: number): string {
  const y = gainToY(gain);
  return `${(y / SVG_HEIGHT) * 100}%`;
}

function updateViewportState(): void {
  const container = scrollContainer.value;
  if (!container) {
    return;
  }

  const { scrollLeft, scrollWidth, clientWidth } = container;
  const totalWidth = scrollWidth || 1;

  viewportLeftPct.value = (scrollLeft / totalWidth) * 100;
  viewportWidthPct.value = (clientWidth / totalWidth) * 100;

  // Cache geometry for scrollToCursor (avoid layout reads in hot path)
  viewportTotalWidth.value = totalWidth;
  viewportClientWidth.value = clientWidth;
  viewportMaxScroll.value = Math.max(0, totalWidth - clientWidth);
}

function handleScroll(): void {
  // rAF-throttle: never more than one geometry update per frame
  if (scrollRafId !== null) {
    return;
  }
  scrollRafId = window.requestAnimationFrame(() => {
    scrollRafId = null;
    updateViewportState();
  });
}

function scrollToCursor(): void {
  const container = scrollContainer.value;
  if (!container) {
    return;
  }
  if (frameCount.value <= 1) {
    return;
  }

  // Use cached geometry - NO layout reads here!
  const totalWidth = viewportTotalWidth.value;
  const viewportWidth = viewportClientWidth.value;
  const maxScroll = viewportMaxScroll.value;

  // Safety check: if we haven't measured yet, bail
  if (totalWidth <= 0 || viewportWidth <= 0) {
    return;
  }

  const ratio =
    frameCount.value <= 1 ? 0 : props.cursor / (frameCount.value - 1);

  const targetX = ratio * totalWidth;
  const scrollPosition = Math.max(
    0,
    Math.min(maxScroll, targetX - viewportWidth / 2),
  );

  // Only writes - no layout reads
  container.scrollTo({ left: scrollPosition });
}

// ---- Scrubbing --------------------------------------------------------------

function getBlockFromPointer(event: PointerEvent): number {
  const container = scrollContainer.value;
  const inner = chartInner.value;

  if (!container || !inner || frameCount.value === 0) {
    return 0;
  }

  const rect = container.getBoundingClientRect();
  const xInViewport = event.clientX - rect.left;
  const totalX = xInViewport + container.scrollLeft;

  const progress = Math.max(0, Math.min(1, totalX / inner.offsetWidth));
  return Math.round(progress * (frameCount.value - 1));
}

function onPointerDown(event: PointerEvent): void {
  if (frameCount.value === 0) {
    return;
  }

  const target = event.currentTarget as Element;
  target.setPointerCapture(event.pointerId);
  isScrubbing.value = true;
  props.onStopPlayback();
  cursorModel.value = getBlockFromPointer(event);
}

function onPointerMove(event: PointerEvent): void {
  if (!isScrubbing.value) {
    return;
  }

  cursorModel.value = getBlockFromPointer(event);

  if (!autoCenter.value || zoom.value <= 1) {
    return;
  }

  const container = scrollContainer.value;
  if (!container) {
    return;
  }

  const rect = container.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;

  const edgeZone = rect.width * 0.2; // 20% on each side
  const maxStep = rect.width * 0.08; // at most 8% of viewport per move

  // Left edge
  if (pointerX < edgeZone) {
    const distance = edgeZone - pointerX; // 0 .. edgeZone
    const ratio = distance / edgeZone; // 0 .. 1
    const step = maxStep * ratio;

    container.scrollLeft = Math.max(0, container.scrollLeft - step);
    return;
  }

  // Right edge
  if (pointerX > rect.width - edgeZone) {
    const distance = pointerX - (rect.width - edgeZone);
    const ratio = distance / edgeZone;
    const step = maxStep * ratio;

    const maxScroll = container.scrollWidth - rect.width;
    container.scrollLeft = Math.min(maxScroll, container.scrollLeft + step);
  }
}

function onPointerUp(event: PointerEvent): void {
  if (!isScrubbing.value) {
    return;
  }

  isScrubbing.value = false;
  const target = event.currentTarget as Element;
  target.releasePointerCapture(event.pointerId);

  // Do NOT recenter here; keep the viewport exactly where the user scrubbed it.
  updateViewportState();
}

// ---- Wheel zoom -------------------------------------------------------------

function onWheel(event: WheelEvent): void {
  const container = scrollContainer.value;
  const inner = chartInner.value;

  if (!container || !inner || frameCount.value === 0) {
    return;
  }

  const absX = Math.abs(event.deltaX);
  const absY = Math.abs(event.deltaY);

  // Let horizontal scrolling behave normally
  if (absX > absY && absX > 0) {
    return;
  }

  event.preventDefault();

  const rect = container.getBoundingClientRect();
  const pointerOffsetX = event.clientX - rect.left;
  const totalXBefore = pointerOffsetX + container.scrollLeft;

  const anchorRatio = Math.max(
    0,
    Math.min(1, totalXBefore / inner.offsetWidth),
  );

  const factor = event.deltaY < 0 ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const rawNextZoom = zoom.value * factor;
  const nextZoom =
    rawNextZoom < ZOOM_MIN
      ? ZOOM_MIN
      : rawNextZoom > ZOOM_MAX
        ? ZOOM_MAX
        : rawNextZoom;

  if (nextZoom === zoom.value) {
    return;
  }

  isWheelZooming.value = true;
  zoom.value = nextZoom;

  nextTick(() => {
    const containerNow = scrollContainer.value;
    const innerNow = chartInner.value;

    if (!containerNow || !innerNow) {
      isWheelZooming.value = false;
      return;
    }

    const newTotalX = anchorRatio * innerNow.offsetWidth;
    const desiredScrollLeft = newTotalX - pointerOffsetX;

    const maxScroll =
      containerNow.scrollWidth - containerNow.clientWidth > 0
        ? containerNow.scrollWidth - containerNow.clientWidth
        : 0;

    containerNow.scrollLeft = Math.max(
      0,
      Math.min(maxScroll, desiredScrollLeft),
    );

    isWheelZooming.value = false;
    updateViewportState();
  });
}

// ---- Minimap interaction ----------------------------------------------------

function applyMinimapTarget(ratio: number, smooth: boolean): void {
  const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;

  if (frameCount.value <= 1) {
    return;
  }

  const targetIndex = Math.round(clamped * (frameCount.value - 1));
  emit("update:cursor", targetIndex);

  const container = scrollContainer.value;
  if (!container || zoom.value <= 1) {
    return;
  }

  const totalWidth = container.scrollWidth;
  const viewWidth = container.clientWidth;

  const rawTarget = clamped * totalWidth - viewWidth / 2;
  const targetScroll = Math.max(0, Math.min(totalWidth - viewWidth, rawTarget));

  if (smooth) {
    container.scrollTo({ left: targetScroll, behavior: "smooth" });
  } else {
    container.scrollLeft = targetScroll;
  }
}

function onMinimapClick(event: MouseEvent): void {
  const host = minimapRef.value;
  if (!host || frameCount.value === 0) {
    return;
  }

  const rect = host.getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / rect.width;

  props.onStopPlayback();
  applyMinimapTarget(ratio, true);
}

function onMinimapPointerDown(event: PointerEvent): void {
  const host = minimapRef.value;
  if (!host || frameCount.value === 0) {
    return;
  }

  const target = event.currentTarget as Element;
  target.setPointerCapture(event.pointerId);
  isMinimapScrubbing.value = true;
  props.onStopPlayback();

  const rect = host.getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / rect.width;

  applyMinimapTarget(ratio, false);
}

function onMinimapPointerMove(event: PointerEvent): void {
  if (!isMinimapScrubbing.value) {
    return;
  }

  const host = minimapRef.value;
  if (!host) {
    return;
  }

  const rect = host.getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / rect.width;

  applyMinimapTarget(ratio, false);
}

function onMinimapPointerUp(event: PointerEvent): void {
  if (!isMinimapScrubbing.value) {
    return;
  }

  isMinimapScrubbing.value = false;
  const target = event.currentTarget as Element;
  target.releasePointerCapture(event.pointerId);
}

// ---- Reactive wiring --------------------------------------------------------

watch(zoom, () => {
  nextTick(() => {
    updateViewportState();
    if (autoCenter.value && !isWheelZooming.value) {
      scrollToCursor();
    }
  });
});

watch(
  () => frameCount.value,
  () => {
    nextTick(() => {
      updateViewportState();
      if (autoCenter.value && zoom.value > 1) {
        scrollToCursor();
      }
    });
  },
);

watch(
  () => props.cursor,
  () => {
    // Hot path during playback - must be read-free!
    if (autoCenter.value && zoom.value > 1 && !isScrubbing.value) {
      scrollToCursor();
    }
  },
);

onMounted(() => {
  updateViewportState();
});

onBeforeUnmount(() => {
  isScrubbing.value = false;
  isMinimapScrubbing.value = false;

  if (scrollRafId !== null) {
    cancelAnimationFrame(scrollRafId);
    scrollRafId = null;
  }
});
</script>

<template>
  <section class="space-y-4">
    <!-- MAIN GRAPH ---------------------------------------------------------- -->
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-medium text-zinc-400">Progress</h2>
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-3 mr-2">
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input
                v-model="autoCenter"
                type="checkbox"
                class="accent-emerald-500 rounded bg-zinc-800 w-3 h-3"
              />
              <span
                class="text-[10px] text-zinc-500 font-mono uppercase tracking-wider"
              >
                Follow
              </span>
            </label>
            <div class="h-4 w-px bg-zinc-800 mx-1" />
            <div class="flex items-center gap-2">
              <span
                class="text-[10px] text-zinc-500 font-mono uppercase tracking-wider"
              >
                Zoom
              </span>
              <input
                v-model.number="zoom"
                type="range"
                :min="ZOOM_MIN"
                :max="ZOOM_MAX"
                step="0.1"
                class="w-20 sm:w-24 h-1 accent-zinc-500 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>

          <div
            class="flex gap-4 text-[10px] font-medium uppercase tracking-wider border-l border-zinc-800 pl-4"
          >
            <span class="flex items-center gap-1.5">
              <div class="w-2 h-0.5 bg-emerald-500" />
              Current
            </span>
            <span class="flex items-center gap-1.5">
              <div class="w-2 h-0.5 bg-purple-500" />
              Next
            </span>
          </div>
        </div>
      </div>

      <div
        class="flex items-center justify-between text-[10px] text-zinc-500 font-mono px-0.5"
      >
        <span v-if="totalBlocks">
          {{ totalBlocks }} blocks
          <span class="text-zinc-600">(RT lifetime)</span>
        </span>
        <span v-if="frameCount">
          ~{{ blocksPerSlot.toFixed(1) }} blocks/slot
        </span>
      </div>

      <div class="relative w-full">
        <div
          v-if="isScrubbing"
          class="absolute top-2 left-2 px-1.5 py-0.5 bg-zinc-800/80 rounded text-[10px] tracking-wide text-zinc-300 border border-zinc-700/50 backdrop-blur-sm shadow-sm z-30 font-mono"
        >
          Block #{{ cursorModel }}
        </div>
        <div
          ref="scrollContainer"
          class="relative w-full h-48 sm:h-80 bg-zinc-900 rounded-sm border border-zinc-800 overflow-x-scroll overflow-y-hidden select-none no-scrollbar"
          @wheel="onWheel"
          @scroll="handleScroll"
        >
          <div
            ref="chartInner"
            class="relative h-full touch-none"
            :style="{ width: `${zoom * 100}%` }"
            :class="
              isScrubbing
                ? 'cursor-grabbing'
                : 'cursor-grab active:cursor-grabbing'
            "
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          >
            <svg
              viewBox="0 0 100 50"
              preserveAspectRatio="none"
              class="absolute inset-0 w-full h-full"
            >
              <!-- Phase bands -->
              <g>
                <rect
                  v-for="segment in phaseSegments"
                  :key="segment.phase + segment.startBlock"
                  :x="segment.startPct"
                  y="0"
                  :width="segment.widthPct"
                  height="50"
                  :fill="segment.color"
                  opacity="0.15"
                  shape-rendering="crispEdges"
                />
                <line
                  v-for="segment in phaseSegments.slice(1)"
                  :key="'divider-' + segment.startBlock"
                  :x1="segment.startPct"
                  y1="0"
                  :x2="segment.startPct"
                  y2="50"
                  stroke="#27272a"
                  stroke-width="1"
                  vector-effect="non-scaling-stroke"
                  shape-rendering="crispEdges"
                />
              </g>

              <!-- Block grid -->
              <g>
                <line
                  v-for="tick in blockTicks"
                  :key="'grid-' + tick.blockIndex"
                  :x1="tick.xPct"
                  y1="0"
                  :x2="tick.xPct"
                  y2="50"
                  :stroke="tick.isMajor ? '#18181b' : '#18181b'"
                  :stroke-width="tick.isMajor ? 0.75 : 0.5"
                  :stroke-dasharray="tick.isMajor ? '4 4' : '2 8'"
                  opacity="0.35"
                  vector-effect="non-scaling-stroke"
                  shape-rendering="crispEdges"
                />
              </g>

              <!-- Gain rails -->
              <line
                x1="0"
                :y1="GAIN_TOP"
                x2="100"
                :y2="GAIN_TOP"
                stroke="#3f3f46"
                stroke-width="1"
                stroke-dasharray="2 4"
                vector-effect="non-scaling-stroke"
                opacity="0.5"
              />
              <line
                x1="0"
                :y1="GAIN_BOTTOM"
                x2="100"
                :y2="GAIN_BOTTOM"
                stroke="#3f3f46"
                stroke-width="1"
                stroke-dasharray="2 4"
                vector-effect="non-scaling-stroke"
                opacity="0.5"
              />

              <!-- Sum-of-gains -->
              <path
                :d="sumGainPath"
                fill="none"
                stroke="white"
                stroke-width="1"
                stroke-dasharray="2 2"
                opacity="0.3"
                vector-effect="non-scaling-stroke"
              />

              <!-- Individual gains -->
              <path
                :d="currentGainPath"
                fill="none"
                stroke="#10b981"
                stroke-width="2"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
              <path
                :d="nextGainPath"
                fill="none"
                stroke="#a855f7"
                stroke-width="2"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </svg>

            <!-- Overlay -->
            <div class="absolute inset-0 pointer-events-none">
              <div class="absolute inset-x-0 top-1 h-3 pointer-events-none">
                <div
                  v-for="tick in majorBlockTicks"
                  :key="'label-' + tick.blockIndex"
                  class="absolute -translate-x-1/2 text-[9px] text-zinc-600 font-mono"
                  :style="{ left: `${tick.xPct}%` }"
                >
                  {{ tick.blockIndex }}
                </div>
              </div>

              <div
                class="absolute top-0 bottom-0 bg-white z-10 shadow-[0_0_10px_rgba(255,255,255,0.3)]"
                :class="isScrubbing ? 'w-0.5 opacity-100' : 'w-px opacity-70'"
                :style="{ left: `${cursorPct}%` }"
              />

              <div
                class="absolute w-5 h-5 -ml-2.5 -mt-2.5 z-20 transition-transform duration-75"
                :class="isScrubbing ? 'scale-125' : 'scale-100'"
                :style="{
                  left: `${cursorPct}%`,
                  top: gainToPct(engineGains.current),
                }"
              >
                <IconCircleLetterAFilled
                  class="w-full h-full text-emerald-500 bg-zinc-950 rounded-full"
                />
              </div>

              <div
                class="absolute w-5 h-5 -ml-2.5 -mt-2.5 z-20 transition-transform duration-75"
                :class="isScrubbing ? 'scale-125' : 'scale-100'"
                :style="{
                  left: `${cursorPct}%`,
                  top: gainToPct(engineGains.next),
                }"
              >
                <IconSquareLetterBFilled
                  class="w-full h-full text-purple-500 bg-zinc-950"
                />
              </div>
            </div>

            <div
              class="absolute bottom-0 inset-x-0 h-4 overflow-hidden pointer-events-none"
            >
              <template v-for="segment in phaseSegments" :key="segment.phase">
                <div
                  v-if="segment.widthPct * zoom >= 8"
                  class="absolute top-1 text-[9px] font-bold uppercase tracking-wider whitespace-nowrap"
                  :style="{
                    left: `${segment.startPct + segment.widthPct / 2}%`,
                    transform: 'translateX(-50%)',
                    color: segment.color,
                  }"
                >
                  {{ segment.phase }}
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- OVERVIEW / MINIMAP --------------------------------------------------- -->
    <section class="space-y-2">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium text-zinc-400">Overview</h3>
        <div
          class="flex items-center gap-1 bg-zinc-900 rounded-sm p-0.5 border border-zinc-800"
        >
          <button
            type="button"
            class="w-7 h-6 flex items-center justify-center rounded hover:bg-zinc-800 active:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
            @click="props.onStepBackward"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <button
            type="button"
            class="w-8 h-6 flex items-center justify-center rounded hover:bg-zinc-800 active:bg-zinc-700 transition-colors"
            :class="
              isPlaying ? 'text-emerald-400' : 'text-zinc-400 hover:text-white'
            "
            @click="props.onTogglePlayback"
          >
            <svg
              v-if="!isPlaying"
              class="w-3.5 h-3.5 fill-current"
              viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
            <svg v-else class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          </button>
          <button
            type="button"
            class="w-7 h-6 flex items-center justify-center rounded hover:bg-zinc-800 active:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
            @click="props.onStepForward"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>

          <button
            type="button"
            class="ml-1 px-2 h-6 flex items-center justify-center rounded text-[10px] font-mono uppercase tracking-wider transition-colors"
            :class="
              isLooping
                ? 'bg-emerald-500/10 border border-emerald-500/60 text-emerald-300'
                : 'bg-zinc-900 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-white'
            "
            @click="props.onToggleLoop"
          >
            Loop
          </button>
        </div>
      </div>

      <div
        ref="minimapRef"
        class="relative w-full h-8 bg-zinc-900 rounded-sm border border-zinc-800 overflow-hidden cursor-crosshair group"
        @click="onMinimapClick"
        @pointerdown="onMinimapPointerDown"
        @pointermove="onMinimapPointerMove"
        @pointerup="onMinimapPointerUp"
        @pointercancel="onMinimapPointerUp"
      >
        <div class="absolute inset-0 flex">
          <div
            v-for="(segment, index) in phaseSegments"
            :key="index"
            :style="{ width: `${segment.widthPct}%` }"
            class="h-full opacity-40 transition-opacity group-hover:opacity-60"
            :class="[
              segment.phase === 'idle' && 'bg-zinc-600',
              segment.phase === 'spawn' && 'bg-blue-500',
              segment.phase === 'prime' && 'bg-emerald-500',
              segment.phase === 'prewarm' && 'bg-amber-500',
              segment.phase === 'crossfade' && 'bg-purple-500',
              segment.phase === 'retire' && 'bg-red-500',
            ]"
          />
        </div>

        <div
          class="absolute top-0 bottom-0 w-0.5 bg-white z-20 shadow-sm"
          :style="{ left: `${cursorPct}%` }"
        />

        <div
          class="absolute top-0 bottom-0 border-2 border-white/20 bg-white/5 z-10 rounded-sm pointer-events-none"
          :style="{
            left: `${viewportLeftPct}%`,
            width: `${viewportWidthPct}%`,
          }"
        />
      </div>
    </section>
  </section>
</template>
