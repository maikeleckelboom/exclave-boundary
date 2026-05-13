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

function getOpLabel(opCode: DemoOpCode | null | undefined): string {
  if (opCode == null) {
    return "CMD";
  }
  return OPCODE_LABELS[opCode];
}

// Format event label
function formatEventLabel(event: LogEvent): string {
  const seqPart = event.seq != null ? ` #${event.seq}` : "";
  const opPart = event.opCode != null ? ` [${getOpLabel(event.opCode)}]` : "";

  switch (event.kind) {
    case "enqueue": {
      return `enqueue${seqPart}${opPart}`;
    }
    case "enqueue_dropped": {
      const head = event.seq != null ? `dropped${seqPart}` : "dropped cmd";
      return `${head}${opPart}`;
    }
    case "enqueue_closed": {
      const head = event.seq != null ? `blocked${seqPart}` : "blocked enqueue";
      return `${head}${opPart} (closed)`;
    }
    case "drain_batch": {
      const count = event.processedCount ?? 0;
      const word = count === 1 ? "cmd" : "cmds";
      return `drained ${count} ${word}`;
    }
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
</script>

<template>
  <section
    class="flex max-h-[80svh] flex-col rounded-lg border border-zinc-800 bg-zinc-900/50"
  >
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-zinc-800/50 px-3 py-2"
    >
      <h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Event Log
      </h2>
      <button
        type="button"
        class="text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
        @click="emit('clear')"
      >
        Clear
      </button>
    </div>

    <!-- Event list -->
    <div class="flex-1 overflow-y-auto p-2 scrollbar-thin">
      <div
        v-if="events.length === 0"
        class="flex h-full items-center justify-center"
      >
        <span class="text-xs text-zinc-600">No events yet</span>
      </div>

      <div v-else class="space-y-0.5">
        <div
          v-for="event in events"
          :key="event.id"
          class="flex items-start gap-2 rounded px-1.5 py-1 text-[10px] font-mono transition-colors hover:bg-zinc-800/30"
          :title="formatEventLabel(event)"
        >
          <!-- Timestamp -->
          <span class="w-20 shrink-0 text-zinc-600">
            {{ formatTime(event.timestamp) }}
          </span>

          <!-- Icon -->
          <span class="w-3 shrink-0 text-center" :class="colorMap[event.kind]">
            {{ iconMap[event.kind] }}
          </span>

          <!-- Label -->
          <span class="flex-1 truncate text-zinc-300">
            {{ formatEventLabel(event) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div
      class="border-t border-zinc-800/50 px-3 py-1.5 text-[9px] font-mono text-zinc-600"
    >
      {{ events.length }} events
    </div>
  </section>
</template>
