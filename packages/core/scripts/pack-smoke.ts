import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

function run(command: string, args: readonly string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runPnpm(args: readonly string[], cwd: string): string {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return run(process.execPath, [npmExecPath, ...args], cwd);
  }

  return run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, cwd);
}

function assertNoWorkspaceDeps(
  label: string,
  deps: Record<string, string> | undefined,
): void {
  for (const [name, version] of Object.entries(deps ?? {})) {
    if (version.startsWith("workspace:")) {
      throw new Error(`${label} contains workspace dependency ${name}`);
    }
  }
}

function assertNoProofFiles(tarballPath: string, packageRoot: string): void {
  const contents = run("tar", ["-tf", tarballPath], packageRoot)
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);
  const forbidden = contents.filter(
    (entry) =>
      entry.includes("apps/signalsmith-stretch/") ||
      entry.includes("signalsmith-stretch/vendor/") ||
      entry.includes("signalsmith-stretch/generated/"),
  );

  if (forbidden.length > 0) {
    throw new Error(
      `@exclave/boundary tarball contains private proof files:\n${forbidden.join("\n")}`,
    );
  }
}

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempRoot = mkdtempSync(join(tmpdir(), "exclave-boundary-pack-"));

try {
  const packOutput = runPnpm(
    ["pack", "--pack-destination", tempRoot],
    packageRoot,
  );
  const tarballName = packOutput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.endsWith(".tgz"));

  if (!tarballName) {
    throw new Error(`pnpm pack did not report a tarball:\n${packOutput}`);
  }

  const tarballPath = isAbsolute(tarballName)
    ? tarballName
    : join(tempRoot, tarballName);
  assertNoProofFiles(tarballPath, packageRoot);

  const consumerRoot = join(tempRoot, "consumer");
  mkdirSync(consumerRoot);
  const tarballSpec = `file:${relative(consumerRoot, tarballPath).replace(
    /\\/gu,
    "/",
  )}`;

  writeFileSync(
    join(consumerRoot, "smoke.mjs"),
    `
import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout
} from "@exclave/boundary";

const spec = defineSpec(({ param, meter }) => ({
  params: {
    nested: {
      count: param.u32({ min: 0, max: 0xffffffff }),
      words: param.u32.array(2)
    }
  },
  meters: {
    signed: meter.i32()
  }
}));
const plan = planLayout(spec);
const backing = allocateShared(plan);
const controller = bindController(spec, plan, backing);
const processor = bindProcessor(buildHandoff(plan, backing));

controller.params.set("nested.count", 7);
controller.params.stage("nested.words", (view) => view.set([1, 2]));
processor.params.within((params) => {
  if (params.nested.count !== 7 || params.nested.words[1] !== 2) {
    throw new Error("packed @exclave/boundary param flow failed");
  }
});
processor.meters.publish((meters) => meters.signed(-3));
if (controller.meters.snapshot().signed !== -3) {
  throw new Error("packed @exclave/boundary meter flow failed");
}
`.trimStart(),
  );

  writeFileSync(
    join(consumerRoot, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "@exclave/boundary": tarballSpec,
        },
      },
      null,
      2,
    ),
  );

  runPnpm(["install", "--ignore-scripts"], consumerRoot);

  const installedPackageJson = JSON.parse(
    readFileSync(
      join(
        consumerRoot,
        "node_modules",
        "@exclave",
        "boundary",
        "package.json",
      ),
      "utf8",
    ),
  ) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  assertNoWorkspaceDeps("dependencies", installedPackageJson.dependencies);
  assertNoWorkspaceDeps(
    "optionalDependencies",
    installedPackageJson.optionalDependencies,
  );
  assertNoWorkspaceDeps(
    "peerDependencies",
    installedPackageJson.peerDependencies,
  );

  run(process.execPath, ["smoke.mjs"], consumerRoot);
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
