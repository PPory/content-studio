#!/usr/bin/env python3
"""Validate and losslessly chunk weekly Markdown materials.

This script intentionally reads only rendered Markdown. It does not read raw JSON,
rank items, filter content, summarize text, or fetch network resources.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence

# 所有产物一律写 LF。Windows 上 `write_text` 默认把 \n 翻成 \r\n，而这些文件会被
# JS 侧读——**JS 正则的 `.` 不匹配 `\r`**（Python 的匹配），一条写得好好的
# `/^#.+?\n/` 会静默失配，不报错、只是少做一件事。踩过一次，查了半小时。
LF = "\n"

WEEK_RE = re.compile(r"^\d{4}-W\d{2}$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2})(?:T[^\s]*)?")
URL_RE = re.compile(r"https?://[^\s\]\[()<>{}\"']+")
CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
SOURCE_KINDS = ("reddit", "x", "aihot")

# 洞察在 vault 里的位置。和 lib/material.mjs 的 INSIGHT_DIR、工作台的
# server/lib/vault-dirs.mjs 是同一个值，**改一处要改三处**（skill 独立跑，
# 不 import 工作台的代码）。对不上的表现是这里找不到材料文件而直接报错——
# 相比之下这是好结局，material.mjs 那边对不上是**安静地写去别的地方**。
INSIGHT_DIR = "99 - 个人工作台/02 - 洞察"


@dataclass(frozen=True)
class Span:
    """A half-open range of original lines."""

    start: int
    end: int

    def char_count(self, lines: Sequence[str]) -> int:
        return sum(len(line) for line in lines[self.start : self.end])


@dataclass(frozen=True)
class Chunk:
    source_kind: str
    index: int
    span: Span
    text: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Check the three weekly Markdown material files and create lossless, "
            "heading-aware chunks plus a coverage manifest."
        )
    )
    parser.add_argument("--vault", type=Path, help=f"Vault root containing {INSIGHT_DIR}/_material")
    parser.add_argument("--week", required=True, help="ISO week, for example 2026-W33")
    parser.add_argument("--reddit", type=Path, help="Explicit Reddit Markdown path")
    parser.add_argument("--x", dest="x_path", type=Path, help="Explicit X Markdown path")
    parser.add_argument("--aihot", type=Path, help="Explicit AIHot Markdown path")
    parser.add_argument(
        "--output",
        type=Path,
        help=f"Working output directory; default: <vault>/{INSIGHT_DIR}/_work/<week>",
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=24000,
        help="Approximate maximum original characters per chunk (default: 24000)",
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Validate and print a JSON summary without writing chunks",
    )
    return parser.parse_args()


def resolve_paths(args: argparse.Namespace) -> tuple[Path, dict[str, Path], Path]:
    if not WEEK_RE.fullmatch(args.week):
        raise ValueError(f"Invalid --week '{args.week}'. Expected YYYY-Www, e.g. 2026-W33.")
    if args.max_chars < 4000:
        raise ValueError("--max-chars must be at least 4000 to avoid destructive micro-chunks.")

    explicit = {
        "reddit": args.reddit,
        "x": args.x_path,
        "aihot": args.aihot,
    }

    if args.vault is None and not all(explicit.values()):
        raise ValueError("Provide --vault or all three explicit paths: --reddit, --x, --aihot.")

    vault = (args.vault or Path.cwd()).expanduser().resolve()
    material_dir = vault / INSIGHT_DIR / "_material"

    paths: dict[str, Path] = {}
    for kind in SOURCE_KINDS:
        supplied = explicit[kind]
        path = supplied if supplied is not None else material_dir / f"{args.week}-{kind}.md"
        paths[kind] = path.expanduser().resolve()

    output = args.output
    if output is None:
        output = vault / INSIGHT_DIR / "_work" / args.week
    output = output.expanduser().resolve()
    return vault, paths, output


def read_markdown(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError(f"{path} is not valid UTF-8 Markdown: {exc}") from exc


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def approximate_tokens(text: str) -> int:
    """Rough mixed Chinese/Latin token estimate, for planning only."""

    cjk = len(CJK_RE.findall(text))
    non_cjk_non_space = sum(1 for ch in text if not ch.isspace() and not CJK_RE.match(ch))
    return max(1, round(cjk + non_cjk_non_space / 4))


def extract_frontmatter(text: str) -> tuple[bool, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return False, ""
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return True, "\n".join(lines[1:index])
    return False, ""


def clean_url(url: str) -> str:
    return url.rstrip(".,;:!?，。；：！？")


def summarize_source(kind: str, path: Path, text: str) -> dict[str, object]:
    lines = text.splitlines()
    headings: dict[str, int] = {str(level): 0 for level in range(1, 7)}
    level2_sections: list[str] = []
    numbered_headings = 0

    for line in lines:
        match = HEADING_RE.match(line)
        if not match:
            continue
        level = len(match.group(1))
        title = match.group(2).strip()
        headings[str(level)] += 1
        if level == 2:
            level2_sections.append(title)
        if re.match(r"^\d+[.)、]\s*", title):
            numbered_headings += 1

    dates = sorted({match.group(1) for match in DATE_RE.finditer(text)})
    urls = sorted({clean_url(match.group(0)) for match in URL_RE.finditer(text)})
    has_frontmatter, frontmatter = extract_frontmatter(text)

    warnings: list[str] = []
    if not text.strip():
        warnings.append("empty file")
    if len(text) < 1000:
        warnings.append("unusually small file")
    if not has_frontmatter:
        warnings.append("YAML frontmatter not detected")
    if not urls:
        warnings.append("no URLs detected")
    if not dates:
        warnings.append("no ISO dates detected")
    if kind == "reddit" and not any("热议" in section for section in level2_sections):
        warnings.append("expected Reddit section '热议' not detected")
    if kind == "aihot":
        # Substring match, not set difference: upstream renders headings with a count
        # suffix ("产品发布/更新（32 条）"), so exact matching flags every section as
        # missing. The Reddit check above already does it this way.
        #
        # Warn only when *none* of the expected sections appear. A single missing
        # category is normal -- the daily roundup's volume swings hard (one observed
        # day had 5 sections / 20 items, the next had 1 section / 4 items), so
        # per-category warnings would cry wolf most weeks. Zero matches is different:
        # that means upstream restructured and the shape assumptions no longer hold.
        expected = ("模型发布", "产品发布", "行业动态", "论文研究", "技巧与观点")
        found = [name for name in expected if any(name in section for section in level2_sections)]
        if not found:
            warnings.append(
                "AIHot section names do not match any expected category "
                f"({', '.join(expected)}); upstream layout may have changed"
            )

    stat = path.stat()
    return {
        "source_kind": kind,
        "path": str(path),
        "bytes": stat.st_size,
        "characters": len(text),
        "lines": len(lines),
        "approx_tokens": approximate_tokens(text),
        "sha256": sha256_text(text),
        "has_frontmatter": has_frontmatter,
        "frontmatter_preview": frontmatter[:500],
        "heading_counts": headings,
        "numbered_heading_count": numbered_headings,
        "level2_sections": level2_sections,
        "date_min": dates[0] if dates else None,
        "date_max": dates[-1] if dates else None,
        "unique_url_count": len(urls),
        "comment_block_count": len(re.findall(r"\*\*评论", text)),
        "truncation_marker_count": len(re.findall(r"截断|truncat", text, flags=re.IGNORECASE)),
        "title_only_marker_count": len(re.findall(r"没抓到内容|仅标题|title[- ]only", text, flags=re.IGNORECASE)),
        "warnings": warnings,
    }


def heading_units(lines: Sequence[str]) -> list[Span]:
    """Split before headings while preserving every original line exactly once."""

    starts = [0]
    for index, line in enumerate(lines):
        if index == 0:
            continue
        match = HEADING_RE.match(line.rstrip("\n\r"))
        if match and len(match.group(1)) <= 4:
            starts.append(index)
    starts = sorted(set(starts))
    spans: list[Span] = []
    for pos, start in enumerate(starts):
        end = starts[pos + 1] if pos + 1 < len(starts) else len(lines)
        if start < end:
            spans.append(Span(start, end))
    return spans or [Span(0, len(lines))]


def split_span_by_paragraphs(span: Span, lines: Sequence[str], max_chars: int) -> list[Span]:
    if span.char_count(lines) <= max_chars:
        return [span]

    paragraph_spans: list[Span] = []
    start = span.start
    index = start
    while index < span.end:
        if lines[index].strip() == "" and index + 1 > start:
            paragraph_spans.append(Span(start, index + 1))
            start = index + 1
        index += 1
    if start < span.end:
        paragraph_spans.append(Span(start, span.end))

    result: list[Span] = []
    current_start: int | None = None
    current_end: int | None = None
    current_chars = 0

    def flush() -> None:
        nonlocal current_start, current_end, current_chars
        if current_start is not None and current_end is not None:
            result.append(Span(current_start, current_end))
        current_start = None
        current_end = None
        current_chars = 0

    for paragraph in paragraph_spans:
        paragraph_chars = paragraph.char_count(lines)
        if paragraph_chars > max_chars:
            flush()
            line_start = paragraph.start
            running_chars = 0
            for line_index in range(paragraph.start, paragraph.end):
                line_chars = len(lines[line_index])
                if running_chars and running_chars + line_chars > max_chars:
                    result.append(Span(line_start, line_index))
                    line_start = line_index
                    running_chars = 0
                running_chars += line_chars
            if line_start < paragraph.end:
                result.append(Span(line_start, paragraph.end))
            continue

        if current_start is None:
            current_start = paragraph.start
            current_end = paragraph.end
            current_chars = paragraph_chars
        elif current_chars + paragraph_chars <= max_chars:
            current_end = paragraph.end
            current_chars += paragraph_chars
        else:
            flush()
            current_start = paragraph.start
            current_end = paragraph.end
            current_chars = paragraph_chars

    flush()
    return result


def make_chunks(kind: str, text: str, max_chars: int) -> list[Chunk]:
    lines = text.splitlines(keepends=True)
    if not lines:
        return []

    fine_spans: list[Span] = []
    for unit in heading_units(lines):
        fine_spans.extend(split_span_by_paragraphs(unit, lines, max_chars))

    assembled: list[Span] = []
    current_start: int | None = None
    current_end: int | None = None
    current_chars = 0

    def flush() -> None:
        nonlocal current_start, current_end, current_chars
        if current_start is not None and current_end is not None:
            assembled.append(Span(current_start, current_end))
        current_start = None
        current_end = None
        current_chars = 0

    for span in fine_spans:
        span_chars = span.char_count(lines)
        if current_start is None:
            current_start = span.start
            current_end = span.end
            current_chars = span_chars
        elif current_chars + span_chars <= max_chars:
            current_end = span.end
            current_chars += span_chars
        else:
            flush()
            current_start = span.start
            current_end = span.end
            current_chars = span_chars
    flush()

    chunks: list[Chunk] = []
    for index, span in enumerate(assembled, start=1):
        chunk_text = "".join(lines[span.start : span.end])
        chunks.append(Chunk(kind, index, span, chunk_text))
    return chunks


def write_outputs(
    week: str,
    vault: Path,
    output: Path,
    source_summaries: dict[str, dict[str, object]],
    chunks_by_source: dict[str, list[Chunk]],
) -> dict[str, object]:
    output.mkdir(parents=True, exist_ok=True)
    chunks_dir = output / "chunks"
    if chunks_dir.exists():
        shutil.rmtree(chunks_dir)
    chunks_dir.mkdir(parents=True)

    chunk_records: list[dict[str, object]] = []
    for kind in SOURCE_KINDS:
        source_path = Path(str(source_summaries[kind]["path"]))
        source_hash = str(source_summaries[kind]["sha256"])
        source_chunks = chunks_by_source[kind]
        for chunk in source_chunks:
            filename = f"{kind}-{chunk.index:03d}.md"
            chunk_path = chunks_dir / filename
            header = (
                "<!-- PIR_CHUNK_METADATA\n"
                f"week: {week}\n"
                f"source_kind: {kind}\n"
                f"source_file: {source_path}\n"
                f"source_sha256: {source_hash}\n"
                f"chunk_index: {chunk.index}\n"
                f"chunk_count: {len(source_chunks)}\n"
                f"original_line_start: {chunk.span.start + 1}\n"
                f"original_line_end: {chunk.span.end}\n"
                "content_policy: exact excerpt; no filtering or summarization\n"
                "-->\n\n"
            )
            # newline 显式写死：Windows 上 write_text 默认把 \n 翻成 \r\n，而这些产物
            # 会被 JS 侧读——JS 的 `.` 不匹配 \r，一条写得好好的正则会静默失配。
            chunk_path.write_text(header + chunk.text, encoding="utf-8", newline=LF)
            chunk_records.append(
                {
                    "source_kind": kind,
                    "chunk_index": chunk.index,
                    "path": str(chunk_path),
                    "original_line_start": chunk.span.start + 1,
                    "original_line_end": chunk.span.end,
                    "characters": len(chunk.text),
                    "approx_tokens": approximate_tokens(chunk.text),
                    "sha256": sha256_text(chunk.text),
                }
            )

    manifest: dict[str, object] = {
        "schema_version": 1,
        "week": week,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "vault": str(vault),
        "output": str(output),
        "preprocessing_policy": (
            "Rendered Markdown only. Exact-content chunking; no network access, filtering, "
            "ranking, summarization, or raw JSON reads."
        ),
        "sources": source_summaries,
        "chunks": chunk_records,
        "totals": {
            "bytes": sum(int(item["bytes"]) for item in source_summaries.values()),
            "characters": sum(int(item["characters"]) for item in source_summaries.values()),
            "approx_tokens": sum(int(item["approx_tokens"]) for item in source_summaries.values()),
            "unique_urls_sum_by_file": sum(
                int(item["unique_url_count"]) for item in source_summaries.values()
            ),
            "chunk_count": len(chunk_records),
        },
    }

    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline=LF
    )
    (output / "manifest.md").write_text(
        render_manifest_markdown(manifest), encoding="utf-8", newline=LF
    )
    return manifest


def render_manifest_markdown(manifest: dict[str, object]) -> str:
    sources = manifest["sources"]
    totals = manifest["totals"]
    assert isinstance(sources, dict)
    assert isinstance(totals, dict)

    lines = [
        f"# {manifest['week']} Material Manifest",
        "",
        "> This manifest describes rendered Markdown inputs. It does not imply raw-pool coverage.",
        "",
        "## Totals",
        "",
        f"- Characters: {totals['characters']:,}",
        f"- Approximate tokens: {totals['approx_tokens']:,}",
        f"- Chunks: {totals['chunk_count']}",
        f"- URLs (sum of per-file unique counts): {totals['unique_urls_sum_by_file']}",
        "",
        "## Sources",
        "",
        "| Source | Characters | Approx tokens | Date range | Sections | URLs | Warnings |",
        "|---|---:|---:|---|---|---:|---|",
    ]
    for kind in SOURCE_KINDS:
        item = sources[kind]
        assert isinstance(item, dict)
        date_range = f"{item['date_min'] or 'n/a'} → {item['date_max'] or 'n/a'}"
        sections = ", ".join(item["level2_sections"]) or "n/a"
        warnings = "; ".join(item["warnings"]) or "none"
        lines.append(
            f"| {kind} | {item['characters']:,} | {item['approx_tokens']:,} | "
            f"{date_range} | {sections} | {item['unique_url_count']} | {warnings} |"
        )

    lines.extend(
        [
            "",
            "## Required interpretation boundary",
            "",
            "- Treat these files as an upstream-curated observation window, not a raw social population.",
            "- Review `references/input-contract.md` before comparing sources or inferring absence.",
            "- Each chunk preserves an exact contiguous excerpt and records original line ranges.",
            "",
        ]
    )
    return "\n".join(lines)


def validate_inputs(paths: dict[str, Path]) -> list[str]:
    errors: list[str] = []
    for kind, path in paths.items():
        if not path.exists():
            errors.append(f"missing {kind} file: {path}")
        elif not path.is_file():
            errors.append(f"not a file for {kind}: {path}")
        elif path.stat().st_size == 0:
            errors.append(f"empty {kind} file: {path}")
    return errors


def main() -> int:
    args = parse_args()
    try:
        vault, paths, output = resolve_paths(args)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    errors = validate_inputs(paths)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print(
            "The fetcher is an external dependency. Run the user's existing fetch-material.mjs "
            "after inspecting its --help; this script will not fetch or read raw JSON.",
            file=sys.stderr,
        )
        return 2

    source_texts: dict[str, str] = {}
    source_summaries: dict[str, dict[str, object]] = {}
    chunks_by_source: dict[str, list[Chunk]] = {}

    try:
        for kind in SOURCE_KINDS:
            text = read_markdown(paths[kind])
            source_texts[kind] = text
            source_summaries[kind] = summarize_source(kind, paths[kind], text)
            chunks_by_source[kind] = make_chunks(kind, text, args.max_chars)
    except (OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 3

    if args.check_only:
        summary = {
            "week": args.week,
            "vault": str(vault),
            "sources": source_summaries,
            "totals": {
                "characters": sum(len(text) for text in source_texts.values()),
                "approx_tokens": sum(approximate_tokens(text) for text in source_texts.values()),
                "chunk_count": sum(len(chunks) for chunks in chunks_by_source.values()),
            },
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    try:
        manifest = write_outputs(
            week=args.week,
            vault=vault,
            output=output,
            source_summaries=source_summaries,
            chunks_by_source=chunks_by_source,
        )
    except OSError as exc:
        print(f"ERROR: failed to write output: {exc}", file=sys.stderr)
        return 4

    totals = manifest["totals"]
    assert isinstance(totals, dict)
    print(f"Prepared {totals['chunk_count']} chunks in {output}")
    print(f"Manifest: {output / 'manifest.json'}")
    print(f"Coverage note: {output / 'manifest.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
