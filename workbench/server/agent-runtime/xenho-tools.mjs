import fs from "node:fs/promises";
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "xenho-expert-tools";
export const inject = ["tools"];

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const textOutput = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }],
};

function compactSource(item) {
  return {
    id: String(item.id || ""),
    type: String(item.typeLabel || item.type || "本地资料"),
    title: String(item.title || "未命名来源"),
    source: String(item.source || ""),
    excerpt: String(item.snippet || item.excerpt || "").slice(0, 600),
    url: String(item.url || ""),
    path: String(item.path || ""),
  };
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "propose_content_create",
    description: "Propose creating a new Xenho content draft. Use when the user explicitly asks to create/write content in the workbench. This does not write data; the user must confirm the returned action card before Xenho calls its Worker.",
    parameters: {
      title: { type: "string", required: true, description: "Content title, up to 200 characters." },
      platform: { type: "string", required: true, description: "One of: 公众号, X, 小红书, 视频号, YouTube." },
      audience: { type: "string", description: "Target audience." },
      viewpoint: { type: "string", description: "One-sentence core idea or summary." },
      body: { type: "string", required: true, description: "Complete proposed draft body." },
    },
    output: textOutput,
    async execute({ title, platform, audience = "", viewpoint = "", body }) {
      const action = { type: "create_content", title: String(title || "").slice(0, 200), platform: String(platform || ""), audience: String(audience || "").slice(0, 500), viewpoint: String(viewpoint || "").slice(0, 2_000), body: String(body || "").slice(0, 200_000) };
      if (!action.title || !action.body) throw new Error("新建内容候选必须包含标题和正文");
      await fs.appendFile(process.env.XENHO_ACTIONS_FILE, `${JSON.stringify(action)}\n`, "utf8");
      return "新建内容候选已提交给工作台，等待用户确认后写入。请简要说明候选已经准备好，不要声称已经创建成功。";
    },
  }));

  ctx.tools.register(defineTool({
    name: "project_read",
    description: "Read the current Xenho content project snapshot, including title, body, audience, platform and current selection. Read-only.",
    parameters: {},
    output: textOutput,
    isConcurrencySafe: () => true,
    async execute() {
      const context = await readJson(process.env.XENHO_CONTEXT_FILE);
      return JSON.stringify(context.project || context.document || {}, null, 2);
    },
  }));

  ctx.tools.register(defineTool({
    name: "material_evidence",
    description: "Read the current project's explicitly linked materials and their source or verification fields. Read-only; a search hit is not the same as adopted evidence.",
    parameters: {},
    output: textOutput,
    isConcurrencySafe: () => true,
    async execute() {
      const context = await readJson(process.env.XENHO_CONTEXT_FILE);
      const materials = (context.projectMaterials || []).slice(0, 40).map((item) => ({
        id: String(item.id || ""),
        title: String(item.title || "未命名素材"),
        content: String(item.content || item.note || item.summary || "").slice(0, 2_000),
        source: String(item.source || item.sourceUrl || item.url || ""),
        verification: String(item.verification || item.verificationStatus || ""),
      }));
      return JSON.stringify({ total: materials.length, materials }, null, 2);
    },
  }));

  ctx.tools.register(defineTool({
    name: "publication_metrics",
    description: "Read the current project's recorded publication and review metrics. Read-only; never infer missing values.",
    parameters: {},
    output: textOutput,
    isConcurrencySafe: () => true,
    async execute() {
      const context = await readJson(process.env.XENHO_CONTEXT_FILE);
      return JSON.stringify({
        publication: context.project?.publication || null,
        review: context.project?.review || null,
      }, null, 2);
    },
  }));

  ctx.tools.register(defineTool({
    name: "knowledge_search",
    description: "Search the Xenho workbench's task-scoped, read-only snapshot of books, notes, knowledge cards, materials and drafts.",
    parameters: { query: { type: "string", required: true, description: "A short keyword or phrase." } },
    output: textOutput,
    isConcurrencySafe: () => true,
    async execute({ query }) {
      const context = await readJson(process.env.XENHO_CONTEXT_FILE);
      const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
      const hits = (context.localSources || []).filter((item) => {
        const hay = JSON.stringify(item).toLowerCase();
        return terms.length === 0 || terms.some((term) => hay.includes(term));
      }).slice(0, 12).map(compactSource);
      return JSON.stringify({ query, total: hits.length, sources: hits }, null, 2);
    },
  }));

  ctx.tools.register(defineTool({
    name: "attachment_read",
    description: "Read the extracted text of a file the user attached to this conversation. List available attachment ids from the task context, then call this tool only for the files needed.",
    parameters: { id: { type: "string", required: true, description: "The attachment id shown in the task context." } },
    output: textOutput,
    isConcurrencySafe: () => true,
    async execute({ id }) {
      const context = await readJson(process.env.XENHO_CONTEXT_FILE);
      const item = (context.attachments || []).find((entry) => entry.id === String(id));
      if (!item) throw new Error("当前对话中没有这个附件");
      if (item.kind === "image") throw new Error("图片已经作为本轮视觉输入直接交给模型，不需要 attachment_read");
      const text = await fs.readFile(item.textPath, "utf8");
      return JSON.stringify({ id: item.id, name: item.name, text: text.slice(0, 120_000), truncated: text.length > 120_000 }, null, 2);
    },
  }));

  ctx.tools.register(defineTool({
    name: "submit_expert_report",
    description: "Submit the final structured Xenho expert report. Call exactly once after research and review are complete.",
    parameters: { reportJson: { type: "string", required: true, description: "A JSON object matching the report contract in the task." } },
    output: textOutput,
    async execute({ reportJson }) {
      let report;
      try { report = JSON.parse(reportJson); } catch { throw new Error("reportJson 不是合法 JSON"); }
      if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("报告必须是 JSON 对象");
      if (report.kind !== process.env.XENHO_EXPERT_KIND) throw new Error("报告 kind 与当前专家任务不一致");
      await fs.writeFile(process.env.XENHO_REPORT_FILE, JSON.stringify(report, null, 2), "utf8");
      return "结构化报告已提交。";
    },
  }));
}
