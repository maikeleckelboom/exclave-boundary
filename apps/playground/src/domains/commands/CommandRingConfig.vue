<script setup lang="ts">
import { computed } from "vue";
import { SliderRoot, SliderTrack, SliderRange, SliderThumb } from "reka-ui";
import type { CapacityOption } from "./useCommandRingLab";

interface Props {
  readonly capacity: CapacityOption;
  readonly capacityOptions: readonly CapacityOption[];

  readonly producerRate: number;
  readonly consumerRate: number;
  readonly producerPaused: boolean;
  readonly consumerPaused: boolean;
  readonly producerJitterMs: number;

  readonly isMailboxClosed: boolean;
  readonly isRingFull?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (event: "update:capacity", value: CapacityOption): void;
  (event: "update:producer-rate", value: number): void;
  (event: "update:consumer-rate", value: number): void;
  (event: "update:producer-jitter-ms", value: number): void;
  (event: "toggle-producer"): void;
  (event: "toggle-consumer"): void;
  (event: "burst-enqueue"): void;
  (event: "drain-all"): void;
  (event: "close-mailbox"): void;
  (event: "reopen-mailbox"): void;
  (event: "reset"): void;
}>();

// --- Handlers ---

function onCapacityChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  const value = Number.parseInt(target.value, 10) as CapacityOption;
  emit("update:capacity", value);
}

function updateProducerRate(v: number[] | undefined): void {
  if (v?.[0] !== undefined) emit("update:producer-rate", v[0]);
}

function updateProducerJitter(v: number[] | undefined): void {
  if (v?.[0] !== undefined) emit("update:producer-jitter-ms", v[0]);
}

function toggleProducerJitter(): void {
  if (props.producerJitterMs > 0) {
    emit("update:producer-jitter-ms", 0);
  } else {
    emit("update:producer-jitter-ms", 20);
  }
}

function updateConsumerRate(v: number[] | undefined): void {
  if (v?.[0] !== undefined) emit("update:consumer-rate", v[0]);
}

// --- Labels ---

const producerRateLabel = computed(() => {
  if (props.producerRate === 0) return "Stopped";
  return `${props.producerRate}/s`;
});

const consumerRateLabel = computed(() => {
  if (props.consumerRate === 0) return "Stopped";
  return `${props.consumerRate}/s`;
});

const producerJitterLabel = computed(() => {
  if (props.producerJitterMs === 0) return "0 ms";
  return `±${props.producerJitterMs.toFixed(0)} ms`;
});

const isJitterPaused = computed(() => props.producerJitterMs === 0);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      class="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
    >
      <div class="flex items-center gap-3">
        <label class="text-[10px] uppercase tracking-wider text-zinc-500">
          Capacity
        </label>
        <select
          :value="capacity"
          class="rounded border border-zinc-700/50 bg-zinc-950 px-2 py-1 text-xs font-mono text-zinc-300 focus:border-zinc-600 focus:outline-none"
          @change="onCapacityChange"
        >
          <option v-for="opt in capacityOptions" :key="opt" :value="opt">
            {{ opt }} slots
          </option>
        </select>
      </div>

      <div class="flex items-center gap-2">
        <span
          class="hidden text-[10px] font-mono text-zinc-600 sm:inline-block"
        >
          2 words/slot
        </span>
        <div class="mx-1 h-3 w-px bg-zinc-800" />
        <button
          type="button"
          class="rounded border px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors"
          :class="
            isMailboxClosed
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
              : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          "
          @click="
            isMailboxClosed ? emit('reopen-mailbox') : emit('close-mailbox')
          "
        >
          {{ isMailboxClosed ? "Reopen" : "Close" }}
        </button>
        <button
          type="button"
          class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-400 transition-colors hover:bg-zinc-700/50 hover:text-zinc-300"
          @click="emit('reset')"
        >
          Reset
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div
        class="relative flex flex-col gap-4 rounded-lg border p-3 transition-all duration-200"
        :class="[
          isRingFull
            ? 'border-red-500/50 bg-red-500/5'
            : 'border-amber-500/20 bg-amber-500/5',
        ]"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h3
              class="text-xs font-semibold uppercase tracking-wide text-amber-500/90"
            >
              Producer
            </h3>
            <span
              v-if="isRingFull"
              class="animate-pulse rounded-sm bg-red-500 px-1.5 text-[9px] font-bold text-white"
            >
              BLOCKED
            </span>
          </div>
          <span class="text-[10px] font-mono text-amber-400">
            {{ producerRateLabel }}
          </span>
        </div>

        <div class="flex flex-col gap-4 px-1">
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded border transition-colors"
              :class="
                producerPaused
                  ? 'border-amber-500 bg-amber-500/20 text-amber-400'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
              "
              title="Toggle Producer"
              @click="emit('toggle-producer')"
            >
              <svg
                v-if="producerPaused"
                class="h-3 w-3 fill-current"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              <svg v-else class="h-3 w-3 fill-current" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </button>

            <SliderRoot
              class="relative flex w-full touch-none select-none items-center"
              :model-value="[producerRate]"
              :max="50"
              :step="1"
              @update:model-value="updateProducerRate"
            >
              <SliderTrack
                class="relative h-1.5 w-full grow rounded-full bg-zinc-800"
              >
                <SliderRange
                  class="absolute h-full rounded-full bg-amber-500"
                />
              </SliderTrack>
              <SliderThumb
                class="block size-5 rounded-full border-2 border-zinc-950 bg-amber-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                aria-label="Producer Rate"
              />
            </SliderRoot>
          </div>

          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-[9px] font-mono">
              <span class="text-zinc-500">Jitter</span>
              <span class="text-amber-300/70">{{ producerJitterLabel }}</span>
            </div>
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded border transition-colors"
                :class="
                  isJitterPaused
                    ? 'border-zinc-700 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
                    : 'border-amber-500 bg-amber-500/20 text-amber-400'
                "
                title="Toggle Jitter"
                @click="toggleProducerJitter"
              >
                <svg
                  v-if="producerJitterMs > 0"
                  class="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>

                <svg
                  v-else
                  class="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </button>

              <SliderRoot
                class="relative flex w-full touch-none select-none items-center"
                :model-value="[producerJitterMs]"
                :max="40"
                :step="1"
                @update:model-value="updateProducerJitter"
              >
                <SliderTrack
                  class="relative h-1.5 w-full grow rounded-full bg-zinc-800"
                >
                  <SliderRange
                    class="absolute h-full rounded-full bg-amber-500/50"
                  />
                </SliderTrack>
                <SliderThumb
                  class="block size-4 rounded-full border-2 border-zinc-950 bg-amber-500/80 shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  aria-label="Producer Jitter"
                />
              </SliderRoot>
            </div>
          </div>
        </div>

        <button
          type="button"
          class="mt-1 w-full rounded border border-amber-500/30 bg-amber-500/10 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20 active:bg-amber-500/30 disabled:opacity-50"
          :disabled="isMailboxClosed"
          @click="emit('burst-enqueue')"
        >
          Burst +10
        </button>
      </div>

      <div
        class="flex flex-col gap-4 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3"
      >
        <div class="flex items-center justify-between">
          <h3
            class="text-xs font-semibold uppercase tracking-wide text-purple-400/90"
          >
            Consumer
          </h3>
          <span class="text-[10px] font-mono text-purple-400">
            {{ consumerRateLabel }}
          </span>
        </div>

        <div class="flex flex-col gap-4 px-1">
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded border transition-colors"
              :class="
                consumerPaused
                  ? 'border-purple-500 bg-purple-500/20 text-purple-400'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
              "
              title="Toggle Consumer"
              @click="emit('toggle-consumer')"
            >
              <svg
                v-if="consumerPaused"
                class="h-3 w-3 fill-current"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              <svg v-else class="h-3 w-3 fill-current" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </button>

            <SliderRoot
              class="relative flex w-full touch-none select-none items-center"
              :model-value="[consumerRate]"
              :max="50"
              :step="1"
              @update:model-value="updateConsumerRate"
            >
              <SliderTrack
                class="relative h-1.5 w-full grow rounded-full bg-zinc-800"
              >
                <SliderRange
                  class="absolute h-full rounded-full bg-purple-500"
                />
              </SliderTrack>
              <SliderThumb
                class="block size-5 rounded-full border-2 border-zinc-950 bg-purple-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                aria-label="Consumer Rate"
              />
            </SliderRoot>
          </div>

          <div class="h-[34px]" />
        </div>

        <button
          type="button"
          class="mt-1 w-full rounded border border-purple-500/30 bg-purple-500/10 py-1.5 text-xs font-medium text-purple-400 transition-colors hover:bg-purple-500/20 active:bg-purple-500/30"
          @click="emit('drain-all')"
        >
          Drain All
        </button>
      </div>
    </div>
  </div>
</template>
