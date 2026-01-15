/* eslint-disable no-console */

// NOTE: keep this script dependency-free (no chalk, no cli-table, etc.)
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_PLANES,
  BYTES_PER_ELEM,
  type PlaneKey,
} from "../packages/primitives/src/planes";
import {
  METER_KIND_CATALOG,
  PARAM_KIND_CATALOG,
} from "../packages/core/src/spec/kinds";

type Table = Readonly<{
  title: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}>;

type ColorFn = (s: string) => string;
type Style = Readonly<{
  dim: ColorFn;
  bold: ColorFn;
  green: ColorFn;
  red: ColorFn;
  yellow: ColorFn;
  cyan: ColorFn;
  gray: ColorFn;
}>;

function isColorEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (!process.stdout.isTTY) return false;
  const fc = process.env.FORCE_COLOR;
  if (fc === "0") return false;
  if (fc && fc !== "0") return true;
  return true;
}

function makeStyle(enabled: boolean): Style {
  const wrap =
    (open: string, close: string): ColorFn =>
    (s: string) =>
      enabled ? `${open}${s}${close}` : s;

  const dim = wrap("\u001b[2m", "\u001b[22m");
  const bold = wrap("\u001b[1m", "\u001b[22m");
  const green = wrap("\u001b[32m", "\u001b[39m");
  const red = wrap("\u001b[31m", "\u001b[39m");
  const yellow = wrap("\u001b[33m", "\u001b[39m");
  const cyan = wrap("\u001b[36m", "\u001b[39m");
  const gray = wrap("\u001b[90m", "\u001b[39m");
  return { dim, bold, green, red, yellow, cyan, gray };
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

function visibleWidth(s: string): number {
  return [...stripAnsi(s)].length;
}

function padRight(s: string, width: number): string {
  const w = visibleWidth(s);
  if (w >= width) return s;
  return s + " ".repeat(width - w);
}

function renderRuleLine(label: string, value: string, s: Style): string {
  const k = padRight(s.gray(label), 22);
  return `${k} ${value}`;
}

function box(title: string, lines: readonly string[], s: Style): string {
  const content = [s.bold(title), ...lines];
  const w = Math.max(...content.map((x) => visibleWidth(x)));
  const top = `┌${"─".repeat(w + 2)}┐`;
  const bot = `└${"─".repeat(w + 2)}┘`;
  const out: string[] = [top];
  for (const line of content) out.push(`│ ${padRight(line, w)} │`);
  out.push(bot);
  return out.join("\n");
}

function renderTable(t: Table, s: Style): string {
  const colCount = t.headers.length;

  const widths: number[] = new Array(colCount).fill(0);
  const considerRow = (row: readonly string[]): void => {
    for (let i = 0; i < colCount; i += 1) {
      const cell = row[i] ?? "";
      widths[i] = Math.max(widths[i] ?? 0, visibleWidth(cell));
    }
  };

  considerRow(t.headers);
  for (const r of t.rows) considerRow(r);

  const top = "┌" + widths.map((w) => "─".repeat(w + 2)).join("┬") + "┐";
  const mid = "├" + widths.map((w) => "─".repeat(w + 2)).join("┼") + "┤";
  const bot = "└" + widths.map((w) => "─".repeat(w + 2)).join("┴") + "┘";

  const renderRow = (row: readonly string[]): string => {
    const cells = widths.map((w, i) => ` ${padRight(row[i] ?? "", w)} `);
    return "│" + cells.join("│") + "│";
  };

  const lines: string[] = [];
  lines.push(s.bold(t.title));
  lines.push(top);
  lines.push(renderRow(t.headers.map((h) => s.cyan(h))));
  lines.push(mid);
  for (const r of t.rows) lines.push(renderRow(r));
  lines.push(bot);
  return lines.join("\n");
}

function uniqSorted(xs: readonly string[]): string[] {
  return Array.from(new Set(xs)).sort((a, b) => a.localeCompare(b));
}

function keysOf<T extends Record<string, unknown>>(obj: T): string[] {
  return Object.keys(obj).sort((a, b) => a.localeCompare(b));
}

function planeViewName(plane: PlaneKey): string {
  switch (plane) {
    case "PF32":
    case "MF32":
      return "Float32Array";
    case "MF64":
      return "Float64Array";
    case "PI32":
      return "Int32Array";
    case "PB":
      return "Uint8Array";
    case "PU":
    case "MU32":
    case "MU":
      return "Uint32Array";
  }
}

function planeRole(plane: PlaneKey): string {
  if (plane === "PU") return "param lock (seqlock)";
  if (plane === "MU") return "meter lock (seqlock)";
  if (plane.startsWith("P")) return "param data";
  if (plane.startsWith("M")) return "meter data";
  return "unknown";
}

function extractStringUnionFromFile(
  sourceText: string,
  typeName: string,
): string[] {
  const re = new RegExp(`\\b(?:export\\s+)?type\\s+${typeName}\\s*=`, "m");
  const m = re.exec(sourceText);
  if (!m || m.index < 0) return [];

  const start = m.index + m[0].length;
  const rest = sourceText.slice(start);

  const semi = rest.indexOf(";");
  if (semi < 0) return [];

  const body = rest.slice(0, semi);

  const out: string[] = [];
  const lit = /["']([^"']+)["']/g;
  for (;;) {
    const mm = lit.exec(body);
    if (!mm) break;
    out.push(mm[1] ?? "");
  }
  return uniqSorted(out.filter((s) => s.length > 0));
}

function detectRuntimeSupport(): Readonly<{
  sharedArrayBuffer: boolean;
  atomics: boolean;
  wasmSharedMemory: boolean;
}> {
  const sharedArrayBuffer = typeof globalThis.SharedArrayBuffer === "function";
  const atomics = typeof globalThis.Atomics === "object";

  let wasmSharedMemory: boolean;
  try {
    new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    wasmSharedMemory = true;
  } catch {
    wasmSharedMemory = false;
  }

  return { sharedArrayBuffer, atomics, wasmSharedMemory };
}

// -----------------------------
// Roadmap parsing (from markdown)
// -----------------------------
type RoadmapPlaneStatus = "planned" | "deferred" | "tbd";
type RoadmapKindStatus = "planned" | "deferred" | "tbd";

type RoadmapPlane = Readonly<{
  plane: string;
  group: string;
  view: string;
  status: RoadmapPlaneStatus;
  note: string;
}>;

type RoadmapKind = Readonly<{
  cat: "param" | "meter";
  kind: string;
  view: string;
  requiredPlane: string;
  status: RoadmapKindStatus;
  note: string;
}>;

type ParsedRoadmap = Readonly<{
  planes: readonly RoadmapPlane[];
  kinds: readonly RoadmapKind[];
  parseWarnings: readonly string[];
}>;

type DocDomain = "param" | "meter" | null;
type ParsedMdTable = Readonly<{
  headers: string[];
  rows: string[][];
  domain: DocDomain; // inferred from nearest "## Param Kinds" / "## Meter Kinds" section
}>;

function cleanCell(raw: string): string {
  const s = raw.trim();
  // common doc formatting: `M16`, `f32`, etc.
  const unbackticked =
    s.startsWith("`") && s.endsWith("`") && s.length >= 2 ? s.slice(1, -1) : s;
  return unbackticked.trim();
}

function findBacktickedPlaneHint(text: string): string | null {
  const m = /`([PM]\d+)`/i.exec(text);
  return m ? m[1]!.toUpperCase() : null;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseMarkdownTables(md: string): ParsedMdTable[] {
  const lines = md.split(/\r?\n/);
  const tables: ParsedMdTable[] = [];

  // Track the nearest "kinds universe" section so we can infer Cat for tables that omit it.
  // This doc is structured as:
  //   ## Param Kinds ...
  //   ### PF32 kinds
  //   | Kind | Status | JS View | ...
  // so we want the last seen "## Param Kinds" / "## Meter Kinds".
  let currentDomain: DocDomain = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      const name = (h2[1] ?? "").toLowerCase();
      if (name.includes("param kinds")) currentDomain = "param";
      else if (name.includes("meter kinds")) currentDomain = "meter";
      // otherwise keep currentDomain as-is; many ## sections are unrelated.
      continue;
    }

    if (!line.includes("|")) continue;

    // Header row must look like a markdown table header
    const headerCells = splitMdRow(line);
    if (headerCells.length < 2) continue;

    const sep = lines[i + 1] ?? "";
    if (!isMdSeparatorRow(sep)) continue;

    const headers = headerCells
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (headers.length < 2) continue;

    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      const rline = lines[j] ?? "";
      if (!rline.includes("|")) break;
      const cells = splitMdRow(rline).map((c) => c.trim());
      // stop if this looks like an empty/non-row
      if (cells.every((c) => c === "")) break;
      rows.push(cells);
    }

    if (rows.length > 0) tables.push({ headers, rows, domain: currentDomain });
    i = j - 1;
  }

  return tables;
}

function splitMdRow(line: string): string[] {
  // trim leading/trailing pipes, then split.
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((s) => s.trim());
}

function isMdSeparatorRow(line: string): boolean {
  // e.g. | --- | :---: | ---: |
  const cells = splitMdRow(line);
  if (cells.length < 2) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

type DocStatus = "enabled" | RoadmapPlaneStatus | RoadmapKindStatus;

function asRoadmapStatus(
  raw: string,
): RoadmapPlaneStatus | RoadmapKindStatus | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  // tolerate decorated cells, e.g. "⏳ planned", "💤 deferred", "🧪 TBD"
  if (s.includes("planned") || s.includes("⏳")) return "planned";
  if (s.includes("deferred") || s.includes("💤")) return "deferred";
  if (s.includes("tbd") || s.includes("🧪") || s.includes("todo")) return "tbd";
  return null;
}

function asDocStatus(raw: string): DocStatus | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  // enabled in doc tables uses ✅ (and sometimes the word "enabled")
  if (s.includes("✅") || s.includes("enabled")) return "enabled";
  return asRoadmapStatus(raw);
}

function parseRoadmapFromMarkdown(md: string): ParsedRoadmap {
  const tables = parseMarkdownTables(md);
  const warnings: string[] = [];

  const planes: RoadmapPlane[] = [];
  const kinds: RoadmapKind[] = [];

  for (const t of tables) {
    const h = t.headers.map(normalizeHeader);

    const hasPlane = h.includes("plane");
    const hasKind = h.includes("kind");
    const hasCat = h.includes("cat") || h.includes("category");
    const hasStatus = h.includes("status");

    // Planes table heuristic: must contain "plane" and "status"
    if (hasPlane && hasStatus) {
      const idxPlane = h.indexOf("plane");
      const idxGroup = h.indexOf("group") >= 0 ? h.indexOf("group") : -1;
      const idxView = h.indexOf("view") >= 0 ? h.indexOf("view") : -1;
      const idxStatus = h.indexOf("status");
      const idxNotes =
        h.indexOf("notes") >= 0
          ? h.indexOf("notes")
          : h.indexOf("note") >= 0
            ? h.indexOf("note")
            : h.indexOf("purpose") >= 0
              ? h.indexOf("purpose")
              : -1;

      for (const r of t.rows) {
        const plane = cleanCell(r[idxPlane] ?? "");
        if (!plane) continue;

        const rawStatus = (r[idxStatus] ?? "").trim();
        const parsed = asRoadmapStatus(rawStatus);
        const status: RoadmapPlaneStatus = parsed ?? "tbd";
        if (!parsed) {
          warnings.push(
            `Roadmap planes: unknown status "${rawStatus}" for plane "${plane}" (defaulted to tbd)`,
          );
        }

        // If group is missing, infer from plane prefix: P* => Params, M* => Meters
        const inferredGroup = plane.startsWith("P")
          ? "Params"
          : plane.startsWith("M")
            ? "Meters"
            : "—";

        planes.push({
          plane,
          group:
            cleanCell(idxGroup >= 0 ? (r[idxGroup] ?? "") : inferredGroup) ||
            inferredGroup,
          view: cleanCell(idxView >= 0 ? (r[idxView] ?? "") : "") || "—",
          status,
          note: cleanCell(idxNotes >= 0 ? (r[idxNotes] ?? "") : "") || "",
        });
      }
      continue;
    }

    // Kinds table heuristic:
    //  - doc tables are usually "Kind | Status | JS View | ..." and live under "## Param Kinds" / "## Meter Kinds"
    //  - optionally, a table may include an explicit Cat column (Cat/Category)
    if (hasKind && hasStatus && (hasCat || t.domain !== null)) {
      const idxCat = hasCat
        ? h.indexOf("cat") >= 0
          ? h.indexOf("cat")
          : h.indexOf("category")
        : -1;
      const idxKind = h.indexOf("kind");
      const idxView =
        h.indexOf("js view") >= 0
          ? h.indexOf("js view")
          : h.indexOf("view") >= 0
            ? h.indexOf("view")
            : -1;
      const idxNeeds =
        h.indexOf("needs plane") >= 0
          ? h.indexOf("needs plane")
          : h.indexOf("needs") >= 0
            ? h.indexOf("needs")
            : h.indexOf("plane") >= 0
              ? h.indexOf("plane")
              : -1;
      const idxStatus = h.indexOf("status");
      const idxNotes =
        h.indexOf("notes") >= 0
          ? h.indexOf("notes")
          : h.indexOf("note") >= 0
            ? h.indexOf("note")
            : -1;

      for (const r of t.rows) {
        const rawCat =
          idxCat >= 0 ? cleanCell(r[idxCat] ?? "").toLowerCase() : "";
        const cat: "param" | "meter" =
          rawCat === "param" || rawCat === "meter"
            ? (rawCat as "param" | "meter")
            : t.domain === "param" || t.domain === "meter"
              ? t.domain
              : "param"; // unreachable given guard above, but keeps TS happy

        const kind = cleanCell(r[idxKind] ?? "");
        if (!kind) continue;

        const rawStatus = (r[idxStatus] ?? "").trim();
        const parsed = asDocStatus(rawStatus);
        if (parsed === "enabled") {
          // This table includes the whole universe; we only want not-yet-enabled in the roadmap section.
          continue;
        }
        const status: RoadmapKindStatus = (parsed ??
          "tbd") as RoadmapKindStatus;
        if (!parsed) {
          warnings.push(
            `Roadmap kinds: unknown status "${rawStatus}" for kind "${cat}:${kind}" (defaulted to tbd)`,
          );
        }

        // requiredPlane: best-effort extraction:
        //  1) explicit "Needs plane" / "Plane" column
        //  2) backticked hint inside Notes/Purpose text ("Awaits `P16`", etc.)
        const requiredPlaneCell =
          idxNeeds >= 0 ? cleanCell(r[idxNeeds] ?? "") : "";
        const rowText = r.map((c) => String(c ?? "")).join(" | ");
        const hinted = findBacktickedPlaneHint(rowText);
        const requiredPlane = requiredPlaneCell || hinted || "—";

        kinds.push({
          cat,
          kind,
          view: cleanCell(idxView >= 0 ? (r[idxView] ?? "") : "") || "—",
          requiredPlane,
          status,
          note: cleanCell(idxNotes >= 0 ? (r[idxNotes] ?? "") : "") || "",
        });
      }
    }
  }

  if (planes.length === 0) {
    warnings.push(
      `No roadmap planes table parsed. Expected a markdown table with headers: Plane | Group | View | Status | Notes`,
    );
  }
  if (kinds.length === 0) {
    warnings.push(
      `No roadmap kinds table parsed. (Doc tables often omit Cat; script expects tables under "## Param Kinds" or "## Meter Kinds" with Kind/Status/JS View columns.)`,
    );
  }

  return { planes, kinds, parseWarnings: warnings };
}

// -----------------------------
// Status badge (text-only)
// -----------------------------
function statusBadge(
  status:
    | "enabled"
    | "spec-only"
    | "roadmap"
    | RoadmapPlaneStatus
    | RoadmapKindStatus,
  s: Style,
): string {
  switch (status) {
    case "enabled":
      return s.green("ENABLED");
    case "spec-only":
      return s.yellow("SPEC-ONLY");
    case "roadmap":
      return s.gray("ROADMAP");
    case "planned":
      return s.yellow("PLANNED");
    case "deferred":
      return s.gray("DEFERRED");
    case "tbd":
      return s.cyan("TBD");
  }
}

function main(): void {
  const s = makeStyle(isColorEnabled());

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "..");

  const specTypesPath = path.join(
    repoRoot,
    "packages",
    "core",
    "src",
    "spec",
    "types.ts",
  );
  const specTypesText = fs.readFileSync(specTypesPath, "utf8");

  const declaredParamKinds = extractStringUnionFromFile(
    specTypesText,
    "ParamKind",
  );
  const declaredMeterKinds = extractStringUnionFromFile(
    specTypesText,
    "MeterKind",
  );

  type KindEntry = Readonly<{
    plane: PlaneKey;
    isArray: boolean;
    elem?: string;
    semantic: string;
  }>;
  type KindCatalog = Readonly<Record<string, KindEntry>>;

  const paramCatalog = PARAM_KIND_CATALOG as unknown as KindCatalog;
  const meterCatalog = METER_KIND_CATALOG as unknown as KindCatalog;

  const supportedParamKinds = keysOf(paramCatalog);
  const supportedMeterKinds = keysOf(meterCatalog);

  const declaredParamKnown = declaredParamKinds.length > 0;
  const declaredMeterKnown = declaredMeterKinds.length > 0;
  const declaredKnown = declaredParamKnown || declaredMeterKnown;

  const unsupportedParamKinds = declaredParamKinds.filter(
    (k) => !new Set(supportedParamKinds).has(k),
  );
  const unsupportedMeterKinds = declaredMeterKinds.filter(
    (k) => !new Set(supportedMeterKinds).has(k),
  );

  // Roadmap doc (authoritative wish-list)
  const roadmapPath = path.join(
    repoRoot,
    "packages",
    "core",
    "docs",
    "spec",
    "seqlok-planes-reference.md",
  );
  const roadmapText = fs.existsSync(roadmapPath)
    ? fs.readFileSync(roadmapPath, "utf8")
    : "";
  const roadmap = roadmapText
    ? parseRoadmapFromMarkdown(roadmapText)
    : { planes: [], kinds: [], parseWarnings: [] };

  const env = detectRuntimeSupport();
  const backingsAvailable = [
    env.sharedArrayBuffer && env.atomics ? "shared" : null,
    env.sharedArrayBuffer && env.atomics ? "shared-partitioned" : null,
    env.wasmSharedMemory && env.atomics ? "wasm-shared" : null,
  ].filter((x): x is string => x !== null);

  // const roadmapDocStatus = !roadmapText
  //   ? s.red("MISSING")
  //   : roadmap.parseWarnings.length
  //     ? s.yellow(`WARN(${roadmap.parseWarnings.length})`)
  //     : s.green("OK");

  // ---- Summary card
  const summaryLines: string[] = [
    renderRuleLine("Node", process.version, s),
    renderRuleLine(
      "TTY color",
      isColorEnabled() ? s.green("on") : s.gray("off"),
      s,
    ),
    renderRuleLine(
      "Planes (impl)",
      `${ALL_PLANES.length} total (${ALL_PLANES.filter((p) => p.startsWith("P")).length} P / ${ALL_PLANES.filter((p) => p.startsWith("M")).length} M)`,
      s,
    ),
    renderRuleLine(
      "ParamKinds (impl)",
      `${supportedParamKinds.length} enabled`,
      s,
    ),
    renderRuleLine(
      "MeterKinds (impl)",
      `${supportedMeterKinds.length} enabled`,
      s,
    ),
    renderRuleLine(
      "Kinds (spec)",
      declaredKnown
        ? `${declaredParamKinds.length} param, ${declaredMeterKinds.length} meter`
        : s.gray("unknown (not enumerable)"),
      s,
    ),
    renderRuleLine(
      "Roadmap planes",
      roadmap.planes.length ? `${roadmap.planes.length}` : s.gray("—"),
      s,
    ),
    renderRuleLine(
      "Roadmap kinds",
      roadmap.kinds.length ? `${roadmap.kinds.length}` : s.gray("—"),
      s,
    ),
    renderRuleLine(
      "Roadmap doc",
      !roadmapText
        ? s.red("MISSING")
        : roadmap.parseWarnings.length
          ? s.yellow(`WARN(${roadmap.parseWarnings.length})`)
          : s.green("OK"),
      s,
    ),
    renderRuleLine(
      "Backings (here)",
      backingsAvailable.length ? backingsAvailable.join(", ") : s.red("none"),
      s,
    ),
  ];

  console.log("");
  console.log(box("Seqlok support matrix", summaryLines, s));
  console.log("");

  // ---- Backing kinds
  const yesNo = (b: boolean): string => (b ? s.green("YES") : s.red("NO"));

  console.log(
    renderTable(
      {
        title: "Backing kinds (runtime availability here)",
        headers: ["BackingKind", "Available", "Requires", "Notes"],
        rows: [
          [
            "shared",
            yesNo(env.sharedArrayBuffer && env.atomics),
            "SAB + Atomics",
            "Browser: requires COOP+COEP",
          ],
          [
            "shared-partitioned",
            yesNo(env.sharedArrayBuffer && env.atomics),
            "SAB + Atomics (1 SAB per plane)",
            "Browser: requires COOP+COEP",
          ],
          [
            "wasm-shared",
            yesNo(env.wasmSharedMemory && env.atomics),
            "Wasm shared + Atomics",
            "Browser: threads + COOP+COEP",
          ],
        ],
      },
      s,
    ),
  );
  console.log("");

  // ---- Planes (implemented)
  const paramPlanes = ALL_PLANES.filter((p) => p.startsWith("P") || p === "PU");
  const meterPlanes = ALL_PLANES.filter((p) => p.startsWith("M") || p === "MU");

  const planeRow = (p: PlaneKey): string[] => {
    const bytes = BYTES_PER_ELEM[p];
    const view = planeViewName(p);
    const role = planeRole(p);
    const lock = p === "PU" || p === "MU";
    return [
      p,
      role,
      String(bytes),
      view,
      lock ? s.yellow("LOCK") : s.gray("DATA"),
    ];
  };

  console.log(
    renderTable(
      {
        title: "Planes — implemented (Params)",
        headers: ["Plane", "Role", "Bytes/elem", "View", "Notes"],
        rows: paramPlanes.map((p) => planeRow(p)),
      },
      s,
    ),
  );
  console.log("");
  console.log(
    renderTable(
      {
        title: "Planes — implemented (Meters)",
        headers: ["Plane", "Role", "Bytes/elem", "View", "Notes"],
        rows: meterPlanes.map((p) => planeRow(p)),
      },
      s,
    ),
  );
  console.log("");

  // ---- Kinds (implemented)
  const paramKindRows: string[][] = supportedParamKinds.map((k) => {
    const entry = paramCatalog[k]!;
    const bytes = BYTES_PER_ELEM[entry.plane];
    return [
      k,
      entry.semantic,
      entry.isArray ? "array" : "scalar",
      entry.plane,
      planeViewName(entry.plane),
      String(bytes),
      entry.isArray ? String(entry.elem ?? "-") : "-",
    ];
  });

  const meterKindRows: string[][] = supportedMeterKinds.map((k) => {
    const entry = meterCatalog[k]!;
    const bytes = BYTES_PER_ELEM[entry.plane];
    return [
      k,
      entry.semantic,
      entry.isArray ? "array" : "scalar",
      entry.plane,
      planeViewName(entry.plane),
      String(bytes),
      entry.isArray ? String(entry.elem ?? "-") : "-",
    ];
  });

  console.log(
    renderTable(
      {
        title: `ParamKinds — implemented (${statusBadge("enabled", s)})`,
        headers: [
          "Kind",
          "Semantic",
          "Shape",
          "Plane",
          "View",
          "Bytes/elem",
          "Elem",
        ],
        rows: paramKindRows,
      },
      s,
    ),
  );
  console.log("");
  console.log(
    renderTable(
      {
        title: `MeterKinds — implemented (${statusBadge("enabled", s)})`,
        headers: [
          "Kind",
          "Semantic",
          "Shape",
          "Plane",
          "View",
          "Bytes/elem",
          "Elem",
        ],
        rows: meterKindRows,
      },
      s,
    ),
  );
  console.log("");

  // ---- Spec-defined but not enabled
  const specNotEnabledRows: string[][] = declaredKnown
    ? [
        ...unsupportedParamKinds.map((k) => [
          "param",
          k,
          statusBadge("spec-only", s),
        ]),
        ...unsupportedMeterKinds.map((k) => [
          "meter",
          k,
          statusBadge("spec-only", s),
        ]),
      ]
    : [];

  console.log(
    renderTable(
      {
        title: "Kinds — spec-defined but NOT enabled (planner rejects)",
        headers: ["Cat", "Kind", "Status"],
        rows: specNotEnabledRows.length
          ? specNotEnabledRows
          : declaredKnown
            ? [[s.gray("—"), s.gray("— none —"), s.gray("—")]]
            : [
                [
                  s.gray("—"),
                  s.gray("spec kinds not enumerable at runtime"),
                  s.gray("—"),
                ],
              ],
      },
      s,
    ),
  );
  console.log("");

  // ---- Roadmap planes/kinds (from doc)
  if (!roadmapText) {
    console.log(s.dim(`Roadmap doc not found at: ${roadmapPath}`));
    console.log("");
  } else if (roadmap.parseWarnings.length) {
    console.log(
      s.dim(
        `Roadmap doc parsed with warnings (${roadmap.parseWarnings.length}): ${roadmapPath}`,
      ),
    );
    for (const w of roadmap.parseWarnings) console.log(s.dim(`  - ${w}`));
    console.log("");
  }

  const implPlanes = new Set<string>(ALL_PLANES as unknown as string[]);
  const roadmapPlaneRows: string[][] = roadmap.planes.map((p) => {
    const present = implPlanes.has(p.plane);
    const st = present ? statusBadge("enabled", s) : statusBadge(p.status, s);
    return [p.plane, p.group, p.view, st, p.note];
  });

  console.log(
    renderTable(
      {
        title: "Planes — roadmap (from doc)",
        headers: ["Plane", "Group", "View", "Status", "Notes"],
        rows: roadmapPlaneRows.length
          ? roadmapPlaneRows
          : [[s.gray("—"), s.gray("—"), s.gray("—"), s.gray("—"), s.gray("—")]],
      },
      s,
    ),
  );
  console.log("");

  const declaredParamSet = new Set<string>(declaredParamKinds);
  const declaredMeterSet = new Set<string>(declaredMeterKinds);
  const enabledParamSet = new Set<string>(supportedParamKinds);
  const enabledMeterSet = new Set<string>(supportedMeterKinds);

  function kindUniverseStatus(
    k: RoadmapKind,
  ): "enabled" | "spec-only" | "roadmap" {
    const declared =
      k.cat === "param"
        ? declaredParamSet.has(k.kind)
        : declaredMeterSet.has(k.kind);
    const enabled =
      k.cat === "param"
        ? enabledParamSet.has(k.kind)
        : enabledMeterSet.has(k.kind);
    if (enabled) return "enabled";
    if (declared) return "spec-only";
    return "roadmap";
  }

  const roadmapKindRows: string[][] = roadmap.kinds.map((k) => {
    const uni = kindUniverseStatus(k);
    const st =
      uni === "roadmap" ? statusBadge(k.status, s) : statusBadge(uni, s);
    return [k.cat, k.kind, k.view, k.requiredPlane, st, k.note];
  });

  console.log(
    renderTable(
      {
        title: "Kinds — roadmap (from doc)",
        headers: ["Cat", "Kind", "JS View", "Needs plane", "Status", "Notes"],
        rows: roadmapKindRows.length
          ? roadmapKindRows
          : [
              [
                s.gray("—"),
                s.gray("—"),
                s.gray("—"),
                s.gray("—"),
                s.gray("—"),
                s.gray("—"),
              ],
            ],
      },
      s,
    ),
  );
  console.log("");

  console.log(s.dim("Rules:"));
  console.log(
    s.dim("  • Planner accepts only kinds present in the kind catalogs."),
  );
  console.log(
    s.dim(
      "  • Spec unions define what builders may express; catalogs define what actually works.",
    ),
  );
  console.log(
    s.dim(
      "  • Note: spec-kind unions may not be enumerable at runtime (TS types are erased).",
    ),
  );
  console.log(
    s.dim(
      "  • Roadmap doc is the authoritative wish-list; keep its tables machine-parseable.",
    ),
  );
  console.log(
    s.dim(
      "  • PU/MU are internal seqlock lock planes (not user-facing value kinds).",
    ),
  );
  console.log("");
}

main();
