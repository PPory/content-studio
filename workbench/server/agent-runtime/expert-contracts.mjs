import { WRITING_EXPERTS } from "../lib/writing-presets.mjs";
import { qualityNinePrompt, XENHO_QUALITY_NINE } from "../lib/quality-nine.mjs";

export const EXPERT_TASKS = Object.freeze({
  "material-research": Object.freeze({ expertId: "material-researcher", expertName: "素材顾问", skillId: "material-gap", displayName: "素材查缺" }),
  "quality-review": Object.freeze({ expertId: "quality-reviewer", expertName: "审稿顾问", skillId: "xenho-quality-nine", displayName: "Xenho 品控九问" }),
  "fact-check": Object.freeze({ expertId: "fact-checker", expertName: "事实核查", skillId: "fact-check", displayName: "事实核查" }),
  "style-calibration": Object.freeze({ expertId: "style-coach", expertName: "风格顾问", skillId: "", displayName: "风格画像校准" }),
});

export const DELEGATABLE_EXPERT_KINDS = Object.freeze(["material-research", "quality-review", "fact-check"]);

const clean = (value, max = 80_000) => String(value ?? "").trim().slice(0, max);

export function expertReportContract(kind) {
  if (kind === "material-research") return `{"kind":"material-research","summary":"...","claims":[{"quote":"...","location":"...","need":"...","localSources":[],"webSources":[],"gap":"..."}],"nextSteps":[]}`;
  if (kind === "quality-review") return `{"kind":"quality-review","summary":"...","strengths":[],"questions":[{"id":"audience","status":"pass|warn|fail","location":"...","finding":"...","direction":"..."}],"mustFix":[]}`;
  if (kind === "fact-check") return `{"kind":"fact-check","summary":"...","claims":[{"quote":"...","type":"数字|日期|人物|事件|引语|绝对化判断","status":"verified|disputed|unsupported|overstated","localSources":[],"webSources":[],"risk":"...","suggestion":"..."}]}`;
  return `{"kind":"style-calibration","summary":"...","dimensions":{"tone":"...","method":"...","thinking":"...","expression":"...","habits":"...","signature":"..."},"name":"我的风格","description":"...","instructions":"...","warnings":[]}`;
}

export function expertPrompt(kind, document, sources, instruction = "") {
  const task = EXPERT_TASKS[kind];
  const expert = WRITING_EXPERTS.find((item) => item.id === task?.expertId);
  const target = document.selection?.text ? `只分析选中段落：\n${document.selection.text}` : `分析全文：\n${document.body}`;
  return [
    expert?.instructions || "",
    task?.skillId ? `先调用 skill_read 读取 ${task.skillId}/SKILL.md，并按这份 Skill 的方法执行。` : "",
    kind === "quality-review" ? `Xenho 品控九问：\n${qualityNinePrompt()}` : "",
    clean(instruction, 2_000) ? `本次额外关注：${clean(instruction, 2_000)}` : "",
    `标题：${document.title || "未命名"}\n平台：${document.platform || ""}\n目标读者：${document.audience || ""}\n${target}`,
    `本地工作区预检到 ${sources.length} 条候选来源。必须先用 knowledge_search 核对；需要时可用 web_search 和 web_fetch 只读核查公开网页。`,
    "你是只读专家子 Agent。不得修改正文、业务状态或文件，不得创建其他 Agent；只提交建议和证据。最后必须调用 submit_expert_report。",
    `reportJson 必须严格符合：${expertReportContract(kind)}`,
  ].filter(Boolean).join("\n\n");
}

export function validateExpertReport(kind, report) {
  if (!report || typeof report !== "object" || Array.isArray(report) || report.kind !== kind) throw new Error("专家没有提交符合约定的结构化报告");
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  const list = (value) => Array.isArray(value);
  if (!text(report.summary)) throw new Error("专家报告缺少摘要");
  if (kind === "quality-review") {
    if (!list(report.strengths) || !list(report.questions) || !list(report.mustFix)) throw new Error("品控报告字段不完整");
    const ids = new Set(report.questions.map((item) => item?.id));
    if (report.questions.length !== XENHO_QUALITY_NINE.length || ids.size !== XENHO_QUALITY_NINE.length || XENHO_QUALITY_NINE.some((item) => !ids.has(item.id))) throw new Error("品控报告没有逐项回答完整且不重复的 Xenho 品控九问");
    if (report.questions.some((item) => !["pass", "warn", "fail"].includes(item?.status) || !text(item.location) || !text(item.finding) || !text(item.direction))) throw new Error("品控报告的问题位置、状态或建议不完整");
  }
  if (kind === "material-research") {
    if (!list(report.claims) || !list(report.nextSteps)) throw new Error("素材报告缺少逐条观点或下一步");
    if (report.claims.some((item) => !text(item?.quote) || !text(item.location) || !text(item.need) || !list(item.localSources) || !list(item.webSources) || !text(item.gap))) throw new Error("素材报告的观点、来源或缺口字段不完整");
  }
  if (kind === "fact-check") {
    if (!list(report.claims)) throw new Error("事实核查报告缺少逐条事实");
    if (report.claims.some((item) => !text(item?.quote) || !text(item.type) || !["verified", "disputed", "unsupported", "overstated"].includes(item.status) || !list(item.localSources) || !list(item.webSources) || !text(item.risk) || !text(item.suggestion))) throw new Error("事实核查报告的状态、来源或建议字段不完整");
  }
  if (kind === "style-calibration" && (!report.dimensions || !report.instructions)) throw new Error("风格画像缺少六维分析或提示词");
  return report;
}
