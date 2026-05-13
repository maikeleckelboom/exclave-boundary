<script setup lang="ts">
import { computed, ref } from "vue";
import {
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
  TooltipPortal,
  TooltipArrow,
} from "reka-ui";
import type {
  SlotView,
  RingSnapshot,
  CapacityOption,
} from "./useCommandRingLab";
import CommandRingSabTape from "./CommandRingSabTape.vue";
import CommandRingCircleView from "./CommandRingCircleView.vue";
import CommandRingGridView from "./CommandRingGridView.vue";
import CommandRing3DView from "./CommandRing3DView.vue";

interface Props {
  readonly slotViews: SlotView[];
  readonly snapshot: RingSnapshot;
  readonly capacity: CapacityOption;
}

const props = defineProps<Props>();

const viewMode = ref<"circle" | "grid">("circle");

const utilizationDescription = computed(() => {
  const { utilizationPct, isEmpty, isFull, inFlight, usableCapacity } =
    props.snapshot;

  if (isEmpty) return "Empty";

  if (isFull) {
    const backingSlots = props.capacity;
    const reservedSlots = Math.max(0, backingSlots - usableCapacity);

    if (backingSlots > 0 && reservedSlots > 0) {
      return `Full (${inFlight} / ${backingSlots} slots, ${reservedSlots} reserved)`;
    }

    if (usableCapacity > 0) {
      return `Full (${inFlight} / ${usableCapacity} slots)`;
    }

    return "Full";
  }

  return `${utilizationPct.toFixed(0)}% used`;
});
</script>

<template>
  <TooltipProvider>
    <TabsRoot v-model="viewMode" class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-zinc-200">Ring Buffer</h2>

        <TabsList
          class="flex rounded border border-zinc-800 bg-zinc-900 p-0.5"
          aria-label="View mode"
        >
          <TabsTrigger
            value="grid"
            class="rounded px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-200 data-[state=active]:shadow-sm focus-visible:ring-1 focus-visible:ring-zinc-700"
          >
            Grid
          </TabsTrigger>
          <TabsTrigger
            value="circle"
            class="rounded px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-200 data-[state=active]:shadow-sm focus-visible:ring-1 focus-visible:ring-zinc-700"
          >
            Circle
          </TabsTrigger>
          <TabsTrigger
            value="3d"
            class="rounded px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-200 data-[state=active]:shadow-sm focus-visible:ring-1 focus-visible:ring-zinc-700"
          >
            3D View
          </TabsTrigger>
        </TabsList>
      </div>

      <div
        class="rounded-lg border border-zinc-800 bg-zinc-950/90 p-4 shadow-inner"
      >
        <TabsContent
          value="grid"
          class="flex justify-center outline-none focus-visible:ring-2 focus-visible:ring-zinc-800 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          <CommandRingGridView :slotViews="slotViews" :capacity="capacity" />
        </TabsContent>
        <TabsContent
          value="circle"
          class="flex min-h-[200px] items-center justify-center overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-zinc-800 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          <CommandRingCircleView
            :slot-views="slotViews"
            :snapshot="snapshot"
            :capacity="capacity"
          />
        </TabsContent>
        <TabsContent
          value="3d"
          class="flex justify-center outline-none focus-visible:ring-2 focus-visible:ring-zinc-800 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          <CommandRing3DView
            :slot-views="slotViews"
            :snapshot="snapshot"
            :capacity="capacity"
          />
        </TabsContent>
        <div
          class="mb-6 mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-zinc-900 pt-4 text-[10px] text-zinc-400"
        >
          <div class="flex items-center gap-4">
            <TooltipRoot :delay-duration="100">
              <TooltipTrigger
                class="flex cursor-help items-center gap-1.5 transition-opacity hover:opacity-80"
              >
                <span class="inline-block h-1.5 w-1.5 rounded bg-emerald-400" />
                <span class="decoration-zinc-700 decoration-dotted underline">
                  Read
                </span>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent
                  class="z-50 max-w-[200px] rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 shadow-xl animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95"
                  :side-offset="5"
                >
                  <p>Consumer head – index of the next slot to be read.</p>
                  <TooltipArrow class="fill-zinc-700" />
                </TooltipContent>
              </TooltipPortal>
            </TooltipRoot>

            <TooltipRoot :delay-duration="100">
              <TooltipTrigger
                class="flex cursor-help items-center gap-1.5 transition-opacity hover:opacity-80"
              >
                <span class="inline-block h-1.5 w-1.5 rounded bg-orange-400" />
                <span class="decoration-zinc-700 decoration-dotted underline">
                  Write
                </span>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent
                  class="z-50 max-w-[200px] rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 shadow-xl animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95"
                  :side-offset="5"
                >
                  <p>Producer head – index of the next slot to be written.</p>
                  <TooltipArrow class="fill-zinc-700" />
                </TooltipContent>
              </TooltipPortal>
            </TooltipRoot>

            <TooltipRoot :delay-duration="100">
              <TooltipTrigger
                class="flex cursor-help items-center gap-1.5 transition-opacity hover:opacity-80"
              >
                <span class="inline-block h-1.5 w-1.5 rounded bg-zinc-700" />
                <span class="decoration-zinc-700 decoration-dotted underline">
                  Empty
                </span>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent
                  class="z-50 max-w-[200px] rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 shadow-xl animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95"
                  :side-offset="5"
                >
                  <p>Available slot ready for new data.</p>
                  <TooltipArrow class="fill-zinc-700" />
                </TooltipContent>
              </TooltipPortal>
            </TooltipRoot>

            <TooltipRoot :delay-duration="100">
              <TooltipTrigger
                class="flex cursor-help items-center gap-1.5 transition-opacity hover:opacity-80"
              >
                <span class="inline-block h-1.5 w-1.5 rounded bg-zinc-300" />
                <span class="decoration-zinc-700 decoration-dotted underline">
                  In-flight
                </span>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent
                  class="z-50 max-w-[200px] rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 shadow-xl animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95"
                  :side-offset="5"
                >
                  <p>
                    Slots between write and read heads – written but not yet
                    consumed.
                  </p>
                  <TooltipArrow class="fill-zinc-700" />
                </TooltipContent>
              </TooltipPortal>
            </TooltipRoot>
          </div>
        </div>

        <div class="space-y-4">
          <CommandRingSabTape :slot-views="slotViews" :capacity="capacity" />

          <div
            class="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-mono"
          >
            <div class="flex flex-wrap items-center gap-4 text-zinc-500">
              <span class="flex items-center gap-1.5">
                <span class="h-0.5 w-2 bg-emerald-500" />
                <span>Read:</span>
                <span class="text-emerald-300">{{ snapshot.readIndex }}</span>
              </span>
              <span class="flex items-center gap-1.5">
                <span class="h-0.5 w-2 bg-orange-500" />
                <span>Write:</span>
                <span class="text-orange-300">{{ snapshot.writeIndex }}</span>
              </span>
              <span class="flex items-center gap-1.5">
                <span class="h-0.5 w-2 bg-zinc-500" />
                <span>In-flight:</span>
                <span class="text-zinc-300">{{ snapshot.inFlight }}</span>
              </span>
            </div>
            <span
              class="font-mono"
              :class="
                snapshot.isFull
                  ? 'text-red-400'
                  : snapshot.isEmpty
                    ? 'text-zinc-500'
                    : 'text-zinc-300'
              "
            >
              {{ utilizationDescription }}
            </span>
          </div>
        </div>
      </div>
    </TabsRoot>
  </TooltipProvider>
</template>
