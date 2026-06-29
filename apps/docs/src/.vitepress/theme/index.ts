import TwoslashFloatingVue from "@shikijs/vitepress-twoslash/client";
import DefaultTheme from "vitepress/theme";

import "@shikijs/vitepress-twoslash/style.css";
import "./custom.css";

import type { Theme } from "vitepress";

import { useMermaidRenderer } from "./mermaid";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.use(TwoslashFloatingVue, {
      themes: {
        twoslash: {
          autoBoundaryMaxSize: true,
          autoHide: true,
          delay: { show: 120, hide: 80 },
          disposeTimeout: 100,
          distance: 8,
          flip: false,
          handleResize: true,
          instantMove: false,
          placement: "bottom-start",
          popperTriggers: ["hover", "focus", "click"],
          triggers: ["hover", "focus", "click"],
        },
        "twoslash-query": {
          autoBoundaryMaxSize: true,
          autoHide: true,
          delay: { show: 0, hide: 80 },
          disposeTimeout: 100,
          flip: false,
          hideTriggers: (triggers) => [...triggers, "click"],
          instantMove: false,
          placement: "bottom-start",
          popperTriggers: ["click"],
          triggers: ["click"],
        },
      },
    });
  },
  setup() {
    useMermaidRenderer();
  },
} satisfies Theme;
