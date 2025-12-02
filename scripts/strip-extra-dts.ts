import { promises as fs } from "node:fs";
import * as path from "node:path";

async function stripInDist(distRoot: string): Promise<number> {
  let removed = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const isDts = entry.name.endsWith(".d.ts");
      const isDtsMap = entry.name.endsWith(".d.ts.map");

      if (!isDts && !isDtsMap) {
        continue;
      }

      const rel = path.relative(distRoot, fullPath).replace(/\\/g, "/");

      if (rel === "index.d.ts" || rel === "index.d.ts.map") {
        // keep the single bundled entry point
        continue;
      }

      await fs.unlink(fullPath);
      removed += 1;
    }
  }

  try {
    await walk(distRoot);
  } catch (error) {
    const maybeErr = error as { code?: string };
    if (maybeErr.code === "ENOENT") {
      // No dist folder for this package, nothing to do.
      return removed;
    }
    throw error;
  }

  return removed;
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const packagesDir = path.join(repoRoot, "packages");

  const entries = await fs.readdir(packagesDir, { withFileTypes: true });
  const packageDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name));

  const results: Array<{ pkg: string; removed: number }> = [];

  for (const pkgDir of packageDirs) {
    const distRoot = path.join(pkgDir, "dist");
    const removed = await stripInDist(distRoot);
    if (removed > 0) {
      results.push({
        pkg: path.basename(pkgDir),
        removed,
      });
    }
  }

  if (results.length === 0) {
    console.log("[strip-extra-dts] No extra .d.ts files found.");
    return;
  }

  for (const { pkg, removed } of results) {
    console.log(
      `[strip-extra-dts] ${pkg}: removed ${removed} extra .d.ts / .d.ts.map files`,
    );
  }
}

void main().catch((error) => {
  console.error("[strip-extra-dts] Failed:", error);
  process.exitCode = 1;
});
