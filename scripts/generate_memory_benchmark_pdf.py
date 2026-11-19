from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

MIB = 1024 * 1024
INK = colors.HexColor("#142A3B")
MUTED = colors.HexColor("#526A78")
DEEP_BLUE = colors.HexColor("#173A55")
PALE_BLUE = colors.HexColor("#E7F0F3")
GRID = colors.HexColor("#D9D9D9")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate the HTWS benchmark PDF.")
    parser.add_argument("input", type=Path)
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--charts-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    summary = read_summary(args.summary)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    build_pdf(args, payload["results"], summary)
    print(args.output)


def read_summary(path: Path) -> list[dict[str, Any]]:
    converters = {
        "active_mib_median": float,
        "post_mib_median": float,
        "post_processes_median": float,
        "runs": int,
        "saved_mib_max": float,
        "saved_mib_median": float,
        "saved_mib_min": float,
        "saved_pct_max": float,
        "saved_pct_median": float,
        "saved_pct_min": float,
        "tabs": int,
        "transition_ms_median": float,
        "windows": int,
    }
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8", newline="") as source:
        for source_row in csv.DictReader(source):
            row: dict[str, Any] = dict(source_row)
            for field, converter in converters.items():
                row[field] = converter(source_row[field])
            rows.append(row)
    return rows


def build_pdf(
    args: argparse.Namespace,
    results: list[dict[str, Any]],
    summary: list[dict[str, Any]],
) -> None:
    register_fonts()
    styles = make_styles()
    native = rows_for(summary, "native-discard")
    htws = rows_for(summary, "htws-hibernate")
    ratios = [
        htws_row["saved_mib_median"] / native_row["saved_mib_median"]
        for native_row, htws_row in zip(native, htws, strict=True)
    ]
    document = SimpleDocTemplate(
        str(args.output),
        pagesize=letter,
        rightMargin=0.68 * inch,
        leftMargin=0.68 * inch,
        topMargin=0.65 * inch,
        bottomMargin=0.62 * inch,
        title="HTWS Memory Savings Benchmark",
        author="HTWS Project",
    )
    story: list[Any] = [
        Paragraph("HTWS Memory Savings Benchmark", styles["Title"]),
        Paragraph(
            "Comparison with Brave native tab discard on Windows",
            styles["Subtitle"],
        ),
        Paragraph(
            f"<b>Test date</b>  15 November 2026<br/>"
            f"<b>Browser</b>  {escape(results[0]['braveVersion'])}<br/>"
            "<b>Platform</b>  Windows 10<br/>"
            "<b>Runs</b>  24 fresh profile runs across four workload sizes",
            styles["Meta"],
        ),
        Paragraph("Conclusion", styles["Heading1"]),
        Paragraph(
            "<b>HTWS released substantially more resident memory in every tested workload.</b> "
            f"Across the four scenarios, HTWS released {min(ratios):.1f} to "
            f"{max(ratios):.1f} times as much Brave process working set as native "
            "discard after the same 10 second stabilization period. The difference "
            "widened as more tabs and windows were present because HTWS closed the "
            "workload tabs and their renderer processes, while native discard left "
            "the tab objects and measured process tree intact in these runs.",
            styles["Body"],
        ),
        Paragraph("Key results", styles["Heading1"]),
    ]
    key_results = [
        f"HTWS median working set reduction rose from {htws[0]['saved_mib_median']:.0f} MiB at 10 tabs to {htws[-1]['saved_mib_median']:.0f} MiB at 100 tabs.",
        f"HTWS released a median {htws[0]['saved_pct_median']:.1f}% to {htws[-1]['saved_pct_median']:.1f}% of the active working set. Native discard released 5.1% to 7.3% at the same checkpoint.",
        "Native discard retained the same median process count before and after every scenario. HTWS reduced the median Brave process tree to eight processes after hibernation.",
        "All requested tabs transitioned successfully in all 24 runs. HTWS left no workload tabs open; native discard retained tabs in the tab strip by design.",
    ]
    story.extend(bullet(item, styles) for item in key_results)
    story.extend(
        [
            Paragraph("Median results", styles["Heading1"]),
            summary_table(native, htws, styles),
            PageBreak(),
            Paragraph("Memory released", styles["Heading1"]),
            Paragraph(
                "The bars show the median resident working set released across three "
                "fresh-profile repetitions. Error bars span the minimum and maximum "
                "observed result. The 60-tab native-discard condition had one high "
                "outlier; the median remains close to the other two repetitions.",
                styles["Body"],
            ),
            *figure(
                args.charts_dir / "memory-saved-working-set.png",
                "Figure 1  Median Brave working set released with full observed range",
                styles,
            ),
            PageBreak(),
            Paragraph("Relative reduction", styles["Heading1"]),
            Paragraph(
                "HTWS became more effective as a share of the active browser footprint "
                "as the workload grew. Native discard remained below 8 percent at the "
                "10 second checkpoint in the median run for every scenario.",
                styles["Body"],
            ),
            *figure(
                args.charts_dir / "memory-saved-percent.png",
                "Figure 2  Median share of active working set released",
                styles,
            ),
            PageBreak(),
            Paragraph("Memory remaining after the action", styles["Heading1"]),
            Paragraph(
                "After HTWS hibernation, the median Brave working set stayed between "
                "roughly 479 MiB and 576 MiB because only the controller and extension "
                "processes remained. After native discard, the median footprint grew "
                "with the workload from about 1.17 GiB to 7.40 GiB in this test.",
                styles["Body"],
            ),
            *figure(
                args.charts_dir / "post-action-memory-footprint.png",
                "Figure 3  Median Brave process working set remaining",
                styles,
            ),
            Paragraph("Why the results differ", styles["Heading1"]),
            Paragraph(
                "Chrome describes Memory Saver as proactive tab discard. A discarded "
                "page is unloaded and reloads when the user returns to it. HTWS first "
                "writes a durable local restore record and then closes the selected tab. "
                "In this benchmark, native discard marked every workload tab as discarded "
                "but retained the full process count at the measurement point. HTWS "
                "removed the workload tabs and allowed their renderer processes to exit.",
                styles["Body"],
            ),
            PageBreak(),
            Paragraph("Experimental method", styles["Heading1"]),
        ]
    )
    method_items = [
        "Four scenarios: 10 tabs in 1 window, 30 tabs in 3 windows, 60 tabs in 6 windows, and 100 tabs in 10 windows.",
        "Three independent repetitions per scenario and method, for 24 fresh temporary Brave profiles. Method order alternated by repetition.",
        "Each local workload page allocated and touched 4 MiB of JavaScript memory, drew a 512 by 512 canvas, and created 750 DOM paragraphs.",
        "Both conditions loaded the same HTWS build. Native runs called the Chromium tabs discard API; HTWS runs sent the production session-hibernation command.",
        "The active baseline and post-action reading each used the median of five Windows process-tree samples taken 400 milliseconds apart.",
        "Post-action measurements began after a 10 second stabilization period. Working set includes the Brave root process and all descendants.",
    ]
    story.extend(bullet(item, styles) for item in method_items)
    story.append(Paragraph("Interpretation and limitations", styles["Heading1"]))
    limitations = [
        "This is a controlled synthetic workload on one Windows 10 computer and one Brave version. Real websites, hardware, extensions, and browser versions will produce different absolute numbers.",
        "Windows working set is resident process memory, not a stable per-tab measurement. It includes browser, renderer, GPU, utility, and extension processes in the isolated Brave tree.",
        "The native condition deliberately invoked Chromium discard. It did not wait for Brave's normal Memory Saver scheduler or simulate hours of inactivity.",
        "The report measures memory 10 seconds after each action. Native discard may release additional memory later or under stronger operating-system memory pressure.",
        "HTWS removes hibernated tabs from the tab strip and requires restoration through its archive. Native discard retains tab-strip entries and transparently reloads them.",
        "Three repetitions reveal large effects and one native-discard outlier, but a larger sample and multiple machines would be required for broad performance claims.",
    ]
    story.extend(bullet(item, styles) for item in limitations)
    story.extend(
        [
            Paragraph("Recommended public claim", styles["Heading1"]),
            Paragraph(
                "HTWS saves memory by securely recording tabs and closing them, instead "
                "of relying only on browser tab discard. In a controlled Brave benchmark "
                "on Windows, HTWS released substantially more process working set than "
                "native discard across 10 to 100 tabs. Actual savings vary by website, "
                "browser version, system, and time after hibernation.",
                styles["Body"],
            ),
            Paragraph("Sources and reproducibility", styles["Heading1"]),
        ]
    )
    references = [
        (
            "Google Chrome Help  Personalize Chrome performance",
            "https://support.google.com/chrome/answer/12929150",
        ),
        (
            "Chrome for Developers  Memory and Energy Saver modes",
            "https://developer.chrome.com/blog/memory-and-energy-saver-mode",
        ),
        (
            "Chrome Enterprise Help  High efficiency mode and tab discarding",
            "https://support.google.com/chrome/a/answer/2657289",
        ),
    ]
    for label, url in references:
        story.append(
            Paragraph(
                f'<a href="{url}" color="#155F8E">{escape(label)}</a><br/>'
                f'<font color="#526A78">{url}</font>',
                styles["Reference"],
            )
        )
    story.append(
        Paragraph(
            f"Raw benchmark data  {escape(args.input.name)}<br/>"
            f"Aggregated summary  {escape(args.summary.name)}<br/>"
            "Reproduction script  scripts/benchmark_memory_savings.mjs",
            styles["Reference"],
        )
    )
    story.extend(
        [
            PageBreak(),
            Paragraph("Appendix Raw results", styles["Heading1"]),
            Paragraph(
                "Working set values are aggregate Brave process-tree measurements. "
                "Rows are ordered by workload, method, and repetition.",
                styles["Body"],
            ),
            raw_table(results, styles),
        ]
    )
    document.build(story, onFirstPage=footer, onLaterPages=footer)


def register_fonts() -> None:
    files = {
        "Aptos": Path("C:/Windows/Fonts/aptos.ttf"),
        "Aptos-Bold": Path("C:/Windows/Fonts/aptos-bold.ttf"),
        "Aptos-Italic": Path("C:/Windows/Fonts/aptos-italic.ttf"),
    }
    if all(path.exists() for path in files.values()):
        for name, path in files.items():
            pdfmetrics.registerFont(TTFont(name, str(path)))


def font(kind: str) -> str:
    if "Aptos" in pdfmetrics.getRegisteredFontNames():
        return {"regular": "Aptos", "bold": "Aptos-Bold", "italic": "Aptos-Italic"}[kind]
    return {"regular": "Helvetica", "bold": "Helvetica-Bold", "italic": "Helvetica-Oblique"}[kind]


def make_styles() -> dict[str, ParagraphStyle]:
    sample = getSampleStyleSheet()
    return {
        "Title": ParagraphStyle("TitleX", parent=sample["Title"], fontName=font("bold"), fontSize=25, leading=29, textColor=colors.black, alignment=TA_LEFT, spaceAfter=4),
        "Subtitle": ParagraphStyle("SubtitleX", fontName=font("italic"), fontSize=13, leading=17, textColor=MUTED, spaceAfter=18),
        "Meta": ParagraphStyle("MetaX", fontName=font("regular"), fontSize=9.5, leading=13, textColor=INK, spaceAfter=8),
        "Heading1": ParagraphStyle("HeadingX", fontName=font("bold"), fontSize=17, leading=20, textColor=colors.black, spaceBefore=9, spaceAfter=6),
        "Body": ParagraphStyle("BodyX", fontName=font("regular"), fontSize=9.5, leading=13.5, textColor=INK, spaceAfter=7),
        "Bullet": ParagraphStyle("BulletX", fontName=font("regular"), fontSize=9.2, leading=13, textColor=INK, leftIndent=14, firstLineIndent=-9, spaceAfter=4),
        "Caption": ParagraphStyle("CaptionX", fontName=font("italic"), fontSize=8.5, leading=11, alignment=TA_CENTER, textColor=MUTED, spaceAfter=7),
        "Reference": ParagraphStyle("ReferenceX", fontName=font("regular"), fontSize=8.8, leading=12, textColor=INK, spaceAfter=6),
        "Table": ParagraphStyle("TableX", fontName=font("regular"), fontSize=7.6, leading=9.2, textColor=INK, alignment=TA_CENTER),
        "TableHeader": ParagraphStyle("TableHeaderX", fontName=font("bold"), fontSize=7.5, leading=9.0, textColor=colors.white, alignment=TA_CENTER),
    }


def rows_for(summary: list[dict[str, Any]], method: str) -> list[dict[str, Any]]:
    return sorted((row for row in summary if row["method"] == method), key=lambda row: row["tabs"])


def bullet(text: str, styles: dict[str, ParagraphStyle]) -> Paragraph:
    return Paragraph(f"&bull;&nbsp;&nbsp;{escape(text)}", styles["Bullet"])


def figure(path: Path, caption: str, styles: dict[str, ParagraphStyle]) -> list[Any]:
    return [
        Image(str(path), width=6.75 * inch, height=3.65 * inch),
        Spacer(1, 0.04 * inch),
        Paragraph(caption, styles["Caption"]),
    ]


def summary_table(native: list[dict[str, Any]], htws: list[dict[str, Any]], styles: dict[str, ParagraphStyle]) -> Table:
    headers = ["Workload", "Native saved", "HTWS saved", "Native percent", "HTWS percent", "HTWS advantage"]
    data: list[list[Any]] = [[Paragraph(value, styles["TableHeader"]) for value in headers]]
    for native_row, htws_row in zip(native, htws, strict=True):
        values = [
            f"{native_row['tabs']} tabs<br/>{native_row['windows']} window{'s' if native_row['windows'] != 1 else ''}",
            f"{native_row['saved_mib_median']:,.1f} MiB",
            f"{htws_row['saved_mib_median']:,.1f} MiB",
            f"{native_row['saved_pct_median']:.1f}%",
            f"{htws_row['saved_pct_median']:.1f}%",
            f"{htws_row['saved_mib_median'] / native_row['saved_mib_median']:.1f}x",
        ]
        data.append([Paragraph(value, styles["Table"]) for value in values])
    table = Table(data, colWidths=[1.15 * inch, 1.05 * inch, 1.05 * inch, 0.95 * inch, 0.95 * inch, 1.0 * inch], repeatRows=1)
    style_table(table, len(data), 6)
    return table


def raw_table(results: list[dict[str, Any]], styles: dict[str, ParagraphStyle]) -> Table:
    headers = ["Tabs", "Windows", "Method", "Run", "Active MiB", "Post MiB", "Saved MiB", "Saved percent", "Processes after"]
    data: list[list[Any]] = [[Paragraph(value, styles["TableHeader"]) for value in headers]]
    for row in sorted(results, key=lambda item: (item["tabCount"], item["method"], item["repetition"])):
        values = [
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
        data.append([Paragraph(value, styles["Table"]) for value in values])
    widths = [0.42, 0.58, 1.05, 0.42, 0.78, 0.78, 0.78, 0.75, 0.78]
    table = Table(data, colWidths=[value * inch for value in widths], repeatRows=1)
    style_table(table, len(data), 4)
    return table


def style_table(table: Table, row_count: int, padding: int) -> None:
    commands: list[tuple[Any, ...]] = [
        ("GRID", (0, 0), (-1, -1), 0.45, GRID),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BACKGROUND", (0, 0), (-1, 0), DEEP_BLUE),
        ("TOPPADDING", (0, 0), (-1, -1), padding),
        ("BOTTOMPADDING", (0, 0), (-1, -1), padding),
        ("LEFTPADDING", (0, 0), (-1, -1), padding),
        ("RIGHTPADDING", (0, 0), (-1, -1), padding),
    ]
    for row in range(1, row_count):
        commands.append(("BACKGROUND", (0, row), (-1, row), PALE_BLUE if row % 2 == 0 else colors.white))
    table.setStyle(TableStyle(commands))


def footer(canvas: Any, document: Any) -> None:
    canvas.saveState()
    canvas.setFont(font("regular"), 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(
        letter[0] - 0.68 * inch,
        0.34 * inch,
        f"HTWS Memory Benchmark  |  15 November 2026  |  Page {document.page}",
    )
    canvas.restoreState()


def escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


if __name__ == "__main__":
    main()
