import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface BenchSample {
  readonly name: string;
  readonly hz: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number; // milliseconds
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

interface OpRef {
  readonly label: string;
  readonly fileSuffix: string;
  readonly groupMatch: string;
  readonly benchName: string;
}

interface ChartRow {
  readonly label: string;
  readonly valueUs: number;
}

/**
 * Load bench-results.json as a typed report.
 */
function loadReport(path: string): BenchReport {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as BenchReport;
  return parsed;
}

/**
 * Look up a single benchmark mean in µs.
 */
function findMeanUs(report: BenchReport, ref: OpRef): number {
  const file = report.files.find((f) => f.filepath.endsWith(ref.fileSuffix));
  if (!file) {
    throw new Error(`Bench file not found for suffix "${ref.fileSuffix}"`);
  }

  const group = file.groups.find((g) => g.fullName.includes(ref.groupMatch));
  if (!group) {
    throw new Error(`Group "${ref.groupMatch}" not found in file "${file.filepath}"`);
  }

  const bench = group.benchmarks.find((b) => b.name === ref.benchName);
  if (!bench) {
    throw new Error(
      `Benchmark "${ref.benchName}" not found in group "${group.fullName}"`,
    );
  }

  // JSON uses milliseconds; we want microseconds.
  return bench.mean * 1000;
}

/**
 * Render a compact left-aligned ASCII bar chart with nicely aligned numbers.
 */
function renderAsciiChart(title: string, rows: readonly ChartRow[]): string {
  const maxLabelLen = rows.reduce(
    (acc, row) => (row.label.length > acc ? row.label.length : acc),
    0,
  );
  const maxValue = rows.reduce((acc, row) => (row.valueUs > acc ? row.valueUs : acc), 0);

  const maxBarWidth = 10;

  const lines: string[] = [];
  lines.push(title);
  lines.push('');

  for (const row of rows) {
    const barLength =
      maxValue > 0 ? Math.max(1, Math.round((row.valueUs / maxValue) * maxBarWidth)) : 1;
    const bar = '█'.repeat(barLength).padEnd(maxBarWidth, ' ');
    const labelPadded = row.label.padEnd(maxLabelLen, ' ');
    const valueStr = row.valueUs.toFixed(3).padStart(7, ' ');
    lines.push(`${labelPadded}  ${bar}  ${valueStr}`);
  }

  return lines.join('\n');
}

/**
 * Define the dataset for the cost ladder chart.
 */
function buildCostLadder(report: BenchReport): ChartRow[] {
  const refs: readonly OpRef[] = [
    {
      label: 'Seqlock publish',
      fileSuffix: 'seqlock.bench.ts',
      groupMatch: 'seqlock (micro)',
      benchName: 'publish uncontended',
    },
    {
      label: 'params.stage',
      fileSuffix: 'param-operations.bench.ts',
      groupMatch: 'Parameter operations',
      benchName: 'controller.params.stage (eqBands f32[8])',
    },
    {
      label: 'writer.set',
      fileSuffix: 'array-vs-stage-and-meters.bench.ts',
      groupMatch: 'MeterWriter sugar',
      benchName: "meter scalar: writer.set('level', 0.75)",
    },
    {
      label: 'writer.level',
      fileSuffix: 'array-vs-stage-and-meters.bench.ts',
      groupMatch: 'MeterWriter sugar',
      benchName: 'meter scalar: writer.level(0.75)',
    },
    {
      label: 'Seqlock tryRead',
      fileSuffix: 'seqlock.bench.ts',
      groupMatch: 'seqlock (micro)',
      benchName: 'tryRead uncontended (spin=0, retry=0)',
    },
    {
      label: 'params.update',
      fileSuffix: 'param-operations.bench.ts',
      groupMatch: 'Parameter operations',
      benchName: 'controller.params.update (3 scalars)',
    },
    {
      label: 'params.set',
      fileSuffix: 'param-operations.bench.ts',
      groupMatch: 'Parameter operations',
      benchName: 'controller.params.set (two scalars)',
    },
    {
      label: 'params.hydrate',
      fileSuffix: 'param-operations.bench.ts',
      groupMatch: 'Parameter operations',
      benchName: 'controller.params.hydrate (3 scalars + f32[8])',
    },
    {
      label: 'params.update+array',
      fileSuffix: 'param-operations.bench.ts',
      groupMatch: 'Parameter operations',
      benchName: 'controller.params.update (3 scalars + f32[8])',
    },
    {
      label: 'processor.within',
      fileSuffix: 'param-operations.bench.ts',
      groupMatch: 'Parameter operations',
      benchName: 'processor.params.within (scalars only)',
    },
    {
      label: 'processor.within+arr',
      fileSuffix: 'param-operations.bench.ts',
      groupMatch: 'Parameter operations',
      benchName: 'processor.params.within (scalars + eqBands f32[8])',
    },
    {
      label: 'writer.stage',
      fileSuffix: 'array-vs-stage-and-meters.bench.ts',
      groupMatch: 'MeterWriter sugar',
      benchName: "meter array: writer.stage('spectrum', cb)",
    },
    {
      label: 'interleaved',
      fileSuffix: 'param-operations.bench.ts',
      groupMatch: 'Parameter operations',
      benchName: 'interleaved controller.update + processor.within',
    },
  ];

  return refs.map((ref) => ({
    label: ref.label,
    valueUs: findMeanUs(report, ref),
  }));
}

/**
 * Define the dataset for the param write strategies chart.
 */
function buildParamWriteChart(report: BenchReport): ChartRow[] {
  const refs: readonly OpRef[] = [
    {
      label: 'stage (array only)',
      fileSuffix: 'param-operations.bench.ts',
      groupMatch: 'Parameter operations',
      benchName: 'controller.params.stage (eqBands f32[8])',
    },
    {
      label: 'update (scalars)',
      fileSuffix: 'param-operations.bench.ts',
      groupMatch: 'Parameter operations',
      benchName: 'controller.params.update (3 scalars)',
    },
    {
      label: 'set (scalars)',
      fileSuffix: 'param-operations.bench.ts',
      groupMatch: 'Parameter operations',
      benchName: 'controller.params.set (two scalars)',
    },
    {
      label: 'hydrate (mixed)',
      fileSuffix: 'param-operations.bench.ts',
      groupMatch: 'Parameter operations',
      benchName: 'controller.params.hydrate (3 scalars + f32[8])',
    },
    {
      label: 'update+array',
      fileSuffix: 'param-operations.bench.ts',
      groupMatch: 'Parameter operations',
      benchName: 'controller.params.update (3 scalars + f32[8])',
    },
  ];

  return refs.map((ref) => ({
    label: ref.label,
    valueUs: findMeanUs(report, ref),
  }));
}

function main(): void {
  // Run from packages/core; bench-results.json is written there by pnpm bench:report
  const reportPath = resolve(process.cwd(), 'bench-results.json');
  const report = loadReport(reportPath);

  const costLadder = buildCostLadder(report);
  const paramWrites = buildParamWriteChart(report);

  const costChart = renderAsciiChart(
    'Hot Path Operations (µs) – lower is better',
    costLadder,
  );
  const paramChart = renderAsciiChart(
    'Parameter Writes (µs) – lower is better',
    paramWrites,
  );

  // Single Markdown block, easy to paste into docs.
  // eslint-disable-next-line no-console
  console.log('```');
  // eslint-disable-next-line no-console
  console.log(costChart);
  // eslint-disable-next-line no-console
  console.log();
  // eslint-disable-next-line no-console
  console.log(paramChart);
  // eslint-disable-next-line no-console
  console.log('```');
}

main();
