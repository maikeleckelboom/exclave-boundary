import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";

import CommandRingLab from "./domains/commands/CommandRingLab.vue";

declare module "vue-router" {
  interface RouteMeta {
    readonly domain: "commands";
    readonly label: string;
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/commands/ring-lab",
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
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
