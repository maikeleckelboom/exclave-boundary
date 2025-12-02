#!/usr/bin/env node

/**
 * @fileoverview
 * CLI entrypoint for exporting the Seqlok error registry as JSON.
 *
 * Example:
 *   pnpm -F @seqlok/introspect errors:registry:schema -- --preset=full
 *   pnpm -F @seqlok/introspect errors:registry:schema -- --preset=fatal-core --out schema/snapshots/error-registry.fatal-core.snapshot.json
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  buildErrorRegistrySchema,
  type ErrorRegistrySchema,
} from "../src/errors/export-json";

import type { SubsetSelectionCriteria } from "../src/errors/subset-selection";

type PresetName = "full" | "fatal-core" | "boundary-safe";

interface Preset {
  readonly description: string;
  readonly criteria: SubsetSelectionCriteria;
}

const PRESETS: Record<PresetName, Preset> = {
  full: {
    description: "All registered errors across all domains",
    criteria: {},
  },
  "fatal-core": {
    description:
      "Fatal, non-recoverable core errors (env/backing/spec/plan/handoff/binding)",
    criteria: {
      domains: ["env", "backing", "spec", "plan", "handoff", "binding"],
      severities: ["fatal"],
      recoverable: false,
    },
  },
  "boundary-safe": {
    description: "Errors that are safe to expose across trust boundaries",
    criteria: {
      boundarySafe: true,
    },
  },
};

interface ParsedArgs {
  readonly preset: PresetName;
  readonly outFile: string | undefined;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let preset: PresetName | undefined;
  let outFile: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === undefined) {
      continue;
    }

    if (arg.startsWith("--preset=")) {
      const value = arg.slice("--preset=".length);
      preset = value as PresetName;
      continue;
    }

    if (arg === "--preset") {
      const value = argv[i + 1];
      if (value !== undefined) {
        preset = value as PresetName;
        i += 1;
      }
      continue;
    }

    if (arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length);
      outFile = value.length > 0 ? value : undefined;
      continue;
    }

    if (arg === "--out") {
      const value = argv[i + 1];
      if (value !== undefined) {
        outFile = value;
        i += 1;
      }
    }
  }

  // Default preset
  preset ??= "full";

  if (!(preset in PRESETS)) {
    const known = Object.keys(PRESETS).join(", ");

    console.error(`Unknown preset "${preset}". Known presets: ${known}`);
    process.exitCode = 1;
    preset = "full";
  }

  return { preset, outFile };
}

function writeJson(
  outFile: string | undefined,
  payload: ErrorRegistrySchema,
): void {
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  if (!outFile) {
    console.log(json);
    return;
  }

  const filePath = resolve(process.cwd(), outFile);
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, json, "utf8");

  console.log(`Wrote error registry to ${filePath}`);
}

function main(): void {
  const { preset, outFile } = parseArgs(process.argv.slice(2));
  const { criteria } = PRESETS[preset];

  const exportData = buildErrorRegistrySchema(criteria);
  writeJson(outFile, exportData);
}

main();
