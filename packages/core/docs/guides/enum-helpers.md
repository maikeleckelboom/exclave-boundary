# Enum Helpers & UI Wiring (`@seqlok-internal/prototype-core`)

This guide shows practical patterns for using the enum helpers in Seqlok
to drive real UI controls, fixtures, and tools.

All helpers are spec-driven: they read the enum vocabulary from your
`SpecInput`, so whenever you tweak the DSL, your UI and tools stay in sync.

---

## 0. API recap

```ts
import {
  enumValues,
  enumPaletteFor,
  enumArrayToLabels,
  enumLabelsToArray,
  enumIndexFromLabel,
  enumLabelFromIndex,
  type EnumLabel,
  type EnumKeyOf,
} from "@seqlok-internal/prototype-core";
```

Core shape:

```ts
declare function enumValues<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
): readonly EnumLabel<S, K>[];
```

Typical usage:

```ts
const modes = enumValues<DemoSpec, "simMode">(spec, "simMode");
// modes: readonly SimMode[]
```

Requirements:

- `DemoSpec` is the `SpecInput` type (usually `type DemoSpec = typeof spec`)
- `simMode` is an `enum` or `enum.array` param or meter in that spec

---

## 1. Classic `<select>` bound to an enum param

```ts
import type { ControllerBinding } from "@seqlok-internal/prototype-core";
import { enumValues } from "@seqlok-internal/prototype-core";
import { spec } from "./spec";

type DemoSpec = typeof spec;
type SimMode = DemoSpec["params"]["simMode"]["values"][number];

export function createSimModeControl(
  ctl: ControllerBinding<DemoSpec>,
): HTMLSelectElement {
  const modes = enumValues<DemoSpec, "simMode">(spec, "simMode");

  const select = document.createElement("select");

  for (const mode of modes) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = mode;
    select.appendChild(option);
  }

  select.addEventListener("change", () => {
    const value = select.value as SimMode;
    ctl.params.update({ simMode: value });
  });

  const { simMode } = ctl.params.snapshot(["simMode"]);
  select.value = simMode;

  return select;
}
```

Use case: simple mode switcher with no hard-coded vocabulary.

---

## 2. Localized labels / pretty names with `enumPaletteFor`

```ts
import { enumPaletteFor, type ControllerBinding } from "@seqlok-internal/prototype-core";
import { spec } from "./spec";

type DemoSpec = typeof spec;
type SimMode = DemoSpec["params"]["simMode"]["values"][number];

const MODE_LABELS: Record<SimMode, string> = {
  basic: "Basic",
  turbo: "Turbo Boost",
  debug: "Debug / Inspect",
};

export function createSimModeButtons(
  ctl: ControllerBinding<DemoSpec>,
): HTMLDivElement {
  const palette = enumPaletteFor<DemoSpec, "simMode">(spec, "simMode");

  const container = document.createElement("div");

  for (const mode of palette.values) {
    const btn = document.createElement("button");
    btn.textContent = MODE_LABELS[mode];

    btn.addEventListener("click", () => {
      ctl.params.update({ simMode: mode });
    });

    container.appendChild(btn);
  }

  const syncUi = () => {
    const { simMode } = ctl.params.snapshot(["simMode"]);
    for (const [i, mode] of palette.values.entries()) {
      const btn = container.children[i] as HTMLButtonElement;
      btn.classList.toggle("active", mode === simMode);
    }
  };

  syncUi();

  return container;
}
```

Use case: segmented controls / buttons with localized labels.

---

## 3. Decode `Int32Array` indices → labels (`enum.array`)

```ts
import { enumArrayToLabels } from "@seqlok-internal/prototype-core";
import { spec } from "./spec";

type DemoSpec = typeof spec;
type PadState = DemoSpec["params"]["padStates"]["values"][number];

function debugPadStates(raw: Int32Array): PadState[] {
  return enumArrayToLabels<DemoSpec, "padStates">(spec, "padStates", raw);
}

// In a test:
const raw = new Int32Array([0, 1, 2, 2, 0]);
const decoded = debugPadStates(raw);
// ['off', 'dim', 'full', 'full', 'off']
```

Out-of-range index → `spec.enumInvalid` with `{ key, values, invalidIndex }`.

---

## 4. Encode labels → `Int32Array` indices

```ts
import { enumLabelsToArray } from "@seqlok-internal/prototype-core";
import { spec } from "./spec";

type DemoSpec = typeof spec;
type PadState = DemoSpec["params"]["padStates"]["values"][number];

const PATTERN_A: readonly PadState[] = [
  "off",
  "dim",
  "full",
  "full",
  "dim",
  "off",
];

const patternEncoded = enumLabelsToArray<DemoSpec, "padStates">(
  spec,
  "padStates",
  PATTERN_A,
);
// Int32Array with indices
```

Typo in a label → `spec.enumInvalid` with `{ key, values, received }`.

---

## 5. Enum labels to colors/icons (HUD / legend)

```ts
import { enumPaletteFor } from "@seqlok-internal/prototype-core";
import { spec } from "./spec";

type DemoSpec = typeof spec;
type DynamicsLabel = DemoSpec["params"]["dynamics"]["values"][number];

const DYNAMICS_COLOR: Record<DynamicsLabel, string> = {
  slow: "#3b82f6",
  medium: "#facc15",
  fast: "#ef4444",
};

export function createDynamicsLegend(): HTMLDivElement {
  const palette = enumPaletteFor<DemoSpec, "dynamics">(spec, "dynamics");
  const container = document.createElement("div");

  for (const label of palette.values) {
    const swatch = document.createElement("div");
    swatch.style.display = "inline-flex";
    swatch.style.alignItems = "center";
    swatch.style.gap = "0.5rem";

    const box = document.createElement("span");
    box.style.display = "inline-block";
    box.style.width = "1rem";
    box.style.height = "1rem";
    box.style.borderRadius = "0.25rem";
    box.style.backgroundColor = DYNAMICS_COLOR[label];

    const text = document.createElement("span");
    text.textContent = label;

    swatch.appendChild(box);
    swatch.appendChild(text);
    container.appendChild(swatch);
  }

  return container;
}
```

Use case: HUD legends / LED maps driven directly from the enum vocabulary.

---

## 6. Stable numeric codes

```ts
import {
  enumIndexFromLabel,
  enumLabelFromIndex,
  enumValues,
} from "@seqlok-internal/prototype-core";
import { spec } from "./spec";

type DemoSpec = typeof spec;
type SimMode = DemoSpec["params"]["simMode"]["values"][number];

function serializeSimMode(mode: SimMode): number {
  return enumIndexFromLabel<DemoSpec, "simMode">(spec, "simMode", mode);
}

function deserializeSimMode(idx: number): SimMode | undefined {
  return enumLabelFromIndex<DemoSpec, "simMode">(spec, "simMode", idx);
}

function example() {
  const modes = enumValues<DemoSpec, "simMode">(spec, "simMode");
  const encoded = serializeSimMode("turbo"); // e.g. 1
  const decoded = deserializeSimMode(encoded); // 'turbo' | undefined
}
```

Use case: compact, order-sensitive encodings (palettes, network, textures).

---

## 7. Reusable "enum buttons" helper for demos

```ts
import {
  enumPaletteFor,
  type ControllerBinding,
  type SpecInput,
} from "@seqlok-internal/prototype-core";

export type EnumParamKey<S extends SpecInput> = Extract<
  keyof S["params"],
  string
>;

export function createEnumButtons<
  S extends SpecInput,
  K extends EnumParamKey<S>,
>(
  ctl: ControllerBinding<S>,
  spec: S,
  key: K,
  labels: Record<S["params"][K]["values"][number], string>,
): HTMLDivElement {
  const palette = enumPaletteFor<S, K>(spec, key);
  const container = document.createElement("div");

  for (const value of palette.values) {
    const btn = document.createElement("button");
    btn.textContent = labels[value];

    btn.addEventListener("click", () => {
      ctl.params.update({ [key]: value } as Partial<S["params"]>);
    });

    container.appendChild(btn);
  }

  const syncUi = () => {
    const snapshot = ctl.params.snapshot([key]);
    const current = snapshot[key];

    for (const [i, value] of palette.values.entries()) {
      const btn = container.children[i] as HTMLButtonElement;
      btn.classList.toggle("active", value === current);
    }
  };

  syncUi();
  return container;
}
```

Example use:

```ts
type DemoSpec = typeof spec;
type SimMode = DemoSpec["params"]["simMode"]["values"][number];

const MODE_LABELS: Record<SimMode, string> = {
  basic: "Basic",
  turbo: "Turbo Boost",
  debug: "Debug / Inspect",
};

const simModeControl = createEnumButtons(ctl, spec, "simMode", MODE_LABELS);
```

---

## Summary

- `enumValues` – vocab for a key.
- `enumPaletteFor` – palette with `values`, `indexFrom`, `labelFrom`.
- `enumArrayToLabels` / `enumLabelsToArray` – indices ↔ labels for
  `enum.array`.
- `enumIndexFromLabel` / `enumLabelFromIndex` – explicit numeric coding.

All of this is spec-driven, so the DSL stays the single source of truth for
both engine and UI.
