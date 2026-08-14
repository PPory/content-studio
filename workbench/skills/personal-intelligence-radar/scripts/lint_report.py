#!/usr/bin/env python3
"""Lint a Personal Intelligence Radar Markdown report and its sidecar artifacts.

The linter checks structure, promotion gates, cross-section consistency, and
traceability. It still cannot judge whether an interpretation is substantively
correct, so a passing result is necessary but not sufficient.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

# 必须有：少一个这份报告就不成立。
ALWAYS_REQUIRED_H2 = [
    "一页结论",
    "数据覆盖与证据边界",
    "Top Insight Cards",
    "Write Queue",
    "核实记录与局限",
]

# 可以缺席，但缺了必须在 OMISSION_SECTION 里点名。
# 「必须逐项检查」是对**分析**的要求，不是对**阅读**的要求——这周真没东西的雷达项
# 画成一个写着「本周材料不足」的空壳，只会让人多翻一屏。
# 这些键是**标题里稳定的那一截**，不是完整显示标题——标题要能改成双语、能微调措辞，
# 拿完整标题当键的话，改一次显示就得同步改这里一次，迟早对不上。
OPTIONAL_H2 = [
    "本周新信号",
    "Learn Queue",
    "值得持续追踪的问题",
    "认知冲突与反共识",
    "跨领域连接",
    "人物与注意力迁移",
    "Source Gems",
    "Noise / Ignore",
]

# 缺席清单本身是必需的：少了它，读的人分不出「查过了没有」和「压根没查」，
# 而那正是这套框架最不该丢的东西。
OMISSION_SECTION = "本周未产出的雷达项"

CARD_METADATA_FIELDS = [
    "Action",
    "Fact status",
    "Pattern maturity",
    "Interpretation confidence",
    "Opportunity validation",
    "Priority score",
    "Score basis",
]

CARD_SECTION_FIELDS = [
    "Signal / Observation",
    "Evidence",
    "Why it matters",
    "Underlying pattern / Interpretation",
    "Cognitive conflict",
    "Knowledge gap",
    "Personal relevance",
    "Content opportunity",
    "Possible angles",
    "Cross-domain connection",
    "Open question",
    "Verification",
    "What would change my mind",
]

VALID_ACTIONS = {"Write", "Learn", "Explore", "Watch", "Ignore"}
VALID_INTERPRETATION_CONFIDENCE = {"High", "Medium-high", "Medium", "Low"}
VALID_FACT_STATUSES = {
    "Primary verified",
    "Official claim only",
    "Independently corroborated",
    "Secondary only",
    "Unverified",
    "Contradicted",
    "Not applicable",
}
VALID_PATTERN_MATURITY = {
    "Single event",
    "Recurrent",
    "Cross-source",
    "Cross-week",
    "Conceptual",
    "Material observation",
}
VALID_OPPORTUNITY_VALIDATION = {
    "Not assessed",
    "Material-only",
    "Supply-audited",
    "Validated",
    "Not applicable",
}
VALID_QUEUE_STATUS = {"ready", "needs_research", "weak_signal", "watch", "ignore"}
VALID_LEDGER_STATUS = {
    "verified",
    "partially_verified",
    "contradicted",
    "unverified",
    "not_applicable",
}

PLACEHOLDER_RE = re.compile(r"\b(?:TODO|TBD|FIXME)\b|待补|占位符", re.IGNORECASE)
OVERCLAIM_RE = re.compile(r"全网都|大多数用户|所有人都|普遍认为|没有人讨论")
TREND_WORD_RE = re.compile(r"稳定|持续|正在成为|已经成为|上升|下降|迁移|转向|行业趋势|普遍")
SUPPLY_CLAIM_RE = re.compile(r"低竞争|供给稀缺|没人(?:写|讲|讨论)|几乎无人|几乎没有|内容空白")
CARD_HEADING_RE = re.compile(r"^###\s+(IC-\d+)\s*[｜|:]\s*(.+?)\s*$", re.MULTILINE)
H2_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
URL_RE = re.compile(r"https?://")
ABSOLUTE_DATE_RE = re.compile(r"\b20\d{2}-\d{2}-\d{2}\b")
ACTION_COUNTS_RE = re.compile(
    r"本周行动分配[：:]\*?\*?\s*Write\s+(\d+)\s*[·|]\s*Learn\s+(\d+)\s*[·|]\s*"
    r"Explore\s+(\d+)\s*[·|]\s*Watch\s+(\d+)\s*[·|]\s*Ignore\s+(\d+)",
    re.IGNORECASE,
)


@dataclass
class Finding:
    level: str
    message: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Lint a weekly personal intelligence report")
    parser.add_argument("report", type=Path, help="Markdown report path")
    parser.add_argument("--manifest", type=Path, help="material manifest.json path")
    parser.add_argument("--registry", type=Path, help="candidate-registry.json path")
    parser.add_argument("--ledger", type=Path, help="verification-ledger.jsonl path")
    parser.add_argument("--max-chars", type=int, default=18000, help="Recommended report character budget")
    parser.add_argument(
        "--max-card-chars", type=int, default=2200, help="Recommended character budget per Top Card"
    )
    parser.add_argument(
        "--legacy-ok",
        action="store_true",
        help="Allow schema-1 reports; new quality fields become warnings rather than errors",
    )
    return parser.parse_args()


def normalize_heading(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}, text
    block = text[4:end]
    values: dict[str, str] = {}
    for line in block.splitlines():
        if not line.strip() or line.lstrip().startswith("#") or line.startswith((" ", "\t")):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        values[key.strip()] = value.strip().strip('"\'')
    return values, text[end + 5 :]


def card_sections(text: str) -> list[tuple[str, str, str]]:
    matches = list(CARD_HEADING_RE.finditer(text))
    cards: list[tuple[str, str, str]] = []
    for index, match in enumerate(matches):
        start = match.end()
        next_card = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        next_h2_match = re.search(r"^##\s+", text[start:next_card], flags=re.MULTILINE)
        end = start + next_h2_match.start() if next_h2_match else next_card
        cards.append((match.group(1), match.group(2).strip(), text[start:end]))
    return cards


# 卡片元信息排成一张两行的表：列头是短中文标签，值是 Registry 那套受控词汇。
#
# 为什么不是「标签：值」的列表——不管一行还是七行。`解释置信度 Interpretation
# confidence：Medium-high` 是 20 个字的标签配 11 个字的值，**标签比数据还长**；
# 六组这样的东西排在一起，屏幕上先折行再换行，分组当场消失。表格把每个标签只写一次，
# 值对齐成一行，扫一眼就完了。这是六个字段一条记录，本来就是张表。
METADATA_LABELS = {
    "行动": "Action",
    "优先级": "Priority score",
    "事实": "Fact status",
    "模式": "Pattern maturity",
    "解释": "Interpretation confidence",
    "机会": "Opportunity validation",
    "评分构成": "Score basis",
}

_SCORE_BASIS_RE = re.compile(r"评分构成\s*[：:]?\s*([NIEDLCP0-9/\s·]+)")


def parse_metadata_table(card_text: str) -> dict[str, str]:
    """从卡片开头那张表里读元信息。读不到就返回空 dict，由旧的 `**字段**` 形式兜底。"""
    rows = [line.strip() for line in card_text.splitlines() if line.strip().startswith("|")]
    if len(rows) < 3:
        return {}
    cells = lambda row: [c.strip() for c in row.strip("|").split("|")]
    header, values = cells(rows[0]), cells(rows[2])
    if len(header) != len(values):
        return {}
    found: dict[str, str] = {}
    for label, value in zip(header, values):
        field = METADATA_LABELS.get(re.sub(r"[*`\s]", "", label))
        if field:
            # 值可能被加粗强调（`**Write**`），去掉标记再交出去。
            found[field] = value.replace("*", "").strip()
    if not found:
        return {}
    basis = _SCORE_BASIS_RE.search(card_text)
    if basis and "Score basis" not in found:
        found["Score basis"] = basis.group(1).strip()
    return found


# 字段名后面允许跟一段中文注解（`**Evidence 证据**`）。一份中文报告里嵌一套
# 只有英文的字段名，读的人每次都要先在脑子里翻译一遍。
# 用 [^*：:]* 而不是 [^*]*，免得把冒号后面的值也吞进字段名。
def _field_pattern(field: str) -> str:
    # 中文注解放在英文前面还是后面都认（`**行动 Action：**` / `**Action 行动：**`）。
    # 中文在前更好读，而这套字段名没有一个是另一个的子串，所以放宽不会串台。
    return rf"\*\*[^*：:]*{re.escape(field)}[^*：:]*[：:]?\*\*"


def extract_bold_field(card_text: str, field: str) -> str | None:
    # 值取到「行尾」或「同一行的下一个字段」为止。后者让一行放得下两个字段，
    # 七行元信息才能压成三行；元信息的值里不会出现 **，所以这个前瞻是安全的。
    pattern = re.compile(rf"{_field_pattern(field)}\s*(.*?)(?=\s+\*\*|\n|$)", re.IGNORECASE)
    match = pattern.search(card_text)
    return match.group(1).strip() if match else None


def has_bold_field(card_text: str, field: str) -> bool:
    return bool(re.search(_field_pattern(field), card_text, re.IGNORECASE))


def extract_section(card_text: str, field: str, next_fields: Iterable[str]) -> str:
    alternatives = "|".join(
        r"[^*：:]*" + re.escape(item) + r"[^*：:]*[：:]?" for item in next_fields
    )
    pattern = re.compile(
        rf"{_field_pattern(field)}\s*(.*?)(?=\n\*\*(?:{alternatives})\*\*|\Z)",
        flags=re.DOTALL | re.IGNORECASE,
    )
    match = pattern.search(card_text)
    return match.group(1).strip() if match else ""


def parse_action_sequence(value: str | None) -> list[str]:
    if not value:
        return []
    normalized = value.replace("->", "→").replace("/", "→")
    sequence = []
    for part in normalized.split("→"):
        clean = re.sub(r"[^A-Za-z-]", "", part)
        for action in VALID_ACTIONS:
            if action.lower() == clean.lower() or action in part:
                sequence.append(action)
                break
    if not sequence:
        for action in VALID_ACTIONS:
            if action in value:
                sequence.append(action)
    return sequence


def parse_score(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"\b(100|\d{1,2})\b", value)
    return int(match.group(1)) if match else None


def parse_score_basis(value: str | None) -> dict[str, int]:
    if not value:
        return {}
    mapping: dict[str, int] = {}
    for key in ("N", "I", "E", "D", "L", "C"):
        match = re.search(rf"\b{key}\s*([0-5])\b", value, re.IGNORECASE)
        if match:
            mapping[key.upper()] = int(match.group(1))
    penalty = re.search(r"(?:Penalty|P)\s*[:=]?\s*(\d{1,2})", value, re.IGNORECASE)
    if penalty:
        mapping["P"] = int(penalty.group(1))
    return mapping


def load_manifest(path: Path | None, findings: list[Finding]) -> dict[str, Any] | None:
    if path is None:
        findings.append(Finding("WARNING", "No --manifest supplied; material hashes were not checked."))
        return None
    resolved = path.expanduser().resolve()
    if not resolved.exists():
        findings.append(Finding("ERROR", f"Material manifest not found: {resolved}"))
        return None
    try:
        data = json.loads(resolved.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        findings.append(Finding("ERROR", f"Cannot read material manifest: {exc}"))
        return None
    if not isinstance(data, dict) or not isinstance(data.get("sources"), dict):
        findings.append(Finding("ERROR", "Material manifest must contain a sources object."))
        return None
    return data


def load_registry(path: Path | None, findings: list[Finding]) -> dict[str, Any] | None:
    if path is None:
        findings.append(Finding("WARNING", "No --registry supplied; cross-section action consistency was not checked."))
        return None
    resolved = path.expanduser().resolve()
    if not resolved.exists():
        findings.append(Finding("ERROR", f"Candidate Registry not found: {resolved}"))
        return None
    try:
        data = json.loads(resolved.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        findings.append(Finding("ERROR", f"Cannot read Candidate Registry: {exc}"))
        return None
    if not isinstance(data, dict) or not isinstance(data.get("candidates"), list):
        findings.append(Finding("ERROR", "Candidate Registry must contain a candidates array."))
        return None
    if data.get("schema_version") != 2:
        findings.append(Finding("ERROR", "Candidate Registry schema_version must be 2."))
    return data


def load_ledger(path: Path | None, findings: list[Finding]) -> list[dict[str, Any]] | None:
    if path is None:
        findings.append(Finding("WARNING", "No --ledger supplied; load-bearing claim gates were not checked."))
        return None
    resolved = path.expanduser().resolve()
    if not resolved.exists():
        findings.append(Finding("ERROR", f"Verification Ledger not found: {resolved}"))
        return None
    rows: list[dict[str, Any]] = []
    try:
        for line_number, raw in enumerate(resolved.read_text(encoding="utf-8-sig").splitlines(), start=1):
            if not raw.strip():
                continue
            item = json.loads(raw)
            if not isinstance(item, dict):
                raise ValueError(f"line {line_number} is not an object")
            if item.get("status") not in VALID_LEDGER_STATUS:
                raise ValueError(f"line {line_number} has invalid status: {item.get('status')}")
            rows.append(item)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        findings.append(Finding("ERROR", f"Cannot read Verification Ledger: {exc}"))
        return None
    return rows


def lint_registry(
    registry: dict[str, Any] | None,
    ledger: list[dict[str, Any]] | None,
    report_cards: dict[str, dict[str, Any]],
    summary_counts: dict[str, int] | None,
    findings: list[Finding],
) -> None:
    if registry is None:
        return

    registry_cards: dict[str, dict[str, Any]] = {}
    primary_counts: Counter[str] = Counter()
    candidates = registry.get("candidates", [])
    seen_ids: set[str] = set()

    for raw in candidates:
        if not isinstance(raw, dict):
            findings.append(Finding("ERROR", "Candidate Registry contains a non-object candidate."))
            continue
        candidate_id = str(raw.get("candidate_id", "")).strip()
        if not candidate_id:
            findings.append(Finding("ERROR", "Candidate Registry candidate missing candidate_id."))
            continue
        if candidate_id in seen_ids:
            findings.append(Finding("ERROR", f"Duplicate candidate_id in Registry: {candidate_id}"))
            continue
        seen_ids.add(candidate_id)

        sequence = raw.get("action_sequence")
        if not isinstance(sequence, list) or not sequence or any(item not in VALID_ACTIONS for item in sequence):
            findings.append(Finding("ERROR", f"{candidate_id} Registry action_sequence is invalid."))
            sequence = []
        primary = raw.get("primary_action")
        if primary not in VALID_ACTIONS:
            findings.append(Finding("ERROR", f"{candidate_id} Registry primary_action is invalid."))
        elif sequence and primary != sequence[0]:
            findings.append(
                Finding("ERROR", f"{candidate_id} primary_action must equal the first action_sequence item.")
            )
        else:
            primary_counts[str(primary)] += 1

        queue_status = raw.get("queue_status")
        if queue_status not in VALID_QUEUE_STATUS:
            findings.append(Finding("ERROR", f"{candidate_id} has invalid queue_status: {queue_status}"))

        score = raw.get("priority_score")
        if not isinstance(score, int) or not 0 <= score <= 100:
            findings.append(Finding("ERROR", f"{candidate_id} Registry priority_score must be an integer 0-100."))
        elif score % 5:
            findings.append(Finding("WARNING", f"{candidate_id} priority_score should be rounded to a multiple of 5."))

        score_basis = raw.get("score_basis")
        score_keys = ("novelty", "importance", "evidence", "depth", "learning", "content")
        if not isinstance(score_basis, dict):
            findings.append(Finding("ERROR", f"{candidate_id} Registry score_basis must be an object."))
        else:
            invalid_basis = [
                key
                for key in score_keys
                if not isinstance(score_basis.get(key), int) or not 0 <= score_basis.get(key) <= 5
            ]
            penalty = score_basis.get("penalty")
            if invalid_basis or not isinstance(penalty, int) or not 0 <= penalty <= 20:
                findings.append(
                    Finding(
                        "ERROR",
                        f"{candidate_id} score_basis needs 0-5 values and penalty 0-20; invalid: {invalid_basis}.",
                    )
                )
            elif isinstance(score, int):
                raw_score = (
                    score_basis["novelty"] / 5 * 15
                    + score_basis["importance"] / 5 * 20
                    + score_basis["evidence"] / 5 * 20
                    + score_basis["depth"] / 5 * 15
                    + score_basis["learning"] / 5 * 15
                    + score_basis["content"] / 5 * 15
                    - penalty
                )
                expected_score = max(0, min(100, int((raw_score + 2.5) // 5 * 5)))
                if score != expected_score:
                    findings.append(
                        Finding(
                            "ERROR",
                            f"{candidate_id} priority_score is {score}; score_basis rounds to {expected_score}.",
                        )
                    )

        if raw.get("top_card"):
            registry_cards[candidate_id] = raw
            if isinstance(score, int) and score < 75:
                findings.append(
                    Finding("ERROR", f"{candidate_id} is a Top Card with score {score}; minimum is 75.")
                )

        fact_status = raw.get("fact_status")
        pattern_maturity = raw.get("pattern_maturity")
        confidence = raw.get("interpretation_confidence")
        opportunity = raw.get("opportunity_validation")
        if fact_status not in VALID_FACT_STATUSES:
            findings.append(Finding("ERROR", f"{candidate_id} has invalid fact_status: {fact_status}"))
        if pattern_maturity not in VALID_PATTERN_MATURITY:
            findings.append(Finding("ERROR", f"{candidate_id} has invalid pattern_maturity: {pattern_maturity}"))
        if confidence not in VALID_INTERPRETATION_CONFIDENCE:
            findings.append(
                Finding("ERROR", f"{candidate_id} has invalid interpretation_confidence: {confidence}")
            )
        if opportunity not in VALID_OPPORTUNITY_VALIDATION:
            findings.append(
                Finding("ERROR", f"{candidate_id} has invalid opportunity_validation: {opportunity}")
            )

        if pattern_maturity == "Single event" and confidence == "High":
            findings.append(
                Finding("ERROR", f"{candidate_id} cannot have High interpretation confidence from a single event.")
            )
        if primary == "Write":
            if queue_status != "ready":
                findings.append(
                    Finding("ERROR", f"{candidate_id} primary Write requires queue_status='ready'.")
                )
            if opportunity not in {"Supply-audited", "Validated"}:
                findings.append(
                    Finding(
                        "ERROR",
                        f"{candidate_id} primary Write requires Supply-audited or Validated opportunity status.",
                    )
                )
            if raw.get("load_bearing_unverified"):
                findings.append(
                    Finding("ERROR", f"{candidate_id} primary Write has load_bearing_unverified=true.")
                )

    if not 3 <= len(registry_cards) <= 5:
        findings.append(
            Finding(
                "WARNING",
                f"Registry marks {len(registry_cards)} Top Cards; target is 3-5 and default is 4.",
            )
        )

    report_card_ids = set(report_cards)
    registry_card_ids = set(registry_cards)
    for candidate_id in sorted(report_card_ids - registry_card_ids):
        findings.append(Finding("ERROR", f"Report card {candidate_id} is not marked top_card in Registry."))
    for candidate_id in sorted(registry_card_ids - report_card_ids):
        findings.append(Finding("ERROR", f"Registry Top Card {candidate_id} is missing from the report."))

    for candidate_id in sorted(report_card_ids & registry_card_ids):
        report = report_cards[candidate_id]
        raw = registry_cards[candidate_id]
        if report.get("score") != raw.get("priority_score"):
            findings.append(
                Finding(
                    "ERROR",
                    f"{candidate_id} report score {report.get('score')} differs from Registry {raw.get('priority_score')}.",
                )
            )
        report_sequence = report.get("action_sequence") or []
        if report_sequence != raw.get("action_sequence"):
            findings.append(
                Finding(
                    "ERROR",
                    f"{candidate_id} report Action {report_sequence} differs from Registry {raw.get('action_sequence')}.",
                )
            )
        report_basis = report.get("score_basis") or {}
        registry_basis = raw.get("score_basis") or {}
        normalized_registry_basis = {
            "N": registry_basis.get("novelty"),
            "I": registry_basis.get("importance"),
            "E": registry_basis.get("evidence"),
            "D": registry_basis.get("depth"),
            "L": registry_basis.get("learning"),
            "C": registry_basis.get("content"),
            "P": registry_basis.get("penalty"),
        }
        if report_basis != normalized_registry_basis:
            findings.append(Finding("ERROR", f"{candidate_id} report Score basis differs from Registry."))

        checks = {
            "fact_status": "Fact status",
            "pattern_maturity": "Pattern maturity",
            "interpretation_confidence": "Interpretation confidence",
            "opportunity_validation": "Opportunity validation",
        }
        for registry_key, label in checks.items():
            if report.get(registry_key) != raw.get(registry_key):
                findings.append(
                    Finding(
                        "ERROR",
                        f"{candidate_id} report {label} differs from Candidate Registry.",
                    )
                )

    if summary_counts is not None:
        for action in ("Write", "Learn", "Explore", "Watch", "Ignore"):
            expected = primary_counts.get(action, 0)
            actual = summary_counts.get(action, 0)
            if expected != actual:
                findings.append(
                    Finding(
                        "ERROR",
                        f"Executive action count for {action} is {actual}; Registry primary-action count is {expected}.",
                    )
                )

    if ledger is None:
        return
    ledger_by_candidate: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in ledger:
        candidate_id = str(row.get("candidate_id", "")).strip()
        if candidate_id:
            ledger_by_candidate[candidate_id].append(row)

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        candidate_id = str(candidate.get("candidate_id", ""))
        primary = candidate.get("primary_action")
        rows = ledger_by_candidate.get(candidate_id, [])
        if primary == "Write":
            blocking = [
                row
                for row in rows
                if row.get("load_bearing") is True
                and row.get("status") in {"unverified", "contradicted"}
            ]
            if blocking:
                claims = ", ".join(str(row.get("claim_id", "?")) for row in blocking)
                findings.append(
                    Finding(
                        "ERROR",
                        f"{candidate_id} primary Write has unresolved load-bearing claims: {claims}.",
                    )
                )
        if candidate.get("opportunity_validation") in {"Supply-audited", "Validated"}:
            supply_rows = [
                row
                for row in rows
                if row.get("claim_type") == "content_supply"
                and row.get("status") in {"verified", "partially_verified"}
                and isinstance(row.get("supply_audit"), dict)
            ]
            if not supply_rows:
                findings.append(
                    Finding(
                        "ERROR",
                        f"{candidate_id} says Supply-audited but Verification Ledger has no usable content_supply record.",
                    )
                )


def lint_report(
    text: str,
    args: argparse.Namespace,
    manifest: dict[str, Any] | None,
    registry: dict[str, Any] | None,
    ledger: list[dict[str, Any]] | None,
) -> list[Finding]:
    findings: list[Finding] = []
    frontmatter, body_text = parse_frontmatter(text)
    schema = frontmatter.get("report_schema")
    schema2 = schema == "2"

    if not frontmatter:
        findings.append(
            Finding("WARNING" if args.legacy_ok else "ERROR", "Missing YAML frontmatter for report reproducibility.")
        )
    else:
        required_frontmatter = [
            "week",
            "report_schema",
            "skill_version",
            "generated_at",
            "material_manifest_sha256",
            "candidate_registry_sha256",
            "verification_ledger_sha256",
        ]
        for key in required_frontmatter:
            if not frontmatter.get(key):
                findings.append(
                    Finding("WARNING" if args.legacy_ok else "ERROR", f"Missing frontmatter field: {key}")
                )
        if schema and schema != "2":
            findings.append(
                Finding("WARNING" if args.legacy_ok else "ERROR", f"report_schema is {schema}; expected 2.")
            )

    if not body_text.lstrip().startswith("# "):
        findings.append(Finding("ERROR", "Report must start with an H1 title after frontmatter."))

    h2_values = [normalize_heading(value) for value in H2_RE.findall(body_text)]

    # 按「包含」匹配而不是全等，双语标题（`## 本周重点 Top Insight Cards`）才算数。
    def _has_h2(key: str) -> bool:
        return any(normalize_heading(key) in value for value in h2_values)

    for required in ALWAYS_REQUIRED_H2:
        if not _has_h2(required):
            findings.append(Finding("ERROR", f"Missing required H2 section: {required}"))

    omitted = [key for key in OPTIONAL_H2 if not _has_h2(key)]
    if omitted:
        if not _has_h2(OMISSION_SECTION):
            findings.append(
                Finding(
                    "ERROR",
                    f"Omitted sections ({', '.join(omitted)}) require a '{OMISSION_SECTION}' section that names them.",
                )
            )
        else:
            start = body_text.find("## " + OMISSION_SECTION)
            block = body_text[start:]
            nxt = block.find("\n## ", 3)
            block = block[:nxt] if nxt > 0 else block
            undeclared = [key for key in omitted if key not in block]
            if undeclared:
                findings.append(
                    Finding(
                        "ERROR",
                        f"Omitted sections not named in '{OMISSION_SECTION}': {', '.join(undeclared)}.",
                    )
                )

    cards = card_sections(body_text)
    if not cards:
        findings.append(Finding("ERROR", "No Insight Cards found. Expected headings like '### IC-01｜...'."))
    elif len(cards) < 3:
        findings.append(Finding("WARNING", f"Only {len(cards)} Insight Cards found; verify scarcity is intentional."))
    elif len(cards) > 5:
        findings.append(
            Finding("WARNING", f"{len(cards)} Insight Cards found; default is 4 and hard target is at most 5.")
        )

    report_cards: dict[str, dict[str, Any]] = {}
    required_metadata = CARD_METADATA_FIELDS if schema2 else ["Action", "Priority score"]
    for card_id, title, card_body in cards:
        if len(title) < 8:
            findings.append(Finding("WARNING", f"{card_id} title may be too topic-like or vague: '{title}'."))

        # 元信息优先读表格，读不到再回落到旧的 `**字段：** 值` 形式——
        # 换排版不该让历史报告集体变红。
        table_meta = parse_metadata_table(card_body)
        meta_of = lambda field: table_meta.get(field) or extract_bold_field(card_body, field)

        for field in required_metadata:
            if field not in table_meta and not has_bold_field(card_body, field):
                findings.append(
                    Finding("WARNING" if args.legacy_ok and not schema2 else "ERROR", f"{card_id} missing field: {field}")
                )
        for field in CARD_SECTION_FIELDS:
            if not has_bold_field(card_body, field):
                findings.append(Finding("ERROR", f"{card_id} missing field: {field}"))

        action_value = meta_of("Action")
        action_sequence = parse_action_sequence(action_value)
        if not action_sequence:
            findings.append(Finding("ERROR", f"{card_id} Action must include one of {sorted(VALID_ACTIONS)}."))

        fact_status = meta_of("Fact status")
        pattern_maturity = meta_of("Pattern maturity")
        interpretation_confidence = meta_of("Interpretation confidence")
        opportunity_validation = meta_of("Opportunity validation")
        score = parse_score(meta_of("Priority score"))
        score_basis = parse_score_basis(meta_of("Score basis"))

        if schema2:
            if fact_status not in VALID_FACT_STATUSES:
                findings.append(Finding("ERROR", f"{card_id} invalid Fact status: {fact_status}"))
            if pattern_maturity not in VALID_PATTERN_MATURITY:
                findings.append(Finding("ERROR", f"{card_id} invalid Pattern maturity: {pattern_maturity}"))
            if interpretation_confidence not in VALID_INTERPRETATION_CONFIDENCE:
                findings.append(
                    Finding("ERROR", f"{card_id} invalid Interpretation confidence: {interpretation_confidence}")
                )
            if opportunity_validation not in VALID_OPPORTUNITY_VALIDATION:
                findings.append(
                    Finding("ERROR", f"{card_id} invalid Opportunity validation: {opportunity_validation}")
                )

        if score is None:
            findings.append(Finding("ERROR", f"{card_id} Priority score is missing or invalid."))
        else:
            if score < 75:
                findings.append(
                    Finding("ERROR", f"{card_id} is a Top Card with score {score}; minimum promotion score is 75.")
                )
            if score % 5:
                findings.append(
                    Finding("WARNING", f"{card_id} score {score} should be rounded to a multiple of 5.")
                )
        if schema2 and set(score_basis) < {"N", "I", "E", "D", "L", "C", "P"}:
            findings.append(
                Finding("ERROR", f"{card_id} Score basis must show N/I/E/D/L/C and Penalty.")
            )

        if pattern_maturity == "Single event" and interpretation_confidence == "High":
            findings.append(
                Finding("ERROR", f"{card_id} cannot claim High interpretation confidence from one event.")
            )
        if pattern_maturity == "Single event" and TREND_WORD_RE.search(title):
            findings.append(
                Finding("ERROR", f"{card_id} uses trend language in the title but Pattern maturity is Single event.")
            )
        if re.search(r"(?:无|没有)历史基线", card_body) and TREND_WORD_RE.search(title):
            findings.append(
                Finding("ERROR", f"{card_id} title claims a pattern while the card states there is no baseline.")
            )
        if opportunity_validation in {"Not assessed", "Material-only"} and SUPPLY_CLAIM_RE.search(
            title + "\n" + card_body
        ):
            findings.append(
                Finding(
                    "ERROR",
                    f"{card_id} makes a market-supply claim without a Supply-audited opportunity status.",
                )
            )

        primary_action = action_sequence[0] if action_sequence else None
        if primary_action == "Write":
            if opportunity_validation not in {"Supply-audited", "Validated"}:
                findings.append(
                    Finding(
                        "ERROR",
                        f"{card_id} primary Write requires Supply-audited or Validated opportunity status.",
                    )
                )
            if fact_status in {"Secondary only", "Unverified", "Contradicted"}:
                findings.append(
                    Finding(
                        "ERROR",
                        f"{card_id} primary Write is blocked by Fact status '{fact_status}'.",
                    )
                )

        if not URL_RE.search(card_body):
            findings.append(Finding("ERROR", f"{card_id} has no traceable HTTP(S) evidence link."))

        evidence = extract_section(card_body, "Evidence", ["Why it matters"])
        if evidence and len(URL_RE.findall(evidence)) < 2 and pattern_maturity not in {
            "Single event",
            "Material observation",
        }:
            findings.append(
                Finding(
                    "WARNING",
                    f"{card_id} Evidence has fewer than two links for a pattern-level claim.",
                )
            )

        falsifier = extract_section(card_body, "What would change my mind", [])
        if len(falsifier) < 12:
            findings.append(Finding("WARNING", f"{card_id} falsifier is too thin or empty."))

        personal = extract_section(card_body, "Personal relevance", ["Content opportunity"])
        if re.search(r"(^|[，。；：\s])他(?:的|在|会|把|做|写|是)", personal):
            findings.append(
                Finding("WARNING", f"{card_id} Personal relevance uses third person; write to the reader as '你'.")
            )

        if len(card_body) > args.max_card_chars:
            findings.append(
                Finding(
                    "WARNING",
                    f"{card_id} is {len(card_body):,} characters; recommended maximum is {args.max_card_chars:,}.",
                )
            )

        report_cards[card_id] = {
            "title": title,
            "action_sequence": action_sequence,
            "fact_status": fact_status,
            "pattern_maturity": pattern_maturity,
            "interpretation_confidence": interpretation_confidence,
            "opportunity_validation": opportunity_validation,
            "score": score,
            "score_basis": score_basis,
        }

    placeholders = PLACEHOLDER_RE.findall(body_text)
    if placeholders:
        findings.append(Finding("ERROR", f"Found {len(placeholders)} placeholder marker(s)."))

    overclaims = OVERCLAIM_RE.findall(body_text)
    if overclaims:
        sample = ", ".join(sorted(set(overclaims)))
        findings.append(
            Finding(
                "WARNING",
                f"Potential population overclaim(s): {sample}. Confirm denominator or add observation-window limits.",
            )
        )

    coverage_match = re.search(
        r"^##\s+数据覆盖与证据边界\s*$([\s\S]*?)(?=^##\s+)", body_text, flags=re.MULTILINE
    )
    if coverage_match:
        coverage = coverage_match.group(1)
        if not re.search(r"筛选|Top-N|详写|观察窗口", coverage, flags=re.IGNORECASE):
            findings.append(
                Finding("ERROR", "Coverage section does not disclose upstream filtering or observation-window bias.")
            )
        if not re.search(r"截断|仅标题|评论", coverage):
            findings.append(
                Finding("WARNING", "Coverage section may not disclose truncation, title-only, or comment limits.")
            )

    if not ABSOLUTE_DATE_RE.search(body_text[:1400]):
        findings.append(Finding("WARNING", "Header does not show an absolute YYYY-MM-DD date near the top."))

    if len(body_text) > int(args.max_chars * 1.35):
        findings.append(
            Finding(
                "ERROR",
                f"Report is {len(body_text):,} characters; hard ceiling is {int(args.max_chars * 1.35):,}.",
            )
        )
    elif len(body_text) > args.max_chars:
        findings.append(
            Finding(
                "WARNING",
                f"Report is {len(body_text):,} characters; recommended budget is {args.max_chars:,}.",
            )
        )

    summary_counts = None
    action_match = ACTION_COUNTS_RE.search(body_text)
    if action_match:
        summary_counts = dict(
            zip(
                ("Write", "Learn", "Explore", "Watch", "Ignore"),
                (int(value) for value in action_match.groups()),
            )
        )
    else:
        findings.append(Finding("ERROR", "Could not parse the executive action distribution line."))

    if registry is not None:
        if frontmatter.get("week") and registry.get("week") != frontmatter.get("week"):
            findings.append(Finding("ERROR", "Report week differs from Candidate Registry week."))
        if frontmatter.get("skill_version") and registry.get("skill_version") != frontmatter.get("skill_version"):
            findings.append(Finding("ERROR", "Report skill_version differs from Candidate Registry."))
    if manifest is not None:
        if frontmatter.get("week") and manifest.get("week") != frontmatter.get("week"):
            findings.append(Finding("ERROR", "Report week differs from material manifest week."))
        if registry is not None:
            registry_materials = registry.get("materials") or {}
            manifest_sources = manifest.get("sources") or {}
            for source_kind in ("reddit", "x", "aihot"):
                registry_sha = (registry_materials.get(source_kind) or {}).get("sha256")
                manifest_sha = (manifest_sources.get(source_kind) or {}).get("sha256")
                if registry_sha and manifest_sha and registry_sha != manifest_sha:
                    findings.append(
                        Finding(
                            "ERROR",
                            f"Registry material hash for {source_kind} differs from manifest.",
                        )
                    )

    lint_registry(registry, ledger, report_cards, summary_counts, findings)

    # Check report hashes when sidecars are supplied.
    hash_pairs = [
        ("material_manifest_sha256", args.manifest),
        ("candidate_registry_sha256", args.registry),
        ("verification_ledger_sha256", args.ledger),
    ]
    for key, path_value in hash_pairs:
        expected = frontmatter.get(key)
        if expected and path_value:
            resolved = path_value.expanduser().resolve()
            if resolved.exists():
                actual = sha256_file(resolved)
                if expected != actual:
                    findings.append(Finding("ERROR", f"Frontmatter {key} does not match {resolved}."))

    return findings


def main() -> int:
    args = parse_args()
    report_path = args.report.expanduser().resolve()
    if not report_path.exists() or not report_path.is_file():
        print(f"ERROR: report not found: {report_path}", file=sys.stderr)
        return 2

    try:
        text = report_path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        print(f"ERROR: cannot read report: {exc}", file=sys.stderr)
        return 2

    preload_findings: list[Finding] = []
    manifest = load_manifest(args.manifest, preload_findings)
    registry = load_registry(args.registry, preload_findings)
    ledger = load_ledger(args.ledger, preload_findings)
    findings = preload_findings + lint_report(text, args, manifest, registry, ledger)

    errors = [item for item in findings if item.level == "ERROR"]
    warnings = [item for item in findings if item.level == "WARNING"]

    for item in findings:
        print(f"{item.level}: {item.message}")

    if not findings:
        print("PASS: report, registry, and verification consistency checks passed with no warnings.")
    else:
        print(f"SUMMARY: {len(errors)} error(s), {len(warnings)} warning(s).")

    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
