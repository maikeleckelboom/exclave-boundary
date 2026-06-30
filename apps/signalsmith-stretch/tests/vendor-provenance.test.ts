import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(dirname(APP_ROOT));
const CATALOG_PATH = join(APP_ROOT, "scripts", "vendor.sources.json");
const SHA_40 = /^[0-9a-f]{40}$/u;

interface VendorCatalogEntry {
  readonly name: string;
  readonly repo: string;
  readonly ref: string;
  readonly sourceBranch?: string;
  readonly sourceTag?: string;
}

interface VendorMeta {
  readonly name: string;
  readonly requestedRef: string;
  readonly source: string;
  readonly sourceBranch?: string;
  readonly sourceTag?: string;
  readonly syncedAt?: string;
}

describe("Signalsmith vendor provenance", () => {
  it("pins Stretch and Linear in the app-local vendor catalog", () => {
    const catalog = readCatalog();
    const stretch = findEntry(catalog, "signalsmith-stretch");
    const linear = findEntry(catalog, "signalsmith-linear");

    expect(stretch.repo).toBe(
      "https://github.com/Signalsmith-Audio/signalsmith-stretch.git",
    );
    expect(stretch.sourceBranch).toBe("performance/output-seek");
    expect(stretch.ref).toMatch(SHA_40);
    expect(stretch.ref).not.toBe(stretch.sourceBranch);

    expect(linear.repo).toBe("https://github.com/Signalsmith-Audio/linear.git");
    expect(linear.sourceTag).toBe("0.3.0");
    expect(linear.ref).toBe("a436c9a53bddd65492a73f6e2dbf02af17ca8820");
  });

  it("keeps app-authored vendor and wasm tooling as .mts files", () => {
    const scripts = [
      join(APP_ROOT, "scripts", "vendor.mts"),
      join(APP_ROOT, "scripts", "build-signalsmith-wasm.mts"),
    ];

    for (const script of scripts) {
      expect(existsSync(script)).toBe(true);
      expect(extname(script)).toBe(".mts");
    }
  });

  it("does not contain authored JavaScript files in the app tree", () => {
    const forbidden = collectFiles(APP_ROOT)
      .filter((file) => [".cjs", ".js", ".mjs"].includes(extname(file)))
      .map((file) => relative(APP_ROOT, file).replaceAll("\\", "/"));

    expect(forbidden).toEqual([]);
  });

  it("records vendored provenance after the vendor script runs", () => {
    const stretchMeta = readMeta("signalsmith-stretch");
    const linearMeta = readMeta("signalsmith-linear");

    expect(stretchMeta.requestedRef).toMatch(SHA_40);
    expect(stretchMeta.sourceBranch).toBe("performance/output-seek");
    expect(linearMeta.requestedRef).toBe(
      "a436c9a53bddd65492a73f6e2dbf02af17ca8820",
    );
    expect(linearMeta.sourceTag).toBe("0.3.0");
    expect(stretchMeta.syncedAt).toBeUndefined();
    expect(linearMeta.syncedAt).toBeUndefined();
  });

  it("records the bundled demo loop provenance in third-party notices", () => {
    const notices = readFileSync(
      join(APP_ROOT, "THIRD_PARTY_NOTICES.md"),
      "utf8",
    );

    expect(notices).toContain("public/audio/signalsmith-demo-loop.wav");
    expect(notices).toContain(
      "https://signalsmith-audio.co.uk/code/stretch/demo/loop.mp3",
    );
  });

  it("keeps the boundary package file list scoped away from proof assets", () => {
    const packageJson = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages", "core", "package.json"), "utf8"),
    ) as { files?: readonly string[] };

    expect(packageJson.files ?? []).toEqual([
      "dist/**/*",
      "README.md",
      "CHANGELOG.md",
      "LICENSE",
    ]);
  });
});

function readCatalog(): readonly VendorCatalogEntry[] {
  return JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as VendorCatalogEntry[];
}

function findEntry(
  catalog: readonly VendorCatalogEntry[],
  name: string,
): VendorCatalogEntry {
  const entry = catalog.find((item) => item.name === name);
  if (!entry) {
    throw new Error(`Missing vendor catalog entry ${name}`);
  }

  return entry;
}

function readMeta(name: string): VendorMeta {
  return JSON.parse(
    readFileSync(join(APP_ROOT, "vendor", name, ".vendor-meta.json"), "utf8"),
  ) as VendorMeta;
}

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (shouldSkip(entry.name)) {
      continue;
    }

    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolute));
      continue;
    }

    files.push(absolute);
  }

  return files;
}

function shouldSkip(name: string): boolean {
  return [
    ".cache",
    "coverage",
    "dist",
    "generated",
    "node_modules",
    "third_party",
    "vendor",
  ].includes(name);
}
