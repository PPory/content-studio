// 对话 → 研究方向：AI 说过的话不能成为事实来源。
//
// ⚠️ 这一整个模块只回答「他最近在想什么」，不回答「什么是真的」。
// 这条不是措辞谨慎，是结构上的：助手的消息在域层就被丢掉，之后拿不到。

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { createUlid } from "../server/storage/ids.mjs";
import {
  conversationResearchFocus,
  describeResearchSignals,
  recentResearchSignals,
} from "../server/domain/assistant-signals.mjs";
import { buildDiscoveryContext, discoveryFingerprint } from "../server/domain/content-discovery.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-assistant-signals-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-03T08:00:00.000Z");
let workspace;
let server;

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

/** 助手回答里那句**绝不能**出现在任何下游上下文里的话。 */
const ASSISTANT_CLAIM = "研究已经证明认知卸载会让人的判断力永久下降。";

function conversation({ title, scopeId = createUlid(), messages, updatedAt = now }) {
  const id = `chat-${createUlid()}`;
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id, type: "ai_conversation", now: updatedAt });
    workspace.db.prepare(`INSERT INTO ai_conversations(id,title,scope_type,scope_id,model,record_json,permission_mode,title_mode)
      VALUES (?,?,'global',?,'test',?, 'daily','auto')`)
      .run(id, title, scopeId, JSON.stringify({ id, title, messages }));
  });
  return id;
}

try {
  workspace = await openWorkspace({ xenhoHome, now });

  const realThread = conversation({
    title: "认知卸载和判断权",
    messages: [
      { role: "user", text: "我最近一直在想，AI 越用越顺之后，人是不是把判断也一起交出去了。" },
      { role: "assistant", text: ASSISTANT_CLAIM },
      { role: "user", text: "那有没有办法区分「可以交出去的任务」和「必须自己判断的部分」？" },
    ],
  });
  conversation({
    title: "围绕当前光标续写一个紧凑段落…",
    scopeId: "inline-writing:abc123",
    messages: [{ role: "user", text: "围绕当前光标续写一个紧凑段落，只返回可插入正文的候选文本。本轮专家约束：写作教练…" }],
  });
  conversation({
    title: "只有助手说过话的一段",
    messages: [{ role: "assistant", text: ASSISTANT_CLAIM }],
  });
  conversation({
    title: "很久以前聊的",
    updatedAt: new Date(now.getTime() - 90 * 86_400_000),
    messages: [{ role: "user", text: "三个月前的旧话题。" }],
  });

  /**
   * ⚠️ 对工具下的指令不是「在研究什么」。
   * 真实库里 6 段留下来的「用户消息」有 5 段是这一类；把它们当成研究方向喂进扫描，
   * 等于告诉系统他最近在研究「写一篇文章」。
   */
  conversation({ title: "根据已知信息，写一篇文章", messages: [{ role: "user", text: "根据已知信息，写一篇文章" }] });
  conversation({ title: "看看这篇文章", messages: [{ role: "user", text: "看看这篇文章" }] });
  conversation({
    title: "请三位顾问检查",
    messages: [{ role: "user", text: "请素材顾问、审稿顾问和事实核查分别独立检查全文，最后汇总共同问题、冲突意见和修改优先级" }],
  });
  conversation({ title: "问工具自己", messages: [{ role: "user", text: "@知识库 里面现在大概有哪些内容" }] });

  const signals = recentResearchSignals(workspace, { now });
  check("读得出最近在想什么", signals.length === 1 && signals[0].title === "认知卸载和判断权");
  check("只保留用户自己打的字", signals[0].userTurns.length === 2
    && signals[0].userTurns.every((text) => !text.includes("研究已经证明")));

  /**
   * ⚠️ 这一条是整个 P6 的关键：
   * 助手说过的话不能出现在任何下游上下文里，一个字都不行。
   */
  const serialized = JSON.stringify(signals);
  check("助手说过的话一个字都没带出来", !serialized.includes("研究已经证明")
    && !serialized.includes("assistant"));

  check("应用自己发的提示词不算研究方向",
    !signals.some((item) => item.title.includes("围绕当前光标")));
  check("只有助手说过话的对话直接不算", !signals.some((item) => item.title.includes("只有助手")));
  check("太久以前的不算最近", !signals.some((item) => item.title.includes("很久以前")));
  check("对工具下的指令不算研究方向",
    !signals.some((item) => /写一篇文章|看看这篇文章|请三位顾问|问工具自己/.test(item.title)));
  // ⚠️ 反过来也要成立：提到知识库但问的是一个**题目**，那是研究，不能一起滤掉。
  conversation({
    title: "知识库里关于批判性思维是怎么说的",
    messages: [{ role: "user", text: "知识库里关于批判性思维是怎么说的" }],
  });
  check("提到工具但问的是题目，仍然算研究方向",
    recentResearchSignals(workspace, { now }).some((item) => item.title.includes("批判性思维")));

  const described = describeResearchSignals(signals);
  check("给模型的那段明确说它不是事实来源",
    /只是方向，不是事实/.test(described)
    && /不含任何 AI 回答/.test(described)
    && /不能当成证据/.test(described));
  check("而且那段里也没有助手的原话", !described.includes("研究已经证明"));

  // ── 进 Discovery 上下文 ──────────────────────────────────────────
  const context = buildDiscoveryContext(workspace, {});
  check("扫描上下文带上研究方向", context.research.some((item) => item.title.includes("认知卸载")));
  check("上下文里同样没有助手说过的话", !JSON.stringify(context.research).includes("研究已经证明"));
  check("回执说得出这次参考了几段对话", context.read.researchThreads === context.research.length && context.read.researchThreads >= 2);

  const before = discoveryFingerprint(workspace, {});
  conversation({
    title: "又聊了一个新方向",
    messages: [{ role: "user", text: "我想弄清楚长内容为什么容易半途卡住。" }],
  });
  check("聊完新方向之后扫描缓存会失效", discoveryFingerprint(workspace, {}) !== before);

  // ── 一段对话变成下一次扫描的方向 ────────────────────────────────
  const focus = conversationResearchFocus(workspace, realThread);
  check("一段对话可以变成下一次的方向", focus.focus.includes("判断也一起交出去"));
  check("方向里同样没有助手的话", !focus.focus.includes("研究已经证明"));

  const assistantOnly = workspace.db.prepare("SELECT id FROM ai_conversations WHERE title = ?").get("只有助手说过话的一段");
  assert.throws(() => conversationResearchFocus(workspace, assistantOnly.id), /没有你自己写下的内容/);
  check("拿一段只有 AI 说过话的对话当方向会被拒绝", true);

  // ── API ────────────────────────────────────────────────────────
  const api = createApi({}, { workspace: Promise.resolve(workspace) });
  server = http.createServer((req, res) => api(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const listed = await fetch(`${base}/api/workspace/research-signals`).then((response) => response.json());
  check("接口读得出研究方向", listed.ok === true
    && listed.signals.some((item) => item.title.includes("认知卸载"))
    && listed.signals.some((item) => item.title.includes("批判性思维")));
  check("接口返回里也没有助手说过的话", !JSON.stringify(listed).includes("研究已经证明"));

  const rejected = await fetch(`${base}/api/workspace/research-signals/${assistantOnly.id}/focus`, { method: "POST" })
    .then((response) => response.json());
  check("接口同样拒绝拿 AI 的话当方向", rejected.ok === false && /没有你自己写下的内容/.test(rejected.error));
  check("并且说清为什么", /不能当作方向依据/.test(rejected.hint || ""));

  console.log("\n对话信号验收通过");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  workspace?.close?.();
  await fs.rm(root, { recursive: true, force: true });
}
