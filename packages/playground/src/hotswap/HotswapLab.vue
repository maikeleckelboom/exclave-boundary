<script setup lang="ts">
import { ref } from "vue";
import { useHotswapLab } from "./useHotswapLab";
import HotswapConfigPanel from "./HotswapConfigPanel.vue";
import HotswapViewport from "./HotswapViewport.vue";
import HotswapInspector from "./HotswapInspector.vue";

const inspectorOpen = ref(false);

const {
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
} = useHotswapLab();
</script>

<template>
  <div
    class="h-svh flex flex-col bg-zinc-950 text-zinc-100 font-sans antialiased"
  >
    <!-- Header with subtle gradient -->
    <header
      class="relative border-b border-zinc-800/80 px-4 sm:px-6 py-4 shrink-0 bg-gradient-to-b from-zinc-900/50 to-zinc-950"
    >
      <div class="w-full max-w-7xl mx-auto flex items-center justify-between">
        <div class="flex items-baseline gap-3">
          <h1 class="text-xl font-bold tracking-tight text-white">Seqlok</h1>
          <span
            class="text-[11px] font-mono text-zinc-500 uppercase tracking-widest"
          >
            Hotswap Lab
          </span>
        </div>

        <!-- Optional: Add a status indicator or version -->
        <!--       <div class="hidden sm:flex items-center gap-2 text-[10px] text-zinc-600 font-mono">-->
        <!--       </div>-->
      </div>
    </header>

    <main
      class="flex-1 overflow-y-auto overflow-x-hidden overscroll-none scrollbar-thin"
    >
      <div class="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <!-- Main grid with better balance -->
        <div class="grid gap-6 lg:gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <!-- Left column: Config + Viewport -->
          <div class="flex flex-col gap-6 min-w-0">
            <HotswapConfigPanel
              :block-frames="blockFrames"
              :fade-frames="fadeFrames"
              :pre-warm-blocks="preWarmBlocks"
              :estimated-blocks="estimatedBlocks"
              :crossfade-curve-id="crossfadeCurveId"
              :crossfade-curves="crossfadeCurves"
              :playback-speed="playbackSpeed"
              :playback-speed-options="playbackSpeedOptions"
              @update:block-frames="(value) => (blockFrames = value)"
              @update:fade-frames="(value) => (fadeFrames = value)"
              @update:pre-warm-blocks="(value) => (preWarmBlocks = value)"
              @update:crossfade-curve-id="(value) => (crossfadeCurveId = value)"
              @update:playback-speed="(value) => (playbackSpeed = value)"
              @regenerate="generateTrace"
            />

            <HotswapViewport
              :frames="frames"
              :cursor="cursor"
              :engine-gains="engineGains"
              :phase-segments="phaseSegments"
              :block-ticks="blockTicks"
              :major-block-ticks="majorBlockTicks"
              :cursor-pct="cursorPct"
              :total-blocks="totalBlocks"
              :blocks-per-slot="blocksPerSlot"
              :sum-gain-path="sumGainPath"
              :current-gain-path="currentGainPath"
              :next-gain-path="nextGainPath"
              :is-playing="isPlaying"
              :is-looping="isLooping"
              :on-toggle-playback="togglePlayback"
              :on-toggle-loop="toggleLoop"
              :on-step-forward="stepForward"
              :on-step-backward="stepBackward"
              :on-stop-playback="stopPlayback"
              @update:cursor="goToBlock"
            />
          </div>

          <!-- Right column: Inspector (sticky on desktop) -->
          <div
            class="lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto"
          >
            <HotswapInspector
              v-model:open="inspectorOpen"
              :current-frame="currentFrame"
              :current-step-kind="currentStepKind"
              :engine-gains="engineGains"
              :engine-activity="engineActivity"
            />
          </div>
        </div>
      </div>
    </main>

    <!-- Optional: Subtle footer -->
    <footer
      class="border-t border-zinc-800/50 px-4 sm:px-6 py-3 text-center text-[10px] text-zinc-600 font-mono"
    >
      <!--      <div class="w-full max-w-7xl mx-auto">-->
      <!--        Real-time engine swap protocol visualization-->
      <!--      </div>-->
    </footer>
  </div>
</template>
