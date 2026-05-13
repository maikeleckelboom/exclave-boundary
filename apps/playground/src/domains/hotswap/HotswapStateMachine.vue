<script setup lang="ts">
import { computed } from "vue";
import type { SwapPhase } from "@seqlok/hotswap";

interface Props {
  readonly currentPhase: SwapPhase;
  readonly hasPrewarm: boolean;
}

const props = defineProps<Props>();

const NODE_Y = 50;
const NODE_RADIUS = 14;
const ARROW_GAP = 8;

// Horizontal positions
const X_IDLE = 40;
const X_SPAWN = 120;
const X_PRIME = 200;
const X_PREWARM = 280;
const X_CROSSFADE = 360;
const X_RETIRE = 440;

function getNodeState(
  nodePhase: SwapPhase,
): "active" | "future" | "past" | "disabled" {
  if (nodePhase === "prewarm" && !props.hasPrewarm) return "disabled";
  if (props.currentPhase === nodePhase) return "active";

  const order: SwapPhase[] = [
    "idle",
    "spawn",
    "prime",
    "prewarm",
    "crossfade",
    "retire",
  ];
  const currentIndex = order.indexOf(props.currentPhase);
  const nodeIndex = order.indexOf(nodePhase);

  if (currentIndex > nodeIndex) return "past";
  return "future";
}

function getNodeClasses(nodePhase: SwapPhase): string {
  const state = getNodeState(nodePhase);
  const base = "transition-all duration-500";

  switch (state) {
    case "active":
      return `${base} fill-zinc-950 stroke-emerald-400 stroke-[2px] shadow-[0_0_20px_rgba(52,211,153,0.5)]`;
    case "past":
      return `${base} fill-zinc-900 stroke-emerald-500/40 stroke-[1.5px]`;
    case "future":
      return `${base} fill-zinc-950 stroke-zinc-800 stroke-[1px]`;
    case "disabled":
      return "hidden";
  }
}

function getTextClasses(nodePhase: SwapPhase): string {
  const state = getNodeState(nodePhase);
  switch (state) {
    case "active":
      return "fill-emerald-300 font-bold drop-shadow-md";
    case "past":
      return "fill-emerald-500/50";
    case "future":
      return "fill-zinc-700";
    case "disabled":
      return "hidden";
  }
}

function getLabel(phase: SwapPhase): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

// zinc-500 Dynamic Paths zinc-500

const transitions = computed(() => {
  const colorNormal = "#27272a";
  const colorTrail = "#10b981";

  const edges = [
    { from: X_IDLE, to: X_SPAWN, phases: ["spawn"], curved: false },
    { from: X_SPAWN, to: X_PRIME, phases: ["prime"], curved: false },
  ];

  if (props.hasPrewarm) {
    edges.push({
      from: X_PRIME,
      to: X_PREWARM,
      phases: ["prewarm"],
      curved: false,
    });
    edges.push({
      from: X_PREWARM,
      to: X_CROSSFADE,
      phases: ["crossfade"],
      curved: false,
    });
  } else {
    edges.push({
      from: X_PRIME,
      to: X_CROSSFADE,
      phases: ["crossfade"],
      curved: true,
    });
  }

  edges.push({
    from: X_CROSSFADE,
    to: X_RETIRE,
    phases: ["retire"],
    curved: false,
  });

  return edges.map((e) => {
    const state = getNodeState(e.phases[0] as SwapPhase);
    const isActivePath = state === "active" || state === "past";

    return {
      ...e,
      stroke: isActivePath ? colorTrail : colorNormal,
      opacity: isActivePath ? 0.4 : 1,
      width: isActivePath ? 1.5 : 1,
      marker: isActivePath ? "url(#arrow-trail)" : "url(#arrow-future)",
    };
  });
});

const returnPathClass = computed(() => {
  const isRetiring = props.currentPhase === "retire";
  return isRetiring
    ? "stroke-emerald-500/50 stroke-[1.5px]"
    : "stroke-zinc-400 opacity-40 stroke-[1px]";
});
</script>

<template>
  <div
    class="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/30 p-4"
  >
    <div class="flex items-center justify-between">
      <h3 class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
        Protocol State
      </h3>

      <div
        class="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5"
      >
        <span class="relative flex h-1.5 w-1.5">
          <span
            class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
          ></span>
          <span
            class="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"
          ></span>
        </span>
        <span class="text-[10px] font-mono font-medium text-emerald-300">
          {{ getLabel(currentPhase) }}
        </span>
      </div>
    </div>

    <div class="relative flex pb-2 items-center justify-center">
      <svg
        viewBox="0 0 500 100"
        class="w-full max-w-lg overflow-visible"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="arrow-future"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" class="fill-zinc-800" />
          </marker>

          <marker
            id="arrow-trail"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" class="fill-emerald-600" />
          </marker>
        </defs>

        <g>
          <template v-for="(edge, i) in transitions" :key="i">
            <line
              v-if="!edge.curved"
              :x1="edge.from + NODE_RADIUS + ARROW_GAP"
              :y1="NODE_Y"
              :x2="edge.to - NODE_RADIUS - ARROW_GAP"
              :y2="NODE_Y"
              fill="none"
              :stroke="edge.stroke"
              :stroke-width="edge.width"
              :opacity="edge.opacity"
              :marker-end="edge.marker"
              class="transition-colors duration-500"
            />

            <path
              v-else
              :d="`M ${edge.from + NODE_RADIUS + ARROW_GAP} ${NODE_Y}
                   Q ${(edge.from + edge.to) / 2} ${NODE_Y - 35}
                   ${edge.to - NODE_RADIUS - ARROW_GAP} ${NODE_Y}`"
              fill="none"
              :stroke="edge.stroke"
              :stroke-width="edge.width"
              :opacity="edge.opacity"
              :marker-end="edge.marker"
              class="transition-colors duration-500"
            />
          </template>

          <path
            d="M 435 90
               C 350 120, 130 120, 45 90"
            fill="none"
            :class="returnPathClass"
            class="transition-all duration-500"
            stroke-dasharray="3 3"
            marker-end="url(#arrow-future)"
          />
        </g>

        <g
          v-for="phase in [
            'idle',
            'spawn',
            'prime',
            'prewarm',
            'crossfade',
            'retire',
          ]"
          :key="phase"
        >
          <circle
            :cx="
              phase === 'idle'
                ? X_IDLE
                : phase === 'spawn'
                  ? X_SPAWN
                  : phase === 'prime'
                    ? X_PRIME
                    : phase === 'prewarm'
                      ? X_PREWARM
                      : phase === 'crossfade'
                        ? X_CROSSFADE
                        : X_RETIRE
            "
            :cy="NODE_Y"
            :r="NODE_RADIUS"
            :class="getNodeClasses(phase as SwapPhase)"
          />

          <text
            :x="
              phase === 'idle'
                ? X_IDLE
                : phase === 'spawn'
                  ? X_SPAWN
                  : phase === 'prime'
                    ? X_PRIME
                    : phase === 'prewarm'
                      ? X_PREWARM
                      : phase === 'crossfade'
                        ? X_CROSSFADE
                        : X_RETIRE
            "
            :y="NODE_Y + 28"
            text-anchor="middle"
            class="text-[9px] font-mono uppercase tracking-wider transition-colors duration-500 select-none"
            :class="getTextClasses(phase as SwapPhase)"
          >
            {{ phase }}
          </text>

          <circle
            v-if="currentPhase === phase"
            :cx="
              phase === 'idle'
                ? X_IDLE
                : phase === 'spawn'
                  ? X_SPAWN
                  : phase === 'prime'
                    ? X_PRIME
                    : phase === 'prewarm'
                      ? X_PREWARM
                      : phase === 'crossfade'
                        ? X_CROSSFADE
                        : X_RETIRE
            "
            :cy="NODE_Y"
            r="3"
            class="fill-emerald-300"
          />
        </g>
      </svg>
    </div>
  </div>
</template>
