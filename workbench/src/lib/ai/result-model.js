import { documentVersion } from "../document-version.js";
import { normalizeGrounding } from "./grounding.js";

export const AI_RESULT_KINDS = Object.freeze(["answer", "candidate", "report", "action"]);
export const CANDIDATE_STATUSES = Object.freeze(["generating", "ready", "edited", "adopted", "discarded", "stale", "failed"]);
export const ACTION_STATUSES = Object.freeze(["proposed", "applied", "rejected", "superseded"]);

const FOCUSED_CANDIDATE_TARGETS = new Set(["section", "chapter", "whole-document", "document"]);

export function candidateReviewMode(target = {}) {
  if (target.review === "focused") return "focused";
  return FOCUSED_CANDIDATE_TARGETS.has(target.kind) ? "focused" : "inline";
}

const clean = (value) => String(value || "");

export function documentVersionOf(text) {
  return documentVersion({ body: clean(text) });
}

export function changeSummary(original, text) {
  const before = clean(original);
  const after = clean(text);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const removed = before.length - prefix - suffix;
  const added = after.length - prefix - suffix;
  return { added, removed, label: `+${added} / −${removed}` };
}

export function candidateStatus({ status, grounding, documentVersion, currentDocumentVersion, edited = false }) {
  const normalizedGrounding = normalizeGrounding(grounding);
  if (normalizedGrounding?.gate === "rejected") return "failed";
  if (["adopted", "discarded", "failed"].includes(status)) return status;
  if (documentVersion && currentDocumentVersion && documentVersion !== currentDocumentVersion) return "stale";
  if (status === "generating") return "generating";
  return edited || status === "edited" ? "edited" : "ready";
}

export function createCandidate(value = {}, currentDocumentVersion = "") {
  const grounding = normalizeGrounding(value.grounding);
  const status = candidateStatus({ ...value, grounding, currentDocumentVersion });
  return {
    id: clean(value.id),
    kind: "candidate",
    source: clean(value.source || "assistant"),
    target: value.target || { kind: "selection" },
    mode: clean(value.mode || "rewrite"),
    from: Number.isFinite(value.from) ? value.from : Number(value.target?.from || 0),
    to: Number.isFinite(value.to) ? value.to : Number(value.target?.to || 0),
    rerun: value.rerun,
    label: clean(value.label || "正文候选"),
    instruction: clean(value.instruction),
    original: clean(value.original),
    text: clean(value.text ?? value.candidate),
    grounding,
    generations: Array.isArray(value.generations) ? value.generations : [],
    status,
    documentVersion: clean(value.documentVersion),
    createdAt: value.createdAt || new Date().toISOString(),
    busy: status === "generating",
    error: status === "failed" ? (value.error || (grounding?.gateDetail ? { message: grounding.gateDetail } : null)) : value.error || null,
  };
}

export function createAiResult(value = {}) {
  if (!AI_RESULT_KINDS.includes(value.kind)) throw new TypeError(`Unknown AI result kind: ${value.kind}`);
  if (value.kind === "candidate") return createCandidate(value);
  if (value.kind === "answer") return { kind: "answer", text: clean(value.text) };
  if (value.kind === "report") return { kind: "report", findings: Array.isArray(value.findings) ? value.findings : [], report: value.report };
  return { ...value, kind: "action", type: clean(value.type), impact: clean(value.impact), status: ACTION_STATUSES.includes(value.status) ? value.status : "proposed" };
}

export function transitionActionResult(action, nextStatus) {
  if (!action || !ACTION_STATUSES.includes(nextStatus)) throw new TypeError(`Unknown action status: ${nextStatus}`);
  return { ...action, kind: "action", status: nextStatus };
}
