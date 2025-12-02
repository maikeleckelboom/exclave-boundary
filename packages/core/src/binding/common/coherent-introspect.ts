/**
 * @fileoverview
 * Introspect hook surface for coherent reads.
 *
 * @remarks
 * - Binding emits structured diagnostic events.
 * - Tooling (e.g. @seqlok/introspect) or tests can install a sink.
 * - Binding never imports counters or logging directly.
 */

export type CoreIntrospectCounterName =
  | "degradedSnapshots"
  | "spinBudgetExhausted"
  | "retryBudgetExhausted";

export interface CoreIntrospectEventContext {
  readonly where: string;
  readonly section?: "params" | "meters";
}

export interface CoreIntrospectSink {
  readonly onCounterIncrement?: (
    name: CoreIntrospectCounterName,
    context: CoreIntrospectEventContext,
  ) => void;
}

let currentSink: CoreIntrospectSink | undefined;

export function installCoreIntrospectSink(
  sink: CoreIntrospectSink | undefined,
): void {
  currentSink = sink;
}

export function recordIntrospectCounter(
  name: CoreIntrospectCounterName,
  context: CoreIntrospectEventContext,
): void {
  const sink = currentSink;
  if (!sink?.onCounterIncrement) {
    return;
  }
  sink.onCounterIncrement(name, context);
}
