import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";

import CommandRingLab from "./commands/CommandRingLab.vue";
import HotswapLab from "./hotswap/HotswapLab.vue";

declare module "vue-router" {
  interface RouteMeta {
    readonly domain: "hotswap" | "commands" | "integration";
    readonly label: string;
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/hotswap/lab",
  },
  {
    path: "/hotswap",
    children: [
      {
        path: "lab",
        name: "hotswap-lab",
        component: HotswapLab,
        meta: {
          domain: "hotswap",
          label: "Hotswap Lab",
        },
      },
    ],
  },
  {
    path: "/commands",
    children: [
      {
        path: "ring-lab",
        name: "commands-ring-lab",
        component: CommandRingLab,
        meta: {
          domain: "commands",
          label: "Command Ring Lab",
        },
      },
    ],
  },
  // Future:
  // {
  //   path: "/integration",
  //   children: [
  //     {
  //       path: "timeline-lab",
  //       name: "integration-timeline-lab",
  //       component: IntegrationTimelineLab,
  //       meta: { domain: "integration", label: "Integration Timeline Lab" },
  //     },
  //   ],
  // },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
