import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import RekaResolver from "reka-ui/resolver";
import Components from "unplugin-vue-components/vite";
import { defineConfig, type UserConfig } from "vite";

const config: UserConfig = defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    Components({
      dts: "src/components.d.ts",
      resolvers: [RekaResolver()],
    }),
  ],
  resolve: {
    conditions: ["source", "import", "module", "browser", "default"],
  },
  optimizeDeps: {
    exclude: [
      "@seqlok/base",
      "@seqlok/primitives",
      "@seqlok/introspect",
      "@seqlok/core",
      "@seqlok/commands",
      "@seqlok/hotswap",
      "@seqlok/integration",
    ],
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    watch: {
      ignored: ["!**/node_modules/@seqlok/**"],
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    sourcemap: true,
  },
});

export default config;
