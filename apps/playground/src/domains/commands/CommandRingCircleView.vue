<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  CapacityOption,
  RingSnapshot,
  SlotView,
} from "./useCommandRingLab";

interface CircleProps {
  readonly slotViews: readonly SlotView[];
  readonly snapshot: RingSnapshot;
  readonly capacity: CapacityOption;
}

const props = defineProps<CircleProps>();

const viewCenterX = 50;
const RING_CENTER = 50;
const RING_RADIUS = 36;
const READ_TRACK_RADIUS = 27;
const WRITE_TRACK_RADIUS = 45;
const CIRCLE_VIEWBOX = "0 0 100 100";

// Hover state
const hoveredSlotIndex = ref<number | null>(null);

const hoveredSlot = computed(() => {
  if (hoveredSlotIndex.value === null) return null;
  return (
    props.slotViews.find((s) => s.index === hoveredSlotIndex.value) ?? null
  );
});

// Pulse state
const isWriting = ref(false);

watch(
  () => props.snapshot.writeIndex,
  () => {
    isWriting.value = true;
    setTimeout(() => {
      isWriting.value = false;
    }, 200);
  },
);

// Rotation helpers
function getRotationForIndex(index: number): number {
  return (index * 360) / props.capacity - 90;
}

const readHeadRotation = ref(getRotationForIndex(props.snapshot.readIndex));
const writeHeadRotation = ref(getRotationForIndex(props.snapshot.writeIndex));

watch(
  () => props.snapshot.readIndex,
  (newIdx) => {
    // Snap directly to the new index (no lerping/continuous rotation logic)
    // to match the discrete nature of the data
    readHeadRotation.value = getRotationForIndex(newIdx);
  },
);

watch(
  () => props.snapshot.writeIndex,
  (newIdx) => {
    writeHeadRotation.value = getRotationForIndex(newIdx);
  },
);

watch(
  () => props.capacity,
  () => {
    readHeadRotation.value = getRotationForIndex(props.snapshot.readIndex);
    writeHeadRotation.value = getRotationForIndex(props.snapshot.writeIndex);
  },
);

// Slot segment / rails
const slotSegmentConfig = computed(() => {
  const circumference = 2 * Math.PI * RING_RADIUS;
  const gap = 2; // Fixed gap size in SVG units
  const slotLength = Math.max(0.1, circumference / props.capacity - gap);
  const totalGap = circumference - slotLength;

  return {
    dashArray: `${slotLength} ${totalGap}`,
    dashOffset: slotLength / 2,
    strokeWidth: 12,
  };
});

const slotBorderConfig = computed(() => {
  const cfg = slotSegmentConfig.value;
  return {
    ...cfg,
    strokeWidth: 16,
  };
});

function getTrackDashArray(radius: number): string {
  const circumference = 2 * Math.PI * radius;
  const dashLength = circumference / props.capacity;
  const gapLength = circumference - dashLength;
  const padding = dashLength * 0.1;
  return `${dashLength - padding} ${gapLength + padding}`;
}

const readTrackDashArray = computed(() => getTrackDashArray(READ_TRACK_RADIUS));
const writeTrackDashArray = computed(() =>
  getTrackDashArray(WRITE_TRACK_RADIUS),
);

// Styles
function getSlotStrokeClass(slot: SlotView): string {
  // Base transition for hover effects only
  const base = "transition-all duration-150";
  const isHovered = hoveredSlotIndex.value === slot.index;

  // Standard hover brightening
  const hoverClass = isHovered ? "brightness-125" : "";

  // 1. If the slot contains data (isPending), we color it Amber (Producer's color).
  // 2. If it's empty, it's dark Zinc.
  if (slot.isPending) {
    // This replaces the "glitchy" continuous arc.
    // We color the individual segment to create the trail.
    return `${base} ${hoverClass} stroke-amber-500/80 drop-shadow-[0_0_2px_rgba(245,158,11,0.5)]`;
  }

  // Empty state
  return `${base} ${hoverClass} stroke-zinc-800`;
}
</script>

<template>
  <svg :viewBox="CIRCLE_VIEWBOX" class="w-full max-w-[220px] overflow-visible">
    <g class="pointer-events-none select-none font-mono text-center">
      <g v-if="hoveredSlot">
        <text
          :x="viewCenterX"
          y="42"
          text-anchor="middle"
          class="text-[4px] uppercase tracking-widest fill-zinc-500"
        >
          Slot {{ hoveredSlot.index }}
        </text>
        <text
          :x="viewCenterX"
          y="54"
          text-anchor="middle"
          class="text-[7px] font-bold fill-zinc-200"
        >
          {{ hoveredSlot.state.replace("_", " ") }}
        </text>
        <text
          v-if="hoveredSlot.opCode"
          :x="viewCenterX"
          y="64"
          text-anchor="middle"
          class="text-[5px] font-semibold fill-zinc-300"
        >
          {{ hoveredSlot.opCode }}
        </text>
      </g>
      <g v-else>
        <text
          :x="viewCenterX"
          y="46"
          text-anchor="middle"
          class="text-[4px] uppercase tracking-widest fill-zinc-600"
        >
          In-Flight
        </text>
        <text
          :x="viewCenterX"
          y="58"
          text-anchor="middle"
          class="text-[10px] font-bold tracking-tight fill-zinc-300"
        >
          {{ snapshot.inFlight }}
        </text>
      </g>
    </g>

    <g
      v-for="slot in slotViews"
      :key="slot.index"
      class="group cursor-crosshair"
      @mouseenter="hoveredSlotIndex = slot.index"
      @mouseleave="hoveredSlotIndex = null"
    >
      <g
        :transform="`rotate(${getRotationForIndex(slot.index)}, ${RING_CENTER}, ${RING_CENTER})`"
      >
        <circle
          :cx="RING_CENTER"
          :cy="RING_CENTER"
          :r="RING_RADIUS"
          fill="none"
          stroke-linecap="butt"
          class="stroke-zinc-950/90"
          :stroke-width="slotBorderConfig.strokeWidth"
          :stroke-dasharray="slotBorderConfig.dashArray"
          :stroke-dashoffset="slotBorderConfig.dashOffset"
        />

        <circle
          :cx="RING_CENTER"
          :cy="RING_CENTER"
          :r="RING_RADIUS"
          fill="none"
          stroke-linecap="butt"
          :class="getSlotStrokeClass(slot)"
          :stroke-width="slotSegmentConfig.strokeWidth"
          :stroke-dasharray="slotSegmentConfig.dashArray"
          :stroke-dashoffset="slotSegmentConfig.dashOffset"
        />

        <circle
          v-if="slot.state === 'empty'"
          :cx="RING_CENTER"
          :cy="RING_CENTER"
          :r="RING_RADIUS"
          fill="none"
          stroke-linecap="butt"
          class="stroke-zinc-950"
          :stroke-width="slotSegmentConfig.strokeWidth - 2"
          :stroke-dasharray="slotSegmentConfig.dashArray"
          :stroke-dashoffset="slotSegmentConfig.dashOffset"
        />

        <circle
          :cx="RING_CENTER"
          :cy="RING_CENTER"
          :r="RING_RADIUS"
          fill="none"
          stroke="transparent"
          stroke-width="16"
          :stroke-dasharray="slotBorderConfig.dashArray"
          :stroke-dashoffset="slotBorderConfig.dashOffset"
        />
      </g>
    </g>

    <circle
      :cx="RING_CENTER"
      :cy="RING_CENTER"
      :r="READ_TRACK_RADIUS"
      fill="none"
      stroke-width="5"
      stroke-linecap="round"
      class="stroke-purple-500/30 blur-[2px]"
      :stroke-dasharray="readTrackDashArray"
      :transform="`rotate(${readHeadRotation}, ${RING_CENTER}, ${RING_CENTER})`"
    />
    <circle
      :cx="RING_CENTER"
      :cy="RING_CENTER"
      :r="READ_TRACK_RADIUS"
      fill="none"
      stroke-width="3"
      stroke-linecap="round"
      class="stroke-purple-400"
      :stroke-dasharray="readTrackDashArray"
      :transform="`rotate(${readHeadRotation}, ${RING_CENTER}, ${RING_CENTER})`"
    />

    <circle
      :cx="RING_CENTER"
      :cy="RING_CENTER"
      :r="WRITE_TRACK_RADIUS"
      fill="none"
      stroke-width="5"
      stroke-linecap="round"
      class="stroke-orange-500/30 blur-[2px]"
      :stroke-dasharray="writeTrackDashArray"
      :transform="`rotate(${writeHeadRotation}, ${RING_CENTER}, ${RING_CENTER})`"
    />
    <circle
      :cx="RING_CENTER"
      :cy="RING_CENTER"
      :r="WRITE_TRACK_RADIUS"
      fill="none"
      stroke-width="3"
      stroke-linecap="round"
      class="transition-colors duration-200"
      :class="
        isWriting
          ? 'stroke-orange-200 drop-shadow-[0_0_6px_rgba(251,146,60,0.9)]'
          : 'stroke-orange-400'
      "
      :stroke-dasharray="writeTrackDashArray"
      :transform="`rotate(${writeHeadRotation}, ${RING_CENTER}, ${RING_CENTER})`"
    />
  </svg>
</template>
