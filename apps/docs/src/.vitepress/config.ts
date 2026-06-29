import { fileURLToPath } from "node:url";

import { transformerTwoslash } from "@shikijs/vitepress-twoslash";
import { createFileSystemTypesCache } from "@shikijs/vitepress-twoslash/cache-fs";
import ts from "typescript";
import { defineConfig } from "vitepress";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const twoslashCacheDir = fileURLToPath(
  new URL("./cache/twoslash", import.meta.url),
);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export default defineConfig({
  title: "Exclave Boundary",
  description:
    "typed shared-memory boundary substrate for coherent state, deterministic layout, explicit handoff, and timing-sensitive runtimes.",
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    theme: {
      light: "light-plus",
      dark: "dark-plus",
    },
    languages: ["js", "jsx", "ts", "tsx", "json", "vue", "sh", "mermaid"],
    defaultHighlightLang: "txt",
    codeTransformers: [
      transformerTwoslash({
        typesCache: createFileSystemTypesCache({
          dir: twoslashCacheDir,
        }),
        twoslashOptions: {
          compilerOptions: {
            allowSyntheticDefaultImports: true,
            baseUrl: repoRoot,
            exactOptionalPropertyTypes: true,
            lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
            module: ts.ModuleKind.ESNext,
            moduleDetection: ts.ModuleDetectionKind.Force,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            noUncheckedIndexedAccess: true,
            paths: {
              "@exclave/boundary": ["packages/core/src/index.ts"],
              "@exclave/boundary/diagnostics": [
                "packages/core/src/diagnostics.ts",
              ],
            },
            skipLibCheck: true,
            strict: true,
            target: ts.ScriptTarget.ES2022,
            types: [],
            verbatimModuleSyntax: true,
          },
        },
      }),
    ],
    config(md) {
      const defaultFence = md.renderer.rules.fence;

      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const language = token.info.trim().split(/\s+/u)[0];

        if (language === "mermaid") {
          return [
            '<div class="mermaid-card" data-mermaid>',
            `<pre class="mermaid-source">${escapeHtml(token.content)}</pre>`,
            '<div class="mermaid-render" aria-hidden="true"></div>',
            "</div>",
          ].join("");
        }

        if (defaultFence) {
          return defaultFence(tokens, idx, options, env, self);
        }

        return self.renderToken(tokens, idx, options);
      };
    },
  },
  themeConfig: {
    nav: [
      { text: "Start", link: "/quickstart" },
      { text: "Concepts", link: "/core-flow" },
      { text: "API", link: "/api" },
      { text: "Examples", link: "/examples" },
      { text: "Internals", link: "/memory-layout" },
      { text: "Blog", link: "/blog/" },
      { text: "Release", link: "/release-checklist" },
    ],
    outline: {
      level: [2, 3],
    },
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Overview", link: "/" },
          { text: "Install", link: "/install" },
          { text: "Quickstart", link: "/quickstart" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Boundary Flow", link: "/core-flow" },
          { text: "Authored AST vs Runtime", link: "/authoring-contract" },
          { text: "Handoff and Acceptance", link: "/handoff-acceptance" },
          { text: "Controller, Processor, Observer", link: "/roles" },
        ],
      },
      {
        text: "API",
        items: [
          { text: "API Reference", link: "/api" },
          { text: "Diagnostics", link: "/diagnostics" },
          { text: "Error Model", link: "/error-model" },
        ],
      },
      {
        text: "Examples",
        items: [{ text: "Examples", link: "/examples" }],
      },
      {
        text: "Internals",
        items: [
          { text: "Memory and Layout Model", link: "/memory-layout" },
          { text: "Package Boundaries", link: "/package-boundaries" },
          { text: "Migration from Seqlok", link: "/migration" },
        ],
      },
      {
        text: "Blog",
        items: [
          { text: "Blog Index", link: "/blog/" },
          {
            text: "Why Exclave Boundary exists",
            link: "/blog/why-exclave-boundary-exists",
          },
          {
            text: "Specs, layout, and handoff",
            link: "/blog/specs-layout-handoff-boundary-contract",
          },
        ],
      },
      {
        text: "Release",
        items: [
          { text: "FAQ", link: "/faq" },
          { text: "Release Checklist", link: "/release-checklist" },
        ],
      },
    ],
    search: {
      provider: "local",
    },
  },
});
