import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_EXTENSIONS = new Set([".css", ".html", ".json", ".mts", ".ts"]);
const AUTHORED_JAVASCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);

describe("Stage B app import and language guards", () => {
  it("uses the current boundary package and no stale prototype package names", () => {
    const files = collectFiles(APP_ROOT);
    const contents = files.map((file) => readFileSync(file, "utf8")).join("\n");
    const forbidden = [
      "@" + "seqlok/core",
      "@" + "exclave/core",
      "@" + "seqlok/",
      "Seq" + "lok",
      "rename" + "-status",
      "rename" + " status",
    ];

    expect(contents).toContain("@exclave/boundary");

    for (const pattern of forbidden) {
      expect(contents.includes(pattern)).toBe(false);
    }
  });

  it("does not add authored JavaScript module files under source, scripts, or tests", () => {
    const forbidden = ["src", "scripts", "tests"]
      .flatMap((dir) => collectAllFiles(join(APP_ROOT, dir)))
      .filter((file) => AUTHORED_JAVASCRIPT_EXTENSIONS.has(extname(file)));

    expect(forbidden).toEqual([]);
  });
});

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (
      entry.name === "dist" ||
      entry.name === "node_modules" ||
      entry.name === "coverage" ||
      entry.name === ".cache" ||
      entry.name === "generated" ||
      entry.name === "third_party" ||
      entry.name === "vendor"
    ) {
      continue;
    }

    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolute));
      continue;
    }

    if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(absolute);
    }
  }

  return files;
}

function collectAllFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectAllFiles(absolute));
      continue;
    }

    files.push(absolute);
  }

  return files;
}
