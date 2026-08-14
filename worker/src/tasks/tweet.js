// /推 · X 快速出稿：从 X 帖 / 文章链接 / 想法生成推文候选，绕过「选题→成稿」全流程。
// webhook 只做秒回受理（telegram.js），本文件的 runTweetJob 在 JobWorkflow 里异步执行
// （LLM 生成超 30 秒，webhook 的 waitUntil 会被掐死，见 jobs.js）。
// 三种输入自动分流：x.com 帖子链接→引用模式（FxTwitter 抓原帖）；其他 URL→文章模式
// （fetchArticle 抓正文）；纯文字→想法模式（按标签词表捞素材库相关素材垫料）。
// 默认只回 Telegram 不落库；带 #存 才把来源存素材库、候选存稿件库（待修改）。

import { TAG_VOCAB, tweetPrompt } from "../prompts.js";
import { chatJson } from "../lib/llm.js";
import { notify, notifyLong } from "../lib/notify.js";
import { autoTag } from "../lib/tagging.js";
import { fetchArticle } from "../lib/reader.js";
import { fetchXPost, parseStatusUrl } from "../lib/xpost.js";
import {
  assertGroundedPersonalNarrative,
  findSpecificPersonalClaims,
  isMaterialEligibleForDraft,
  stableTaskKey,
  verificationForMaterial,
} from "../lib/integrity.js";
import { upsertByTaskKey, searchSupplementary, setTags, tagsOf } from "../lib/db.js";
import { DRAFT_STATUS } from "../lib/values.js";

export const TWEET_USAGE = [
  "用法：/推 <X帖链接|文章链接|想法> [一句话角度] [#存]",
  "· X 帖链接 → 引用转发文案 + 同主题原创推",
  "· 文章链接 → 单推 + 短thread + 链接自评文案",
  "· 纯文字想法 → 多角度单推候选",
  "· 默认只回不存；加 #存 才落库（来源进素材库、候选进稿件库）",
].join("\n");

// 从参数里抽出所有 #token，返回 token 列表和剥掉 token 后的正文。
// 仅把「行首或空格后」的 #token 当 token，避免误抓 URL 片段（如 …/#section）。
export function extractTokens(argStr) {
  const tokens = [];
  const rest = argStr.replace(/(^|\s)#([^\s#]+)/g, (_, pre, t) => {
    tokens.push(t);
    return pre;
  }).replace(/[ \t]{2,}/g, " ").trim();
  return { tokens, rest };
}

// webhook 受理回执用：秒判输入属于哪种模式（不发任何请求）
export function detectTweetMode(argStr) {
  const { rest } = extractTokens(argStr);
  const url = rest.match(/https?:\/\/\S+/i)?.[0];
  if (url && parseStatusUrl(url)) return "引用";
  if (url) return "文章";
  return "想法";
}

// Workflow 里执行的完整流程：抓源 → LLM 生成 → 回执候选 →（#存 时）落库
export async function runTweetJob(env, { to, argStr }) {
  const { tokens, rest } = extractTokens(argStr);
  const save = tokens.includes("存");
  const manualTags = tokens.filter((t) => t !== "存");

  const urlMatch = rest.match(/https?:\/\/\S+/i);
  const url = urlMatch ? urlMatch[0] : "";
  const angle = url ? rest.replace(url, "").trim() : "";

  // 分流：X 帖 / 文章 / 想法
  let mode, content, sourceTitle;
  let supp = [];
  if (url && parseStatusUrl(url)) {
    const post = await fetchXPost(url);
    if (!post.ok) {
      await notify(env, to, `❌ 原帖抓取失败（${post.reason.slice(0, 100)}）。把帖子文字直接粘过来再 /推 一次即可。`);
      return;
    }
    mode = "引用";
    content = `${post.author}：${post.text}`;
    if (post.quote) content += `\n\n（其引用的帖子｜${post.quote.author}：${post.quote.text}）`;
    sourceTitle = post.text.slice(0, 60);
  } else if (url) {
    const article = await fetchArticle(url, env);
    if (!article.ok) {
      await notify(env, to, `❌ 文章抓取失败（${article.reason.slice(0, 100)}）。可以把正文粘过来再 /推 一次。`);
      return;
    }
    mode = "文章";
    content = article.body;
    sourceTitle = article.title || url;
  } else {
    mode = "想法";
    content = rest;
    sourceTitle = rest.slice(0, 60);
    supp = await findTweetMaterials(env, rest, manualTags);
    if (findSpecificPersonalClaims(content).length) {
      supp.unshift({ title: "本次用户输入的个人经历", type: "个人经历", note: content, verificationStatus: "不适用", tags: manualTags });
    }
  }

  const { json } = await chatJson(env, {
    system: tweetPrompt(),
    user: JSON.stringify({
      模式: mode,
      内容: content.slice(0, 12000),
      我的角度: angle,
      相关素材: supp,
    }),
    maxTokens: 8000,
  });
  const out = formatTweetResult(json);
  if (!out) {
    await notify(env, to, "❌ 生成结果为空，换个说法再试一次。");
    return;
  }
  const sourceType = mode === "想法" && findSpecificPersonalClaims(content).length
    ? "个人经历"
    : (mode === "文章" ? "案例/故事" : "核心观点");
  const evidence = [{ type: sourceType, note: content }, ...supp];
  assertGroundedPersonalNarrative(out, evidence);
  await notifyLong(env, to, out);

  if (save) {
    try {
      await saveTweetBatch(env, { mode, url, sourceTitle, content, json, manualTags, sourceType });
      await notify(env, to, "💾 已存：来源进素材库，候选进稿件库（待修改）。");
    } catch (e) {
      console.error("tweet save failed:", e.message);
      await notify(env, to, `⚠️ 草稿已生成但落库失败：${e.message.slice(0, 100)}`);
    }
  }
}

// 想法模式垫料：手动 #标签 + 想法文字里命中的词表标签 → 检索素材库，取前 6 条
async function findTweetMaterials(env, text, manualTags) {
  const tags = [...new Set([...manualTags, ...TAG_VOCAB.filter((t) => text.includes(t))])];
  if (!tags.length) return [];
  // 和成稿的补充料走同一条检索：同一件事没必要有两套打分规则
  const rows = (await searchSupplementary(env, { tags, text, limit: 6 }))
    .filter((m) => isMaterialEligibleForDraft({ type: m.type, verificationStatus: m.verification }));
  const tagMap = await tagsOf(env, "material", rows.map((m) => m.id));
  return rows.map((m) => ({
    title: m.title,
    type: m.type,
    note: (m.content || "").slice(0, 500),
    verificationStatus: m.verification,
    tags: tagMap.get(m.id) || [],
  }));
}

function formatTweetResult(json) {
  const parts = [];
  let i = 1;
  for (const c of json.candidates || []) {
    if (Array.isArray(c.thread) && c.thread.length) {
      parts.push(`【${i} · ${c.kind || "短thread"}】\n${c.thread.map((t, k) => `${k + 1}/ ${t}`).join("\n\n")}`);
    } else if (c.text) {
      parts.push(`【${i} · ${c.kind || "单推"}】\n${c.text}`);
    } else {
      continue;
    }
    i++;
  }
  if (!parts.length) return "";
  if (json.link_reply) parts.push(`【链接自评（发在第一条回复里）】\n${json.link_reply}`);
  if (json.note) parts.push(`💡 ${json.note}`);
  return parts.join("\n\n————————\n\n");
}

// #存 落库：来源 → 素材库（带出处链接）；全部候选合并 → 稿件库一行（平台=X，待修改）
async function saveTweetBatch(env, { mode, url, sourceTitle, content, json, manualTags, sourceType }) {
  const taskIdentity = [mode, url || content];
  const verification = verificationForMaterial({ type: sourceType, note: content, sourceUrl: url, origin: "manual" });
  const material = await upsertByTaskKey(env, "materials", stableTaskKey("tweet-source", taskIdentity), {
    title: sourceTitle.slice(0, 200),
    type: sourceType,
    content: content.slice(0, 1800),
    source_url: url || "",
    verification: verification.status,
    verification_note: verification.note,
  });
  if (manualTags.length) await setTags(env, "material", material.id, manualTags.slice(0, 4));
  else if (material.created) await autoTag(env, material.id, sourceType, content.slice(0, 2000));

  const first = (json.candidates || []).find((c) => c.text || (c.thread || []).length);
  const headline = first ? (first.text || first.thread[0]) : sourceTitle;
  // 稿件正文直接进 body 列。topic_id 留空——/推 本来就没有对应选题。
  await upsertByTaskKey(env, "drafts", stableTaskKey("tweet-draft", taskIdentity), {
    topic_id: null,
    headline: headline.slice(0, 200),
    summary: `/推 ${mode}模式候选${url ? `｜${url}` : ""}`.slice(0, 500),
    body: formatTweetResult(json).replaceAll("————————", "---"),
    platform: "X",
    status: DRAFT_STATUS.TODO,
  });
}
