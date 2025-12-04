<script setup lang="ts">
import { computed } from "vue";
import type { CapacityOption } from "./useCommandRingLab";

interface Props {
  readonly capacity: CapacityOption;
  readonly capacityOptions: readonly CapacityOption[];
  readonly producerRate: number;
  readonly consumerRate: number;
  readonly producerPaused: boolean;
  readonly consumerPaused: boolean;
  readonly isMailboxClosed: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (event: "update:capacity", value: CapacityOption): void;
  (event: "update:producer-rate", value: number): void;
  (event: "update:consumer-rate", value: number): void;
  (event: "toggle-producer"): void;
  (event: "toggle-consumer"): void;
  (event: "burst-enqueue"): void;
  (event: "drain-all"): void;
  (event: "close-mailbox"): void;
  (event: "reopen-mailbox"): void;
  (event: "reset"): void;
}>();

function onCapacityChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  const value = Number.parseInt(target.value, 10) as CapacityOption;
  emit("update:capacity", value);
}

function onProducerRateInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  const value = Number.parseFloat(target.value);
  emit("update:producer-rate", Number.isNaN(value) ? 0 : value);
}

function onConsumerRateInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  const value = Number.parseFloat(target.value);
  emit("update:consumer-rate", Number.isNaN(value) ? 0 : value);
}

const producerRateLabel = computed(() => {
  if (props.producerRate === 0) return "Stopped";
  if (props.producerRate === 1) return "1/s";
  return `${props.producerRate}/s`;
});

const consumerRateLabel = computed(() => {
  if (props.consumerRate === 0) return "Stopped";
  if (props.consumerRate === 1) return "1/s";
  return `${props.consumerRate}/s`;
});
</script>

<template>
  <section class="space-y-4">
    <!-- Header row -->
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-zinc-300">Configuration</h2>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded border transition-colors"
          :class="
            isMailboxClosed
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20'
              : 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20'
          "
          @click="
            isMailboxClosed ? emit('reopen-mailbox') : emit('close-mailbox')
          "
        >
          {{ isMailboxClosed ? "Reopen" : "Close" }}
        </button>
        <button
          type="button"
          class="px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded border bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-300 transition-colors"
          @click="emit('reset')"
        >
          Reset
        </button>
      </div>
    </div>

    <!-- Main controls grid -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <!-- Capacity selector -->
      <div class="space-y-2">
        <label class="text-[10px] text-zinc-500 uppercase tracking-wider block">
          Ring Capacity
        </label>
        <select
          :value="capacity"
          class="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-sm text-zinc-200 font-mono focus:outline-none focus:border-zinc-600 transition-colors"
          @change="onCapacityChange"
        >
          <option v-for="opt in capacityOptions" :key="opt" :value="opt">
            {{ opt }} slots
          </option>
        </select>
      </div>

      <!-- Producer rate -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-[10px] text-zinc-500 uppercase tracking-wider">
            Producer Rate
          </label>
          <span class="text-[10px] font-mono text-emerald-400">
            {{ producerRateLabel }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max="50"
            step="1"
            :value="producerRate"
            class="flex-1 h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-emerald-500"
            @input="onProducerRateInput"
          />
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded border transition-colors"
            :class="
              producerPaused
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:bg-zinc-700/50'
            "
            :title="producerPaused ? 'Resume producer' : 'Pause producer'"
            @click="emit('toggle-producer')"
          >
            <svg
              v-if="producerPaused"
              class="w-3.5 h-3.5 fill-current"
              viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
            <svg v-else class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Consumer rate -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-[10px] text-zinc-500 uppercase tracking-wider">
            Consumer Rate
          </label>
          <span class="text-[10px] font-mono text-purple-400">
            {{ consumerRateLabel }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max="50"
            step="1"
            :value="consumerRate"
            class="flex-1 h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-purple-500"
            @input="onConsumerRateInput"
          />
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded border transition-colors"
            :class="
              consumerPaused
                ? 'bg-purple-500/10 border-purple-500/40 text-purple-400'
                : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:bg-zinc-700/50'
            "
            :title="consumerPaused ? 'Resume consumer' : 'Pause consumer'"
            @click="emit('toggle-consumer')"
          >
            <svg
              v-if="consumerPaused"
              class="w-3.5 h-3.5 fill-current"
              viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
            <svg v-else class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Action buttons -->
    <div
      class="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-800/50"
    >
      <button
        type="button"
        class="px-3 py-1.5 text-xs font-medium rounded border bg-emerald-500/10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="isMailboxClosed"
        @click="emit('burst-enqueue')"
      >
        Burst +10
      </button>
      <button
        type="button"
        class="px-3 py-1.5 text-xs font-medium rounded border bg-purple-500/10 border-purple-500/40 text-purple-400 hover:bg-purple-500/20 transition-colors"
        @click="emit('drain-all')"
      >
        Drain All
      </button>
      <div class="flex-1" />
      <span class="text-[10px] text-zinc-600 font-mono"> Words/slot: 2 </span>
    </div>
  </section>
</template>
