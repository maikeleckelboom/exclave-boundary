import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @fileoverview
 * Format Vitest benchmark JSON into Markdown + ASCII charts
 * for Seqlok documentation.
 *
 * This version introspects the benchmark structure dynamically
 * and derives markdown tables + console-friendly ASCII charts.
 */

interface BenchSample {
  readonly name: string;
  readonly hz: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p75: number;
  readonly p99: number;
  readonly p995: number;
  readonly p999: number;
}

interface BenchGroup {
  readonly fullName: string;
  readonly benchmarks: readonly BenchSample[];
}

interface BenchFile {
  readonly filepath: string;
  readonly groups: readonly BenchGroup[];
}

interface BenchReport {
  readonly files: readonly BenchFile[];
}

interface MicroOpRow {
  readonly operation: string;
  readonly meanUs: number;
  readonly hz: number;
}

interface SetupRow {
  readonly label: string;
  readonly meanMs: number;
  readonly hz: number;
}

interface ChartRow {
  readonly label: string;
  readonly valueUs: number;
}

/**
 * Chart configuration: defines which benchmarks to include and how to label them.
 */
interface ChartConfig {
  readonly title: string;
  readonly entries: readonly ChartEntry[];
}

interface ChartEntry {
  readonly label: string;
  readonly fileSuffix: string;
  readonly benchPattern: string | RegExp;
}

function loadReport(path: string): BenchReport {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as BenchReport;
}

function findFile(report: BenchReport, needle: string): BenchFile | null {
  return report.files.find((f) => f.filepath.endsWith(needle)) ?? null;
}

function findBenchInFile(
  file: BenchFile,
  pattern: string | RegExp,
): BenchSample | null {
  for (const group of file.groups) {
    const matcher =
      typeof pattern === "string"
        ? (name: string) => name === pattern
        : (name: string) => pattern.test(name);

    const bench = group.benchmarks.find((b) => matcher(b.name));
    if (bench) {
      return bench;
    }
  }
  return null;
}

/**
 * Collect all hot-path micro operations dynamically from known benchmark files.
 */
function collectMicroOps(report: BenchReport): MicroOpRow[] {
  const rows: MicroOpRow[] = [];

  const tryAdd = (
    operation: string,
    fileSuffix: string,
    benchPattern: string | RegExp,
  ): void => {
    const file = findFile(report, fileSuffix);
    if (!file) {
      return;
    }

    const bench = findBenchInFile(file, benchPattern);
    if (!bench) {
      return;
    }

    rows.push({
      operation,
      meanUs: bench.mean * 1_000,
      hz: bench.hz,
    });
  };

  // Seqlock primitives
  tryAdd(
    "seqlock tryRead uncontended",
    "seqlock.bench.ts",
    /tryRead uncontended/i,
  );
  tryAdd(
    "seqlock publish uncontended",
    "seqlock.bench.ts",
    /publish uncontended/i,
  );

  // Controller param operations
  tryAdd(
    "controller.params.set (two scalars)",
    "param-operations.bench.ts",
    /controller\.params\.set.*two scalars/i,
  );
  tryAdd(
    "controller.params.update (3 scalars)",
    "param-operations.bench.ts",
    /controller\.params\.update.*3 scalars\)$/i,
  );
  tryAdd(
    "controller.params.update (3 scalars + f32[8])",
    "param-operations.bench.ts",
    /controller\.params\.update.*3 scalars.*f32\[8\]/i,
  );
  tryAdd(
    "controller.params.hydrate (3 scalars + f32[8])",
    "param-operations.bench.ts",
    /controller\.params\.hydrate.*3 scalars.*f32\[8\]/i,
  );
  tryAdd(
    "controller.params.stage (eqBands f32[8])",
    "param-operations.bench.ts",
    /controller\.params\.stage.*eqBands/i,
  );
  tryAdd(
    "processor.params.within (scalars only)",
    "param-operations.bench.ts",
    /processor\.params\.within.*scalars only/i,
  );
  tryAdd(
    "processor.params.within (scalars + eqBands f32[8])",
    "param-operations.bench.ts",
    /processor\.params\.within.*scalars \+ eqBands/i,
  );
  tryAdd(
    "interleaved controller.update + processor.within",
    "param-operations.bench.ts",
    /interleaved controller\.update \+ processor\.within/i,
  );

  // MeterWriter sugar
  tryAdd(
    "meter scalar: writer.level(0.75)",
    "array-vs-stage-and-meters.bench.ts",
    /writer\.level\(0\.75\)/i,
  );
  tryAdd(
    "meter scalar: writer.set('level', 0.75)",
    "array-vs-stage-and-meters.bench.ts",
    /writer\.set\('level', 0\.75\)/i,
  );
  tryAdd(
    "meter array: writer.stage('spectrum', cb)",
    "array-vs-stage-and-meters.bench.ts",
    /writer\.stage\('spectrum', cb\)/i,
  );

  // Observer reads (updated to match current names)
  tryAdd(
    "observer.params.within (full view)",
    "observer-reads.bench.ts",
    /params\.within\(\).*full view/i,
  );
  tryAdd(
    "observer.params.snapshot (full)",
    "observer-reads.bench.ts",
    /params\.snapshot\(\).*full spec/i,
  );
  tryAdd(
    "observer.params.snapshot (partial)",
    "observer-reads.bench.ts",
    /params\.snapshot\(\['gain'\]\).*partial/i,
  );
  tryAdd(
    "observer.meters.snapshot (full)",
    "observer-reads.bench.ts",
    /meters\.snapshot\(\).*full spec/i,
  );
  tryAdd(
    "observer.meters.snapshot (partial)",
    "observer-reads.bench.ts",
    /meters\.snapshot\(\['peak'\]\).*partial/i,
  );

  return [...rows].sort((a, b) => a.meanUs - b.meanUs);
}

/**
 * Collect end-to-end setup benchmarks dynamically.
 */
function collectSetup(report: BenchReport): SetupRow[] {
  const file = findFile(report, "e2e-pipeline.bench.ts");
  if (!file) {
    return [];
  }

  const rows: SetupRow[] = [];

  const patterns = [
    { label: "Small spec", pattern: /small spec: full setup/i },
    {
      label: "Medium spec",
      pattern: /medium spec: full setup/i,
    },
    { label: "Large spec", pattern: /large spec: full setup/i },
  ];

  for (const { label, pattern } of patterns) {
    const bench = findBenchInFile(file, pattern);
    if (bench) {
      rows.push({
        label,
        meanMs: bench.mean,
        hz: bench.hz,
      });
    }
  }

  return rows;
}

/**
 * Build chart data from configuration.
 */
function buildChart(report: BenchReport, config: ChartConfig): ChartRow[] {
  const rows: ChartRow[] = [];

  for (const entry of config.entries) {
    const file = findFile(report, entry.fileSuffix);
    if (!file) {
      continue;
    }

    const bench = findBenchInFile(file, entry.benchPattern);
    if (!bench) {
      continue;
    }

    rows.push({
      label: entry.label,
      valueUs: bench.mean * 1_000,
    });
  }

  return rows;
}

/**
 * Chart configurations for ASCII output.
 *
 * Note: labels are doc-facing, patterns are tightly matched
 * to current benchmark names.
 */
const CHART_CONFIGS: readonly ChartConfig[] = [
  {
    title: "Hot Path Operations (µs) – lower is better",
    entries: [
      {
        label: "seqlock publish",
        fileSuffix: "seqlock.bench.ts",
        benchPattern: /publish uncontended/i,
      },
      {
        label: "params.stage",
        fileSuffix: "param-operations.bench.ts",
        benchPattern: /controller\.params\.stage.*eqBands/i,
      },
      {
        label: "writer.set",
        fileSuffix: "array-vs-stage-and-meters.bench.ts",
        benchPattern: /writer\.set\('level', 0\.75\)/i,
      },
      {
        label: "writer.level",
        fileSuffix: "array-vs-stage-and-meters.bench.ts",
        benchPattern: /writer\.level\(0\.75\)/i,
      },
      {
        label: "seqlock tryRead",
        fileSuffix: "seqlock.bench.ts",
        benchPattern: /tryRead uncontended/i,
      },
      {
        label: "params.update",
        fileSuffix: "param-operations.bench.ts",
        benchPattern: /controller\.params\.update.*3 scalars\)$/i,
      },
      {
        label: "params.set",
        fileSuffix: "param-operations.bench.ts",
        benchPattern: /controller\.params\.set.*two scalars/i,
      },
      {
        label: "params.hydrate",
        fileSuffix: "param-operations.bench.ts",
        benchPattern: /controller\.params\.hydrate/i,
      },
      {
        label: "params.update+array",
        fileSuffix: "param-operations.bench.ts",
        benchPattern: /controller\.params\.update.*3 scalars.*f32\[8\]/i,
      },
      {
        label: "processor.within",
        fileSuffix: "param-operations.bench.ts",
        benchPattern: /processor\.params\.within.*scalars only/i,
      },
      {
        label: "processor.within+arr",
        fileSuffix: "param-operations.bench.ts",
        benchPattern: /processor\.params\.within.*scalars \+ eqBands/i,
      },
      {
        label: "writer.stage",
        fileSuffix: "array-vs-stage-and-meters.bench.ts",
        benchPattern: /writer\.stage\('spectrum', cb\)/i,
      },
      {
        label: "interleaved",
        fileSuffix: "param-operations.bench.ts",
        benchPattern: /interleaved controller\.update \+ processor\.within/i,
      },
    ],
  },
  {
    title: "Parameter Writes (µs) – lower is better",
    entries: [
      {
        label: "stage (array only)",
        fileSuffix: "param-operations.bench.ts",
        benchPattern: /controller\.params\.stage.*eqBands/i,
      },
      {
        label: "update (scalars)",
        fileSuffix: "param-operations.bench.ts",
        benchPattern: /controller\.params\.update.*3 scalars\)$/i,
      },
      {
        label: "set (scalars)",
        fileSuffix: "param-operations.bench.ts",
        benchPattern: /controller\.params\.set.*two scalars/i,
      },
      {
        label: "hydrate (mixed)",
        fileSuffix: "param-operations.bench.ts",
        benchPattern: /controller\.params\.hydrate/i,
      },
      {
        label: "update+array",
        fileSuffix: "param-operations.bench.ts",
        benchPattern: /controller\.params\.update.*3 scalars.*f32\[8\]/i,
      },
    ],
  },
  {
    title: "Observer Reads (µs) – lower is better",
    entries: [
      {
        label: "within (full view)",
        fileSuffix: "observer-reads.bench.ts",
        benchPattern: /params\.within\(\).*full view/i,
      },
      {
        label: "snap params (partial)",
        fileSuffix: "observer-reads.bench.ts",
        benchPattern: /params\.snapshot\(\['gain'\]\).*partial/i,
      },
      {
        label: "snap params (full)",
        fileSuffix: "observer-reads.bench.ts",
        benchPattern: /params\.snapshot\(\).*full spec/i,
      },
      {
        label: "snap meters (partial)",
        fileSuffix: "observer-reads.bench.ts",
        benchPattern: /meters\.snapshot\(\['peak'\]\).*partial/i,
      },
      {
        label: "snap meters (full)",
        fileSuffix: "observer-reads.bench.ts",
        benchPattern: /meters\.snapshot\(\).*full spec/i,
      },
    ],
  },
];

function renderAsciiChart(title: string, rows: readonly ChartRow[]): string {
  if (rows.length === 0) {
    return `${title}\n\n(no data)`;
  }

  // Sort by ascending time (fastest first)
  const sorted = [...rows].sort((a, b) => a.valueUs - b.valueUs);

  const maxLabelLen = sorted.reduce(
    (acc, row) => (row.label.length > acc ? row.label.length : acc),
    0,
  );
  const maxValue = sorted.reduce(
    (acc, row) => (row.valueUs > acc ? row.valueUs : acc),
    0,
  );

  const maxBarWidth = 20;
  const lines: string[] = [title, ""];

  for (const row of sorted) {
    const barLength =
      maxValue > 0
        ? Math.max(1, Math.round((row.valueUs / maxValue) * maxBarWidth))
        : 1;
    const bar = "█".repeat(barLength).padEnd(maxBarWidth, " ");
    const labelPadded = row.label.padEnd(maxLabelLen, " ");
    const valueStr = row.valueUs.toFixed(3).padStart(7, " ");
    lines.push(`${labelPadded}  ${bar}  ${valueStr}`);
  }

  return lines.join("\n");
}

function renderMarkdown(micro: MicroOpRow[], setup: SetupRow[]): string {
  const lines: string[] = [];
  const runIso = new Date().toISOString();

  const opHeader = "Operation";
  const meanHeader = "Mean time (µs)";
  const thrHeader = "Throughput (M ops/s)";

  const meanStrings = micro.map((row) => row.meanUs.toFixed(3));
  const throughputStrings = micro.map((row) => (row.hz / 1_000_000).toFixed(2));

  const operationWidth = micro.reduce(
    (acc, row) => (row.operation.length > acc ? row.operation.length : acc),
    opHeader.length,
  );

  let meanWidth = meanHeader.length;
  for (const value of meanStrings) {
    if (value.length > meanWidth) {
      meanWidth = value.length;
    }
  }

  let throughputWidth = thrHeader.length;
  for (const value of throughputStrings) {
    if (value.length > throughputWidth) {
      throughputWidth = value.length;
    }
  }

  const specHeader = "Spec size";
  const setupHeader = "Mean setup time (ms)";
  const setupsPerSecHeader = "Setups per second";

  const specStrings = setup.map((row) => row.label);
  const setupMeanStrings = setup.map((row) => row.meanMs.toFixed(3));
  const setupsPerSecStrings = setup.map((row) => Math.round(row.hz).toString());

  let specWidth = specHeader.length;
  for (const value of specStrings) {
    if (value.length > specWidth) {
      specWidth = value.length;
    }
  }

  let setupWidth = setupHeader.length;
  for (const value of setupMeanStrings) {
    if (value.length > setupWidth) {
      setupWidth = value.length;
    }
  }

  let setupsPerSecWidth = setupsPerSecHeader.length;
  for (const value of setupsPerSecStrings) {
    if (value.length > setupsPerSecWidth) {
      setupsPerSecWidth = value.length;
    }
  }

  lines.push("");
  lines.push("");
  lines.push("# Bench Results");
  lines.push("");
  lines.push(
    "> Generated from `bench-results.json` by `scripts/format-bench.ts`." +
      " Re-run `pnpm bench:report` after changing benchmarks.",
  );
  lines.push("");
  lines.push(`_Bench run: ${runIso}_`);
  lines.push("");
  lines.push("## Hot path micro-operations");
  lines.push("");

  if (micro.length > 0) {
    lines.push(
      `| ${opHeader.padEnd(operationWidth, " ")} | ${meanHeader.padStart(meanWidth, " ")} | ${thrHeader.padStart(throughputWidth, " ")} |`,
    );
    lines.push(
      `|${"-".repeat(operationWidth + 2)}|${"-".repeat(meanWidth + 1)}:|${"-".repeat(throughputWidth + 1)}:|`,
    );

    for (let i = 0; i < micro.length; i += 1) {
      const row = micro[i];
      const meanStr = meanStrings[i];
      const thrStr = throughputStrings[i];

      if (row === undefined || meanStr === undefined || thrStr === undefined) {
        throw new Error(
          `Internal error: mismatched micro row lengths at index ${String(i)}`,
        );
      }

      lines.push(
        `| ${row.operation.padEnd(operationWidth, " ")} | ${meanStr.padStart(meanWidth, " ")} | ${thrStr.padStart(throughputWidth, " ")} |`,
      );
    }
  } else {
    lines.push("_(No micro-operations found in benchmark results)_");
  }

  lines.push("");
  lines.push("## E2E setup: `spec → plan → backing → handoff → bindings`");
  lines.push("");

  if (setup.length > 0) {
    lines.push(
      `| ${specHeader.padEnd(specWidth, " ")} | ${setupHeader.padStart(setupWidth, " ")} | ${setupsPerSecHeader.padStart(setupsPerSecWidth, " ")} |`,
    );
    lines.push(
      `|${"-".repeat(specWidth + 2)}|${"-".repeat(setupWidth + 1)}:|${"-".repeat(setupsPerSecWidth + 1)}:|`,
    );

    for (let i = 0; i < setup.length; i += 1) {
      const row = setup[i];
      const meanStr = setupMeanStrings[i];
      const perSecStr = setupsPerSecStrings[i];

      if (
        row === undefined ||
        meanStr === undefined ||
        perSecStr === undefined
      ) {
        throw new Error(
          `Internal error: mismatched setup row lengths at index ${String(i)}`,
        );
      }

      lines.push(
        `| ${row.label.padEnd(specWidth, " ")} | ${meanStr.padStart(setupWidth, " ")} | ${perSecStr.padStart(setupsPerSecWidth, " ")} |`,
      );
    }
  } else {
    lines.push("_(No E2E setup benchmarks found in results)_");
  }

  lines.push("");
  lines.push(
    "_Note:_ numbers are from a single Node 20 + Vitest bench run and are meant for relative comparison, not absolute tuning.",
  );
  lines.push("");

  return lines.join("\n");
}

function main(): void {
  const scriptDir = dirname(fileURLToPath(import.meta.url));

  const defaultJsonPath = join(scriptDir, "..", "bench-results.json");
  const defaultOutPath = join(
    scriptDir,
    "..",
    "docs",
    "performance",
    "bench-results.generated.md",
  );
  const defaultJsonCopyDest = join(
    scriptDir,
    "..",
    "docs",
    "performance",
    "bench-results.json",
  );

  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const shouldClean = process.argv.includes("--clean");

  const jsonPath = args[0] ?? defaultJsonPath;
  const outPath = args[1] ?? defaultOutPath;

  const report = loadReport(jsonPath);

  const micro = collectMicroOps(report);
  const setup = collectSetup(report);
  const markdown = renderMarkdown(micro, setup);

  writeFileSync(outPath, markdown, "utf8");
  console.log(`Bench summary written to ${outPath}`);

  if (args[0] === undefined) {
    try {
      copyFileSync(jsonPath, defaultJsonCopyDest);
      console.log(`Bench JSON copied to ${defaultJsonCopyDest}`);

      if (shouldClean) {
        unlinkSync(jsonPath);
        console.log(`Cleaned up source file: ${jsonPath}`);
      }
    } catch (err) {
      console.log(
        `Warning: could not copy bench JSON from ${jsonPath} to ${defaultJsonCopyDest}`,
        err,
      );
    }
  }

  // ASCII charts to stdout for quick visual inspection
  console.log("```");
  for (const config of CHART_CONFIGS) {
    const rows = buildChart(report, config);
    const chart = renderAsciiChart(config.title, rows);
    console.log(chart);
    console.log();
  }
  console.log("```");
}

main();
