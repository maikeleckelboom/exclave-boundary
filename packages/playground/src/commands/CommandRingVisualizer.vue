<script setup lang="ts">
import { computed } from "vue";
import type {
  SlotView,
  RingSnapshot,
  CapacityOption,
} from "./useCommandRingLab";

interface Props {
  readonly slotViews: readonly SlotView[];
  readonly snapshot: RingSnapshot;
  readonly capacity: CapacityOption;
}

const props = defineProps<Props>();

// Calculate grid dimensions
const gridConfig = computed(() => {
  const cap = props.capacity;
  // Prefer 8 columns for visual balance
  if (cap <= 8) {
    return { cols: cap, rows: 1 };
  }
  if (cap <= 16) {
    return { cols: 8, rows: 2 };
  }
  if (cap <= 32) {
    return { cols: 8, rows: 4 };
  }
  return { cols: 8, rows: 8 };
});

// Slot styling based on state
function getSlotClasses(slot: SlotView): string {
  const base = "transition-all duration-150";

  switch (slot.state) {
    case "empty":
      return `${base} fill-zinc-800/50 stroke-zinc-700`;
    case "pending":
      return `${base} fill-purple-500/40 stroke-purple-400`;
    case "read_head":
      return `${base} fill-purple-500/60 stroke-emerald-400 stroke-2`;
    case "write_head":
      return `${base} fill-zinc-800/50 stroke-amber-400 stroke-2`;
    case "both_heads":
      return `${base} fill-zinc-800/50 stroke-emerald-400 stroke-2`;
    default:
      return base;
  }
}

// Opacity based on age for pending slots (newer = more opaque)
function getSlotOpacity(slot: SlotView): number {
  if (!slot.isPending || slot.age < 0) return 1;

  const { inFlight } = props.snapshot;
  if (inFlight <= 1) return 1;

  // Oldest (at read head) is 0.4, newest is 1.0
  const normalizedAge = slot.age / (inFlight - 1);
  return 1 - normalizedAge * 0.6;
}

// Calculate slot position in grid
function getSlotPosition(index: number): { x: number; y: number } {
  const { cols } = gridConfig.value;
  const col = index % cols;
  const row = Math.floor(index / cols);

  // Each slot is 10x10 units with 2 unit gaps
  const cellSize = 12;
  return {
    x: col * cellSize + 1,
    y: row * cellSize + 1,
  };
}

// SVG viewBox dimensions
const viewBox = computed(() => {
  const { cols, rows } = gridConfig.value;
  const width = cols * 12;
  const height = rows * 12;
  return `0 0 ${width} ${height}`;
});

// Ring utilization description
const utilizationDescription = computed(() => {
  const { inFlight, isFull, isEmpty } = props.snapshot;
  if (isEmpty) return "Empty";
  if (isFull) return "Full (backpressure!)";
  return `${inFlight} pending`;
});
</script>

<template>
  <section class="space-y-3">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-zinc-300">Ring Buffer</h2>
      <div class="flex items-center gap-4 text-[10px] font-mono">
        <span class="flex items-center gap-1.5">
          <span
            class="w-2.5 h-2.5 rounded-sm bg-purple-500/40 border border-purple-400"
          />
          <span class="text-zinc-400">Pending</span>
        </span>
        <span class="flex items-center gap-1.5">
          <span
            class="w-2.5 h-2.5 rounded-sm bg-zinc-800/50 border-2 border-emerald-400"
          />
          <span class="text-zinc-400">Read</span>
        </span>
        <span class="flex items-center gap-1.5">
          <span
            class="w-2.5 h-2.5 rounded-sm bg-zinc-800/50 border-2 border-amber-400"
          />
          <span class="text-zinc-400">Write</span>
        </span>
      </div>
    </div>

    <!-- Ring visualization -->
    <div class="relative bg-zinc-900 rounded-lg border border-zinc-800 p-4">
      <!-- SVG Grid -->
      <svg
        :viewBox="viewBox"
        class="w-full max-w-md mx-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        <!-- Slots -->
        <g v-for="slot in slotViews" :key="slot.index">
          <rect
            :x="getSlotPosition(slot.index).x"
            :y="getSlotPosition(slot.index).y"
            width="10"
            height="10"
            rx="1.5"
            :class="getSlotClasses(slot)"
            :style="{ opacity: getSlotOpacity(slot) }"
          />

          <!-- Slot index label -->
          <text
            :x="getSlotPosition(slot.index).x + 5"
            :y="getSlotPosition(slot.index).y + 6.5"
            text-anchor="middle"
            class="text-[3px] fill-zinc-500 font-mono select-none pointer-events-none"
          >
            {{ slot.index }}
          </text>

          <!-- Read head marker -->
          <circle
            v-if="slot.isReadHead"
            :cx="getSlotPosition(slot.index).x + 2"
            :cy="getSlotPosition(slot.index).y + 2"
            r="1.5"
            class="fill-emerald-400"
          />

          <!-- Write head marker -->
          <circle
            v-if="slot.isWriteHead"
            :cx="getSlotPosition(slot.index).x + 8"
            :cy="getSlotPosition(slot.index).y + 2"
            r="1.5"
            class="fill-amber-400"
          />
        </g>
      </svg>

      <!-- Index labels -->
      <div
        class="mt-4 flex items-center justify-center gap-6 text-[11px] font-mono"
      >
        <span class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-emerald-400" />
          <span class="text-zinc-400">Read:</span>
          <span class="text-emerald-300">{{ snapshot.readIndex }}</span>
        </span>
        <span class="text-zinc-600">→</span>
        <span class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-amber-400" />
          <span class="text-zinc-400">Write:</span>
          <span class="text-amber-300">{{ snapshot.writeIndex }}</span>
        </span>
        <span class="text-zinc-600">|</span>
        <span class="text-zinc-400">
          In-Flight:
          <span
            class="font-semibold"
            :class="
              snapshot.isFull
                ? 'text-red-400'
                : snapshot.isEmpty
                  ? 'text-zinc-500'
                  : 'text-purple-300'
            "
          >
            {{ snapshot.inFlight }}
          </span>
        </span>
      </div>
    </div>

    <!-- Status bar -->
    <div class="flex items-center justify-between text-[10px]">
      <span class="text-zinc-600 font-mono">
        Capacity: {{ capacity }} slots
      </span>
      <span
        class="font-mono"
        :class="
          snapshot.isFull
            ? 'text-red-400'
            : snapshot.isEmpty
              ? 'text-zinc-500'
              : 'text-zinc-400'
        "
      >
        {{ utilizationDescription }}
      </span>
    </div>
  </section>
</template>
