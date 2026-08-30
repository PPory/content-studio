export const DEFAULT_ATTENTION = {
  schemaVersion: 1,
  domains: [
    {
      name: "AI 与 Agent",
      words: ["/\\bAI\\b/", "AIGC", "人工智能", "大模型", "/\\bagent\\b/", "智能体", "/\\bMCP\\b/", "/\\bLLM\\b/", "Claude", "GPT", "Gemini", "OpenAI", "Anthropic", "!招聘", "!广告"],
    },
    {
      name: "内容创作",
      words: ["写作", "创作者", "公众号", "小红书", "自媒体", "短视频", "播客", "内容平台", "!招聘"],
    },
    {
      name: "知识管理",
      words: ["知识库", "笔记", "/\\bRAG\\b/", "检索增强", "第二大脑", "知识管理"],
    },
    {
      name: "独立开发",
      words: ["独立开发", "开源", "SaaS", "Cloudflare", "Vercel", "出海", "副业"],
    },
  ],
  limits: { perDomain: 12 },
};

function compile(word) {
  const match = word.match(/^\/(.+)\/([a-z]*)$/);
  if (match) {
    try {
      const regexp = new RegExp(match[1], match[2].includes("i") ? match[2] : `${match[2]}i`);
      return (text) => regexp.test(text);
    } catch {
      return () => false;
    }
  }
  const lower = word.toLowerCase();
  return (text) => text.toLowerCase().includes(lower);
}

function displayName(pattern, explicit) {
  if (explicit) return explicit;
  const match = pattern.match(/^\/(.+)\/[a-z]*$/);
  if (!match) return pattern;
  return match[1].replace(/\\b/g, "").replace(/^\^|\$$/g, "") || pattern;
}

function parseWord(raw) {
  const [patternPart, labelPart] = String(raw).split("=>");
  const pattern = patternPart.trim();
  return { pattern, label: displayName(pattern, labelPart?.trim()) };
}

export function compileDomain(domain) {
  const normals = [];
  const musts = [];
  const excludes = [];
  for (const raw of domain.words || []) {
    const word = String(raw).trim();
    if (!word) continue;
    const list = word[0] === "!" ? excludes : word[0] === "+" ? musts : normals;
    const body = word[0] === "!" || word[0] === "+" ? word.slice(1) : word;
    const { pattern, label } = parseWord(body);
    list.push({ word: label, test: compile(pattern) });
  }
  return { name: domain.name, normals, musts, excludes };
}

export function matchDomain(title, compiled) {
  const text = String(title || "");
  if (!text || compiled.excludes.some((item) => item.test(text))) return null;
  if (compiled.musts.length && !compiled.musts.every((item) => item.test(text))) return null;
  if (!compiled.normals.length) return compiled.musts.length ? "（必须词）" : null;
  return compiled.normals.find((item) => item.test(text))?.word || null;
}
