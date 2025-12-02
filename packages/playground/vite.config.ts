import { defineConfig, type UserConfig } from "vite";

export default defineConfig({
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
    watch: {
      ignored: ["!**/node_modules/@seqlok/**"],
    },
  },
  build: {
    sourcemap: true,
  },
}) satisfies UserConfig;
