<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import { RouterView, useRoute, useRouter, type RouteMeta } from "vue-router";
import { TabsRoot, TabsList, TabsTrigger, TabsIndicator } from "reka-ui";

type PlaygroundDomainId = RouteMeta["domain"];

interface PlaygroundDomainNavItem {
  readonly id: PlaygroundDomainId;
  readonly label: string;
  readonly description: string;
  readonly routeName: string;
  readonly disabled?: boolean;
}

const router = useRouter();
const route = useRoute();

const domains: readonly PlaygroundDomainNavItem[] = [
  {
    id: "hotswap",
    label: "Hotswap",
    description: "Engine swap protocol lab",
    routeName: "hotswap-lab",
  },
  {
    id: "commands",
    label: "Commands",
    description: "Command ring + mailbox lab",
    routeName: "commands-ring-lab",
  },
];

const activeDomain = computed<PlaygroundDomainNavItem["id"]>({
  get() {
    const current = route.meta.domain;
    if (current) {
      return current;
    }

    const first = domains[0];
    return first ? first.id : "hotswap";
  },
  set(nextDomainId) {
    const target = domains.find(
      (entry) => entry.id === nextDomainId && !entry.disabled,
    );
    if (!target) {
      return;
    }

    if (route.name === target.routeName) {
      return;
    }

    void router.push({ name: target.routeName });
  },
});
</script>

<template>
  <TabsRoot
    v-model="activeDomain"
    activation-mode="manual"
    class="flex h-svh flex-col bg-zinc-950 text-zinc-50"
  >
    <!-- Top shell / header -->
    <header
      class="border-b border-zinc-800/60 bg-zinc-950/90 backdrop-blu h-16 flex items-center justify-center"
      ref="header"
    >
      <div
        class="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
      >
        <!-- Brand -->
        <div class="flex items-center gap-3">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-xs font-bold text-emerald-400"
          >
            SL
          </div>
          <div class="flex flex-col">
            <span class="text-sm font-semibold tracking-tight">
              Seqlok Playground
            </span>
            <span class="text-[11px] text-zinc-500 truncate">
              Real-time shared-state labs: hotswap and command rings.
            </span>
          </div>
        </div>

        <!-- Domain navigation -->
        <TabsList
          class="relative inline-flex items-center gap-1 rounded-xl border border-zinc-800/60 bg-zinc-900/80 p-1"
          aria-label="Playground domains"
        >
          <TabsIndicator
            class="absolute h-7 rounded-lg border border-emerald-500/50 bg-emerald-500/10 shadow-sm transition-[transform,width]"
          />

          <TabsTrigger
            v-for="domain in domains"
            :key="domain.id"
            :value="domain.id"
            :disabled="!!domain.disabled"
            class="relative z-10 cursor-pointer rounded-lg px-3 py-1.5 text-[11px] font-medium tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
            :class="[
              domain.id === activeDomain
                ? 'text-emerald-200'
                : 'text-zinc-400 hover:text-zinc-100',
              domain.disabled ? 'cursor-not-allowed opacity-40' : '',
            ]"
          >
            {{ domain.label }}
          </TabsTrigger>
        </TabsList>
      </div>
    </header>

    <!-- Page content -->
    <main
      class="flex-1 grid overflow-y-auto overflow-x-hidden overscroll-none scrollbar-thin"
    >
      <div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <RouterView />
      </div>
    </main>
  </TabsRoot>
</template>
