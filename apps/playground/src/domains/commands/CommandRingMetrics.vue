<script setup lang="ts">
import { computed } from "vue";
import type { RingSnapshot, CumulativeMetrics } from "./useCommandRingLab";

interface Props {
  readonly snapshot: RingSnapshot;
  readonly metrics: CumulativeMetrics;
}

const props = defineProps<Props>();

// Utilization bar width clamped to 100%
const utilizationWidth = computed(() => {
  const pct = Math.min(props.snapshot.utilizationPct, 100);
  return `width: ${pct}%`;
});

// Utilization color based on level
const utilizationColor = computed(() => {
  const pct = props.snapshot.utilizationPct;
  if (pct >= 90) return "from-red-500 to-red-600";
  if (pct >= 70) return "from-amber-500 to-amber-600";
  if (pct >= 50) return "from-purple-500 to-purple-600";
  return "from-emerald-500 to-emerald-600";
});

// Drop rate percentage
const dropRate = computed(() => {
  const total = props.metrics.totalEnqueued + props.metrics.totalDropped;
  if (total === 0) return 0;
  return (props.metrics.totalDropped / total) * 100;
});
</script>

<template>
  <section class="space-y-4">
    <h2 class="text-sm font-semibold text-zinc-300">Metrics</h2>

    <!-- Utilization bar -->
    <div class="space-y-2">
      <div class="flex items-center justify-between text-[10px]">
        <span class="text-zinc-500 uppercase tracking-wider">Utilization</span>
        <span class="font-mono text-zinc-300">
          {{ snapshot.utilizationPct.toFixed(0) }}%
        </span>
      </div>
      <div
        class="h-3 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800"
      >
        <div
          class="h-full bg-sky-600 transition-all duration-150"
          :class="utilizationColor"
          :style="utilizationWidth"
        />
      </div>
    </div>

    <!-- Stats grid -->
    <div class="grid grid-cols-3 gap-3">
      <!-- Enqueued -->
      <div class="p-3 bg-zinc-900/70 rounded-lg border border-zinc-800/50">
        <div class="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
          Enqueued
        </div>
        <div class="text-lg font-mono font-semibold text-emerald-400">
          {{ metrics.totalEnqueued }}
        </div>
      </div>

      <!-- Consumed -->
      <div class="p-3 bg-zinc-900/70 rounded-lg border border-zinc-800/50">
        <div class="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
          Consumed
        </div>
        <div class="text-lg font-mono font-semibold text-purple-400">
          {{ metrics.totalConsumed }}
        </div>
      </div>

      <!-- Dropped -->
      <div class="p-3 bg-zinc-900/70 rounded-lg border border-zinc-800/50">
        <div class="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
          Dropped
        </div>
        <div
          class="text-lg font-mono font-semibold"
          :class="metrics.totalDropped > 0 ? 'text-red-400' : 'text-zinc-500'"
        >
          {{ metrics.totalDropped }}
        </div>
      </div>
    </div>

    <!-- Secondary stats row -->
    <div class="flex items-center justify-between text-[10px] font-mono px-1">
      <div class="flex items-center gap-4">
        <span class="text-zinc-500">
          Seq:
          <span class="text-zinc-400">{{ snapshot.writeSeq }}</span>
        </span>
        <span class="text-zinc-500">
          Peak:
          <span class="text-zinc-400"
            >{{ metrics.peakUtilization.toFixed(0) }}%</span
          >
        </span>
        <span
          class="text-zinc-500"
          :class="dropRate > 0 ? 'text-red-400/70' : ''"
        >
          Drop Rate:
          <span :class="dropRate > 0 ? 'text-red-400' : 'text-zinc-400'">
            {{ dropRate.toFixed(1) }}%
          </span>
        </span>
      </div>
      <div
        v-if="
          metrics.totalUnknownCommand > 0 || metrics.totalInvalidPayload > 0
        "
        class="flex items-center gap-3 text-amber-400/70"
      >
        <span v-if="metrics.totalUnknownCommand > 0">
          Unknown: {{ metrics.totalUnknownCommand }}
        </span>
        <span v-if="metrics.totalInvalidPayload > 0">
          Invalid: {{ metrics.totalInvalidPayload }}
        </span>
      </div>
    </div>
  </section>
</template>
