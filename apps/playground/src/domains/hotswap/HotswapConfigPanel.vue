<script setup lang="ts">
import { computed } from "vue";
import type {
  CrossfadeCurveId,
  CrossfadeCurveDescriptor,
} from "./useHotswapLab";

interface HotswapConfigPanelProps {
  readonly blockFrames: number;
  readonly fadeFrames: number;
  readonly preWarmBlocks: number;
  readonly estimatedBlocks: number;
  readonly crossfadeCurveId: CrossfadeCurveId;
  readonly crossfadeCurves: readonly CrossfadeCurveDescriptor[];

  readonly playbackSpeed: number;
  readonly playbackSpeedOptions: readonly number[];
}

const props = defineProps<HotswapConfigPanelProps>();

const emit = defineEmits<{
  (event: "update:block-frames", value: number): void;
  (event: "update:fade-frames", value: number): void;
  (event: "update:pre-warm-blocks", value: number): void;
  (event: "update:crossfade-curve-id", value: CrossfadeCurveId): void;
  (event: "update:playback-speed", value: number): void;
  (event: "regenerate"): void;
}>();

function onBlockFramesInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  const value = Number.parseInt(target.value, 10);
  emit("update:block-frames", Number.isNaN(value) ? props.blockFrames : value);
}

function onFadeFramesInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  const value = Number.parseInt(target.value, 10);
  emit("update:fade-frames", Number.isNaN(value) ? props.fadeFrames : value);
}

function onPreWarmBlocksInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  const value = Number.parseInt(target.value, 10);
  emit(
    "update:pre-warm-blocks",
    Number.isNaN(value) ? props.preWarmBlocks : value,
  );
}

function onRegenerateClick(): void {
  emit("regenerate");
}

const crossfadeCurveModel = computed<CrossfadeCurveId>({
  get() {
    return props.crossfadeCurveId;
  },
  set(value) {
    emit("update:crossfade-curve-id", value);
  },
});

const playbackSpeedLabel = computed(() => {
  const rounded = props.playbackSpeed.toFixed(2).replace(/\.00$/, "");
  return `${rounded}×`;
});

// ---- Mini curve icon helpers -----------------------------------------------

interface MiniGains {
  readonly current: number;
  readonly next: number;
}

function clamp01(v: number): number {
  if (v < 0) {
    return 0;
  }
  if (v > 1) {
    return 1;
  }
  return v;
}

function miniGainsForCurve(curveId: CrossfadeCurveId, tRaw: number): MiniGains {
  const t = clamp01(tRaw);

  switch (curveId) {
    case "linear": {
      return { current: 1 - t, next: t };
    }
    case "fastIn": {
      const shaped = t * t;
      return { current: 1 - shaped, next: shaped };
    }
    case "fastOut": {
      const shaped = Math.sqrt(t);
      return { current: 1 - shaped, next: shaped };
    }
    case "equalPower":
    default: {
      const angle = (t * Math.PI) / 2;
      return {
        current: Math.cos(angle),
        next: Math.sin(angle),
      };
    }
  }
}

type CurveRole = "current" | "next";

interface CurveIconPaths {
  readonly current: string;
  readonly next: string;
}

function buildMiniPath(curveId: CrossfadeCurveId, role: CurveRole): string {
  const width = 100;
  const height = 40;
  const steps = 24;

  const commands: string[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const gains = miniGainsForCurve(curveId, t);
    const value = role === "current" ? gains.current : gains.next;

    const x = t * width;
    const y = (1 - value) * height; // 1 at top, 0 at bottom

    commands.push(`${index === 0 ? "M" : "L"} ${x} ${y}`);
  }

  return commands.join(" ");
}

const curveIconPaths: Record<CrossfadeCurveId, CurveIconPaths> = {
  equalPower: {
    current: buildMiniPath("equalPower", "current"),
    next: buildMiniPath("equalPower", "next"),
  },
  linear: {
    current: buildMiniPath("linear", "current"),
    next: buildMiniPath("linear", "next"),
  },
  fastIn: {
    current: buildMiniPath("fastIn", "current"),
    next: buildMiniPath("fastIn", "next"),
  },
  fastOut: {
    current: buildMiniPath("fastOut", "current"),
    next: buildMiniPath("fastOut", "next"),
  },
};
</script>

<template>
  <section class="space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between gap-4">
      <div class="space-y-1">
        <h2 class="text-base font-semibold text-zinc-100">Configuration</h2>
        <p class="text-xs text-zinc-500">
          Estimated swap lifecycle:
          <span class="font-mono text-zinc-300">~{{ estimatedBlocks }}</span>
          <span class="text-zinc-600">blocks</span>
        </p>
      </div>

      <button
        type="button"
        class="px-4 py-2 rounded-lg bg-white text-zinc-900 text-sm font-semibold hover:bg-zinc-50 active:bg-zinc-200 transition-colors shadow-sm"
        @click="onRegenerateClick"
      >
        Regenerate
      </button>
    </div>

    <!-- Engine Parameters -->
    <div class="space-y-4">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Engine Parameters
      </h3>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Block size -->
        <label class="space-y-3">
          <div class="flex items-baseline justify-between">
            <span class="text-sm text-zinc-300">Block size</span>
            <span class="font-mono text-sm text-white">
              {{ blockFrames }}
              <span class="text-xs text-zinc-500 ml-0.5">frames</span>
            </span>
          </div>
          <input
            :value="blockFrames"
            type="range"
            min="32"
            max="1024"
            step="32"
            class="w-full h-2 accent-emerald-500 bg-zinc-800 rounded-full appearance-none cursor-pointer"
            @input="onBlockFramesInput"
          />
          <span class="text-[10px] text-zinc-500 leading-relaxed">
            Audio processing chunk size per step
          </span>
        </label>

        <!-- Fade duration -->
        <label class="space-y-3">
          <span class="flex items-baseline justify-between">
            <span class="text-sm text-zinc-300">Fade duration</span>
            <span class="font-mono text-sm text-white">
              {{ fadeFrames }}
              <span class="text-xs text-zinc-500 ml-0.5">frames</span>
            </span>
          </span>
          <input
            :value="fadeFrames"
            type="range"
            min="32"
            max="8192"
            step="32"
            class="w-full h-2 accent-emerald-500 bg-zinc-800 rounded-full appearance-none cursor-pointer"
            @input="onFadeFramesInput"
          />
          <span class="text-[10px] text-zinc-500 leading-relaxed">
            Total crossfade length in frames
          </span>
        </label>

        <!-- Prewarm blocks -->
        <label class="space-y-3">
          <span class="flex items-baseline justify-between">
            <span class="text-sm text-zinc-300">Prewarm</span>
            <span class="font-mono text-sm text-white">
              {{ preWarmBlocks }}
              <span class="text-xs text-zinc-500 ml-0.5">blocks</span>
            </span>
          </span>
          <input
            :value="preWarmBlocks"
            type="range"
            min="0"
            max="64"
            step="1"
            class="w-full h-2 accent-emerald-500 bg-zinc-800 rounded-full appearance-none cursor-pointer"
            @input="onPreWarmBlocksInput"
          />
          <span class="text-[10px] text-zinc-500 leading-relaxed">
            Silent warmup blocks before crossfade
          </span>
        </label>
      </div>
    </div>

    <!-- Crossfade Curve -->
    <div class="space-y-4">
      <div class="flex items-baseline justify-between">
        <div class="space-y-1">
          <h3
            class="text-xs font-semibold uppercase tracking-wider text-zinc-400"
          >
            Crossfade Curve
          </h3>
          <p class="text-[10px] text-zinc-500 leading-relaxed max-w-md">
            How engine gains are interpolated during the swap phase
          </p>
        </div>
        <span class="text-xs font-mono text-zinc-300">
          {{
            crossfadeCurves.find((curve) => curve.id === crossfadeCurveModel)
              ?.label ?? crossfadeCurveModel
          }}
        </span>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          v-for="curve in crossfadeCurves"
          :key="curve.id"
          type="button"
          class="group relative px-3 py-3 rounded-lg border text-left transition-all"
          :class="
            curve.id === crossfadeCurveModel
              ? 'bg-emerald-500/10 border-emerald-500/50 shadow-sm'
              : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900'
          "
          @click="crossfadeCurveModel = curve.id"
        >
          <span
            class="grid grid-cols-[0.5fr_1fr] gap-4 place-items-center space-y-2"
          >
            <svg
              class="w-full h-8 my-auto"
              viewBox="0 0 100 40"
              aria-hidden="true"
              preserveAspectRatio="none"
            >
              <path
                :d="curveIconPaths[curve.id].current"
                fill="none"
                :stroke="
                  curve.id === crossfadeCurveModel ? '#10b981' : '#71717a'
                "
                stroke-width="3"
                stroke-linecap="round"
                vector-effect="non-scaling-stroke"
              />
              <path
                :d="curveIconPaths[curve.id].next"
                fill="none"
                :stroke="
                  curve.id === crossfadeCurveModel ? '#a855f7' : '#52525b'
                "
                stroke-width="3"
                stroke-linecap="round"
                stroke-dasharray="4, 6"
                vector-effect="non-scaling-stroke"
              />
            </svg>
            <div class="space-y-0.5">
              <div
                class="text-xs font-medium tracking-wide"
                :class="
                  curve.id === crossfadeCurveModel
                    ? 'text-emerald-300'
                    : 'text-zinc-300'
                "
              >
                {{ curve.label }}
              </div>
              <div class="text-[10px] text-zinc-500 leading-snug">
                {{ curve.description }}
              </div>
            </div>
          </span>
        </button>
      </div>
    </div>

    <!-- Playback Controls -->
    <div class="pt-4 border-t border-zinc-800/50 space-y-4">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Playback Speed
      </h3>

      <div class="flex items-center gap-3">
        <div class="flex gap-2">
          <button
            v-for="speedOption in playbackSpeedOptions"
            :key="speedOption"
            type="button"
            class="px-4 py-2 rounded-lg border text-sm font-mono transition-all"
            :class="
              speedOption === playbackSpeed
                ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-300 shadow-sm'
                : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:border-zinc-700'
            "
            @click="emit('update:playback-speed', speedOption)"
          >
            {{ speedOption }}×
          </button>
        </div>
        <span class="text-xs text-zinc-500">
          Current:
          <span class="font-mono text-zinc-300">{{ playbackSpeedLabel }}</span>
        </span>
      </div>
    </div>
  </section>
</template>
