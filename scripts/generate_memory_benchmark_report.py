from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


MIB = 1024 * 1024
INK = "142A3B"
MUTED = "526A78"
DEEP_BLUE = "173A55"
PALE_BLUE = "E7F0F3"
PALE_GRAY = "F2F5F6"
TEAL = "2C9188"
ORANGE = "D77B2C"
GRID = "D9D9D9"
WHITE = "FFFFFF"
BLACK = "000000"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate charts and a DOCX report from an HTWS memory benchmark."
    )
    parser.add_argument("input", type=Path, help="Benchmark JSON file")
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    results = payload["results"]
    metadata = payload["metadata"]
    validate_results(results, metadata)
    summary = summarize(results)

    summary_csv = args.output_dir / "memory-benchmark-summary.csv"
    absolute_chart = args.output_dir / "memory-saved-working-set.png"
    percent_chart = args.output_dir / "memory-saved-percent.png"
    footprint_chart = args.output_dir / "post-action-memory-footprint.png"
    report_path = args.output_dir / "HTWS-memory-savings-benchmark.docx"

    write_summary_csv(summary_csv, summary)
    create_absolute_chart(absolute_chart, summary)
    create_percent_chart(percent_chart, summary)
    create_footprint_chart(footprint_chart, summary)
    create_report(
        report_path,
        summary,
        results,
        metadata,
        args.input,
        absolute_chart,
        percent_chart,
        footprint_chart,
        summary_csv,
    )

    print(report_path)
    print(summary_csv)
    print(absolute_chart)
    print(percent_chart)
    print(footprint_chart)


def validate_results(results: list[dict[str, Any]], metadata: dict[str, Any]) -> None:
    expected = (
        len(metadata["scenarios"])
        * len(metadata["methods"])
        * metadata["repeats"]
    )
    if len(results) != expected:
        raise ValueError(f"Expected {expected} runs, found {len(results)}.")
    for row in results:
        if row["transitionedTabs"] != row["tabCount"]:
            raise ValueError(f"Incomplete transition: {row}")
        if row["method"] == "htws-hibernate" and row["remainingTestTabs"] != 0:
            raise ValueError(f"HTWS left workload tabs open: {row}")


def summarize(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[int, int, str], list[dict[str, Any]]] = defaultdict(list)
    for row in results:
        grouped[(row["tabCount"], row["windowCount"], row["method"])].append(row)

    summary: list[dict[str, Any]] = []
    for key in sorted(grouped):
        tabs, windows, method = key
        rows = grouped[key]
        saved_mib = [row["savedWorkingSetBytes"] / MIB for row in rows]
        saved_pct = [row["savedWorkingSetPercent"] for row in rows]
        post_mib = [row["postWorkingSetBytes"] / MIB for row in rows]
        active_mib = [row["activeWorkingSetBytes"] / MIB for row in rows]
        summary.append(
            {
                "active_mib_median": statistics.median(active_mib),
                "method": method,
                "post_mib_median": statistics.median(post_mib),
                "post_processes_median": statistics.median(
                    row["postProcessCount"] for row in rows
                ),
                "runs": len(rows),
                "saved_mib_max": max(saved_mib),
                "saved_mib_median": statistics.median(saved_mib),
                "saved_mib_min": min(saved_mib),
                "saved_pct_max": max(saved_pct),
                "saved_pct_median": statistics.median(saved_pct),
                "saved_pct_min": min(saved_pct),
                "tabs": tabs,
                "transition_ms_median": statistics.median(
                    row["transitionDurationMs"] for row in rows
                ),
                "windows": windows,
            }
        )
    return summary


def write_summary_csv(path: Path, summary: list[dict[str, Any]]) -> None:
    columns = list(summary[0].keys())
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        writer.writerows(summary)


def chart_style() -> None:
    plt.rcParams.update(
        {
            "axes.edgecolor": "#BED0D7",
            "axes.labelcolor": f"#{INK}",
            "axes.titlecolor": f"#{BLACK}",
            "axes.titlesize": 15,
            "axes.titleweight": "bold",
            "font.family": "DejaVu Sans",
            "font.size": 10,
            "figure.facecolor": "white",
            "grid.color": "#DCE6EA",
            "grid.linewidth": 0.8,
            "text.color": f"#{INK}",
            "xtick.color": f"#{MUTED}",
            "ytick.color": f"#{MUTED}",
        }
    )


def scenario_rows(summary: list[dict[str, Any]], method: str) -> list[dict[str, Any]]:
    return sorted(
        (row for row in summary if row["method"] == method),
        key=lambda row: row["tabs"],
    )


def create_absolute_chart(path: Path, summary: list[dict[str, Any]]) -> None:
    chart_style()
    native = scenario_rows(summary, "native-discard")
    htws = scenario_rows(summary, "htws-hibernate")
    labels = [f"{row['tabs']} tabs\n{row['windows']} window{'s' if row['windows'] != 1 else ''}" for row in native]
    x = np.arange(len(labels))
    width = 0.34
    fig, axis = plt.subplots(figsize=(10, 5.5))

    for offset, rows, label, color in [
        (-width / 2, native, "Native discard", f"#{ORANGE}"),
        (width / 2, htws, "HTWS hibernate", f"#{TEAL}"),
    ]:
        medians = np.array([row["saved_mib_median"] for row in rows])
        lower = medians - np.array([row["saved_mib_min"] for row in rows])
        upper = np.array([row["saved_mib_max"] for row in rows]) - medians
        bars = axis.bar(
            x + offset,
            medians,
            width,
            color=color,
            label=label,
            yerr=np.vstack([lower, upper]),
            capsize=4,
            error_kw={"elinewidth": 1.2, "capthick": 1.2},
        )
        axis.bar_label(
            bars,
            labels=[f"{value:,.0f}" for value in medians],
            padding=5,
            fontsize=9,
        )

    axis.set_title("Median working set released after 10 seconds")
    axis.set_ylabel("Memory released MiB")
    axis.set_xticks(x, labels)
    axis.grid(axis="y")
    axis.set_axisbelow(True)
    axis.legend(frameon=False, loc="upper left")
    axis.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)


def create_percent_chart(path: Path, summary: list[dict[str, Any]]) -> None:
    chart_style()
    native = scenario_rows(summary, "native-discard")
    htws = scenario_rows(summary, "htws-hibernate")
    labels = [str(row["tabs"]) for row in native]
    fig, axis = plt.subplots(figsize=(10, 5.2))
    axis.plot(
        labels,
        [row["saved_pct_median"] for row in native],
        marker="o",
        markersize=7,
        linewidth=2.5,
        color=f"#{ORANGE}",
        label="Native discard",
    )
    axis.plot(
        labels,
        [row["saved_pct_median"] for row in htws],
        marker="o",
        markersize=7,
        linewidth=2.5,
        color=f"#{TEAL}",
        label="HTWS hibernate",
    )
    for rows, color, y_offset in [(native, ORANGE, -6), (htws, TEAL, 4)]:
        for index, row in enumerate(rows):
            axis.annotate(
                f"{row['saved_pct_median']:.1f}%",
                (index, row["saved_pct_median"]),
                xytext=(0, y_offset),
                textcoords="offset points",
                ha="center",
                va="bottom" if y_offset >= 0 else "top",
                color=f"#{color}",
                fontweight="bold",
            )
    axis.set_ylim(0, 100)
    axis.set_title("Share of the active Brave working set released")
    axis.set_xlabel("Workload tabs")
    axis.set_ylabel("Median memory released percent")
    axis.grid(axis="y")
    axis.set_axisbelow(True)
    axis.legend(frameon=False, loc="center right")
    axis.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)


def create_footprint_chart(path: Path, summary: list[dict[str, Any]]) -> None:
    chart_style()
    native = scenario_rows(summary, "native-discard")
    htws = scenario_rows(summary, "htws-hibernate")
    labels = [str(row["tabs"]) for row in native]
    fig, axis = plt.subplots(figsize=(10, 5.2))
    axis.plot(
        labels,
        [row["post_mib_median"] for row in native],
        marker="o",
        linewidth=2.5,
        color=f"#{ORANGE}",
        label="Native discard",
    )
    axis.plot(
        labels,
        [row["post_mib_median"] for row in htws],
        marker="o",
        linewidth=2.5,
        color=f"#{TEAL}",
        label="HTWS hibernate",
    )
    axis.set_title("Brave process tree remaining after each action")
    axis.set_xlabel("Workload tabs")
    axis.set_ylabel("Median working set remaining MiB")
    axis.grid(axis="y")
    axis.set_axisbelow(True)
    axis.legend(frameon=False, loc="upper left")
    axis.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)


def create_report(
    path: Path,
    summary: list[dict[str, Any]],
    results: list[dict[str, Any]],
    metadata: dict[str, Any],
    raw_path: Path,
    absolute_chart: Path,
    percent_chart: Path,
    footprint_chart: Path,
    summary_csv: Path,
) -> None:
    document = Document()
    configure_document(document)
    native = scenario_rows(summary, "native-discard")
    htws = scenario_rows(summary, "htws-hibernate")
    brave_version = results[0]["braveVersion"]
    run_date = datetime.fromisoformat(metadata["runStartedAt"]).strftime("%d %B %Y")

    title = document.add_paragraph(style="Title")
    title.add_run("HTWS Memory Savings Benchmark")
    subtitle = document.add_paragraph()
    subtitle.style = document.styles["Subtitle"]
    subtitle.add_run("Comparison with Brave native tab discard on Windows")
    context = document.add_paragraph()
    context.alignment = WD_ALIGN_PARAGRAPH.LEFT
    context.add_run(f"Test date  {run_date}\n").bold = True
    context.add_run(f"Browser  {brave_version}\n")
    context.add_run("Platform  Windows 10\n")
    context.add_run("Runs  24 fresh profile runs across four workload sizes")

    add_heading(document, "Conclusion", 1)
    ratios = [
        htws_row["saved_mib_median"] / native_row["saved_mib_median"]
        for native_row, htws_row in zip(native, htws, strict=True)
    ]
    paragraph = document.add_paragraph()
    paragraph.add_run("HTWS released substantially more resident memory in every tested workload. ").bold = True
    paragraph.add_run(
        f"Across the four scenarios, HTWS released {min(ratios):.1f} to {max(ratios):.1f} times as much "
        "Brave process working set as native discard after the same 10 second stabilization period. "
        "The difference widened as more tabs and windows were present because HTWS closed the workload "
        "tabs and their renderer processes, while native discard left the tab objects and measured process "
        "tree intact in these runs."
    )

    add_heading(document, "Key results", 1)
    add_bullet(
        document,
        "HTWS median working set reduction rose from "
        f"{htws[0]['saved_mib_median']:.0f} MiB at 10 tabs to "
        f"{htws[-1]['saved_mib_median']:.0f} MiB at 100 tabs.",
    )
    add_bullet(
        document,
        "HTWS released a median "
        f"{htws[0]['saved_pct_median']:.1f}% to {htws[-1]['saved_pct_median']:.1f}% of the active working set. "
        "Native discard released 5.1% to 7.3% at the same 10 second checkpoint.",
    )
    add_bullet(
        document,
        "Native discard retained the same median process count before and after the action in every scenario. "
        "HTWS reduced the median Brave process tree to eight processes after hibernation in every scenario.",
    )
    add_bullet(
        document,
        "All requested tabs transitioned successfully in all 24 runs. HTWS left no workload tabs open; native "
        "discard retained the tabs in the tab strip by design.",
    )

    add_heading(document, "Median results", 1)
    add_summary_table(document, native, htws)

    document.add_page_break()
    add_heading(document, "Memory released", 1)
    document.add_paragraph(
        "The bars show the median resident working set released across three fresh-profile repetitions. "
        "Error bars span the minimum and maximum observed result. The 60-tab native-discard condition had "
        "one high outlier; the median remains close to the other two repetitions."
    )
    add_figure(
        document,
        absolute_chart,
        "Figure 1  Median Brave working set released with full observed range",
        "Grouped bars comparing median memory released by native discard and HTWS across four tab and window workloads.",
    )

    document.add_page_break()
    add_heading(document, "Relative reduction", 1)
    document.add_paragraph(
        "HTWS became more effective as a share of the active browser footprint as the workload grew. Native "
        "discard remained below 8 percent at the 10 second checkpoint in the median run for every scenario."
    )
    add_figure(
        document,
        percent_chart,
        "Figure 2  Median share of active working set released",
        "Line chart showing the percentage of active Brave working set released by each method at 10, 30, 60, and 100 tabs.",
    )

    document.add_page_break()
    add_heading(document, "Memory remaining after the action", 1)
    document.add_paragraph(
        "The post-action footprint explains the practical advantage. After HTWS hibernation, the median Brave "
        "working set stayed between roughly 479 MiB and 576 MiB because only the controller and extension "
        "processes remained. After native discard, the median footprint grew with the workload from about "
        "1.17 GiB to 7.40 GiB in this test."
    )
    add_figure(
        document,
        footprint_chart,
        "Figure 3  Median Brave process working set remaining",
        "Line chart comparing the memory footprint remaining after native discard and HTWS hibernation.",
    )

    add_heading(document, "Why the results differ", 1)
    document.add_paragraph(
        "Chrome describes Memory Saver as proactive tab discard. A discarded page is unloaded and reloads when "
        "the user returns to it. HTWS uses a different lifecycle: it first writes a durable local restore record "
        "and then closes the selected tab. In this benchmark, native discard marked every workload tab as "
        "discarded but retained the full process count at the measurement point. HTWS removed the workload tabs "
        "and allowed their renderer processes to exit. The measured advantage therefore comes from deterministic "
        "closure, not from a claim that HTWS can inspect or optimize each page's internal memory use."
    )

    add_heading(document, "Experimental method", 1)
    method_points = [
        "Four scenarios: 10 tabs in 1 window, 30 tabs in 3 windows, 60 tabs in 6 windows, and 100 tabs in 10 windows.",
        "Three independent repetitions per scenario and method, for 24 fresh temporary Brave profiles. Method order alternated by repetition.",
        "Each local workload page allocated and touched 4 MiB of JavaScript memory, drew a 512 by 512 canvas, and created 750 DOM paragraphs.",
        "Both conditions loaded the same HTWS build so extension overhead was controlled. Native comparison runs called the Chromium tabs discard API; HTWS runs sent the production session-hibernation command.",
        "The active baseline and post-action reading each used the median of five Windows process-tree samples taken 400 milliseconds apart.",
        "Post-action measurements began after a 10 second stabilization period. Working set includes the Brave root process and all descendants.",
    ]
    for point in method_points:
        add_bullet(document, point)

    add_heading(document, "Interpretation and limitations", 1)
    limitations = [
        "This is a controlled synthetic workload on one Windows 10 computer and one Brave version. Real websites, hardware, extensions, and browser versions will produce different absolute numbers.",
        "Windows working set is resident process memory, not a stable per-tab measurement. It includes browser, renderer, GPU, utility, and extension processes in the isolated Brave tree.",
        "The native condition deliberately invoked Chromium discard to make every run deterministic. It did not wait for Brave's normal Memory Saver scheduler or simulate hours of inactivity.",
        "The report measures memory 10 seconds after each action. Native discard may release additional memory later or under stronger operating-system memory pressure.",
        "HTWS removes hibernated tabs from the tab strip and requires restoration through its archive. Native discard retains tab-strip entries and transparently reloads them, which is a usability advantage rather than a memory advantage.",
        "Three repetitions reveal large effects and one native-discard outlier, but a larger sample and multiple machines would be required for broad performance claims.",
    ]
    for point in limitations:
        add_bullet(document, point)

    add_heading(document, "Recommended public claim", 1)
    document.add_paragraph(
        "HTWS saves memory by securely recording tabs and closing them, instead of relying only on browser tab "
        "discard. In a controlled Brave benchmark on Windows, HTWS released substantially more process working "
        "set than native discard across 10 to 100 tabs. Actual savings vary by website, browser version, system, "
        "and time after hibernation."
    )

    add_heading(document, "Sources and reproducibility", 1)
    document.add_paragraph(
        "Google Chrome Help, Personalize Chrome performance\n"
        "https://support.google.com/chrome/answer/12929150"
    )
    document.add_paragraph(
        "Chrome for Developers, What developers need to know about Memory and Energy Saver modes\n"
        "https://developer.chrome.com/blog/memory-and-energy-saver-mode"
    )
    document.add_paragraph(
        "Chrome Enterprise Help, High efficiency mode and tab discarding behavior\n"
        "https://support.google.com/chrome/a/answer/2657289"
    )
    document.add_paragraph(
        f"Raw benchmark data  {raw_path.name}\n"
        f"Aggregated summary  {summary_csv.name}\n"
        "Reproduction script  scripts/benchmark_memory_savings.mjs"
    )

    document.add_page_break()
    add_heading(document, "Appendix Raw results", 1)
    document.add_paragraph(
        "Working set values are aggregate Brave process-tree measurements. Rows are ordered by workload, method, and repetition."
    )
    add_raw_table(document, results)

    document.core_properties.title = "HTWS Memory Savings Benchmark"
    document.core_properties.subject = "Comparison of HTWS hibernation and Brave native tab discard"
    document.core_properties.author = "HTWS Project"
    document.core_properties.keywords = "HTWS, Brave, Chrome, memory saver, tab discard, benchmark"
    for paragraph in document.paragraphs:
        paragraph.paragraph_format.keep_with_next = False
        paragraph.paragraph_format.keep_together = False
    document.save(path)


def configure_document(document: Document) -> None:
    section = document.sections[0]
    section.top_margin = Inches(0.75)
    section.bottom_margin = Inches(0.72)
    section.left_margin = Inches(0.82)
    section.right_margin = Inches(0.82)

    styles = document.styles
    normal = styles["Normal"]
    normal.font.name = "Aptos"
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = RGBColor.from_string(INK)
    normal.paragraph_format.space_after = Pt(7)
    normal.paragraph_format.line_spacing = 1.12

    for style_name, size, bold, spacing in [
        ("Title", 28, True, 18),
        ("Subtitle", 14, False, 12),
        ("Heading 1", 18, True, 10),
        ("Heading 2", 13, True, 6),
    ]:
        style = styles[style_name]
        style.font.name = "Aptos Display" if style_name != "Normal" else "Aptos"
        style.font.size = Pt(size)
        style.font.bold = bold
        style.font.color.rgb = RGBColor.from_string(BLACK)
        style.paragraph_format.space_before = Pt(spacing)
        style.paragraph_format.space_after = Pt(6)
        style.paragraph_format.keep_with_next = True

    styles["Title"].paragraph_format.space_after = Pt(4)
    title_properties = styles["Title"]._element.get_or_add_pPr()
    title_borders = title_properties.find(qn("w:pBdr"))
    if title_borders is not None:
        title_properties.remove(title_borders)
    styles["Subtitle"].font.color.rgb = RGBColor.from_string(MUTED)
    styles["Subtitle"].paragraph_format.space_before = Pt(0)
    styles["Subtitle"].paragraph_format.space_after = Pt(18)

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    footer_run = footer.add_run("HTWS Memory Benchmark  |  15 November 2026")
    footer_run.font.name = "Aptos"
    footer_run.font.size = Pt(8)
    footer_run.font.color.rgb = RGBColor.from_string(MUTED)


def add_heading(document: Document, text: str, level: int) -> None:
    document.add_heading(text, level=level)


def add_bullet(document: Document, text: str) -> None:
    paragraph = document.add_paragraph(style="List Bullet")
    paragraph.add_run(text)


def add_summary_table(
    document: Document,
    native: list[dict[str, Any]],
    htws: list[dict[str, Any]],
) -> None:
    headers = [
        "Workload",
        "Native saved",
        "HTWS saved",
        "Native percent",
        "HTWS percent",
        "HTWS advantage",
    ]
    rows = []
    for native_row, htws_row in zip(native, htws, strict=True):
        rows.append(
            [
                f"{native_row['tabs']} tabs\n{native_row['windows']} window{'s' if native_row['windows'] != 1 else ''}",
                f"{native_row['saved_mib_median']:,.1f} MiB",
                f"{htws_row['saved_mib_median']:,.1f} MiB",
                f"{native_row['saved_pct_median']:.1f}%",
                f"{htws_row['saved_pct_median']:.1f}%",
                f"{htws_row['saved_mib_median'] / native_row['saved_mib_median']:.1f}x",
            ]
        )
    add_table(document, headers, rows, [1.35, 1.15, 1.15, 1.05, 1.05, 1.05])


def add_raw_table(document: Document, results: list[dict[str, Any]]) -> None:
    headers = [
        "Tabs",
        "Windows",
        "Method",
        "Run",
        "Active MiB",
        "Post MiB",
        "Saved MiB",
        "Saved percent",
        "Processes after",
    ]
    rows = []
    for row in sorted(
        results,
        key=lambda item: (item["tabCount"], item["method"], item["repetition"]),
    ):
        rows.append(
            [
                str(row["tabCount"]),
                str(row["windowCount"]),
                "HTWS" if row["method"] == "htws-hibernate" else "Native discard",
                str(row["repetition"]),
                f"{row['activeWorkingSetBytes'] / MIB:,.1f}",
                f"{row['postWorkingSetBytes'] / MIB:,.1f}",
                f"{row['savedWorkingSetBytes'] / MIB:,.1f}",
                f"{row['savedWorkingSetPercent']:.1f}%",
                str(row["postProcessCount"]),
            ]
        )
    add_table(
        document,
        headers,
        rows,
        [0.42, 0.52, 0.92, 0.38, 0.72, 0.72, 0.72, 0.7, 0.64],
        font_size=7.2,
    )


def add_table(
    document: Document,
    headers: list[str],
    rows: list[list[str]],
    widths: list[float],
    font_size: float = 9.0,
) -> None:
    table = document.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table)
    for index, (header, width) in enumerate(zip(headers, widths, strict=True)):
        cell = table.rows[0].cells[index]
        cell.width = Inches(width)
        shade_cell(cell, DEEP_BLUE)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_margins(cell)
        paragraph = cell.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.space_after = Pt(0)
        run = paragraph.add_run(header)
        run.bold = True
        run.font.color.rgb = RGBColor.from_string(WHITE)
        run.font.size = Pt(font_size)
    set_repeat_table_header(table.rows[0])

    for row_index, values in enumerate(rows):
        cells = table.add_row().cells
        for column_index, (value, width) in enumerate(
            zip(values, widths, strict=True)
        ):
            cell = cells[column_index]
            cell.width = Inches(width)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_margins(cell)
            if row_index % 2 == 1:
                shade_cell(cell, PALE_BLUE if row_index % 4 == 1 else PALE_GRAY)
            paragraph = cell.paragraphs[0]
            paragraph.alignment = (
                WD_ALIGN_PARAGRAPH.LEFT
                if column_index == 2 and len(headers) > 7
                else WD_ALIGN_PARAGRAPH.CENTER
            )
            paragraph.paragraph_format.space_after = Pt(0)
            paragraph.paragraph_format.line_spacing = 1.0
            run = paragraph.add_run(value)
            run.font.size = Pt(font_size)
    document.add_paragraph().paragraph_format.space_after = Pt(1)


def add_figure(
    document: Document,
    image_path: Path,
    caption: str,
    alt_text: str,
) -> None:
    paragraph = document.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run()
    shape = run.add_picture(str(image_path), width=Inches(6.8))
    shape._inline.docPr.set("descr", alt_text)
    caption_paragraph = document.add_paragraph()
    caption_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    caption_paragraph.paragraph_format.space_after = Pt(10)
    caption_run = caption_paragraph.add_run(caption)
    caption_run.italic = True
    caption_run.font.size = Pt(9)
    caption_run.font.color.rgb = RGBColor.from_string(MUTED)


def set_table_borders(table: Any) -> None:
    table_properties = table._tbl.tblPr
    borders = table_properties.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        table_properties.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        element = borders.find(qn(f"w:{edge}"))
        if element is None:
            element = OxmlElement(f"w:{edge}")
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), "4")
        element.set(qn("w:color"), GRID)


def shade_cell(cell: Any, fill: str) -> None:
    properties = cell._tc.get_or_add_tcPr()
    shading = properties.find(qn("w:shd"))
    if shading is None:
        shading = OxmlElement("w:shd")
        properties.append(shading)
    shading.set(qn("w:fill"), fill)


def set_cell_margins(cell: Any, top: int = 90, start: int = 110, bottom: int = 90, end: int = 110) -> None:
    properties = cell._tc.get_or_add_tcPr()
    margins = properties.first_child_found_in("w:tcMar")
    if margins is None:
        margins = OxmlElement("w:tcMar")
        properties.append(margins)
    for margin_name, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        margin = margins.find(qn(f"w:{margin_name}"))
        if margin is None:
            margin = OxmlElement(f"w:{margin_name}")
            margins.append(margin)
        margin.set(qn("w:w"), str(value))
        margin.set(qn("w:type"), "dxa")


def set_repeat_table_header(row: Any) -> None:
    row_properties = row._tr.get_or_add_trPr()
    repeat = OxmlElement("w:tblHeader")
    repeat.set(qn("w:val"), "true")
    row_properties.append(repeat)


if __name__ == "__main__":
    main()
