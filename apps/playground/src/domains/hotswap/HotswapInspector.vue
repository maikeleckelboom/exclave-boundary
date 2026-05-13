<script setup lang="ts">
import { computed } from "vue";
import type { SwapTraceFrame } from "./trace";
import type {
  DecisionKind,
  EngineActivity,
  EngineGains,
} from "./useHotswapLab";
import IconCircleLetterAFilled from "../../icons/IconCircleLetterAFilled.vue";
import IconSquareLetterBFilled from "../../icons/IconSquareLetterBFilled.vue";

const props = defineProps<{
  open: boolean;
  currentFrame: SwapTraceFrame<number> | null;
  currentStepKind: DecisionKind;
  engineGains: EngineGains;
  engineActivity: EngineActivity;
}>();

const emit = defineEmits<{
  (event: "update:open", value: boolean): void;
}>();

const openModel = computed<boolean>({
  get() {
    return props.open;
  },
  set(value) {
    emit("update:open", value);
  },
});

const stepKindLabel = computed(() => {
  switch (props.currentStepKind) {
    case "idle":
      return "Idle";
    case "runCurrentOnly":
      return "Run Current";
    case "runCurrentAndPrewarmNext":
      return "Prewarm Next";
    case "runBothForCrossfade":
      return "Crossfade";
    case "retireNow":
      return "Retire";
    default:
      return props.currentStepKind;
  }
});

const stepKindColor = computed(() => {
  switch (props.currentStepKind) {
    case "idle":
      return "text-zinc-400 bg-zinc-900/50 border-zinc-700";
    case "runCurrentOnly":
      return "text-emerald-300 bg-emerald-500/10 border-emerald-500/40";
    case "runCurrentAndPrewarmNext":
      return "text-amber-300 bg-amber-500/10 border-amber-500/40";
    case "runBothForCrossfade":
      return "text-purple-300 bg-purple-500/10 border-purple-500/40";
    case "retireNow":
      return "text-red-300 bg-red-500/10 border-red-500/40";
    default:
      return "text-zinc-400 bg-zinc-900/50 border-zinc-700";
  }
});
</script>

<template>
  <section class="space-y-4 flex flex-col">
    <!-- Mobile toggle -->
    <button
      type="button"
      class="lg:hidden w-full flex items-center justify-between px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-sm font-medium touch-manipulation hover:bg-zinc-800/50 transition-colors"
      @click="openModel = !openModel"
    >
      <span>Frame inspector</span>
      <svg
        class="w-4 h-4 text-zinc-500 transition-transform"
        :class="openModel && 'rotate-180'"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>

    <div :class="['space-y-4', openModel ? 'block' : 'hidden lg:block']">
      <!-- Current step card -->
      <div
        class="space-y-4 border-zinc-800 border rounded-md bg-zinc-950 px-4 py-4"
      >
        <!-- Header -->
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-1">
              <h2
                class="text-xs font-semibold uppercase tracking-wider text-zinc-400"
              >
                Current Step
              </h2>
              <p class="text-[10px] text-zinc-500 leading-relaxed">
                One block of the swap protocol
              </p>
            </div>
          </div>

          <!-- Status badge - full width to prevent layout shift -->
          <div v-if="currentFrame" class="flex">
            <div
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono border transition-colors"
              :class="stepKindColor"
            >
              <div class="w-1.5 h-1.5 rounded-full bg-current" />
              <span>{{ stepKindLabel }}</span>
            </div>
          </div>
        </div>

        <div v-if="currentFrame" class="space-y-4">
          <!-- Block info -->
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
              <div class="text-[10px] text-zinc-500 uppercase tracking-wider">
                Block index
              </div>
              <div class="font-mono text-sm text-zinc-100">
                #{{ currentFrame.blockIndex }}
              </div>
            </div>
            <div class="space-y-1">
              <div class="text-[10px] text-zinc-500 uppercase tracking-wider">
                Phase
              </div>
              <div class="font-mono text-sm text-zinc-100 capitalize">
                {{ currentFrame.state.phase }}
              </div>
            </div>
          </div>

          <!-- Fade progress -->
          <div class="space-y-2">
            <div class="flex justify-between items-baseline">
              <span class="text-xs text-zinc-400">Fade progress</span>
              <span class="font-mono text-sm text-zinc-200">
                {{ (currentFrame.fadeProgress * 100).toFixed(0) }}%
              </span>
            </div>
            <div
              class="h-2 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800"
            >
              <div
                class="h-full bg-gradient-to-r from-emerald-500 to-purple-500"
                :style="{ width: `${currentFrame.fadeProgress * 100}%` }"
              />
            </div>
          </div>

          <!-- Remaining counters -->
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
              <div class="text-[10px] text-zinc-500 uppercase tracking-wider">
                Warm left
              </div>
              <div class="font-mono text-sm text-zinc-100">
                {{ currentFrame.state.preWarmBlocksRemaining }}
              </div>
            </div>
            <div class="space-y-1">
              <div class="text-[10px] text-zinc-500 uppercase tracking-wider">
                Fade left
              </div>
              <div class="font-mono text-sm text-zinc-100">
                {{ currentFrame.state.fadeFramesRemaining }}
              </div>
            </div>
          </div>

          <!-- Engine Gains -->
          <div class="pt-3 border-t border-zinc-800/60 space-y-3">
            <div class="text-[10px] text-zinc-500 uppercase tracking-wider">
              Engine Gains
            </div>

            <!-- Current engine -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <IconCircleLetterAFilled class="w-4 h-4 text-emerald-500" />
                  <span class="text-xs font-medium text-emerald-400"
                    >Current</span
                  >
                </div>
                <span class="font-mono text-sm text-emerald-300">
                  {{ (engineGains.current * 100).toFixed(1) }}%
                </span>
              </div>
              <div
                class="h-2 bg-zinc-950 rounded-full border border-zinc-800 relative overflow-hidden"
              >
                <div
                  class="absolute inset-y-0 left-0 bg-emerald-500/30"
                  :style="{ width: `${engineGains.current * 100}%` }"
                />
                <div
                  class="absolute inset-y-0 left-0 border-r-2 border-emerald-500"
                  :style="{ width: `${engineGains.current * 100}%` }"
                />
              </div>
            </div>

            <!-- Next engine -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <IconSquareLetterBFilled class="w-4 h-4 text-purple-500" />
                  <span class="text-xs font-medium text-purple-400">Next</span>
                </div>
                <span class="font-mono text-sm text-purple-300">
                  {{ (engineGains.next * 100).toFixed(1) }}%
                </span>
              </div>
              <div
                class="h-2 bg-zinc-950 rounded-full border border-zinc-800 relative overflow-hidden"
              >
                <div
                  class="absolute inset-y-0 left-0 bg-purple-500/30"
                  :style="{ width: `${engineGains.next * 100}%` }"
                />
                <div
                  class="absolute inset-y-0 left-0 border-r-2 border-purple-500"
                  :style="{ width: `${engineGains.next * 100}%` }"
                />
              </div>
            </div>
          </div>
        </div>

        <div v-else class="py-8 text-center">
          <p class="text-sm text-zinc-500">No trace generated yet</p>
          <p class="text-xs text-zinc-600 mt-1">
            Adjust config and hit Regenerate
          </p>
        </div>
      </div>

      <!-- Engine state card -->
      <!--      <div class="space-y-4 border border-zinc-800 rounded-xl bg-zinc-900/70 px-4 py-4">-->
      <!--        <div class="space-y-1">-->
      <!--          <h2-->
      <!--            class="text-xs font-semibold uppercase tracking-wider text-zinc-400"-->
      <!--          >-->
      <!--            Engine State-->
      <!--          </h2>-->
      <!--          <p class="text-[10px] text-zinc-500 leading-relaxed">-->
      <!--            Current activity status per engine-->
      <!--          </p>-->
      <!--        </div>-->
      <!--        <div class="space-y-3">-->
      <!--          &lt;!&ndash; Engine A &ndash;&gt;-->
      <!--          <div-->
      <!--            class="flex items-center gap-3 p-2.5 rounded-lg bg-zinc-950/50 border border-zinc-800/50"-->
      <!--          >-->
      <!--            <div class="w-5 h-5 shrink-0">-->
      <!--              <IconCircleLetterAFilled-->
      <!--                class="w-full h-full transition-colors duration-150"-->
      <!--                :class="[-->
      <!--                  engineActivity.current === 'idle' ||-->
      <!--                  engineActivity.current === 'done'-->
      <!--                    ? 'text-zinc-700'-->
      <!--                    : 'text-emerald-500',-->
      <!--                ]"-->
      <!--              />-->
      <!--            </div>-->
      <!--            <span class="text-sm text-zinc-200 flex-1 font-medium"-->
      <!--              >Engine A</span-->
      <!--            >-->
      <!--            <span-->
      <!--              class="text-[10px] px-2 py-1 rounded-md font-mono uppercase tracking-wider border transition-colors"-->
      <!--              :class="[-->
      <!--                engineActivity.current === 'idle' ||-->
      <!--                engineActivity.current === 'done'-->
      <!--                  ? 'bg-zinc-900 border-zinc-700 text-zinc-500'-->
      <!--                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',-->
      <!--              ]"-->
      <!--            >-->
      <!--              {{ engineActivity.current }}-->
      <!--            </span>-->
      <!--          </div>-->

      <!--          &lt;!&ndash; Engine B &ndash;&gt;-->
      <!--          <div-->
      <!--            class="flex items-center gap-3 p-2.5 rounded-lg bg-zinc-950/50 border border-zinc-800/50"-->
      <!--          >-->
      <!--            <div class="w-5 h-5 shrink-0">-->
      <!--              <IconSquareLetterBFilled-->
      <!--                class="w-full h-full transition-colors duration-150"-->
      <!--                :class="[-->
      <!--                  engineActivity.next === 'idle'-->
      <!--                    ? 'text-zinc-700'-->
      <!--                    : 'text-purple-500',-->
      <!--                ]"-->
      <!--              />-->
      <!--            </div>-->
      <!--            <span class="text-sm text-zinc-200 flex-1 font-medium"-->
      <!--              >Engine B</span-->
      <!--            >-->
      <!--            <span-->
      <!--              class="text-[10px] px-2 py-1 rounded-md font-mono uppercase tracking-wider border transition-colors"-->
      <!--              :class="[-->
      <!--                engineActivity.next === 'idle'-->
      <!--                  ? 'bg-zinc-900 border-zinc-700 text-zinc-500'-->
      <!--                  : 'bg-purple-500/10 border-purple-500/30 text-purple-400',-->
      <!--              ]"-->
      <!--            >-->
      <!--              {{ engineActivity.next }}-->
      <!--            </span>-->
      <!--          </div>-->
      <!--        </div>-->
      <!--      </div>-->
    </div>
  </section>
</template>
