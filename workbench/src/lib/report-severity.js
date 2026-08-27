export const REPORT_SEVERITIES = Object.freeze({
  risk: Object.freeze({ id: "risk", displayName: "高风险" }),
  suggested: Object.freeze({ id: "suggested", displayName: "建议修改" }),
  optional: Object.freeze({ id: "optional", displayName: "可选优化" }),
});

const STATUS_TO_SEVERITY = Object.freeze({
  fail: "risk",
  disputed: "risk",
  unsupported: "risk",
  warn: "suggested",
  overstated: "suggested",
  optional: "optional",


});

const POSITIVE_STATUSES = new Set(["pass", "verified", "supported"]);

export function reportSeverity(kind, status = "") {
  if (POSITIVE_STATUSES.has(String(status || "").toLowerCase())) return null;
  if (kind === "material-research") return REPORT_SEVERITIES.suggested;
  return REPORT_SEVERITIES[STATUS_TO_SEVERITY[String(status || "").toLowerCase()]] || REPORT_SEVERITIES.suggested;
}
