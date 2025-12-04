<script setup lang="ts">
import { useCommandRingLab } from "./useCommandRingLab";
import CommandRingConfig from "./CommandRingConfig.vue";
import CommandRingVisualizer from "./CommandRingVisualizer.vue";
import CommandRingMetrics from "./CommandRingMetrics.vue";
import CommandRingEventLog from "./CommandRingEventLog.vue";

const {
  // Configuration
  capacity,
  CAPACITY_OPTIONS,

  // Rate controls
  producerRate,
  consumerRate,
  producerPaused,
  consumerPaused,

  // State
  snapshot,
  metrics,
  eventLog,
  slotViews,

  // Computed
  isMailboxClosed,

  // Actions
  toggleProducer,
  toggleConsumer,
  burstEnqueue,
  drainAll,
  closeMailbox,
  reopenMailbox,
  resetRing,
  clearLog,
} = useCommandRingLab();
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="space-y-1">
        <h1 class="text-sm font-semibold tracking-tight text-zinc-50">
          Command Ring Lab
        </h1>
        <p class="text-xs text-zinc-500">
          Lock-free SPSC mailbox with configurable producer/consumer pacing.
        </p>
      </div>

      <div
        class="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1 text-[10px] font-mono text-zinc-300"
      >
        <span
          class="h-1.5 w-1.5 rounded-full"
          :class="
            isMailboxClosed ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'
          "
        />
        <span>{{ isMailboxClosed ? "Mailbox: closed" : "Mailbox: live" }}</span>
      </div>
    </div>

    <!-- Main layout -->
    <div
      class="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)] items-start"
    >
      <!-- Left column: controls + viz + metrics -->
      <div class="flex flex-col gap-4">
        <CommandRingConfig
          :capacity="capacity"
          :capacity-options="CAPACITY_OPTIONS"
          :producer-rate="producerRate"
          :consumer-rate="consumerRate"
          :producer-paused="producerPaused"
          :consumer-paused="consumerPaused"
          :is-mailbox-closed="isMailboxClosed"
          @update:capacity="capacity = $event"
          @update:producer-rate="producerRate = $event"
          @update:consumer-rate="consumerRate = $event"
          @toggle-producer="toggleProducer"
          @toggle-consumer="toggleConsumer"
          @burst-enqueue="burstEnqueue(10)"
          @drain-all="drainAll"
          @close-mailbox="closeMailbox"
          @reopen-mailbox="reopenMailbox"
          @reset="resetRing"
        />

        <CommandRingVisualizer
          :slot-views="slotViews"
          :snapshot="snapshot"
          :capacity="capacity"
        />

        <CommandRingMetrics :snapshot="snapshot" :metrics="metrics" />
      </div>

      <!-- Right column: event log -->
      <div class="flex flex-col">
        <CommandRingEventLog :events="eventLog" @clear="clearLog" />
      </div>
    </div>
  </section>
</template>
