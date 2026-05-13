<script setup lang="ts">
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from "reka-ui";

defineProps<{
  modelValue: number;
}>();

const emit = defineEmits<{
  (event: "change:modelValue", payload: number[] | undefined): any;
}>();
</script>

<template>
  <SliderRoot
    class="relative flex w-full touch-none select-none items-center"
    :model-value="[modelValue]"
    :max="50"
    :step="1"
    @update:model-value="emit('change:modelValue', $event)"
  >
    <SliderTrack class="relative h-1.5 w-full grow rounded-full bg-zinc-800">
      <SliderRange class="absolute h-full rounded-full bg-amber-500" />
    </SliderTrack>
    <SliderThumb
      class="block size-5 rounded-full border-2 border-zinc-950 bg-amber-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
      aria-label="Producer Rate"
    />
  </SliderRoot>
</template>

<style scoped></style>
