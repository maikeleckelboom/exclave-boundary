# @seqlok/introspect

`@seqlok/introspect` is the observability and analysis sidecar for Seqlok.

It is for:

- counters
- budgets
- health checks
- sink installation
- session tracking
- feature flags for tooling paths
- error registry export and subset selection
- UI-friendly and tooling-friendly inspection helpers

It is **not** for hot-path runtime logic.

If `@seqlok/diagnostics` is where runtime code publishes bounded telemetry structures, `@seqlok/introspect` is where tooling, tests, dashboards, and export pipelines interpret and package what they see.

---

## What belongs here

- counters and snapshots of counters
- introspect budgets and validation
- sink installation for events emitted by core
- dev/test session lifecycle helpers
- threshold and health wrappers
- error registry aggregation and JSON/schema export
- subset selection for boundary-safe or fatal-core views
- feature toggles for tooling paths

## What does not belong here

- hot-path RT publishing logic
- shared-memory primitive mechanics
- param/meter binding ownership
- product-specific UI models
- domain semantics like tracks, decks, BPM, cues, or host policy
- telemetry schemas that must be writable from runtime code

If runtime code must publish it with bounded work and zero allocations, it belongs lower, typically in `@seqlok/diagnostics`, not here.

---

## Runtime vs tooling split

Seqlok diagnostics is intentionally split in two.

### `@seqlok/diagnostics`

Runtime-side telemetry structures.

Examples:

- SAB rings
- snapshot record layouts
- RT writers
- host readers for those specific layouts

### `@seqlok/introspect`

Tooling-side interpretation and export.

Examples:

- counters
- health envelopes
- sink installation
- session timing
- error registry exports
- subset selection and UI-friendly inspection

That split keeps runtime publication bounded and keeps higher-level analysis out of the hot path.

---

## Current public surface

Today this package exports these families of things.

### 1. Budgets

```ts
createIntrospectBudgets(...)
validateIntrospectBudgets(...)
DEFAULT_INTROSPECT_BUDGETS
```

Use these to define and validate introspection budgets for tooling and health-oriented paths.

### 2. Counters

```ts
incrementCounter(...)
setCounter(...)
resetCounters(...)
snapshotCounters(...)
```

And the related types:

- `IntrospectCounterName`
- `IntrospectCounters`
- `IntrospectCountersSnapshot`

These are for lightweight aggregation of observability state, not for driving core behavior.

### 3. Export helpers

```ts
exportIntrospectCounters(...)
```

This gives tooling a stable outward-facing representation for counter snapshots.

### 4. Feature toggles

```ts
enableIntrospectFeature(...)
enableIntrospectFeatureByName(...)
isIntrospectFeatureEnabled(...)
listEnabledIntrospectFeatures(...)
resetIntrospectFeatures(...)
```

These are for tooling paths and experiments.
They are not a replacement for product configuration.

### 5. Core sink bridge

```ts
installCoreIntrospectSink(...)
recordIntrospectCounter(...)
```

And the related types:

- `CoreIntrospectCounterName`
- `CoreIntrospectEventContext`
- `CoreIntrospectSink`

This is the bridge between `@seqlok/core` emitting structured introspect events and tooling choosing to receive them.
When no sink is installed, the emission path is meant to stay cheap.

### 6. Session lifecycle

```ts
startIntrospectSession(...)
endIntrospectSession(...)
getActiveIntrospectSession(...)
getIntrospectSessionDuration(...)
```

Use this for devtools sessions, stress runs, or explicit analysis windows.

### 7. Health wrappers

```ts
runWithIntrospectSync(...)
runWithIntrospect(...)
checkIntrospectThresholds(...)
```

And the related types:

- `ThresholdViolation`
- `RunWithIntrospectOptions`
- `IntrospectThresholds`
- `RunWithIntrospectResult`

These helpers are for packaging execution results with threshold and health information.
They are for tooling and integration surfaces, not the hot path.

### 8. Error registry export

```ts
exportErrorRegistryJsonSchema(...)
buildErrorRegistryJson(...)
buildFullErrorRegistryJson(...)
listErrors(...)
computeNumericCode(...)
selectErrorSubset(...)
```

And the related schema/export types:

- `ErrorRegistrySchema`
- `ErrorCodeSchema`
- `ErrorMetaSchema`
- `JsonSchemaDocument`
- `DomainSchema`
- `RegistryStats`
- `AggregatedErrorDescriptor`
- `SubsetSelectionCriteria`
- `ErrorSubset`
- `SelectedDomain`
- `ExportedError`
- `ExportedDomain`
- `ErrorRegistryJson`

This is the package that turns the distributed Seqlok error universe into tooling-safe artifacts and exportable snapshots.

---

## Counter example

```ts
import {
  incrementCounter,
  snapshotCounters,
  resetCounters,
} from "@seqlok/introspect";

incrementCounter("degradedSnapshots");
incrementCounter("degradedSnapshots");

console.log(snapshotCounters());

resetCounters();
```

This is useful for dev overlays, tests, and stress harnesses.

---

## Sink example

```ts
import {
  installCoreIntrospectSink,
  type CoreIntrospectSink,
} from "@seqlok/introspect";

const sink: CoreIntrospectSink = {
  onCounterIncrement(name, context) {
    console.log("core introspect event", name, context);
  },
};

const previous = installCoreIntrospectSink(sink);

// later
installCoreIntrospectSink(previous);
```

The sink is optional by design.
Core should remain usable without tooling attached.

---

## Error registry example

```ts
import {
  buildFullErrorRegistryJson,
  selectErrorSubset,
} from "@seqlok/introspect";

const full = buildFullErrorRegistryJson();

const boundarySafe = selectErrorSubset(full, {
  boundarySafeOnly: true,
});
```

This is the right layer for:

- SDK-facing error exports
- native binding generators
- docs tooling
- CI validation of error-registry shape

---

## Who should import this package

Good consumers:

- dashboards
- HUDs
- devtools
- stress harnesses
- docs generators
- CI scripts
- native interop tooling
- test helpers

Bad consumers:

- RT callbacks
- primitive memory layers
- core ownership logic
- anything that must stay on the hot path

---

## Source of truth

For exact exported symbols, use:

- `src/index.ts`

For the package split across runtime and tooling, use:

- `../README.md`
