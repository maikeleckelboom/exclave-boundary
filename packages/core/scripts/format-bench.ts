import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * Locate a bench file by suffix.
 */
function findFile(report: BenchReport, needle: string): BenchFile {
  const file = report.files.find((f) => f.filepath.endsWith(needle));
  if (!file) {
    throw new Error(
      `Benchmark file ending with "${needle}" not found in bench-results.json`,
    );
  }
  return file;
}

/**
 * In all current benches, each file has exactly one group.
 * Keep this simple but explicit.
 */
function getSingleGroup(file: BenchFile): BenchGroup {
  if (file.groups.length !== 1) {
    throw new Error(
      `Expected exactly one group in "${file.filepath}", found ${String(file.groups.length)}`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return file.groups[0]!;
}

/**
 * Find a benchmark by its name within a group.
 */
function findBench(group: BenchGroup, name: string): BenchSample {
  const bench = group.benchmarks.find((b) => b.name === name);
  if (!bench) {
    throw new Error(`Benchmark "${name}" not found in group "${group.fullName}"`);
  }
  return bench;
}

/**
 * Convert throughput to mean time per operation.
 */
function meanMicrosFromHz(hz: number): number {
  if (hz <= 0) {
    throw new Error(`Invalid hz value: ${String(hz)}`);
  }
  // 1 / hz seconds per op → µs
  return 1_000_000 / hz;
}

function meanMillisFromHz(hz: number): number {
  if (hz <= 0) {
    throw new Error(`Invalid hz value: ${String(hz)}`);
  }
  // 1 / hz seconds per op → ms
  return 1_000 / hz;
}

/**
 * Collect hot-path micro operations into a flat list.
 */
function collectMicroOps(report: BenchReport): MicroOpRow[] {
  const rows: MicroOpRow[] = [];

  const seqlockFile = findFile(report, 'seqlock.bench.ts');
  const seqlockGroup = getSingleGroup(seqlockFile);

  const paramFile = findFile(report, 'param-operations.bench.ts');
  const paramGroup = getSingleGroup(paramFile);

  const metersFile = findFile(report, 'array-vs-stage-and-meters.bench.ts');
  const metersGroup = getSingleGroup(metersFile);

  const push = (operation: string, bench: BenchSample): void => {
    rows.push({
      operation,
      meanUs: meanMicrosFromHz(bench.hz),
      hz: bench.hz,
    });
  };

  // Seqlock primitives
  push(
    'Seqlock tryRead uncontended',
    findBench(seqlockGroup, 'tryRead uncontended (spin=0, retry=0)'),
  );
  push('Seqlock publish uncontended', findBench(seqlockGroup, 'publish uncontended'));

  // Controller / processor param ops
  push(
    'controller.params.set (two scalars)',
    findBench(paramGroup, 'controller.params.set (two scalars)'),
  );
  push(
    'controller.params.update (3 scalars)',
    findBench(paramGroup, 'controller.params.update (3 scalars)'),
  );
  push(
    'controller.params.update (3 scalars + f32[8])',
    findBench(paramGroup, 'controller.params.update (3 scalars + f32[8])'),
  );
  push(
    'controller.params.stage (eqBands f32[8])',
    findBench(paramGroup, 'controller.params.stage (eqBands f32[8])'),
  );
  push(
    'processor.params.within (scalars only)',
    findBench(paramGroup, 'processor.params.within (scalars only)'),
  );
  push(
    'processor.params.within (scalars + eqBands f32[8])',
    findBench(paramGroup, 'processor.params.within (scalars + eqBands f32[8])'),
  );
  push(
    'interleaved controller.update + processor.within',
    findBench(paramGroup, 'interleaved controller.update + processor.within'),
  );

  // MeterWriter sugar
  push(
    'meter scalar: writer.level(0.75)',
    findBench(metersGroup, 'meter scalar: writer.level(0.75)'),
  );
  push(
    "meter scalar: writer.set('level', 0.75)",
    findBench(metersGroup, "meter scalar: writer.set('level', 0.75)"),
  );
  push(
    "meter array: writer.stage('spectrum', cb)",
    findBench(metersGroup, "meter array: writer.stage('spectrum', cb)"),
  );

  // Sort by mean ascending for nicer tables.
  return [...rows].sort((a, b) => a.meanUs - b.meanUs);
}

/**
 * Collect end-to-end setup benchmarks.
 */
function collectSetup(report: BenchReport): SetupRow[] {
  const file = findFile(report, 'e2e-pipeline.bench.ts');
  const group = getSingleGroup(file);

  const mkRow = (label: string, benchName: string): SetupRow => {
    const bench = findBench(group, benchName);
    return {
      label,
      meanMs: meanMillisFromHz(bench.hz),
      hz: bench.hz,
    };
  };

  return [
    mkRow('Small spec', 'small spec: full setup'),
    mkRow('Medium spec', 'medium spec: full setup'),
    mkRow('Large spec', 'large spec: full setup'),
  ];
}

/**
 * Render a simple markdown performance summary.
 * This intentionally covers the "hot micro" and "E2E" parts;
 * higher-level narrative stays hand-written.
 */
function renderMarkdown(micro: MicroOpRow[], setup: SetupRow[]): string {
  const lines: string[] = [];

  const runIso = new Date().toISOString();

  lines.push('<!-- GENERATED FILE: do not edit by hand.');
  lines.push('     Regenerate via: pnpm bench:report -->');
  lines.push('');
  lines.push('# Bench Results');
  lines.push('');
  lines.push(
    '> Generated from `bench-results.json` by `scripts/format-bench.ts`.' +
      ' Re-run `pnpm bench:report` after changing benchmarks.',
  );
  lines.push('');
  lines.push(`_Bench run: ${runIso}_`);
  lines.push('');
  lines.push('## Hot path micro-operations');
  lines.push('');
  lines.push('| Operation | Mean time (µs) | Throughput (M ops/s) |');
  lines.push('| --- | ---: | ---: |');

  for (const row of micro) {
    const meanUs = row.meanUs.toFixed(3);
    const mhz = (row.hz / 1_000_000).toFixed(2);
    lines.push(`| ${row.operation} | ${meanUs} | ${mhz} |`);
  }

  lines.push('');
  lines.push('## E2E setup: `spec → plan → backing → handoff → bindings`');
  lines.push('');
  lines.push('| Spec size | Mean setup time (ms) | Setups per second |');
  lines.push('| --- | ---: | ---: |');

  for (const row of setup) {
    const meanMs = row.meanMs.toFixed(3);
    const setupsPerSec = Math.round(row.hz).toString();
    lines.push(`| ${row.label} | ${meanMs} | ${setupsPerSec} |`);
  }

  lines.push('');
  lines.push(
    '_Note:_ numbers are from a single Node 20 + Vitest bench run and are meant for relative comparison, not absolute tuning.',
  );
  lines.push('');

  return lines.join('\n');
}

function main(): void {
  const scriptDir = dirname(fileURLToPath(import.meta.url));

  const jsonPath = process.argv[2] ?? join(scriptDir, '..', 'bench-results.json');

  const outPath =
    process.argv[3] ??
    join(scriptDir, '..', 'docs', 'performance', 'bench-results.generated.md');

  const raw = readFileSync(jsonPath, 'utf8');
  const report = JSON.parse(raw) as BenchReport;

  const micro = collectMicroOps(report);
  const setup = collectSetup(report);
  const markdown = renderMarkdown(micro, setup);

  writeFileSync(outPath, markdown, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Bench summary written to ${outPath}`);
}

main();
