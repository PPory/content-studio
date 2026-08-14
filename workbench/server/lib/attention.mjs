// 关注配置：领域 + 关键词，决定热点里什么能进来。
//
// 关键词语法抄的是 TrendRadar（sansan0/TrendRadar）那套，它已经把这件事想清楚了：
//
//   词        普通词，标题包含即命中（大小写不敏感）
//   +词       必须词，该领域的普通词命中之后还必须同时包含它
//   !词       排除词，命中直接扔掉，优先级最高
//   /正则/    正则匹配，用来精确卡英文词边界（`/\bai\b/` 不会被 "email" 命中）
//
// 领域分组的思路来自 oyorf/person_dashboard 的 attention.json：热点按**领域**分组呈现，
// 而不是按平台——你关心的是「AI 有什么新东西」，不是「微博今天说了什么」。

import path from "node:path";
import fs from "node:fs/promises";
import { atomicWrite, pruneSnapshots, snapshotFile, snapshotKeepDays } from "./safe-write.mjs";

const FILE = path.resolve(process.cwd(), "config", "attention.json");

// 默认关注面。改这里只影响还没生成配置文件的新环境；已有 config/attention.json 以文件为准。
// 注意作用范围：**只作用于 AI 情报**，不作用于平台热榜。
// 六个大众榜是「看大众在关心什么」，拿这些词去筛它等于把它筛没了（实测 50 条剩不到 1 条）。
export const DEFAULT_ATTENTION = {
  schemaVersion: 1,
  domains: [
    {
      // 短英文缩写一律用 /\b…\b/ 正则，**不要写成普通词**：
      // 普通词是大小写不敏感的子串匹配，写 `RAG` 会把 "The tragedy" 匹配上，
      // 写 `AI` 会把 "certain"、"email" 匹配上。踩过一次。
      name: "AI 与 Agent",
      words: [
        "/\\bAI\\b/", "AIGC", "人工智能", "大模型", "/\\bagent\\b/", "智能体",
        "/\\bMCP\\b/", "/\\bLLM\\b/", "Claude", "GPT", "Gemini", "OpenAI", "Anthropic",
        "!招聘", "!广告",
      ],
    },
    {
      name: "内容创作",
      words: ["写作", "创作者", "公众号", "小红书", "自媒体", "短视频", "播客", "内容平台", "!招聘"],
    },
    {
      name: "知识管理",
      words: ["知识库", "笔记", "Obsidian", "Notion", "/\\bRAG\\b/", "检索增强", "第二大脑", "知识管理"],
    },
    {
      name: "独立开发",
      words: ["独立开发", "开源", "SaaS", "Cloudflare", "Vercel", "出海", "副业"],
    },
  ],
  limits: { perDomain: 12 },
};

export async function loadAttention() {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const cfg = JSON.parse(raw);
    // 逐字段兜底：手改坏一个键不该让整个热点页打不开
    return {
      schemaVersion: 1,
      domains: Array.isArray(cfg.domains) && cfg.domains.length
        ? cfg.domains.filter((d) => d?.name).map((d) => ({ name: String(d.name), words: (d.words || []).map(String) }))
        : DEFAULT_ATTENTION.domains,
      limits: { perDomain: Number(cfg.limits?.perDomain) || DEFAULT_ATTENTION.limits.perDomain },
    };
  } catch (e) {
    if (e.code !== "ENOENT") console.warn("[attention] 配置读失败，用默认值:", e.message);
    return structuredClone(DEFAULT_ATTENTION);
  }
}

export async function saveAttention(cfg) {
  const clean = {
    schemaVersion: 1,
    domains: (cfg.domains || [])
      .filter((d) => d?.name?.trim())
      .map((d) => ({
        name: String(d.name).trim(),
        words: (Array.isArray(d.words) ? d.words : String(d.words || "").split("\n"))
          .map((w) => String(w).trim())
          .filter(Boolean),
      })),
    limits: { perDomain: Math.min(Math.max(Number(cfg.limits?.perDomain) || 12, 1), 50) },
  };
  if (!clean.domains.length) throw Object.assign(new Error("至少要留一个领域"), { status: 400 });

  // 改之前留一版：这份配置是手写出来的（关键词表、正则边界），
  // 覆盖错了没法从别处再生成一遍。写入走原子替换，坏掉的是临时文件不是它。
  await snapshotFile(process.cwd(), "attention", FILE);
  await atomicWrite(FILE, JSON.stringify(clean, null, 2));
  await pruneSnapshots(process.cwd(), "attention", { keepDays: snapshotKeepDays() }).catch(() => 0);
  return clean;
}

// 把一条关键词编译成匹配函数。`/.../` 走正则，其余走大小写不敏感的包含。
function compile(word) {
  const m = word.match(/^\/(.+)\/([a-z]*)$/);
  if (m) {
    try {
      const re = new RegExp(m[1], m[2].includes("i") ? m[2] : m[2] + "i");
      return (s) => re.test(s);
    } catch {
      return () => false; // 正则写坏了就当它永不命中，别让整个页面炸
    }
  }
  const lower = word.toLowerCase();
  return (s) => s.toLowerCase().includes(lower);
}

// 界面上要显示「命中了什么」，直接甩一串 `/\bAI\b/` 给用户看是不合格的。
// 显式写法：`/\bAI\b/ => AI 相关`；没写就从正则里把 \b、锚点、斜杠剥掉当显示名。
function displayName(pattern, explicit) {
  if (explicit) return explicit;
  const m = pattern.match(/^\/(.+)\/[a-z]*$/);
  if (!m) return pattern;
  return m[1].replace(/\\b/g, "").replace(/^\^|\$$/g, "") || pattern;
}

function parseWord(raw) {
  const [patternPart, labelPart] = String(raw).split("=>");
  const pattern = patternPart.trim();
  return { pattern, label: displayName(pattern, labelPart?.trim()) };
}

export function compileDomain(domain) {
  const normals = [], musts = [], excludes = [];
  for (const raw of domain.words || []) {
    const w = String(raw).trim();
    if (!w) continue;
    const kind = w[0] === "!" ? excludes : w[0] === "+" ? musts : normals;
    const body = w[0] === "!" || w[0] === "+" ? w.slice(1) : w;
    const { pattern, label } = parseWord(body);
    kind.push({ word: label, test: compile(pattern) });
  }
  return { name: domain.name, normals, musts, excludes };
}

/**
 * 判断一个标题是否命中某个领域。
 * @returns 命中的普通词（用于界面上显示「为什么它出现在这」），没命中返回 null
 */
export function matchDomain(title, compiled) {
  const s = String(title || "");
  if (!s) return null;
  if (compiled.excludes.some((e) => e.test(s))) return null;          // 排除词优先级最高
  if (compiled.musts.length && !compiled.musts.every((m) => m.test(s))) return null;
  if (!compiled.normals.length) return compiled.musts.length ? "（必须词）" : null;
  const hit = compiled.normals.find((n) => n.test(s));
  return hit ? hit.word : null;
}
