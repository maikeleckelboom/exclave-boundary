import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @fileoverview
 * Format Vitest benchmark JSON into Markdown + ASCII charts
 * for Seqlok documentation.
 *
 * This version uses a single configuration for "important" benchmarks
 * and derives both the markdown table and ASCII charts from it.
 * It also surfaces warnings when expected files or benches are missing.
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

type ChartGroup = "hotPath" | "paramWrite" | "observer";

interface MicroOpConfig {
  readonly id: string;
  readonly label: string;
  readonly fileSuffix: string;
  readonly benchPattern: string | RegExp;
  readonly chartGroups: readonly ChartGroup[];
  readonly chartLabel?: string;
}

interface MicroOpRow {
  readonly id: string;
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

/**
 * Expected micro operations and where they live.
 *
 * If you rename a bench or move it to another file:
 * - this is the only place to update
 * - missing entries will produce warnings (and can be made fatal via --strict)
 */
const MICRO_OP_CONFIG: readonly MicroOpConfig[] = [
  // Seqlock primitives
  {
    id: "seqlock-tryRead",
    label: "seqlock tryRead uncontended",
    fileSuffix: "seqlock.bench.ts",
    benchPattern: /tryRead uncontended/i,
    chartGroups: ["hotPath"],
    chartLabel: "seqlock tryRead",
  },
  {
    id: "seqlock-publish",
    label: "seqlock publish uncontended",
    fileSuffix: "seqlock.bench.ts",
    benchPattern: /publish uncontended/i,
    chartGroups: ["hotPath"],
    chartLabel: "seqlock publish",
  },

  // Controller param operations
  {
    id: "params-set-scalars",
    label: "controller.params.set (two scalars)",
    fileSuffix: "param-operations.bench.ts",
    benchPattern: /controller\.params\.set.*two scalars/i,
    chartGroups: ["hotPath", "paramWrite"],
    chartLabel: "params.set",
  },
  {
    id: "params-update-scalars",
    label: "controller.params.update (3 scalars)",
    fileSuffix: "param-operations.bench.ts",
    benchPattern: /controller\.params\.update.*3 scalars\)$/i,
    chartGroups: ["hotPath", "paramWrite"],
    chartLabel: "params.update",
  },
  {
    id: "params-update-scalars-array",
    label: "controller.params.update (3 scalars + f32[8])",
    fileSuffix: "param-operations.bench.ts",
    benchPattern: /controller\.params\.update.*3 scalars.*f32\[8\]/i,
    chartGroups: ["hotPath", "paramWrite"],
    chartLabel: "params.update+array",
  },
  {
    id: "params-hydrate-mixed",
    label: "controller.params.hydrate (3 scalars + f32[8])",
    fileSuffix: "param-operations.bench.ts",
    benchPattern: /controller\.params\.hydrate.*3 scalars.*f32\[8\]/i,
    chartGroups: ["hotPath", "paramWrite"],
    chartLabel: "params.hydrate",
  },
  {
    id: "params-stage-array",
    label: "controller.params.stage (eqBands f32[8])",
    fileSuffix: "param-operations.bench.ts",
    benchPattern: /controller\.params\.stage.*eqBands/i,
    chartGroups: ["hotPath", "paramWrite"],
    chartLabel: "params.stage",
  },
  {
    id: "params-within-scalars",
    label: "processor.params.within (scalars only)",
    fileSuffix: "param-operations.bench.ts",
    benchPattern: /processor\.params\.within.*scalars only/i,
    chartGroups: ["hotPath"],
    chartLabel: "processor.within",
  },
  {
    id: "params-within-mixed",
    label: "processor.params.within (scalars + eqBands f32[8])",
    fileSuffix: "param-operations.bench.ts",
    benchPattern: /processor\.params\.within.*scalars \+ eqBands/i,
    chartGroups: ["hotPath"],
    chartLabel: "processor.within+arr",
  },
  {
    id: "params-interleaved-update-within",
    label: "interleaved controller.update + processor.within",
    fileSuffix: "param-operations.bench.ts",
    benchPattern: /interleaved controller\.update \+ processor\.within/i,
    chartGroups: ["hotPath"],
    chartLabel: "interleaved",
  },

  // MeterWriter sugar
  {
    id: "writer-level",
    label: "meter scalar: writer.level(0.75)",
    fileSuffix: "array-vs-stage-and-meters.bench.ts",
    benchPattern: /writer\.level\(0\.75\)/i,
    chartGroups: ["hotPath"],
    chartLabel: "writer.level",
  },
  {
    id: "writer-set",
    label: "meter scalar: writer.set('level', 0.75)",
    fileSuffix: "array-vs-stage-and-meters.bench.ts",
    benchPattern: /writer\.set\('level', 0\.75\)/i,
    chartGroups: ["hotPath"],
    chartLabel: "writer.set",
  },
  {
    id: "writer-stage-array",
    label: "meter array: writer.stage('spectrum', cb)",
    fileSuffix: "array-vs-stage-and-meters.bench.ts",
    benchPattern: /writer\.stage\('spectrum', cb\)/i,
    chartGroups: ["hotPath"],
    chartLabel: "writer.stage",
  },

  // Observer reads
  {
    id: "observer-within-full",
    label: "observer.params.within (full view)",
    fileSuffix: "observer-reads.bench.ts",
    benchPattern: /params\.within\(\).*full view/i,
    chartGroups: ["observer"],
    chartLabel: "within (full view)",
  },
  {
    id: "observer-params-snapshot-full",
    label: "observer.params.snapshot (full)",
    fileSuffix: "observer-reads.bench.ts",
    benchPattern: /params\.snapshot\(\).*full spec/i,
    chartGroups: ["observer"],
    chartLabel: "snap params (full)",
  },
  {
    id: "observer-params-snapshot-partial",
    label: "observer.params.snapshot (partial, array)",
    fileSuffix: "observer-reads.bench.ts",
    benchPattern: /params\.snapshot\(\['gain'\]\).*array/i,
    chartGroups: ["observer"],
    chartLabel: "snap params (partial, array)",
  },
  {
    id: "observer-meters-snapshot-full",
    label: "observer.meters.snapshot (full)",
    fileSuffix: "observer-reads.bench.ts",
    benchPattern: /meters\.snapshot\(\).*full spec/i,
    chartGroups: ["observer"],
    chartLabel: "snap meters (full)",
  },
  {
    id: "observer-meters-snapshot-partial",
    label: "observer.meters.snapshot (partial, array)",
    fileSuffix: "observer-reads.bench.ts",
    benchPattern: /meters\.snapshot\(\['peak'\]\).*array/i,
    chartGroups: ["observer"],
    chartLabel: "snap meters (partial, array)",
  },
];

const MICRO_OP_CONFIG_BY_ID: ReadonlyMap<string, MicroOpConfig> = new Map(
  MICRO_OP_CONFIG.map((config) => [config.id, config]),
);

interface CollectWarning {
  readonly kind: "fileMissing" | "benchMissing";
  readonly context: "microOps" | "setup" | "chart";
  readonly label: string;
  readonly fileSuffix: string;
  readonly benchPattern: string;
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
  const matcher =
    typeof pattern === "string"
      ? (name: string) => name === pattern
      : (name: string) => pattern.test(name);

  for (const group of file.groups) {
    const bench = group.benchmarks.find((b) => matcher(b.name));
    if (bench) {
      return bench;
    }
  }
  return null;
}

/**
 * Collect all hot-path micro operations based on MICRO_OP_CONFIG.
 */
function collectMicroOps(
  report: BenchReport,
  warnings: CollectWarning[],
): MicroOpRow[] {
  const rows: MicroOpRow[] = [];

  for (const config of MICRO_OP_CONFIG) {
    const file = findFile(report, config.fileSuffix);
    if (!file) {
      warnings.push({
        kind: "fileMissing",
        context: "microOps",
        label: config.label,
        fileSuffix: config.fileSuffix,
        benchPattern: String(config.benchPattern),
      });
      continue;
    }

    const bench = findBenchInFile(file, config.benchPattern);
    if (!bench) {
      warnings.push({
        kind: "benchMissing",
        context: "microOps",
        label: config.label,
        fileSuffix: config.fileSuffix,
        benchPattern: String(config.benchPattern),
      });
      continue;
    }

    rows.push({
      id: config.id,
      operation: config.label,
      meanUs: bench.mean * 1_000,
      hz: bench.hz,
    });
  }

  return [...rows].sort((a, b) => a.meanUs - b.meanUs);
}

/**
 * Collect end-to-end setup benchmarks dynamically.
 */
function collectSetup(
  report: BenchReport,
  warnings: CollectWarning[],
): SetupRow[] {
  const file = findFile(report, "e2e-pipeline.bench.ts");
  if (!file) {
    warnings.push({
      kind: "fileMissing",
      context: "setup",
      label: "E2E pipeline",
      fileSuffix: "e2e-pipeline.bench.ts",
      benchPattern: "/small|medium|large spec: full setup/",
    });
    return [];
  }

  const rows: SetupRow[] = [];

  const patterns: readonly {
    readonly label: string;
    readonly pattern: RegExp;
  }[] = [
    { label: "Small spec", pattern: /small spec: full setup/i },
    { label: "Medium spec", pattern: /medium spec: full setup/i },
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
    } else {
      warnings.push({
        kind: "benchMissing",
        context: "setup",
        label,
        fileSuffix: "e2e-pipeline.bench.ts",
        benchPattern: String(pattern),
      });
    }
  }

  return rows;
}

/**
 * Chart configurations for ASCII output.
 *
 * Note: labels are doc-facing, patterns are shared with MICRO_OP_CONFIG
 * via chartGroups and chartLabel.
 */
const CHART_CONFIGS: readonly ChartConfig[] = [
  {
    title: "Hot Path Operations (µs) – lower is better",
    entries: MICRO_OP_CONFIG.filter((c) =>
      c.chartGroups.includes("hotPath"),
    ).map<ChartEntry>((c) => ({
      label: c.chartLabel ?? c.label,
      fileSuffix: c.fileSuffix,
      benchPattern: c.benchPattern,
    })),
  },
  {
    title: "Parameter Writes (µs) – lower is better",
    entries: MICRO_OP_CONFIG.filter((c) =>
      c.chartGroups.includes("paramWrite"),
    ).map<ChartEntry>((c) => ({
      label: c.chartLabel ?? c.label,
      fileSuffix: c.fileSuffix,
      benchPattern: c.benchPattern,
    })),
  },
  {
    title: "Observer Reads (µs) – lower is better",
    entries: MICRO_OP_CONFIG.filter((c) =>
      c.chartGroups.includes("observer"),
    ).map<ChartEntry>((c) => ({
      label: c.chartLabel ?? c.label,
      fileSuffix: c.fileSuffix,
      benchPattern: c.benchPattern,
    })),
  },
];

/**
 * Build chart data from configuration.
 */
function buildChart(
  report: BenchReport,
  config: ChartConfig,
  warnings: CollectWarning[],
): ChartRow[] {
  const rows: ChartRow[] = [];

  for (const entry of config.entries) {
    const file = findFile(report, entry.fileSuffix);
    if (!file) {
      warnings.push({
        kind: "fileMissing",
        context: "chart",
        label: entry.label,
        fileSuffix: entry.fileSuffix,
        benchPattern: String(entry.benchPattern),
      });
      continue;
    }

    const bench = findBenchInFile(file, entry.benchPattern);
    if (!bench) {
      warnings.push({
        kind: "benchMissing",
        context: "chart",
        label: entry.label,
        fileSuffix: entry.fileSuffix,
        benchPattern: String(entry.benchPattern),
      });
      continue;
    }

    rows.push({
      label: entry.label,
      valueUs: bench.mean * 1_000,
    });
  }

  return rows;
}

function renderAsciiChart(title: string, rows: readonly ChartRow[]): string {
  if (rows.length === 0) {
    return `${title}\n\n(no data)`;
  }

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

function renderMarkdown(
  micro: readonly MicroOpRow[],
  setup: readonly SetupRow[],
  warnings: readonly CollectWarning[],
): string {
  const lines: string[] = [];

  const runDate = new Date();
  const runIso = runDate.toISOString();
  const runLocal = runDate.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  const nodeVersion = process.versions.node;

  const hotPathTableRows = micro.filter((row) => {
    const cfg = MICRO_OP_CONFIG_BY_ID.get(row.id);
    return cfg?.chartGroups.includes("hotPath") === true;
  });

  const opHeader = "Operation";
  const meanHeader = "Mean time (µs)";
  const thrHeader = "Throughput (M ops/s)";

  const meanStrings = hotPathTableRows.map((row) => row.meanUs.toFixed(3));
  const throughputStrings = hotPathTableRows.map((row) =>
    (row.hz / 1_000_000).toFixed(2),
  );

  const operationWidth = hotPathTableRows.reduce(
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

  const microById = new Map<string, MicroOpRow>();
  for (const row of micro) {
    microById.set(row.id, row);
  }

  function getRow(id: string): MicroOpRow | undefined {
    return microById.get(id);
  }

  function getConfig(id: string): MicroOpConfig | undefined {
    return MICRO_OP_CONFIG_BY_ID.get(id);
  }

  function formatOpLabel(id: string, row: MicroOpRow | undefined): string {
    const cfg = getConfig(id);
    const label = cfg?.chartLabel ?? cfg?.label ?? row?.operation ?? id;
    return `\`${label}\``;
  }

  function ratioText(
    numerator: MicroOpRow | undefined,
    denominator: MicroOpRow | undefined,
  ): string {
    if (!numerator || !denominator) {
      return "n/a";
    }
    if (denominator.meanUs <= 0) {
      return "n/a";
    }
    const value = numerator.meanUs / denominator.meanUs;
    return value.toFixed(2);
  }

  function exampleOps(rows: readonly MicroOpRow[], limit: number): string {
    if (rows.length === 0) {
      return "none";
    }
    const sorted = [...rows].sort((a, b) => a.meanUs - b.meanUs);
    const slice = sorted.slice(0, limit);
    return slice.map((row) => `\`${row.operation}\``).join(", ");
  }

  lines.push("# Bench Results");
  lines.push("");
  lines.push(
    "> Generated from `bench-results.json` by `scripts/format-bench.ts`." +
      " Re-run `pnpm bench:report` after changing benchmarks.",
  );
  lines.push("");
  lines.push(`_Bench run (local time): ${runLocal}_`);
  lines.push("");
  lines.push(`_Bench run (ISO 8601): ${runIso}_`);
  lines.push("");
  lines.push("## Hot path micro-operations");
  lines.push(
    "_Includes seqlock primitives, controller param writes, processor reads, and MeterWriter operations. Observer reads are broken out separately below._",
  );
  lines.push("");

  if (hotPathTableRows.length > 0) {
    lines.push(
      `| ${opHeader.padEnd(operationWidth, " ")} | ${meanHeader.padStart(meanWidth, " ")} | ${thrHeader.padStart(throughputWidth, " ")} |`,
    );
    lines.push(
      `|${"-".repeat(operationWidth + 2)}|${"-".repeat(meanWidth + 1)}:|${"-".repeat(throughputWidth + 1)}:|`,
    );

    for (let i = 0; i < hotPathTableRows.length; i += 1) {
      const row = hotPathTableRows[i];
      const meanStr = meanStrings[i];
      const thrStr = throughputStrings[i];

      if (row === undefined || meanStr === undefined || thrStr === undefined) {
        throw new Error(
          `Internal error: mismatched hot-path row lengths at index ${String(
            i,
          )}`,
        );
      }

      lines.push(
        `| ${row.operation.padEnd(operationWidth, " ")} | ${meanStr.padStart(meanWidth, " ")} | ${thrStr.padStart(throughputWidth, " ")} |`,
      );
    }
  } else {
    lines.push("_(No hot-path micro-operations found in benchmark results)_");
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

  // Interpretation section – this is what makes it a "living spec"
  lines.push("");
  lines.push("## Interpretation and budgets");
  lines.push("");

  if (micro.length > 0) {
    const tier0 = micro.filter((row) => row.meanUs < 1);
    const tier1 = micro.filter((row) => row.meanUs >= 1 && row.meanUs < 100);
    const tier2 = micro.filter((row) => row.meanUs >= 100);

    lines.push("### Latency tiers");
    lines.push("");

    if (tier0.length > 0) {
      lines.push(
        `- Tier 0 (sub-microsecond): ${String(
          tier0.length,
        )} operations including ${exampleOps(tier0, 4)}.`,
      );
    }
    if (tier1.length > 0) {
      lines.push(
        `- Tier 1 (tens of microseconds): ${String(
          tier1.length,
        )} operations including ${exampleOps(tier1, 3)}.`,
      );
    }
    if (tier2.length > 0) {
      lines.push(
        `- Tier 2 (hundreds of microseconds): ${String(
          tier2.length,
        )} operations including ${exampleOps(tier2, 3)}.`,
      );
    }

    lines.push("");
  }

  // Parameter write budgets
  const paramsStage = getRow("params-stage-array");
  const paramsSet = getRow("params-set-scalars");
  const paramsUpdate = getRow("params-update-scalars");
  const paramsUpdateArray = getRow("params-update-scalars-array");
  const paramsHydrate = getRow("params-hydrate-mixed");

  const paramWriteIds = MICRO_OP_CONFIG.filter((c) =>
    c.chartGroups.includes("paramWrite"),
  ).map((c) => c.id);
  const paramWriteRows = paramWriteIds
    .map((id) => getRow(id))
    .filter((row): row is MicroOpRow => row !== undefined);

  if (paramWriteRows.length > 0) {
    lines.push("### Parameter write budgets");
    lines.push("");

    const firstParam = paramWriteRows[0];
    if (!firstParam) {
      // Should be unreachable with the length guard, but kept for type and runtime safety.
      lines.push(
        "_Internal formatter invariant violated, parameter write rows were empty._",
      );
      lines.push("");
    } else {
      let fastestParam: MicroOpRow = firstParam;
      let slowestParam: MicroOpRow = firstParam;

      for (const row of paramWriteRows) {
        if (row.meanUs < fastestParam.meanUs) {
          fastestParam = row;
        }
        if (row.meanUs > slowestParam.meanUs) {
          slowestParam = row;
        }
      }

      lines.push(
        `- Absolute costs: param writes sit between ${fastestParam.meanUs.toFixed(
          3,
        )} µs (${formatOpLabel(
          fastestParam.id,
          fastestParam,
        )}) and ${slowestParam.meanUs.toFixed(3)} µs (${formatOpLabel(
          slowestParam.id,
          slowestParam,
        )}) in this run.`,
      );

      if (paramsStage && paramsSet && paramsUpdate) {
        lines.push(
          `- Relative: ${formatOpLabel(
            "params-stage-array",
            paramsStage,
          )} is about ${ratioText(
            paramsSet,
            paramsStage,
          )}× faster than ${formatOpLabel(
            "params-set-scalars",
            paramsSet,
          )} and ${ratioText(
            paramsUpdate,
            paramsStage,
          )}× faster than ${formatOpLabel(
            "params-update-scalars",
            paramsUpdate,
          )}.`,
        );
      }

      if (paramsHydrate && paramsUpdateArray) {
        const low = Math.min(paramsHydrate.meanUs, paramsUpdateArray.meanUs);
        const high = Math.max(paramsHydrate.meanUs, paramsUpdateArray.meanUs);
        lines.push(
          `- Mixed scalar + array writes remain sub-microsecond: ${formatOpLabel(
            "params-hydrate-mixed",
            paramsHydrate,
          )} and ${formatOpLabel(
            "params-update-scalars-array",
            paramsUpdateArray,
          )} land around ${low.toFixed(3)}–${high.toFixed(3)} µs per call.`,
        );
      }

      lines.push("");
    }
  }

  // Observer param read budgets
  const observerPartialParams = getRow("observer-params-snapshot-partial");
  const observerFullParams = getRow("observer-params-snapshot-full");
  const observerWithinFull = getRow("observer-within-full");

  if (observerPartialParams || observerFullParams || observerWithinFull) {
    lines.push("### Observer param read budgets");
    lines.push("");

    if (observerPartialParams) {
      lines.push(
        `- Partial param snapshots (array form) cost about ${observerPartialParams.meanUs.toFixed(3)} µs per snapshot.`,
      );
    }
    if (observerFullParams) {
      lines.push(
        `- Full param snapshots sit around ${observerFullParams.meanUs.toFixed(3)} µs.`,
      );
    }
    if (observerWithinFull) {
      lines.push(
        `- Coherent views via ${formatOpLabel(
          "observer-within-full",
          observerWithinFull,
        )} land near ${observerWithinFull.meanUs.toFixed(3)} µs.`,
      );
    }

    if (observerPartialParams && paramsSet && paramsStage) {
      lines.push(
        `- Relative to writes: a partial param snapshot is roughly ${ratioText(
          observerPartialParams,
          paramsSet,
        )}× the cost of ${formatOpLabel(
          "params-set-scalars",
          paramsSet,
        )} and ${ratioText(
          observerPartialParams,
          paramsStage,
        )}× the cost of ${formatOpLabel("params-stage-array", paramsStage)}.`,
      );
    }

    lines.push("");
  }

  // Observer meter read budgets
  const observerPartialMeters = getRow("observer-meters-snapshot-partial");
  const observerFullMeters = getRow("observer-meters-snapshot-full");
  const writerStage = getRow("writer-stage-array");

  if (observerPartialMeters || observerFullMeters) {
    lines.push("### Observer meter read budgets");
    lines.push("");

    if (observerPartialMeters) {
      lines.push(
        `- Partial meter snapshots (array form) cost about ${observerPartialMeters.meanUs.toFixed(3)} µs.`,
      );
    }
    if (observerFullMeters) {
      lines.push(
        `- Full meter snapshots land around ${observerFullMeters.meanUs.toFixed(3)} µs.`,
      );
    }

    if (observerPartialMeters && writerStage) {
      lines.push(
        `- Compared to a write: a partial meter snapshot is roughly ${ratioText(
          observerPartialMeters,
          writerStage,
        )}× the cost of ${formatOpLabel("writer-stage-array", writerStage)}.`,
      );
    }
    if (observerPartialMeters && observerPartialParams && observerFullParams) {
      lines.push(
        `- Compared to params: meter snapshots are about ${ratioText(
          observerPartialMeters,
          observerPartialParams,
        )}× heavier than partial param snapshots and ${ratioText(
          observerPartialMeters,
          observerFullParams,
        )}× heavier than full param snapshots.`,
      );
    }

    lines.push("");
  }

  // End-to-end setup budgets
  if (setup.length > 0) {
    lines.push("### End-to-end setup budgets");
    lines.push("");

    const firstSetup = setup[0];
    if (!firstSetup) {
      lines.push(
        "_Internal formatter invariant violated, setup rows were empty._",
      );
      lines.push("");
    } else {
      let largestSetup: SetupRow = firstSetup;

      for (const row of setup) {
        if (row.meanMs > largestSetup.meanMs) {
          largestSetup = row;
        }
      }

      const blockSamples = 128;
      const sampleRateHz = 48_000;
      const blockMs = (blockSamples / sampleRateHz) * 1_000;
      const factor = blockMs / largestSetup.meanMs;

      lines.push(
        `- Largest measured setup (${largestSetup.label}) is about ${largestSetup.meanMs.toFixed(3)} ms per run.`,
      );
      lines.push(
        `- For reference, a ${String(
          blockSamples,
        )}-sample audio block at ${sampleRateHz.toLocaleString(
          "en-US",
        )} Hz is about ${blockMs.toFixed(
          3,
        )} ms, so ${largestSetup.label} is roughly ${factor.toFixed(
          1,
        )}× cheaper than processing a single block.`,
      );
      lines.push(
        "- This keeps full `spec → plan → backing → handoff → bindings` rebuilds safely on the control side rather than in the audio hot path.",
      );
      lines.push("");
    }
  }

  if (warnings.length > 0) {
    lines.push("## Formatter health");
    lines.push("");
    lines.push(
      `This run had ${String(
        warnings.length,
      )} formatting warning${warnings.length === 1 ? "" : "s"} from \`scripts/format-bench.ts\`. See the CLI output for details.`,
    );
    lines.push("");
  }

  lines.push(
    `_Note:_ numbers are from a single Node ${nodeVersion} + Vitest bench run and are meant for relative comparison, not absolute tuning.`,
  );
  lines.push("");

  return lines.join("\n");
}

function main(): void {
  // Assumes CWD is the @seqlok/core package root
  const rootDir = process.cwd();

  const defaultJsonPath = join(rootDir, "bench-results.json");
  const defaultOutPath = join(
    rootDir,
    "docs",
    "performance",
    "bench-results.generated.md",
  );
  const defaultJsonCopyDest = join(
    rootDir,
    "docs",
    "performance",
    "bench-results.json",
  );

  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const shouldClean = process.argv.includes("--clean");
  const isStrict = process.argv.includes("--strict");

  const jsonPath = args[0] ?? defaultJsonPath;
  const outPath = args[1] ?? defaultOutPath;

  const report = loadReport(jsonPath);
  const warnings: CollectWarning[] = [];

  const micro = collectMicroOps(report, warnings);
  const setup = collectSetup(report, warnings);
  const markdown = renderMarkdown(micro, setup, warnings);

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

  console.log("```");
  for (const config of CHART_CONFIGS) {
    const rows = buildChart(report, config, warnings);
    const chart = renderAsciiChart(config.title, rows);
    console.log(chart);
    console.log();
  }
  console.log("```");

  if (warnings.length > 0) {
    console.log();
    console.log("Bench format warnings:");
    for (const w of warnings) {
      const where = `${w.fileSuffix} / ${w.benchPattern}`;
      const prefix =
        w.kind === "fileMissing" ? "File not found" : "Bench not found";
      console.log(`- [${w.context}] ${prefix} for "${w.label}" in ${where}`);
    }

    if (isStrict) {
      throw new Error(
        "Bench formatting failed due to missing files or benchmarks",
      );
    }
  }
}

main();
