import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";

import { build as viteBuild, defineConfig, type Plugin } from "vite";

const appRoot = dirname(fileURLToPath(import.meta.url));
const boundarySource = fileURLToPath(
  new URL("../../packages/core/src/index.ts", import.meta.url),
);
const generatedModuleEntry = join(
  appRoot,
  "generated",
  "signalsmith-stretch.module.js",
);
const workletEntry = join(appRoot, "src", "worklet", "stretch-processor.ts");
const workletUrlId = "virtual:signalsmith-stretch/worklet-url";
const resolvedWorkletUrlId = `\0${workletUrlId}`;
const generatedModuleUrlId =
  "virtual:signalsmith-stretch/generated-module-url";
const resolvedGeneratedModuleUrlId = `\0${generatedModuleUrlId}`;
const devWorkletPath = "/__signalsmith-stretch/stretch-processor.js";
const devGeneratedModulePath =
  "/__signalsmith-stretch/signalsmith-stretch.module.js";

const isolationHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function signalsmithAudioWorkletPlugin(realAdapterEnabled: boolean): Plugin {
  let command: "build" | "serve" = "serve";

  return {
    name: "signalsmith-audio-worklet",
    configResolved(config) {
      command = config.command;
    },
    configureServer(server) {
      server.middlewares.use(devWorkletPath, (request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
          next();
          return;
        }

        void bundleWorklet(realAdapterEnabled)
          .then((code) => {
            response.statusCode = 200;
            for (const [header, value] of Object.entries(isolationHeaders)) {
              response.setHeader(header, value);
            }
            response.setHeader(
              "Content-Type",
              "text/javascript; charset=utf-8",
            );
            response.end(request.method === "HEAD" ? "" : code);
          })
          .catch(next);
      });
    },
    load(id) {
      if (id !== resolvedWorkletUrlId) {
        return null;
      }

      if (command === "serve") {
        return `export default ${JSON.stringify(devWorkletPath)};`;
      }

      return bundleWorklet(realAdapterEnabled).then((code) => {
        const referenceId = this.emitFile({
          name: "stretch-processor.js",
          source: code,
          type: "asset",
        });

        return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`;
      });
    },
    resolveId(id) {
      if (id === workletUrlId) {
        return resolvedWorkletUrlId;
      }

      return null;
    },
  };
}

async function bundleWorklet(realAdapterEnabled: boolean): Promise<string> {
  const result = await viteBuild({
    build: {
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        input: workletEntry,
        output: {
          entryFileNames: "stretch-processor.js",
          format: "iife",
          inlineDynamicImports: true,
        },
      },
      sourcemap: "inline",
      target: "es2022",
      write: false,
    },
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    resolve: {
      alias: {
        "@exclave/boundary": boundarySource,
      },
    },
    root: appRoot,
  });

  interface WorkletBundleOutput {
    readonly code?: string;
    readonly type: string;
  }
  type WorkletBundleResult =
    | { readonly output: readonly WorkletBundleOutput[] }
    | readonly { readonly output: readonly WorkletBundleOutput[] }[];

  const bundle = result as WorkletBundleResult;
  const output = Array.isArray(bundle)
    ? (
        bundle as readonly {
          readonly output: readonly WorkletBundleOutput[];
        }[]
      ).flatMap((item) => item.output)
    : (bundle as { readonly output: readonly WorkletBundleOutput[] }).output;
  const chunk = output.find(
    (
      item: WorkletBundleOutput,
    ): item is WorkletBundleOutput & { readonly code: string } =>
      item.type === "chunk" && typeof item.code === "string",
  );

  if (!chunk) {
    throw new Error("Unable to bundle Signalsmith AudioWorklet processor.");
  }

  return `${readGeneratedModulePrelude(realAdapterEnabled)}${chunk.code}`;
}

function signalsmithGeneratedModuleUrlPlugin(
  realAdapterEnabled: boolean,
): Plugin {
  let command: "build" | "serve" = "serve";

  return {
    name: "signalsmith-generated-module-url",
    configResolved(config) {
      command = config.command;
    },
    configureServer(server) {
      server.middlewares.use(
        devGeneratedModulePath,
        (request, response, next) => {
          if (
            !realAdapterEnabled ||
            !existsSync(generatedModuleEntry) ||
            (request.method !== "GET" && request.method !== "HEAD")
          ) {
            next();
            return;
          }

          response.statusCode = 200;
          for (const [header, value] of Object.entries(isolationHeaders)) {
            response.setHeader(header, value);
          }
          response.setHeader("Content-Type", "text/javascript; charset=utf-8");
          response.end(
            request.method === "HEAD"
              ? ""
              : readFileSync(generatedModuleEntry, "utf8"),
          );
        },
      );
    },
    load(id) {
      if (id !== resolvedGeneratedModuleUrlId) {
        return null;
      }

      if (!realAdapterEnabled || !existsSync(generatedModuleEntry)) {
        return "export default null;";
      }

      if (command === "serve") {
        return `export default ${JSON.stringify(devGeneratedModulePath)};`;
      }

      const referenceId = this.emitFile({
        name: "signalsmith-stretch.module.js",
        source: readFileSync(generatedModuleEntry),
        type: "asset",
      });

      return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`;
    },
    resolveId(id) {
      if (id === generatedModuleUrlId) {
        return resolvedGeneratedModuleUrlId;
      }

      return null;
    },
  };
}

function readGeneratedModulePrelude(realAdapterEnabled: boolean): string {
  if (!realAdapterEnabled || !existsSync(generatedModuleEntry)) {
    return "";
  }

  const generatedSource = readFileSync(generatedModuleEntry, "utf8");
  const withoutDefaultExport = generatedSource.replace(
    /\n?export\s+default\s+SignalsmithStretchModule;?\s*$/u,
    "",
  );

  if (withoutDefaultExport === generatedSource) {
    throw new Error(
      "Generated Signalsmith module format changed; expected default export.",
    );
  }

  return `var crypto = globalThis.crypto ?? {
  getRandomValues(view) {
    let seed = 305419896;
    for (let index = 0; index < view.length; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      view[index] = seed & 255;
    }
    return view;
  },
};
${withoutDefaultExport}
globalThis.__SIGNALSMITH_STRETCH_MODULE_FACTORY__ = SignalsmithStretchModule;
`;
}

export default defineConfig(({ mode }) => {
  const realAdapterEnabled = mode === "real-adapter";

  return {
    build: {
      target: "es2022",
    },
    define: {
      __SIGNALSMITH_REAL_ADAPTER_ENABLED__: JSON.stringify(realAdapterEnabled),
      __SIGNALSMITH_VITE_MODE__: JSON.stringify(mode),
    },
    plugins: [
      signalsmithAudioWorkletPlugin(realAdapterEnabled),
      signalsmithGeneratedModuleUrlPlugin(realAdapterEnabled),
    ],
    preview: {
      headers: isolationHeaders,
    },
    resolve: {
      alias: {
        "@exclave/boundary": boundarySource,
      },
    },
    server: {
      headers: isolationHeaders,
    },
  };
});
