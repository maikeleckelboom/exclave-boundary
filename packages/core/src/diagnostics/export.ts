import { createError } from '../errors/error';

import type { DiagnosticsCounterName, DiagnosticsCountersSnapshot } from './counters';
import type { DiagnosticsCounterDetails } from '../errors/codes/diagnostics';

/**
 * Supported export formats for diagnostics counters.
 */
export type DiagnosticsExportFormat = 'json' | 'prometheus' | 'csv';

/**
 * Options for exporting diagnostics data.
 */
export interface DiagnosticsExportOptions {
  /**
   * Output format.
   */
  readonly format: DiagnosticsExportFormat;

  /**
   * Optional metric prefix for Prometheus format.
   */
  readonly metricPrefix?: string;

  /**
   * Include timestamp in export.
   */
  readonly includeTimestamp?: boolean;
}

/**
 * Validate a counter snapshot before export.
 *
 * @remarks
 * Defensive layer that catches corrupted introspection state before it
 * hits external systems.
 *
 * @throws SeqlokError<'diagnostics.counterInvalid'>
 */
function assertValidCounterSnapshot(snapshot: DiagnosticsCountersSnapshot): void {
  const entries = Object.entries(snapshot) as [DiagnosticsCounterName, number][];

  for (const [name, value] of entries) {
    if (!Number.isFinite(value) || value < 0) {
      const details: DiagnosticsCounterDetails = {
        name: `export.${name}`,
        value,
      };

      throw createError(
        'diagnostics.counterInvalid',
        'Diagnostics counter invalid',
        details,
      );
    }
  }
}

/**
 * Export diagnostics counters to JSON format.
 */
function exportToJson(
  snapshot: DiagnosticsCountersSnapshot,
  options: DiagnosticsExportOptions,
): string {
  const data: Record<string, unknown> = { ...snapshot };

  if (options.includeTimestamp) {
    data.timestamp = Date.now();
  }

  return JSON.stringify(data, null, 2);
}

/**
 * Export diagnostics counters to Prometheus text format.
 */
function exportToPrometheus(
  snapshot: DiagnosticsCountersSnapshot,
  options: DiagnosticsExportOptions,
): string {
  const prefix = options.metricPrefix ?? 'seqlok';
  const lines: string[] = [];

  const entries = Object.entries(snapshot) as [DiagnosticsCounterName, number][];

  for (const [name, value] of entries) {
    const metricName = `${prefix}_${name}`;
    lines.push(`# TYPE ${metricName} counter`);
    lines.push(`${metricName} ${String(value)}`);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Export diagnostics counters to CSV format.
 */
function exportToCsv(
  snapshot: DiagnosticsCountersSnapshot,
  options: DiagnosticsExportOptions,
): string {
  const entries = Object.entries(snapshot) as [DiagnosticsCounterName, number][];

  const rows: string[] = [];
  const includeTimestamp = options.includeTimestamp === true;

  if (includeTimestamp) {
    rows.push('timestamp,metric,value');
    const timestamp = Date.now();
    for (const [name, value] of entries) {
      rows.push(`${String(timestamp)},${name},${String(value)}`);
    }
  } else {
    rows.push('metric,value');
    for (const [name, value] of entries) {
      rows.push(`${name},${String(value)}`);
    }
  }

  return `${rows.join('\n')}\n`;
}

/**
 * Export diagnostics counters in the specified format.
 *
 * @remarks
 * Validates the snapshot first; suitable for CLIs, metrics pollers, or
 * dev tooling that periodically scrapes diagnostics.
 *
 * @throws SeqlokError<'diagnostics.counterInvalid'>
 */
export function exportDiagnosticsCounters(
  snapshot: DiagnosticsCountersSnapshot,
  options: DiagnosticsExportOptions,
): string {
  assertValidCounterSnapshot(snapshot);

  switch (options.format) {
    case 'json':
      return exportToJson(snapshot, options);
    case 'prometheus':
      return exportToPrometheus(snapshot, options);
    case 'csv':
      return exportToCsv(snapshot, options);
  }
}
