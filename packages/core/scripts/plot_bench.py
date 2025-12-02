#!/usr/bin/env python3
"""
Enhanced Vitest benchmark visualizer for Seqlok.

Generates charts with:
- Error bars (p75/p99 variance)
- Audio budget reference lines (E2E chart)
- Latency and throughput views
- SVG and PNG output (configurable)

Usage:
    python plot_bench.py [bench-results.json] [output-dir] [--format svg|png|both]

Defaults assume the script lives in packages/core/scripts/.
"""

from __future__ import annotations

import argparse
import json
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import numpy as np
import re
import sys
from dataclasses import dataclass
from matplotlib.ticker import FuncFormatter
from pathlib import Path
from typing import List, Optional, Pattern


# ═══════════════════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class Theme:
  name: str
  colors: dict[str, str]
  category_colors: dict[str, str]


DARK_THEME = Theme(
  name="dark",
  colors={
    "primary": "#60A5FA",  # Blue
    "secondary": "#38BDF8",  # Lighter blue
    "accent": "#F97316",  # Orange accent (budget lines and highlights)
    "danger": "#F97373",  # Red (unused for now, kept for future)
    "muted": "#6B7280",  # Gray
    "background": "#020617",  # Very dark
    "surface": "#020617",
    "text": "#E5E7EB",  # Near white
    "text_muted": "#9CA3AF",  # Light gray
  },
  category_colors={
    "seqlock": "#60A5FA",
    "params": "#38BDF8",
    "processor": "#60A5FA",
    "writer": "#38BDF8",
    "observer": "#60A5FA",
    "setup": "#60A5FA",
  },
)

LIGHT_THEME = Theme(
  name="light",
  colors={
    "primary": "#2563EB",  # Blue 600
    "secondary": "#0EA5E9",  # Sky 500
    "accent": "#EA580C",  # Orange 600
    "danger": "#DC2626",  # Red 600
    "muted": "#D1D5DB",  # Gray 300
    "background": "#F9FAFB",  # Gray 50
    "surface": "#FFFFFF",  # White
    "text": "#111827",  # Gray 900
    "text_muted": "#4B5563",  # Gray 700
  },
  category_colors={
    "seqlock": "#2563EB",
    "params": "#0EA5E9",
    "processor": "#2563EB",
    "writer": "#0EA5E9",
    "observer": "#2563EB",
    "setup": "#2563EB",
  },
)

THEMES: List[Theme] = [DARK_THEME, LIGHT_THEME]

# Audio budget reference lines (in microseconds)
AUDIO_BUDGETS_US = {
  "128 samples @ 48kHz": (128 / 48_000) * 1_000_000,  # ~2,667 µs
  "256 samples @ 48kHz": (256 / 48_000) * 1_000_000,  # ~5,333 µs
  "512 samples @ 48kHz": (512 / 48_000) * 1_000_000,  # ~10,667 µs
}


# ═══════════════════════════════════════════════════════════════════════════════
# Data Model
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class BenchSample:
  name: str
  hz: float
  min: float
  max: float
  mean: float
  p75: float
  p99: float
  p995: float
  p999: float
  rme: float = 0.0  # relative margin of error


@dataclass(frozen=True)
class BenchGroup:
  full_name: str
  benchmarks: List[BenchSample]


@dataclass(frozen=True)
class BenchFile:
  filepath: str
  groups: List[BenchGroup]


@dataclass(frozen=True)
class BenchReport:
  files: List[BenchFile]


@dataclass(frozen=True)
class ChartEntry:
  label: str
  file_suffix: str
  bench_pattern: Pattern[str]
  category: str = "default"


@dataclass(frozen=True)
class ChartConfig:
  title: str
  filename_base: str
  entries: List[ChartEntry]
  show_budget_lines: bool = True
  y_label: str = "Mean time (µs)"


def _re(pattern: str) -> Pattern[str]:
  return re.compile(pattern, flags=re.IGNORECASE)


# ═══════════════════════════════════════════════════════════════════════════════
# Chart Configurations
# ═══════════════════════════════════════════════════════════════════════════════

CHART_CONFIGS: List[ChartConfig] = [
  ChartConfig(
    title="Hot Path Operations",
    filename_base="bench-hot-path",
    show_budget_lines=False,
    entries=[
      # Seqlock primitives
      ChartEntry("seqlock publish", "seqlock.bench.ts", _re(r"publish uncontended"), "seqlock"),
      ChartEntry("seqlock tryRead", "seqlock.bench.ts", _re(r"tryRead uncontended"), "seqlock"),
      # Controller params
      ChartEntry("params.stage", "param-operations.bench.ts", _re(r"controller\.params\.stage.*eqBands"), "params"),
      ChartEntry("params.set", "param-operations.bench.ts", _re(r"controller\.params\.set.*two scalars"), "params"),
      ChartEntry("params.update", "param-operations.bench.ts", _re(r"controller\.params\.update.*3 scalars\)$"),
                 "params"),
      ChartEntry("params.hydrate", "param-operations.bench.ts",
                 _re(r"controller\.params\.hydrate.*3 scalars.*f32\[8\]"), "params"),
      ChartEntry("params.update+arr", "param-operations.bench.ts",
                 _re(r"controller\.params\.update.*3 scalars.*f32\[8\]"), "params"),
      # Processor reads
      ChartEntry("processor.within", "param-operations.bench.ts", _re(r"processor\.params\.within.*scalars only"),
                 "processor"),
      ChartEntry("processor.within+arr", "param-operations.bench.ts",
                 _re(r"processor\.params\.within.*scalars \+ eqBands"), "processor"),
      ChartEntry("interleaved", "param-operations.bench.ts",
                 _re(r"interleaved controller\.update \+ processor\.within"), "processor"),
      # Writer sugar
      ChartEntry("writer.level", "array-vs-stage-and-meters.bench.ts", _re(r"writer\.level\(0\.75\)"), "writer"),
      ChartEntry("writer.set", "array-vs-stage-and-meters.bench.ts", _re(r"writer\.set\('level', 0\.75\)"), "writer"),
      ChartEntry("writer.stage", "array-vs-stage-and-meters.bench.ts", _re(r"writer\.stage\('spectrum', cb\)"),
                 "writer"),
    ],
  ),
  ChartConfig(
    title="Parameter Write Operations",
    filename_base="bench-param-writes",
    show_budget_lines=False,
    entries=[
      ChartEntry("stage (array)", "param-operations.bench.ts", _re(r"controller\.params\.stage.*eqBands"), "params"),
      ChartEntry("set (scalars)", "param-operations.bench.ts", _re(r"controller\.params\.set.*two scalars"), "params"),
      ChartEntry("update (scalars)", "param-operations.bench.ts", _re(r"controller\.params\.update.*3 scalars\)$"),
                 "params"),
      ChartEntry("hydrate (mixed)", "param-operations.bench.ts",
                 _re(r"controller\.params\.hydrate.*3 scalars.*f32\[8\]"), "params"),
      ChartEntry("update+array", "param-operations.bench.ts", _re(r"controller\.params\.update.*3 scalars.*f32\[8\]"),
                 "params"),
    ],
  ),
  ChartConfig(
    title="Observer Read Operations",
    filename_base="bench-observer-reads",
    show_budget_lines=False,
    entries=[
      ChartEntry("within (full)", "observer-reads.bench.ts", _re(r"params\.within\(\).*full view"), "observer"),
      ChartEntry("snap params (full)", "observer-reads.bench.ts", _re(r"params\.snapshot\(\).*full spec"), "observer"),
      ChartEntry("snap params (partial)", "observer-reads.bench.ts", _re(r"params\.snapshot\(\['gain'\]\).*array"),
                 "observer"),
      ChartEntry("snap meters (full)", "observer-reads.bench.ts", _re(r"meters\.snapshot\(\).*full spec"), "observer"),
      ChartEntry("snap meters (partial)", "observer-reads.bench.ts", _re(r"meters\.snapshot\(\['peak'\]\).*array"),
                 "observer"),
    ],
  ),
  ChartConfig(
    title="End-to-End Setup",
    filename_base="bench-e2e-setup",
    show_budget_lines=True,
    y_label="Mean time (ms)",
    entries=[
      ChartEntry("Small spec", "e2e-pipeline.bench.ts", _re(r"small spec: full setup"), "setup"),
      ChartEntry("Medium spec", "e2e-pipeline.bench.ts", _re(r"medium spec: full setup"), "setup"),
      ChartEntry("Large spec", "e2e-pipeline.bench.ts", _re(r"large spec: full setup"), "setup"),
    ],
  ),
]


# ═══════════════════════════════════════════════════════════════════════════════
# Parsing
# ═══════════════════════════════════════════════════════════════════════════════

def load_report(path: Path) -> BenchReport:
  raw = path.read_text(encoding="utf-8")
  data = json.loads(raw)

  files: List[BenchFile] = []

  for f in data.get("files", []):
    groups: List[BenchGroup] = []

    for g in f.get("groups", []):
      benchmarks: List[BenchSample] = []

      for b in g.get("benchmarks", []):
        benchmarks.append(
          BenchSample(
            name=str(b["name"]),
            hz=float(b["hz"]),
            min=float(b["min"]),
            max=float(b["max"]),
            mean=float(b["mean"]),
            p75=float(b["p75"]),
            p99=float(b["p99"]),
            p995=float(b["p995"]),
            p999=float(b["p999"]),
            rme=float(b.get("rme", 0)),
          )
        )

      groups.append(
        BenchGroup(
          full_name=str(g["fullName"]),
          benchmarks=benchmarks,
        )
      )

    files.append(BenchFile(filepath=str(f["filepath"]), groups=groups))

  return BenchReport(files=files)


def find_file(report: BenchReport, suffix: str) -> Optional[BenchFile]:
  for f in report.files:
    if f.filepath.endswith(suffix):
      return f
  return None


def find_bench(file: BenchFile, pattern: Pattern[str]) -> Optional[BenchSample]:
  for group in file.groups:
    for bench in group.benchmarks:
      if pattern.search(bench.name) is not None:
        return bench
  return None


# ═══════════════════════════════════════════════════════════════════════════════
# Chart Data Collection
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ChartDataPoint:
  label: str
  category: str
  mean_us: float
  min_us: float
  max_us: float
  p75_us: float
  p99_us: float
  hz: float
  rme: float


def collect_chart_data(report: BenchReport, config: ChartConfig) -> List[ChartDataPoint]:
  """Collect benchmark data for a chart configuration."""

  points: List[ChartDataPoint] = []

  # Vitest outputs time in seconds so convert to target unit
  is_ms = "ms" in config.y_label
  multiplier = 1_000.0 if is_ms else 1_000_000.0  # seconds to ms or seconds to µs

  for entry in config.entries:
    bench_file = find_file(report, entry.file_suffix)
    if bench_file is None:
      print(f"[warn] File not found: {entry.file_suffix} for '{entry.label}'")
      continue

    bench = find_bench(bench_file, entry.bench_pattern)
    if bench is None:
      print(f"[warn] Bench not found: '{entry.label}' in {entry.file_suffix}")
      continue

    points.append(
      ChartDataPoint(
        label=entry.label,
        category=entry.category,
        mean_us=bench.mean * multiplier,
        min_us=bench.min * multiplier,
        max_us=bench.max * multiplier,
        p75_us=bench.p75 * multiplier,
        p99_us=bench.p99 * multiplier,
        hz=bench.hz,
        rme=bench.rme,
      )
    )

  return points


# ═══════════════════════════════════════════════════════════════════════════════
# Plotting helpers
# ═══════════════════════════════════════════════════════════════════════════════

def setup_style(theme: Theme) -> None:
  """Configure matplotlib for the given theme."""
  colors = theme.colors

  plt.rcParams.update(
    {
      "figure.facecolor": colors["background"],
      "axes.facecolor": colors["surface"],
      "axes.edgecolor": colors["text_muted"],
      "axes.labelcolor": colors["text"],
      "text.color": colors["text"],
      "xtick.color": colors["text"],
      "ytick.color": colors["text"],
      "grid.color": colors["muted"],
      "grid.alpha": 0.3,
      "font.family": "sans-serif",
      "font.size": 10,
    }
  )


def _make_latency_formatter(is_ms: bool) -> FuncFormatter:
  def _fmt(value: float, _pos: int) -> str:
    if is_ms:
      if value >= 10:
        return f"{value:.0f}"
      return f"{value:.1f}"

    # µs scale
    if value >= 1000:
      return f"{value / 1000:.1f}k"
    if value >= 100:
      return f"{value:.0f}"
    return f"{value:.1f}"

  return FuncFormatter(_fmt)


# ═══════════════════════════════════════════════════════════════════════════════
# Individual charts
# ═══════════════════════════════════════════════════════════════════════════════

def plot_latency_chart(
  config: ChartConfig,
  data: List[ChartDataPoint],
  output_dir: Path,
  theme: Theme,
  formats: List[str],
) -> None:
  """Generate a horizontal bar chart for mean latency only (no error bars)."""

  if not data:
    print(f"[skip] No data for {config.filename_base}")
    return

  setup_style(theme)
  colors = theme.colors
  category_colors = theme.category_colors

  # Sort by mean time (fastest at top)
  sorted_data = sorted(data, key=lambda d: d.mean_us)
  num_bars = len(sorted_data)

  fig_height = max(3.0, 0.5 * num_bars + 1.5)
  fig, ax = plt.subplots(figsize=(10, fig_height))

  y_pos = np.arange(num_bars)

  means = [d.mean_us for d in sorted_data]
  labels = [d.label for d in sorted_data]
  categories = [d.category for d in sorted_data]

  bar_colors = [category_colors.get(cat, colors["primary"]) for cat in categories]

  # Bars: 0 → mean
  bars = ax.barh(
    y_pos,
    means,
    color=bar_colors,
    edgecolor="none",
    height=0.7,
  )

  ax.set_yticks(y_pos)
  ax.set_yticklabels(labels)
  ax.invert_yaxis()

  ax.set_xlabel(config.y_label)
  ax.set_title(config.title, fontsize=12, fontweight="bold", pad=15)

  is_ms = "ms" in config.y_label
  ax.xaxis.set_major_formatter(_make_latency_formatter(is_ms))

  max_mean = max(means) if means else 1.0

  # Value annotations just to the right of each bar
  for bar in bars:
    width = bar.get_width()
    y = bar.get_y() + bar.get_height() / 2.0
    text_x = width + max_mean * 0.02

    ax.text(
      text_x,
      y,
      f"{width:.3f}",
      va="center",
      ha="left",
      fontsize=9,
      color=colors["text"],
    )

  # Audio budget reference lines (only for E2E charts on ms scale; no labels)
  if config.show_budget_lines and is_ms:
    for _, budget_us in AUDIO_BUDGETS_US.items():
      budget_ms = budget_us / 1_000.0
      ax.axvline(
        x=budget_ms,
        color=colors["accent"],
        linestyle="--",
        alpha=0.4,
        linewidth=1.2,
      )

  # Legend for categories (only if there is more than one)
  unique_cats = list(dict.fromkeys(categories))
  if len(unique_cats) > 1:
    legend_handles = [
      mpatches.Patch(
        color=category_colors.get(cat, colors["primary"]),
        label=cat,
      )
      for cat in unique_cats
    ]
    ax.legend(
      handles=legend_handles,
      loc="lower right",
      framealpha=0.8,
      facecolor=colors["surface"],
      edgecolor=colors["muted"],
    )

  ax.xaxis.grid(True, alpha=0.3)
  ax.set_axisbelow(True)
  ax.set_xlim(0.0, max_mean * 1.1)

  fig.tight_layout()

  for ext in formats:
    out_path = output_dir / f"{config.filename_base}.{ext}"
    fig.savefig(
      out_path,
      dpi=150 if ext == "png" else None,
      facecolor=fig.get_facecolor(),
    )
    print(f"[plot] Wrote {out_path}")

  plt.close(fig)



def plot_throughput_chart(
  config: ChartConfig,
  data: List[ChartDataPoint],
  output_dir: Path,
  theme: Theme,
  formats: List[str],
) -> None:
  """Generate throughput chart (M ops per second)."""

  if not data:
    return

  # Skip throughput for E2E
  if "e2e" in config.filename_base.lower():
    return

  setup_style(theme)
  colors = theme.colors
  category_colors = theme.category_colors

  sorted_data = sorted(data, key=lambda d: d.hz, reverse=True)
  num_bars = len(sorted_data)

  fig_height = max(3.0, 0.5 * num_bars + 1.5)
  fig, ax = plt.subplots(figsize=(10, fig_height))

  y_pos = np.arange(num_bars)

  throughputs = [d.hz / 1_000_000.0 for d in sorted_data]
  labels = [d.label for d in sorted_data]
  categories = [d.category for d in sorted_data]

  bar_colors = [
    category_colors.get(cat, colors["secondary"])
    for cat in categories
  ]

  bars = ax.barh(
    y_pos,
    throughputs,
    color=bar_colors,
    edgecolor="none",
    height=0.7,
  )

  ax.set_yticks(y_pos)
  ax.set_yticklabels(labels)
  ax.invert_yaxis()

  ax.set_xlabel("Throughput (M ops per second)")
  ax.set_title(f"{config.title} - Throughput", fontsize=12, fontweight="bold", pad=15)

  max_val = max(throughputs) if throughputs else 1.0

  for bar in bars:
    width = bar.get_width()
    ax.text(
      width + max_val * 0.02,
      bar.get_y() + bar.get_height() / 2.0,
      f"{width:.2f}M",
      va="center",
      ha="left",
      fontsize=9,
      color=colors["text"],
    )

  ax.xaxis.grid(True, alpha=0.3)
  ax.set_axisbelow(True)
  ax.set_xlim(0.0, max_val * 1.2)

  fig.tight_layout()

  for ext in formats:
    out_path = output_dir / f"{config.filename_base}-throughput.{ext}"
    fig.savefig(
      out_path,
      dpi=150 if ext == "png" else None,
      facecolor=fig.get_facecolor(),
    )
    print(f"[plot] Wrote {out_path}")

  plt.close(fig)


# ═══════════════════════════════════════════════════════════════════════════════
# Summary dashboard
# ═══════════════════════════════════════════════════════════════════════════════

def plot_summary_dashboard(
  report: BenchReport,
  all_data: dict[str, List[ChartDataPoint]],
  output_dir: Path,
  theme: Theme,
  formats: List[str],
) -> None:
  """Generate a summary dashboard with key metrics."""

  setup_style(theme)
  colors = theme.colors
  category_colors = theme.category_colors

  # Theme-aware panel styling for the summary card
  if theme.name == "dark":
    panel_face = colors["muted"]      # soft gray on dark
    panel_alpha = 0.20
  else:
    panel_face = colors["surface"]    # near-white card on light
    panel_alpha = 0.96

  fig, axes = plt.subplots(
    2,
    2,
    figsize=(14, 9),
  )

  fig.suptitle(
    "Seqlok Benchmark Summary",
    fontsize=14,
    fontweight="bold",
  )

  hot_path = all_data.get("bench-hot-path", [])
  e2e_setup = all_data.get("bench-e2e-setup", [])

  # Top-left: fastest hot-path ops (mean latency only)
  ax1 = axes[0, 0]
  if hot_path:
    sorted_hp = sorted(hot_path, key=lambda d: d.mean_us)[:8]
    labels = [d.label for d in sorted_hp]
    positions = np.arange(len(sorted_hp))
    means = [d.mean_us for d in sorted_hp]

    bar_colors = [
      category_colors.get(d.category, colors["primary"])
      for d in sorted_hp
    ]

    bars = ax1.barh(
      positions,
      means,
      color=bar_colors,
      edgecolor="none",
      height=0.6,
    )

    ax1.set_yticks(positions)
    ax1.set_yticklabels(labels)
    ax1.set_xlabel("Mean time (µs)")
    ax1.set_title("Fastest hot path operations", fontsize=10, pad=10)
    ax1.invert_yaxis()
    ax1.xaxis.grid(True, alpha=0.3)
    ax1.xaxis.set_major_formatter(_make_latency_formatter(False))

    max_mean = max(means) if means else 1.0
    for bar, mean_val in zip(bars, means):
      ax1.text(
        mean_val + max_mean * 0.02,
        bar.get_y() + bar.get_height() / 2.0,
        f"{mean_val:.1f}",
        va="center",
        ha="left",
        fontsize=8.5,
        color=colors["text"],
        )

    ax1.set_xlim(0.0, max_mean * 1.15)

  # Top-right: throughput by category (median)
  ax2 = axes[0, 1]
  if hot_path:
    cat_throughputs: dict[str, List[float]] = {}
    for d in hot_path:
      cat_throughputs.setdefault(d.category, []).append(d.hz / 1_000_000.0)

    cats = list(cat_throughputs.keys())
    medians = [float(np.median(cat_throughputs[c])) for c in cats]
    colors_for_cats = [
      category_colors.get(c, colors["primary"])
      for c in cats
    ]

    bars = ax2.bar(cats, medians, color=colors_for_cats, edgecolor="none")

    ax2.set_ylabel("Median throughput (M ops per second)")
    ax2.set_title("Throughput by category", fontsize=10, pad=10)

    max_val = max(medians) if medians else 1.0

    for bar, val in zip(bars, medians):
      ax2.text(
        bar.get_x() + bar.get_width() / 2.0,
        val + max_val * 0.02,
        f"{val:.1f}M",
        ha="center",
        va="bottom",
        fontsize=9,
        )

    ax2.set_ylim(0.0, max_val * 1.25)

  # Bottom-left: E2E setup times with audio budgets
  ax3 = axes[1, 0]
  if e2e_setup:
    sorted_e2e = sorted(e2e_setup, key=lambda d: d.mean_us)
    labels = [d.label for d in sorted_e2e]
    values = [d.mean_us for d in sorted_e2e]  # ms
    positions = np.arange(len(sorted_e2e))

    setup_color = category_colors.get("setup", colors["primary"])

    bars = ax3.barh(
      positions,
      values,
      color=setup_color,
      height=0.6,
    )

    ax3.set_yticks(positions)
    ax3.set_yticklabels(labels)
    ax3.set_xlabel("Time (ms)")
    ax3.set_title("E2E setup times", fontsize=10, pad=10)
    ax3.invert_yaxis()

    max_val = max(values)

    for _, budget_us in AUDIO_BUDGETS_US.items():
      budget_ms = budget_us / 1_000.0
      if budget_ms < max_val * 2.0:
        ax3.axvline(
          x=budget_ms,
          color=colors["accent"],
          linestyle="--",
          alpha=0.4,
        )

    for bar, val in zip(bars, values):
      ax3.text(
        val + max_val * 0.02,
        bar.get_y() + bar.get_height() / 2.0,
        f"{val:.2f}ms",
        va="center",
        fontsize=9,
        color=colors["text"],
        )

    ax3.xaxis.set_major_formatter(_make_latency_formatter(True))

  # Bottom-right: summary card
  ax4 = axes[1, 1]
  ax4.set_xlim(0.0, 1.0)
  ax4.set_ylim(0.0, 1.0)
  ax4.axis("off")

  metrics_lines: List[str] = []

  if hot_path:
    fastest = min(hot_path, key=lambda d: d.mean_us)
    slowest = max(hot_path, key=lambda d: d.mean_us)
    median_hz = float(np.median([d.hz for d in hot_path]))
    sub_us = [d for d in hot_path if d.mean_us < 1.0]

    metrics_lines.extend(
      [
        "Hot path",
        f"• operations: {len(hot_path)}",
        f"• fastest: {fastest.label}  ({fastest.mean_us:.3f} µs)",
        f"• slowest: {slowest.label}  ({slowest.mean_us:.3f} µs)",
        f"• median throughput: {median_hz / 1e6:.2f} M ops per second",
      ]
    )

    if sub_us:
      metrics_lines.append(
        f"• sub-microsecond ops: {len(sub_us)}/{len(hot_path)}",
      )

  if e2e_setup:
    if metrics_lines:
      metrics_lines.append("")  # blank line between sections

    largest = max(e2e_setup, key=lambda d: d.mean_us)
    block_us = (128 / 48_000) * 1_000_000.0  # 128 samples at 48kHz in µs
    block_ms = block_us / 1_000.0
    ratio = largest.mean_us / block_ms if block_ms > 0.0 else 0.0

    metrics_lines.extend(
      [
        "End to end setup",
        f"• largest: {largest.label}  ({largest.mean_us:.2f} ms)",
        f"• approx blocks: {ratio:.0f} at 128 samples and 48kHz",
        "• safe on control thread, not in audio callback",
      ]
    )

  ax4.set_title("Summary", fontsize=11, fontweight="bold", loc="left", pad=8)

  if metrics_lines:
    ax4.text(
      0.03,
      0.94,
      "\n".join(metrics_lines),
      transform=ax4.transAxes,
      va="top",
      ha="left",
      fontsize=10,
      linespacing=1.5,
      color=colors["text"],
      bbox={
        "boxstyle": "round,pad=0.8",
        "facecolor": panel_face,
        "edgecolor": "none",
        "alpha": panel_alpha,
      },
    )

  # Leave space for suptitle
  fig.tight_layout(rect=[0.0, 0.0, 1.0, 0.92])

  for ext in formats:
    out_path = output_dir / f"bench-summary.{ext}"
    fig.savefig(
      out_path,
      dpi=150 if ext == "png" else None,
      facecolor=fig.get_facecolor(),
    )
    print(f"[plot] Wrote {out_path}")

  plt.close(fig)



# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def run(report_path: Path, output_root: Path, formats: List[str]) -> None:
  print(f"[plot] Reading {report_path}")
  report = load_report(report_path)

  # Root stays the same, charts now live under <output_root>/charts/<theme>
  output_root.mkdir(parents=True, exist_ok=True)
  charts_root = output_root / "charts"

  # Collect data once
  all_data: dict[str, List[ChartDataPoint]] = {}
  for config in CHART_CONFIGS:
    data = collect_chart_data(report, config)
    all_data[config.filename_base] = data

  # Render per theme
  for theme in THEMES:
    theme_dir = charts_root / theme.name
    theme_dir.mkdir(parents=True, exist_ok=True)
    print(f"[theme] Rendering {theme.name} charts into {theme_dir}")

    for config in CHART_CONFIGS:
      data = all_data.get(config.filename_base, [])
      plot_latency_chart(config, data, theme_dir, theme, formats)
      plot_throughput_chart(config, data, theme_dir, theme, formats)

    plot_summary_dashboard(report, all_data, theme_dir, theme, formats)

  print(f"\n[done] Charts written to {charts_root}/")


def main() -> None:
  script_path = Path(__file__).resolve()

  # Default paths assume script is in packages/core/scripts/
  core_root = (
    script_path.parents[1]
    if script_path.parent.name == "scripts"
    else script_path.parent
  )

  default_json = core_root / "docs" / "performance" / "bench-results.json"
  default_out = core_root / "docs" / "performance"

  parser = argparse.ArgumentParser(
    description="Generate Seqlok benchmark charts from a Vitest bench JSON report.",
  )
  parser.add_argument(
    "report_path",
    nargs="?",
    help="Path to bench-results.json from Vitest.",
  )
  parser.add_argument(
    "output_dir",
    nargs="?",
    help="Root output directory. Defaults to docs/performance under core.",
  )
  parser.add_argument(
    "--format",
    "-f",
    choices=("svg", "png", "both"),
    default="svg",
    help="Output image format. Defaults to svg.",
  )

  args = parser.parse_args(sys.argv[1:])

  json_path = Path(args.report_path) if args.report_path is not None else default_json
  out_dir = Path(args.output_dir) if args.output_dir is not None else default_out

  if args.format == "both":
    formats = ["svg", "png"]
  else:
    formats = [args.format]

  run(json_path, out_dir, formats)


if __name__ == "__main__":
  main()
