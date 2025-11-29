/**
 * @fileoverview
 * Introspect data export utilities.
 *
 * @remarks
 * - Supports multiple export formats (JSON, Prometheus, CSV).
 * - Handles validation and sanitization of introspect data.
 * - Used for integrating with monitoring systems and debugging tools.
 */

import {
  createIntrospectError,
  type IntrospectCounterDetails,
} from "./errors/introspect";

import type {
  IntrospectCounterName,
  IntrospectCountersSnapshot,
} from "./counters";

/**
 * Supported export formats for introspect counters.
 */
export type IntrospectExportFormat = "json" | "prometheus" | "csv";

/**
 * Options for exporting introspect data.
 */
export interface IntrospectExportOptions {
  /**
   * Output format.
   */
  readonly format: IntrospectExportFormat;

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
 * @throws SeqlokError<'introspect.counterInvalid'>
 */
function assertValidCounterSnapshot(
  snapshot: IntrospectCountersSnapshot,
): void {
  const entries = Object.entries(snapshot) as [IntrospectCounterName, number][];

  for (const [name, value] of entries) {
    if (!Number.isFinite(value) || value < 0) {
      const details: IntrospectCounterDetails = {
        name: `export.${name}`,
        value,
      };

      throw createIntrospectError("counterInvalid", details);
    }
  }
}

/**
 * Export introspect counters to JSON format.
 */
function exportToJson(
  snapshot: IntrospectCountersSnapshot,
  options: IntrospectExportOptions,
): string {
  const data: Record<string, unknown> = { ...snapshot };

  if (options.includeTimestamp) {
    data.timestamp = Date.now();
  }

  return JSON.stringify(data, null, 2);
}

/**
 * Export introspect counters to Prometheus text format.
 */
function exportToPrometheus(
  snapshot: IntrospectCountersSnapshot,
  options: IntrospectExportOptions,
): string {
  const lines: string[] = [];
  const prefix =
    options.metricPrefix !== undefined && options.metricPrefix.length > 0
      ? `${options.metricPrefix}_`
      : "";

  const entries = Object.entries(snapshot) as [IntrospectCounterName, number][];

  for (const [name, value] of entries) {
    const metricName = `${prefix}${name}`;
    lines.push(`# HELP ${metricName} Seqlok introspect counter`);
    lines.push(`# TYPE ${metricName} counter`);
    lines.push(`${metricName} ${String(value)}`);
  }

  if (options.includeTimestamp) {
    lines.push(`# TIMESTAMP ${Date.now().toString()}`);
  }

  return lines.join("\n");
}

/**
 * Export introspect counters to CSV format.
 */
function exportToCsv(
  snapshot: IntrospectCountersSnapshot,
  options: IntrospectExportOptions,
): string {
  const header = ["name", "value"];
  if (options.includeTimestamp) {
    header.push("timestamp");
  }

  const rows: string[] = [header.join(",")];

  const timestamp = options.includeTimestamp ? Date.now() : undefined;

  const entries = Object.entries(snapshot) as [IntrospectCounterName, number][];

  for (const [name, value] of entries) {
    const base = [name, String(value)];
    if (timestamp !== undefined) {
      base.push(String(timestamp));
    }
    rows.push(base.join(","));
  }

  return rows.join("\n");
}

/**
 * Export introspect counters using the requested format.
 *
 * @throws SeqlokError<'introspect.counterInvalid'>
 */
export function exportIntrospectCounters(
  snapshot: IntrospectCountersSnapshot,
  options: IntrospectExportOptions,
): string {
  assertValidCounterSnapshot(snapshot);

  switch (options.format) {
    case "json":
      return exportToJson(snapshot, options);
    case "prometheus":
      return exportToPrometheus(snapshot, options);
    case "csv":
      return exportToCsv(snapshot, options);
  }
}
