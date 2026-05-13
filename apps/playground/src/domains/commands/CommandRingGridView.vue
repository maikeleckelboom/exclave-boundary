<script setup lang="ts">
import { computed } from "vue";
import type { SlotView, CapacityOption } from "./useCommandRingLab";

interface CommandRingGridViewProps {
  readonly slotViews: readonly SlotView[];
  readonly capacity: CapacityOption;
}

const props = defineProps<CommandRingGridViewProps>();

const GRID_CELL_SIZE = 18;
const GRID_PADDING = 2;

const gridConfig = computed(() => {
  const cap = props.capacity;
  if (cap <= 8) return { cols: cap, rows: 1 };
  if (cap <= 16) return { cols: 8, rows: 2 };
  if (cap <= 32) return { cols: 8, rows: 4 };
  const cols = 8;
  const rows = Math.ceil(cap / cols);
  return { cols, rows };
});

function getSlotGridPosition(index: number): { x: number; y: number } {
  const { cols } = gridConfig.value;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: col * GRID_CELL_SIZE + GRID_PADDING,
    y: row * GRID_CELL_SIZE + GRID_PADDING,
  };
}

const gridViewBox = computed(() => {
  const { cols, rows } = gridConfig.value;
  const width = cols * GRID_CELL_SIZE + GRID_PADDING * 2;
  const height = rows * GRID_CELL_SIZE + GRID_PADDING * 2;
  return `0 0 ${width} ${height}`;
});

const maxPendingAge = computed(() => {
  let max = 0;
  for (const slot of props.slotViews) {
    if (slot.age > max) max = slot.age;
  }
  return max;
});

// neutral brightness for in-flight overlay
function getPendingOpacity(age: number): number {
  const max = maxPendingAge.value;
  if (age < 0 || max <= 0) return 0.14;
  const t = age / max; // 0 = youngest, 1 = oldest
  // keep VERY subtle: 0.10 → 0.24
  return 0.1 + t * 0.14;
}

function getSlotClasses(slot: SlotView): string {
  const base = "transition-[fill,stroke,opacity] duration-200";

  const fillStroke =
    slot.state === "empty"
      ? "fill-zinc-950 stroke-zinc-800"
      : "fill-zinc-900 stroke-zinc-700";

  let headAccent = "";
  if (slot.isReadHead && slot.isWriteHead) {
    headAccent = "stroke-fuchsia-400";
  } else if (slot.isReadHead) {
    headAccent = "stroke-emerald-400";
  } else if (slot.isWriteHead) {
    headAccent = "stroke-orange-400";
  }

  return `${base} ${fillStroke} ${headAccent}`;
}

function getLabelFill(slot: SlotView): string {
  // tiny bump for in-flight so numbers are a bit crisper
  if (slot.isPending) return "#e5e5e5";
  return "#a1a1aa";
}
</script>

<template>
  <svg
    :viewBox="gridViewBox"
    class="mx-auto w-full max-w-md"
    preserveAspectRatio="xMidYMid meet"
  >
    <g v-for="slot in slotViews" :key="slot.index">
      <!-- base SAB slot -->
      <rect
        :x="getSlotGridPosition(slot.index).x"
        :y="getSlotGridPosition(slot.index).y"
        width="16"
        height="16"
        rx="3"
        stroke-width="0.75"
        :class="getSlotClasses(slot)"
      />

      <!-- in-flight overlay: subtle neutral brighten, inset -->
      <rect
        v-if="slot.isPending"
        :x="getSlotGridPosition(slot.index).x + 1.5"
        :y="getSlotGridPosition(slot.index).y + 1.5"
        width="13"
        height="13"
        rx="2.5"
        fill="#f4f4f5"
        :opacity="getPendingOpacity(slot.age)"
      />

      <!-- index label (properly centered) -->
      <text
        :x="getSlotGridPosition(slot.index).x + 8"
        :y="getSlotGridPosition(slot.index).y + 8"
        text-anchor="middle"
        dominant-baseline="central"
        class="select-none text-[3px] font-mono"
        :fill="getLabelFill(slot)"
      >
        {{ slot.index }}
      </text>

      <!-- read head marker -->
      <circle
        v-if="slot.isReadHead"
        :cx="getSlotGridPosition(slot.index).x + 4"
        :cy="getSlotGridPosition(slot.index).y + 13"
        r="1.4"
        class="fill-emerald-400"
      />

      <!-- write head marker -->
      <circle
        v-if="slot.isWriteHead"
        :cx="getSlotGridPosition(slot.index).x + 12"
        :cy="getSlotGridPosition(slot.index).y + 3.5"
        r="1.4"
        class="fill-orange-400"
      />
    </g>
  </svg>
</template>
