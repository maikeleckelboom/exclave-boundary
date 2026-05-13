<script setup lang="ts">
import { DemoOpCode } from "./useCommandRingLab";
import type { SlotView, CapacityOption } from "./useCommandRingLab";

interface Props {
  readonly slotViews: readonly SlotView[];
  readonly capacity: CapacityOption;
}

const props = defineProps<Props>();

function getOpcodeDotClass(opCode: DemoOpCode | undefined): string {
  switch (opCode) {
    case DemoOpCode.Ping:
      return "fill-cyan-400";
    case DemoOpCode.SetValue:
      return "fill-fuchsia-400";
    case DemoOpCode.Trigger:
      return "fill-amber-400";
    case DemoOpCode.Noop:
      return "fill-zinc-500";
    default:
      return "fill-zinc-700";
  }
}
</script>

<template>
  <div class="space-y-1">
    <div
      class="flex items-center justify-between text-[10px] font-mono text-zinc-500"
    >
      <span>SAB linear layout (slots)</span>
      <span>slots: 0..{{ capacity - 1 }}</span>
    </div>

    <div
      class="flex h-6 w-full overflow-hidden rounded border border-zinc-800/70 bg-zinc-900 text-[9px] font-mono"
    >
      <div
        v-for="slot in slotViews"
        :key="slot.index"
        class="relative flex flex-1 items-center justify-center border-r border-zinc-900 last:border-r-0"
        :class="slot.isPending ? 'bg-zinc-800/80' : 'bg-transparent'"
      >
        <div
          v-if="slot.isPending"
          class="h-1.5 w-1.5 rounded-full"
          :class="getOpcodeDotClass(slot.opCode)"
        />

        <div
          v-if="slot.isReadHead"
          class="absolute inset-x-0 bottom-0 h-0.5 bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.7)]"
        />
        <div
          v-if="slot.isWriteHead"
          class="absolute inset-x-0 top-0 h-0.5 bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.7)]"
        />
      </div>
    </div>
  </div>
</template>
