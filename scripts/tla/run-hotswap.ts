import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

type HotswapMode = "invonly" | "full";
type HotswapPolicy = "single" | "reject-busy" | "mailbox-latest";

const TOOLS_JAR = resolve("tools", "tla", "tla2tools.jar");
const HOTSWAP_FORMAL_DIR = resolve("packages", "hotswap", "docs", "formal");

/**
 * Policy-to-cpp base name mapping
 * - single: Base single-swap protocol
 * - reject-busy: Multi-swap with reject-while-busy
 * - mailbox-latest: EXPERIMENTAL latest-wins mailbox overlap handling
 */
function getSpecBaseName(policy: HotswapPolicy): string {
  switch (policy) {
    case "single":
      return "HotSwapSingle";
    case "reject-busy":
      return "HotSwapRejectBusy";
    case "mailbox-latest":
      return "HotSwapMailboxLatest";
  }
}

function getPolicyTlaDir(policy: HotswapPolicy): string {
  // Policy specs live under packages/hotswap/docs/formal/policies/<policy>/tla/
  return resolve(HOTSWAP_FORMAL_DIR, "policies", policy, "tla");
}

function getSpecPath(policy: HotswapPolicy): string {
  return resolve(getPolicyTlaDir(policy), `${getSpecBaseName(policy)}.tla`);
}

function getConfigPath(policy: HotswapPolicy, mode: HotswapMode): string {
  const baseName = getSpecBaseName(policy);
  const suffix = mode === "full" ? "" : ".invonly";
  return resolve(getPolicyTlaDir(policy), `${baseName}${suffix}.cfg`);
}

interface ParsedArgs {
  readonly mode: HotswapMode;
  readonly policy: HotswapPolicy;
  readonly extraTlcArgs: readonly string[];
}

function parsePolicy(raw: string): HotswapPolicy {
  if (raw === "single" || raw === "reject-busy" || raw === "mailbox-latest") {
    return raw;
  }

  console.error(
    `Unknown policy "${raw}". Supported: "single", "reject-busy", "mailbox-latest"`,
  );
  console.error(
    'Examples: "--policy single" (default), "--policy reject-busy", "--policy mailbox-latest"',
  );

  process.exitCode = 1;
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [, , rawMode, ...rest] = argv;

  // --- Mode parsing ---
  let mode: HotswapMode | null = null;

  if (rawMode === "full" || rawMode === "invonly") {
    mode = rawMode;
  } else {
    console.log(
      `Unknown mode "${rawMode ?? ""}". Supported modes are "invonly" and "full".`,
    );
    console.log("\nExamples:");
    console.log(
      "  pnpm tla:hotswap                                # single, invonly",
    );
    console.log(
      "  pnpm tla:hotswap:full                           # single, full",
    );
    console.log(
      "  pnpm tla:hotswap -- --policy reject-busy        # reject-busy, invonly",
    );
    console.log(
      "  pnpm tla:hotswap:full -- --policy reject-busy   # reject-busy, full",
    );
    console.log(
      "  pnpm tla:hotswap -- --policy mailbox-latest     # mailbox-latest, invonly (EXPERIMENTAL)",
    );
    console.log(
      "  pnpm tla:hotswap:full -- --policy mailbox-latest # mailbox-latest, full (EXPERIMENTAL)",
    );
    console.log(
      "  pnpm tla:hotswap:full -- --policy=reject-busy    # -nowarning is already set by the script",
    );

    process.exitCode = 1;
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }

  // --- Policy parsing + extra TLC args ---
  let policy: HotswapPolicy = "single";
  const extraTlcArgs: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (typeof arg !== "string") {
      // Keeps noUncheckedIndexedAccess happy; should not happen in practice.
      continue;
    }

    // Ignore bare "--" so pnpm-style separators don't get passed to TLC.
    if (arg === "--") {
      continue;
    }

    if (arg === "--policy") {
      const next = rest[index + 1];

      if (typeof next !== "string") {
        console.error(
          'Missing value for "--policy". Expected "single", "reject-busy", or "mailbox-latest".',
        );
        process.exitCode = 1;
        // eslint-disable-next-line no-process-exit
        process.exit(1);
      }

      policy = parsePolicy(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--policy=")) {
      const value = arg.slice("--policy=".length);
      policy = parsePolicy(value);
      continue;
    }

    // Everything else is forwarded directly to TLC.
    extraTlcArgs.push(arg);
  }

  if (mode === null) {
    console.error("Internal error: failed to determine TLC mode.");
    process.exitCode = 1;
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }

  return {
    mode,
    policy,
    extraTlcArgs,
  };
}

function ensureToolsJar(): void {
  if (existsSync(TOOLS_JAR)) {
    return;
  }

  console.error(
    `Missing tla2tools.jar at ${TOOLS_JAR}. Run "pnpm tla:fetch" first.`,
  );
  process.exitCode = 1;
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}

function ensureFileExists(label: string, path: string): void {
  if (existsSync(path)) {
    return;
  }

  console.error(`${label} not found at: ${path}`);
  process.exitCode = 1;
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}

function runTlc(
  policy: HotswapPolicy,
  mode: HotswapMode,
  extraTlcArgs: readonly string[],
): void {
  ensureToolsJar();

  const specPath = getSpecPath(policy);
  const configPath = getConfigPath(policy, mode);

  ensureFileExists("TLA spec", specPath);
  ensureFileExists("TLA config", configPath);

  const javaArgs: string[] = [
    "-XX:+UseParallelGC",
    "-cp",
    TOOLS_JAR,
    "tlc2.TLC",
    ...extraTlcArgs,
    "-workers",
    "4",
    "-config",
    configPath,
    specPath,
  ];

  const specName = getSpecBaseName(policy);
  console.log(
    `Running TLC for ${specName} (policy: "${policy}") in mode "${mode}" with config:`,
  );
  console.log(`  ${configPath}`);
  if (extraTlcArgs.length > 0) {
    console.log("Extra TLC args:", extraTlcArgs.join(" "));
  }

  const child = spawn("java", javaArgs, {
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`TLC exited due to signal ${signal}`);
      process.exitCode = 1;
      return;
    }

    process.exitCode = code ?? 1;
  });
}

function main(): void {
  const { mode, policy, extraTlcArgs } = parseArgs(process.argv);
  runTlc(policy, mode, extraTlcArgs);
}

main();
