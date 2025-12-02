/**
 * @fileoverview
 * Core introspect hook surface.
 *
 * @remarks
 * - Core emits structured diagnostic events.
 * - Tooling packages (like @seqlok/introspect) or tests can install a sink.
 * - Core never imports counters, loggers, or external observability systems.
 */

/**
 * Names for introspect counters that core may emit events for.
 *
 * @remarks
 * This is the "ABI" between core and introspect. Prefer extending over
 * renaming, because tooling and dashboards may depend on these names.
 */
export type CoreIntrospectCounterName =
  | "degradedSnapshots"
  | "spinBudgetExhausted"
  | "retryBudgetExhausted";

/**
 * Context attached to introspect events emitted by core.
 *
 * @remarks
 * - `where` is a human-readable site identifier (e.g. "controller.meters.snapshot").
 * - `section` is used by snapshot paths to distinguish params vs meters.
 */
export interface CoreIntrospectEventContext {
  readonly where: string;
  readonly section?: "params" | "meters";
}

/**
 * Sink installed by introspect tooling or tests.
 *
 * @remarks
 * - Core never assumes a sink is present.
 * - Emission must be zero-cost when no sink is installed.
 */
export interface CoreIntrospectSink {
  readonly onCounterIncrement?: (
    name: CoreIntrospectCounterName,
    context: CoreIntrospectEventContext,
  ) => void;
}

let currentSink: CoreIntrospectSink | undefined;

/**
 * Install or clear the global introspect sink.
 *
 * @remarks
 * - Passing `undefined` disables introspect emission.
 * - Not thread-safe by design: this is dev/test/tooling only.
 */
export function installCoreIntrospectSink(
  sink: CoreIntrospectSink | undefined,
): void {
  currentSink = sink;
}

/**
 * Record an introspect counter event if a sink is installed.
 *
 * @remarks
 * - This is called by core hot paths (e.g. snapshotWithPolicy).
 * - When no sink is installed, it must be a cheap no-op.
 */
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
