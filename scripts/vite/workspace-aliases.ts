import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { SEQLOK_PACKAGES } from "../workspace-packages";

const WORKSPACE_SENTINEL = "pnpm-workspace.yaml";

function findWorkspaceRoot(startDir: string): string {
  let current = startDir;

  for (;;) {
    const sentinelPath = join(current, WORKSPACE_SENTINEL);
    if (existsSync(sentinelPath)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return startDir;
    }

    current = parent;
  }
}

type AliasMap = Record<string, string>;

/**
 * Build Vite aliases that point @seqlok/* to workspace source.
 *
 * - Uses process.cwd() as the starting directory.
 * - Walks up until it finds pnpm-workspace.yaml.
 * - Maps each package to `<root>/packages/<n>/src`.
 */
export function createSeqlokWorkspaceAliases(): AliasMap {
  const root = findWorkspaceRoot(process.cwd());
  const aliases: AliasMap = {};

  for (const pkg of SEQLOK_PACKAGES) {
    const key = `@seqlok/${pkg}`;

    aliases[key] = resolve(root, "packages", pkg, "src");
  }

  return aliases;
}
