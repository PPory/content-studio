const MODES = new Set(["polish", "correct", "shorten", "expand", "rewrite"]);
const MAX_SELECTION = 6_000;
const MAX_INSTRUCTION = 500;

export const REVISION_LABELS = {
  polish: "润色",
  correct: "纠错",
  shorten: "缩写",
  expand: "扩写",
  rewrite: "改写",
};

export function normalizeTextRevisionRequest(body = {}) {
  const mode = MODES.has(body.mode) ? body.mode : "polish";
  const selected = String(body.selected || "").trim();
  if (!selected) throw Object.assign(new Error("请先选中要修改的文字"), { status: 400 });
  if (selected.length > MAX_SELECTION) throw Object.assign(new Error(`一次最多处理 ${MAX_SELECTION.toLocaleString()} 个字符`), { status: 400 });
  const instruction = String(body.instruction || "").trim().slice(0, MAX_INSTRUCTION);
  if (mode === "rewrite" && !instruction) throw Object.assign(new Error("请先写下具体的改写要求"), { status: 400 });
  return {
    mode,
    label: REVISION_LABELS[mode],
    selected,
    instruction,
    title: String(body.title || "").trim().slice(0, 160),
    platform: String(body.platform || "").trim().slice(0, 24),
    before: String(body.before || "").slice(-4_000),
    after: String(body.after || "").slice(0, 4_000),
  };
}
