import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { get } from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, "..");
const SOURCES_PATH = path.join(SCRIPT_DIR, "vendor.sources.json");
const VENDOR_ROOT = path.join(APP_ROOT, "vendor");
const CACHE_ROOT = path.join(APP_ROOT, ".cache", "vendor");
const LICENSE_ROOT = path.join(APP_ROOT, "third_party", "licenses");
const NOTICES_PATH = path.join(APP_ROOT, "THIRD_PARTY_NOTICES.md");

const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_ATTEMPTS = 3;
const MAX_REDIRECTS = 5;
const GZIP_MAGIC = [0x1f, 0x8b] as const;

interface RepoSpec {
  readonly name: string;
  readonly repo: string;
  readonly ref: string;
  readonly includeDir: string;
  readonly extraFiles: readonly string[];
  readonly licenseFiles: readonly string[];
  readonly sourceBranch?: string;
  readonly sourceTag?: string;
}

interface VendorSummary {
  readonly name: string;
  readonly repo: string;
  readonly ref: string;
  readonly sourceBranch?: string;
  readonly sourceTag?: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return value;
}

function optionalString(
  record: JsonRecord,
  key: string,
  label: string,
): string | undefined {
  if (record[key] === undefined) {
    return undefined;
  }

  return assertString(record[key], label);
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  return value.map((item, index) =>
    assertString(item, `${label}[${index.toString()}]`),
  );
}

function validateName(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(name)) {
    throw new Error(`Invalid vendor name "${name}"`);
  }

  return name;
}

function normalizeRelativePath(input: string, label: string): string {
  if (
    path.isAbsolute(input) ||
    path.win32.isAbsolute(input) ||
    input.includes("\0")
  ) {
    throw new Error(`${label} must be a relative path: ${input}`);
  }

  const normalized = path.normalize(input).replaceAll("\\", "/");

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..")
  ) {
    throw new Error(`${label} must not escape its root: ${input}`);
  }

  return normalized;
}

function resolveInside(
  baseDir: string,
  relPath: string,
  label: string,
): string {
  const normalized = normalizeRelativePath(relPath, label);
  const target = path.resolve(baseDir, normalized);
  const relative = path.relative(baseDir, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its root: ${relPath}`);
  }

  return target;
}

function parseCatalog(value: unknown): RepoSpec[] {
  if (!Array.isArray(value)) {
    throw new Error("vendor.sources.json must be an array");
  }

  const seen = new Set<string>();
  const specs: RepoSpec[] = [];

  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      throw new Error(
        `vendor.sources.json entry ${index.toString()} must be an object`,
      );
    }

    const name = validateName(
      assertString(item.name, `entry ${index.toString()}.name`),
    );
    if (seen.has(name)) {
      throw new Error(`Duplicate vendor name "${name}"`);
    }
    seen.add(name);

    const repo = assertString(item.repo, `entry ${index.toString()}.repo`);
    const ref = assertString(item.ref, `entry ${index.toString()}.ref`);
    const includeDir = assertString(
      item.includeDir ?? "include",
      `entry ${index.toString()}.includeDir`,
    );
    const extraFiles = stringArray(
      item.extraFiles,
      `entry ${index.toString()}.extraFiles`,
    );
    const licenseFiles = stringArray(
      item.licenseFiles,
      `entry ${index.toString()}.licenseFiles`,
    );
    const sourceBranch = optionalString(
      item,
      "sourceBranch",
      `entry ${index.toString()}.sourceBranch`,
    );
    const sourceTag = optionalString(
      item,
      "sourceTag",
      `entry ${index.toString()}.sourceTag`,
    );

    normalizeRelativePath(includeDir, `entry ${index.toString()}.includeDir`);
    for (const relPath of extraFiles) {
      normalizeRelativePath(
        relPath,
        `entry ${index.toString()}.extraFiles item`,
      );
    }
    for (const relPath of licenseFiles) {
      normalizeRelativePath(
        relPath,
        `entry ${index.toString()}.licenseFiles item`,
      );
    }

    const specBase = {
      name,
      repo,
      ref,
      includeDir,
      extraFiles,
      licenseFiles,
    };
    const specWithBranch =
      sourceBranch === undefined ? specBase : { ...specBase, sourceBranch };
    const spec =
      sourceTag === undefined
        ? specWithBranch
        : { ...specWithBranch, sourceTag };
    specs.push(spec);
  }

  return specs;
}

function parseGitHubRepo(repoUrl: string): {
  readonly owner: string;
  readonly repo: string;
} {
  const match = /github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:$|[#?])/iu.exec(
    repoUrl,
  );
  const owner = match?.[1];
  const repo = match?.[2];

  if (!owner || !repo) {
    throw new Error(`Cannot parse GitHub repository URL: ${repoUrl}`);
  }

  return { owner, repo };
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function hasValidGzipMagic(filePath: string): Promise<boolean> {
  const handle = await open(filePath, "r");

  try {
    const buffer = Buffer.allocUnsafe(2);
    const result = await handle.read(buffer, 0, buffer.length, 0);

    return (
      result.bytesRead === buffer.length &&
      buffer[0] === GZIP_MAGIC[0] &&
      buffer[1] === GZIP_MAGIC[1]
    );
  } finally {
    await handle.close();
  }
}

async function validateTarball(
  filePath: string,
  expectedLength: number | undefined,
): Promise<void> {
  if (!(await hasValidGzipMagic(filePath))) {
    throw new Error(`Downloaded archive is not gzip: ${filePath}`);
  }

  if (expectedLength !== undefined) {
    const info = await stat(filePath);
    if (info.size !== expectedLength) {
      throw new Error(
        `Downloaded archive size mismatch for ${filePath}: got ${info.size.toString()}, expected ${expectedLength.toString()}`,
      );
    }
  }
}

function redirectTarget(
  location: string | readonly string[],
  fromUrl: string,
): string {
  const target = typeof location === "string" ? location : location.at(0);
  if (!target) {
    throw new Error(`Empty redirect from ${fromUrl}`);
  }

  return new URL(target, fromUrl).toString();
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function download(
  url: string,
  destFile: string,
  redirectCount = 0,
): Promise<void> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error(`Too many redirects while downloading ${url}`);
  }

  const tempFile = `${destFile}.tmp`;
  await rm(tempFile, { force: true });

  await new Promise<void>((resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, DOWNLOAD_TIMEOUT_MS);

    const request = get(
      url,
      {
        headers: {
          accept: "application/octet-stream,application/gzip,*/*",
          "user-agent": "exclave-boundary-vendor-sync",
        },
        signal: controller.signal,
      },
      (response) => {
        void (async () => {
          try {
            const status = response.statusCode ?? 0;

            if (status >= 300 && status < 400 && response.headers.location) {
              response.resume();
              clearTimeout(timeout);
              await download(
                redirectTarget(response.headers.location, url),
                destFile,
                redirectCount + 1,
              );
              resolve();
              return;
            }

            if (status !== 200) {
              response.resume();
              throw new Error(
                `HTTP ${status.toString()} while downloading ${url}`,
              );
            }

            const expectedLengthHeader = response.headers["content-length"];
            const expectedLength =
              typeof expectedLengthHeader === "string"
                ? Number(expectedLengthHeader)
                : undefined;

            await pipeline(response, createWriteStream(tempFile));
            await validateTarball(
              tempFile,
              expectedLength !== undefined && Number.isFinite(expectedLength)
                ? expectedLength
                : undefined,
            );
            await rename(tempFile, destFile);
            clearTimeout(timeout);
            resolve();
          } catch (error) {
            clearTimeout(timeout);
            await rm(tempFile, { force: true }).catch(() => undefined);
            reject(toError(error));
          }
        })();
      },
    );

    request.on("error", (error) => {
      clearTimeout(timeout);
      void rm(tempFile, { force: true }).finally(() => {
        reject(error);
      });
    });
  });
}

async function downloadTarball(
  owner: string,
  repo: string,
  ref: string,
  destFile: string,
): Promise<void> {
  const candidates = [
    `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`,
    `https://github.com/${owner}/${repo}/archive/${ref}.tar.gz`,
  ] as const;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    for (const candidate of candidates) {
      try {
        await download(candidate, destFile);
        return;
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to download ${owner}/${repo}@${ref}`);
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${String(code)}`,
        ),
      );
    });
  });
}

async function untar(tarballPath: string, extractDir: string): Promise<void> {
  await ensureDir(extractDir);
  await run("tar", ["-xzf", tarballPath, "-C", extractDir], APP_ROOT);
}

async function copyPath(
  source: string,
  dest: string,
  label: string,
): Promise<void> {
  if (!existsSync(source)) {
    throw new Error(`Missing ${label}: ${source}`);
  }

  const info = await stat(source);
  await ensureDir(path.dirname(dest));

  if (info.isDirectory()) {
    await cp(source, dest, { force: true, recursive: true });
    return;
  }

  await copyFile(source, dest);
}

async function extractedRoot(extractDir: string): Promise<string> {
  const entries = await readdir(extractDir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());

  if (directories.length !== 1) {
    throw new Error(
      `Unexpected tarball layout: expected one top-level directory, found ${directories.length.toString()}`,
    );
  }

  const directory = directories[0];
  if (!directory) {
    throw new Error("Unexpected empty tarball");
  }

  return path.join(extractDir, directory.name);
}

async function writeVendorMeta(destDir: string, spec: RepoSpec): Promise<void> {
  const meta = {
    name: spec.name,
    source: spec.repo,
    requestedRef: spec.ref,
    ...(spec.sourceBranch === undefined
      ? {}
      : { sourceBranch: spec.sourceBranch }),
    ...(spec.sourceTag === undefined ? {} : { sourceTag: spec.sourceTag }),
  };

  await writeFile(
    path.join(destDir, ".vendor-meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8",
  );
}

async function copyReadmeIfPresent(
  root: string,
  licenseDestDir: string,
): Promise<void> {
  const readme = path.join(root, "README.md");
  if (existsSync(readme)) {
    await copyFile(readme, path.join(licenseDestDir, "README.md"));
  }
}

async function vendorOne(spec: RepoSpec): Promise<VendorSummary> {
  const { owner, repo } = parseGitHubRepo(spec.repo);
  const cacheDir = path.join(CACHE_ROOT, spec.name, spec.ref);
  const tarballPath = path.join(cacheDir, `${repo}-${spec.ref}.tar.gz`);
  const extractDir = path.join(cacheDir, "extract");
  const vendorDestDir = path.join(VENDOR_ROOT, spec.name);
  const licenseDestDir = path.join(LICENSE_ROOT, spec.name);

  await ensureDir(cacheDir);

  if (!existsSync(tarballPath) || !(await hasValidGzipMagic(tarballPath))) {
    await rm(tarballPath, { force: true });
    console.log(`Downloading ${owner}/${repo}@${spec.ref}`);
    await downloadTarball(owner, repo, spec.ref, tarballPath);
  } else {
    console.log(`Using cached archive ${path.relative(APP_ROOT, tarballPath)}`);
  }

  await rm(extractDir, { force: true, recursive: true });
  await untar(tarballPath, extractDir);

  const root = await extractedRoot(extractDir);
  const includeSource = resolveInside(
    root,
    spec.includeDir,
    `${spec.name} includeDir`,
  );

  await rm(vendorDestDir, { force: true, recursive: true });
  await ensureDir(vendorDestDir);
  await copyPath(
    includeSource,
    path.join(vendorDestDir, "include"),
    `${spec.name} includeDir`,
  );

  for (const relPath of spec.extraFiles) {
    await copyPath(
      resolveInside(root, relPath, `${spec.name} extraFiles`),
      resolveInside(vendorDestDir, relPath, `${spec.name} vendor target`),
      `${spec.name} extra file ${relPath}`,
    );
  }

  await writeVendorMeta(vendorDestDir, spec);

  await rm(licenseDestDir, { force: true, recursive: true });
  await ensureDir(licenseDestDir);
  for (const relPath of spec.licenseFiles) {
    await copyPath(
      resolveInside(root, relPath, `${spec.name} licenseFiles`),
      resolveInside(licenseDestDir, relPath, `${spec.name} license target`),
      `${spec.name} license file ${relPath}`,
    );
  }
  await copyReadmeIfPresent(root, licenseDestDir);

  return {
    name: spec.name,
    repo: spec.repo,
    ref: spec.ref,
    ...(spec.sourceBranch === undefined
      ? {}
      : { sourceBranch: spec.sourceBranch }),
    ...(spec.sourceTag === undefined ? {} : { sourceTag: spec.sourceTag }),
  };
}

async function writeNotices(summary: readonly VendorSummary[]): Promise<void> {
  const lines = [
    "# Third-Party Notices",
    "",
    "This app includes vendored third-party source code. Full license texts are mirrored under `third_party/licenses/`.",
    "",
  ];

  for (const item of summary) {
    const origin = item.sourceBranch
      ? ` from branch ${item.sourceBranch}`
      : item.sourceTag
        ? ` from tag ${item.sourceTag}`
        : "";
    lines.push(`- **${item.name}** - ${item.repo}@${item.ref}${origin}`);
  }

  lines.push("");
  lines.push(
    "The app also includes `public/audio/signalsmith-demo-loop.wav`, converted from the official Signalsmith Stretch Web Audio demo `loop.mp3` at https://signalsmith-audio.co.uk/code/stretch/demo/loop.mp3 for comparison testing. The source MP3 had no embedded title or artist metadata.",
  );
  await writeFile(NOTICES_PATH, `${lines.join("\n")}\n`, "utf8");
}

async function main(): Promise<void> {
  await ensureDir(VENDOR_ROOT);
  await ensureDir(CACHE_ROOT);
  await ensureDir(LICENSE_ROOT);

  const catalog = parseCatalog(
    JSON.parse(await readFile(SOURCES_PATH, "utf8")) as unknown,
  );
  const summary: VendorSummary[] = [];

  console.log("Vendor sync: Signalsmith sources");
  for (const spec of catalog) {
    console.log(`\n${spec.name}`);
    summary.push(await vendorOne(spec));
  }

  await writeNotices(summary);
  console.log("\nVendor sync complete");
}

await main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
