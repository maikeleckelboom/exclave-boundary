<script setup lang="ts">
/**
 * CommandRing3DView.vue
 *
 * Holographic HUD Edition – focused on 3D ring only
 */
import { computed, ref, watch, onBeforeUnmount, onMounted } from "vue";
import type {
  SlotView,
  RingSnapshot,
  CapacityOption,
} from "./useCommandRingLab";
import { DemoOpCode } from "./useCommandRingLab";

interface Props {
  readonly slotViews: readonly SlotView[];
  readonly snapshot: RingSnapshot;
  readonly capacity: CapacityOption;
}

const props = defineProps<Props>();

// --- Configuration ---
const SLOT_WIDTH = 64;
const SLOT_HEIGHT = 56;
const MAX_PARTICLES = 25;
const MAX_BURST_PARTICLES = 5;

// Rotation speed cap (degrees per millisecond)
const ROTATE_SPEED_DEG_PER_MS = 0.18;

// SSR-safe "now"
const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

// --- Interaction / camera state ---
const isDragging = ref(false);
const lastPointerX = ref(0);
const isAutoFollow = ref(true);

// Physics state: visual vs target rotation (degrees)
const visualRotation = ref(0);
const targetRotation = ref(0);

let animationFrameId: number | null = null;
let lastFrameTime = now();

// --- Dynamics state ---
const dropGlitchActive = ref(false);

// --- Particle system ---
interface DropParticle {
  readonly id: number;
  readonly slotIndex: number;
  readonly opCode?: DemoOpCode;
  readonly colorClass: string;
  readonly transformString: string;
  readonly tumbleRotation: string;
  readonly fallDuration: string;
}

const particles = ref<DropParticle[]>([]);
let nextParticleId = 0;
let lastTransition: string | null = null;
const opCodeHistory = new Map<number, DemoOpCode>();

// --- 1. Physics loop (speed-limited follow) ---
const stepPhysics = (timestamp: number) => {
  const dt = timestamp - lastFrameTime;
  lastFrameTime = timestamp;

  if (isAutoFollow.value && !isDragging.value) {
    const diff = targetRotation.value - visualRotation.value;

    if (Math.abs(diff) > 0.001) {
      const maxStep = ROTATE_SPEED_DEG_PER_MS * dt;
      const step = Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;
      visualRotation.value += step;
    } else {
      visualRotation.value = targetRotation.value;
    }
  } else {
    // When user is manipulating, keep target locked to current pose
    targetRotation.value = visualRotation.value;
  }

  animationFrameId = window.requestAnimationFrame(stepPhysics);
};

onMounted(() => {
  if (
    typeof window === "undefined" ||
    typeof window.requestAnimationFrame === "undefined"
  ) {
    return;
  }
  lastFrameTime = now();
  animationFrameId = window.requestAnimationFrame(stepPhysics);
});

onBeforeUnmount(() => {
  if (animationFrameId !== null && typeof window !== "undefined") {
    window.cancelAnimationFrame(animationFrameId);
  }
});

// --- 2. Data / ring semantics ---

// Clear opcode history on capacity change
watch(
  () => props.capacity,
  () => opCodeHistory.clear(),
);

// Update opcode history for consumed particle labels
watch(
  () => props.slotViews,
  (slots) => {
    slots.forEach((slot) => {
      if (slot.opCode !== undefined) {
        opCodeHistory.set(slot.index, slot.opCode);
      }
    });
  },
  { deep: true, immediate: true },
);

// Per-slot angle in degrees
const anglePerSlot = computed(() => 360 / props.capacity);

// Follow write head with camera
watch(
  () => props.snapshot.writeIndex,
  (newIndex, oldIndex) => {
    if (!isAutoFollow.value || isDragging.value) return;
    if (oldIndex === undefined || newIndex === oldIndex) return;

    const rawTarget = -(newIndex * anglePerSlot.value);

    // Work relative to current target to keep unwrap stable
    const currentWrapped = ((targetRotation.value % 360) + 360) % 360;
    let delta = rawTarget - currentWrapped;

    if (delta < -180) delta += 360;
    if (delta > 180) delta -= 360;

    targetRotation.value += delta;
  },
);

// Spawn particles when read head advances (drain)
watch(
  () => props.snapshot.readIndex,
  (newIdx, oldIdx) => {
    if (oldIdx === undefined || newIdx === oldIdx) return;
    const key = `${oldIdx}:${newIdx}`;
    if (key === lastTransition) return;
    lastTransition = key;

    let count = newIdx - oldIdx;
    if (count < 0) count += props.capacity;

    const toSpawn = Math.min(count, MAX_BURST_PARTICLES);

    for (let i = 0; i < toSpawn; i += 1) {
      const offset = i;
      const consumedIndex = (oldIdx + offset) % props.capacity;
      const cachedOpCode = opCodeHistory.get(consumedIndex);

      setTimeout(() => {
        spawnParticle(consumedIndex, cachedOpCode);
      }, i * 30);
    }
  },
);

function spawnParticle(slotIndex: number, opCode: DemoOpCode | undefined) {
  const id = nextParticleId++;
  let colorClass =
    "border-emerald-500/50 bg-emerald-950/60 text-emerald-100 shadow-[0_0_15px_rgba(16,185,129,0.3)]";

  if (opCode === DemoOpCode.Ping) {
    colorClass =
      "border-cyan-400/50 bg-cyan-950/60 text-cyan-100 shadow-[0_0_15px_rgba(6,182,212,0.3)]";
  } else if (opCode === DemoOpCode.SetValue) {
    colorClass =
      "border-fuchsia-400/50 bg-fuchsia-950/60 text-fuchsia-100 shadow-[0_0_15px_rgba(232,121,249,0.3)]";
  } else if (opCode === DemoOpCode.Trigger) {
    colorClass =
      "border-amber-400/50 bg-amber-950/60 text-amber-100 shadow-[0_0_15px_rgba(245,158,11,0.3)]";
  }

  const angle = slotIndex * anglePerSlot.value;
  const r = radius.value;

  const transformString = `rotateY(${angle}deg) translateZ(${r - 25}px)`;

  const tumbleAxis = Math.random() > 0.5 ? "1, 0, 0" : "0, 0, 1";
  const tumbleDir = Math.random() > 0.5 ? 1 : -1;
  const tumbleRotation = `rotate3d(${tumbleAxis}, ${tumbleDir * 90}deg)`;

  particles.value.push({
    id,
    slotIndex,
    opCode,
    colorClass,
    transformString,
    tumbleRotation,
    fallDuration: "0.8s",
  } as DropParticle);

  setTimeout(() => {
    const idx = particles.value.findIndex((x) => x.id === id);
    if (idx !== -1) {
      particles.value.splice(idx, 1);
    }
  }, 900);

  if (particles.value.length > MAX_PARTICLES) {
    particles.value.shift();
  }
}

// --- 3. Geometry & camera ---
const radius = computed(() => {
  return Math.round((props.capacity * SLOT_WIDTH) / (2 * Math.PI)) + 20;
});

const autoScale = computed(() => {
  const idealRadius = 220;
  if (radius.value <= idealRadius) return 1;
  return idealRadius / radius.value;
});

// Angle cache for Z-sorting and opacity
interface AngleInfo {
  readonly backFace: boolean;
  readonly opacity: number;
}

const angleCache = computed(() => {
  const result = new Map<number, AngleInfo>();
  const currentRot = visualRotation.value;

  for (let index = 0; index < props.capacity; index += 1) {
    const slotAngle = index * anglePerSlot.value;
    const netAngle = (slotAngle + currentRot) % 360;
    const normalized = netAngle < 0 ? netAngle + 360 : netAngle;

    const backFace = normalized > 90 && normalized < 270;

    const rad = (netAngle * Math.PI) / 180;
    const visibility = Math.abs(Math.cos(rad));
    let opacity = Math.min(1, Math.pow(visibility, 0.5) + 0.15);

    if (backFace) {
      // Still dim the far side, but keep commands visibly colored
      opacity *= 0.7;
    }

    result.set(index, { backFace, opacity });
  }
  return result;
});

// Pending indices: contiguous span from readIndex over inFlight slots
const pendingIndices = computed(() => {
  const indices: number[] = [];
  const capacityValue = props.capacity;
  const inFlight = props.snapshot.inFlight;
  const readIndex = props.snapshot.readIndex;

  if (capacityValue <= 0 || inFlight <= 0) {
    return indices;
  }

  for (let i = 0; i < inFlight; i += 1) {
    indices.push((readIndex + i) % capacityValue);
  }
  return indices;
});

const pendingStartIndex = computed(() => {
  const indices = pendingIndices.value;
  return indices.length > 0 ? indices[0] : null;
});

const pendingEndIndex = computed(() => {
  const indices = pendingIndices.value;
  return indices.length > 0 ? indices[indices.length - 1] : null;
});

// Pending intensity based on backlog size
const pendingIntensity = computed(() => {
  const capacityValue = props.capacity;
  const inFlight = props.snapshot.inFlight;

  if (capacityValue <= 0 || inFlight <= 0) {
    return 0;
  }

  const ratio = inFlight / capacityValue;

  // Base glow even for tiny backlog, ramp up fairly quickly
  const minOpacity = 0.35;
  const maxOpacity = 1;
  const clamped = Math.min(1, ratio * 2); // full by ~50% utilization

  return minOpacity + (maxOpacity - minOpacity) * clamped;
});

// --- 4. Input handling ---
const handlePointerDown = (e: PointerEvent) => {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  isAutoFollow.value = false;
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  isDragging.value = true;
  lastPointerX.value = e.clientX;
  target.style.cursor = "grabbing";

  targetRotation.value = visualRotation.value;
};

const handlePointerMove = (e: PointerEvent) => {
  if (!isDragging.value) return;
  e.preventDefault();
  const delta = e.clientX - lastPointerX.value;

  const rotationChange = delta * (0.5 / autoScale.value);
  visualRotation.value += rotationChange;
  targetRotation.value = visualRotation.value;

  lastPointerX.value = e.clientX;
};

const handlePointerUp = (e: PointerEvent) => {
  if (!isDragging.value) return;
  isDragging.value = false;
  const target = e.currentTarget as HTMLElement;
  target.releasePointerCapture(e.pointerId);
  target.style.cursor = "grab";
};

const toggleLock = () => {
  isAutoFollow.value = !isAutoFollow.value;
  if (isAutoFollow.value) {
    const rawTarget = -(props.snapshot.writeIndex * anglePerSlot.value);
    const currentWrapped = ((visualRotation.value % 360) + 360) % 360;
    let delta = rawTarget - currentWrapped;
    if (delta < -180) delta += 360;
    if (delta > 180) delta -= 360;
    targetRotation.value = visualRotation.value + delta;
  }
};

// Visual glitch trigger for overflow (drops)
watch(
  () => props.snapshot.dropped,
  (newVal, oldVal) => {
    if (oldVal !== undefined && newVal > oldVal) {
      dropGlitchActive.value = true;
      setTimeout(() => {
        dropGlitchActive.value = false;
      }, 150);
    }
  },
);

// --- 5. Style helpers ---
function getOpStyles(slot: SlotView, isBack: boolean): string {
  const { opCode, state } = slot;

  // Empty slots: wireframe on back, subtle plate on front
  if (state === "empty") {
    if (isBack) {
      return "border-zinc-800/20 text-zinc-800/20 bg-transparent";
    }

    if (slot.isWriteHead) {
      return "border-amber-500/80 bg-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.25)] ring-1 ring-amber-500/50";
    }
    if (slot.isReadHead) {
      return "border-emerald-500/80 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.25)] ring-1 ring-emerald-500/50";
    }
    return "border-zinc-800 text-zinc-700 bg-zinc-950/10";
  }

  // Non-empty slots: always use op color, even on back side
  let base: string;
  switch (opCode) {
    case DemoOpCode.Ping:
      base =
        "border-cyan-400 text-cyan-200 bg-cyan-950/80 shadow-[0_0_15px_rgba(34,211,238,0.2)]";
      break;
    case DemoOpCode.SetValue:
      base =
        "border-fuchsia-400 text-fuchsia-200 bg-fuchsia-950/80 shadow-[0_0_15px_rgba(232,121,249,0.2)]";
      break;
    case DemoOpCode.Trigger:
      base =
        "border-amber-400 text-amber-200 bg-amber-950/80 shadow-[0_0_15px_rgba(251,191,36,0.2)]";
      break;
    default:
      base = "border-zinc-500 text-zinc-300 bg-zinc-900/80";
  }

  return `${base} backdrop-blur-sm`;
}

function getOpLabel(opCode?: DemoOpCode): string {
  switch (opCode) {
    case DemoOpCode.Ping:
      return "PING";
    case DemoOpCode.SetValue:
      return "SET";
    case DemoOpCode.Trigger:
      return "TRIG";
    case DemoOpCode.Noop:
      return "NOOP";
    default:
      return "";
  }
}
</script>

<template>
  <div
    class="relative w-full h-[500px] bg-zinc-950 flex flex-col items-center overflow-hidden"
  >
    <!-- Controls -->
    <div
      class="absolute top-4 right-4 z-30 flex flex-col items-end gap-1 select-none"
    >
      <div
        class="flex items-center gap-2 cursor-pointer px-3 py-1 rounded-full bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 transition-colors"
        @click="toggleLock"
      >
        <span
          class="text-[9px] uppercase font-bold tracking-[0.18em]"
          :class="isAutoFollow ? 'text-amber-400' : 'text-zinc-500'"
        >
          {{ isAutoFollow ? "FOLLOW HEAD" : "FREE ORBIT" }}
        </span>
        <div
          class="w-1.5 h-1.5 rounded-full transition-colors"
          :class="isAutoFollow ? 'bg-amber-400' : 'bg-zinc-600'"
        />
      </div>
      <div class="text-[9px] text-zinc-500/80">
        Drag to orbit. FOLLOW keeps camera on write head.
      </div>
    </div>

    <!-- 3D Scene -->
    <div
      class="relative w-full flex-1 flex items-center justify-center perspective-container"
    >
      <div
        class="scene touch-none"
        :style="{ transform: `scale(${autoScale})` }"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerUp"
        @pointercancel="handlePointerUp"
      >
        <!-- The Ring Container: Rotated via JS loop -->
        <div
          class="ring-base"
          :style="{
            transform: `rotateX(-12deg) rotateY(${visualRotation}deg)`,
          }"
        >
          <!-- SLOTS -->
          <div
            v-for="slot in slotViews"
            :key="`slot-${slot.index}`"
            class="slot"
            :class="[
              getOpStyles(slot, angleCache.get(slot.index)?.backFace ?? false),
              angleCache.get(slot.index)?.backFace ? 'z-0' : 'z-10',
            ]"
            :style="{
              width: `${SLOT_WIDTH}px`,
              height: `${SLOT_HEIGHT}px`,
              marginLeft: `-${SLOT_WIDTH / 2}px`,
              marginTop: `-${SLOT_HEIGHT / 2}px`,
              transform: `rotateY(${slot.index * anglePerSlot}deg) translateZ(${radius}px)`,
              opacity: angleCache.get(slot.index)?.opacity ?? 1,
            }"
          >
            <!-- Slot Index -->
            <div
              class="absolute top-0.5 left-1 text-[8px] font-mono select-none"
              :class="
                slot.isWriteHead &&
                slot.state === 'empty' &&
                !angleCache.get(slot.index)?.backFace
                  ? 'text-amber-500/90'
                  : 'text-zinc-500'
              "
            >
              {{ slot.index }}
            </div>

            <!-- Content -->
            <div class="flex items-center justify-center h-full w-full">
              <span
                v-if="slot.opCode"
                class="text-xs font-bold tracking-tight select-none"
              >
                {{ getOpLabel(slot.opCode) }}
              </span>
            </div>

            <!-- WRITE HEAD / producer indicator (above slot) -->
            <div
              v-if="slot.isWriteHead"
              class="absolute bottom-full left-1/2 -translate-x-1/2 flex flex-col items-center z-50 pointer-events-none pb-4"
              :class="[
                angleCache.get(slot.index)?.backFace
                  ? 'opacity-35'
                  : 'opacity-100',
                dropGlitchActive &&
                !(angleCache.get(slot.index)?.backFace ?? false)
                  ? 'scale-110'
                  : '',
              ]"
            >
              <div class="flex flex-col items-center gap-0.5 mb-2">
                <div
                  class="text-[9px] font-bold text-amber-400 tracking-[0.18em] uppercase drop-shadow-[0_0_8px_rgba(245,158,11,0.8)] text-center"
                >
                  WRITE HEAD
                </div>
                <div
                  class="text-[8px] uppercase tracking-[0.16em] text-amber-300/80 text-center"
                >
                  producer
                </div>
              </div>
              <div
                class="w-2 h-2 bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,1)] rounded-full mb-1"
              />
              <div
                class="w-px h-10 bg-gradient-to-t from-amber-500/80 to-transparent"
              />
            </div>

            <!-- READ HEAD / consumer indicator (below slot) -->
            <div
              v-if="slot.isReadHead"
              class="absolute top-full left-1/2 -translate-x-1/2 flex flex-col items-center z-50 pointer-events-none pt-4"
              :class="[
                angleCache.get(slot.index)?.backFace
                  ? 'opacity-35'
                  : 'opacity-100',
              ]"
            >
              <div
                class="w-px h-10 bg-gradient-to-b from-emerald-500/80 to-transparent"
              />
              <div
                class="w-2 h-2 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,1)] rounded-full mt-1"
              />
              <div class="flex flex-col items-center gap-0.5 mt-2">
                <div
                  class="text-[9px] font-bold text-emerald-400 tracking-[0.18em] uppercase drop-shadow-[0_0_8px_rgba(16,185,129,0.8)] text-center"
                >
                  READ HEAD
                </div>
                <div
                  class="text-[8px] uppercase tracking-[0.16em] text-emerald-300/80 text-center"
                >
                  consumer
                </div>
              </div>
            </div>
          </div>

          <!-- PENDING RING (floating backlog plane) -->
          <div
            v-for="index in pendingIndices"
            :key="`pending-${index}`"
            class="pending-ring-segment"
            :class="{
              'pending-ring-start': index === pendingStartIndex,
              'pending-ring-end': index === pendingEndIndex,
            }"
            :style="{
              transform: `rotateY(${index * anglePerSlot}deg) translateZ(${radius + 3}px) translateY(-70px)`,
              opacity: pendingIntensity,
            }"
          />

          <!-- PARTICLES -->
          <div
            v-for="p in particles"
            :key="p.id"
            class="absolute top-1/2 left-1/2 w-0 h-0 pointer-events-none z-20"
            :style="{ transform: p.transformString }"
          >
            <div class="falling-container">
              <div
                class="falling-visual w-[50px] h-[40px] -ml-[25px] -mt-[20px] rounded border flex items-center justify-center backdrop-blur-md"
                :class="p.colorClass"
                :style="{
                  '--tumble-rot': p.tumbleRotation,
                  '--fall-dur': p.fallDuration,
                }"
              >
                <span
                  class="text-[8px] font-mono font-bold tracking-tight text-white/90"
                >
                  {{ getOpLabel(p.opCode) || "DONE" }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@property --fall-dur {
  syntax: "<time>";
  inherits: false;
  initial-value: 1s;
}

.perspective-container {
  perspective: 1200px;
}

.scene {
  width: 100%;
  height: 100%;
  position: relative;
  transform-style: preserve-3d;
  will-change: transform;
  cursor: grab;
}

.scene:active {
  cursor: grabbing;
}

/* Movement is driven by JS requestAnimationFrame */
.ring-base {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  transform-style: preserve-3d;
  will-change: transform;
}

.slot {
  position: absolute;
  left: 50%;
  top: 50%;
  border-width: 1px;
  border-style: solid;
  display: flex;
  align-items: center;
  justify-content: center;
  backface-visibility: visible;
  transform-style: preserve-3d;
  transition:
    opacity 0.2s,
    filter 0.2s,
    background-color 0.2s,
    border-color 0.2s;
}

/* Pending ring (read -> write span) */
.pending-ring-segment {
  position: absolute;
  left: 50%;
  top: 50%;

  width: 76px;
  height: 2px;
  margin-left: -38px;
  margin-top: -1px;

  border-radius: 9999px;
  transform-style: preserve-3d;

  /* flat rail; continuity comes from masks on the ends */
  background: rgba(56, 189, 248, 0.8);
  box-shadow:
    0 0 4px rgba(56, 189, 248, 0.4),
    0 0 18px rgba(56, 189, 248, 0.6);

  pointer-events: none;
}

/* fade-in at the start (near read head) */
.pending-ring-start {
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0%,
    black 35%,
    black 100%
  );
  mask-image: linear-gradient(to right, transparent 0%, black 35%, black 100%);
}

/* gentle taper at the far end, stays visually connected */
.pending-ring-end {
  -webkit-mask-image: linear-gradient(
    to left,
    rgba(0, 0, 0, 0.2) 0%,
    black 40%,
    black 100%
  );
  mask-image: linear-gradient(
    to left,
    rgba(0, 0, 0, 0.2) 0%,
    black 40%,
    black 100%
  );
}

.falling-container {
  transform-style: preserve-3d;
}

.falling-visual {
  opacity: 0;
  animation: fall-tumble var(--fall-dur) ease-in forwards;
}

@keyframes fall-tumble {
  0% {
    opacity: 1;
    transform: translateY(0) rotate3d(0, 0, 0, 0) scale(0.9);
  }
  10% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(350px) var(--tumble-rot) scale(0.4);
  }
}
</style>
