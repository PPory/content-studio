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

async function braveSearch(query, signal) {
  const key = String(process.env.BRAVE_SEARCH_API_KEY || "").trim();
  if (!key) return { available: false, reason: "工作台尚未配置 Brave Search 密钥", sources: [] };
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "8");
  url.searchParams.set("search_lang", "zh-hans");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal,
  });
  if (!response.ok) throw new Error(`Brave Search 返回 HTTP ${response.status}`);
  const data = await response.json();
  return {
    available: true,
    sources: (data.web?.results || []).slice(0, 8).map((item, index) => ({
      id: `web:${index + 1}`,
      type: "网页",
      title: String(item.title || item.url || "网页来源"),
      url: String(item.url || ""),
      excerpt: String(item.description || "").slice(0, 800),
      publishedAt: String(item.age || item.page_age || ""),
    })),
  };
}

export function apply(ctx) {
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
    name: "web_search",
    description: "Search the public web through the workbench's configured Brave Search provider. Use it for dates, numbers, people, events and authoritative evidence.",
    parameters: { query: { type: "string", required: true, description: "A precise search query. Prefer one claim per query." } },
    output: textOutput,
    isConcurrencySafe: () => true,
    async execute({ query }, exec) {
      return JSON.stringify({ query, ...(await braveSearch(String(query).slice(0, 300), exec.signal)) }, null, 2);
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
