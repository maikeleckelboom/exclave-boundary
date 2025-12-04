<script setup lang="ts">
import type { LogEvent, LogEventKind } from "./useCommandRingLab";
import { DemoOpCode, OPCODE_LABELS } from "./useCommandRingLab";

interface Props {
  readonly events: readonly LogEvent[];
}

defineProps<Props>();

const emit = defineEmits<{
  (event: "clear"): void;
}>();

// Icon map for event kinds
const iconMap: Record<LogEventKind, string> = {
  enqueue: "▸",
  enqueue_dropped: "✕",
  enqueue_closed: "⊘",
  drain_batch: "◂",
  drain_empty: "○",
  mailbox_closed: "■",
  mailbox_opened: "□",
  ring_reset: "↻",
};

// Color map for event kinds
const colorMap: Record<LogEventKind, string> = {
  enqueue: "text-emerald-400",
  enqueue_dropped: "text-red-400",
  enqueue_closed: "text-red-300",
  drain_batch: "text-purple-400",
  drain_empty: "text-zinc-500",
  mailbox_closed: "text-amber-400",
  mailbox_opened: "text-emerald-300",
  ring_reset: "text-amber-300",
};

// Format timestamp as HH:MM:SS.mmm
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

// Format event label
function formatEventLabel(event: LogEvent): string {
  switch (event.kind) {
    case "enqueue":
      return event.payload
        ? `enqueue #${event.seq} [${getOpLabel(event.payload.opCode)}]`
        : `enqueue #${event.seq}`;
    case "enqueue_dropped":
      return `dropped #${event.seq}`;
    case "enqueue_closed":
      return `blocked #${event.seq} (closed)`;
    case "drain_batch":
      return `drained ${event.count} cmd${event.count === 1 ? "" : "s"}`;
    case "drain_empty":
      return "drain (empty)";
    case "mailbox_closed":
      return "mailbox closed";
    case "mailbox_opened":
      return "mailbox opened";
    case "ring_reset":
      return "ring reset";
    default:
      return event.kind;
  }
}

function getOpLabel(opCode: DemoOpCode): string {
  return OPCODE_LABELS[opCode] ?? `OP${opCode}`;
}
</script>

<template>
  <section
    class="flex flex-col h-full bg-zinc-900/50 rounded-lg border border-zinc-800"
  >
    <!-- Header -->
    <div
      class="flex items-center justify-between px-3 py-2 border-b border-zinc-800/50"
    >
      <h2 class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
        Event Log
      </h2>
      <button
        type="button"
        class="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
        @click="emit('clear')"
      >
        Clear
      </button>
    </div>

    <!-- Event list -->
    <div class="flex-1 overflow-y-auto scrollbar-thin p-2">
      <div
        v-if="events.length === 0"
        class="h-full flex items-center justify-center"
      >
        <span class="text-xs text-zinc-600">No events yet</span>
      </div>

      <div v-else class="space-y-0.5">
        <div
          v-for="event in events"
          :key="event.id"
          class="flex items-start gap-2 py-1 px-1.5 rounded hover:bg-zinc-800/30 transition-colors text-[10px] font-mono"
        >
          <!-- Timestamp -->
          <span class="text-zinc-600 shrink-0 w-20">
            {{ formatTime(event.timestamp) }}
          </span>

          <!-- Icon -->
          <span :class="colorMap[event.kind]" class="shrink-0 w-3 text-center">
            {{ iconMap[event.kind] }}
          </span>

          <!-- Label -->
          <span class="text-zinc-300 flex-1 truncate">
            {{ formatEventLabel(event) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div
      class="px-3 py-1.5 border-t border-zinc-800/50 text-[9px] text-zinc-600 font-mono"
    >
      {{ events.length }} events
    </div>
  </section>
</template>
