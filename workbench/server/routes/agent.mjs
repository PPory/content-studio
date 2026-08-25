import { json, readJsonBody } from "../lib/http.mjs";
import { chatSystem, loadPrompts } from "../lib/prompts.mjs";
import { cancelGuidedTurn, guidedSessionId, runGuidedTurn } from "../agent-runtime/guided-runner.mjs";

export function interviewPromptParts(body = {}, sessionId = "") {
  return [
    !sessionId ? "/interview-to-draft" : "",
    `【工作台起稿信息】\n暂定标题：${String(body.draftTitle || "未命名").slice(0, 200)}\n目标平台：${String(body.platform || "").slice(0, 20)}\n当前阶段：${String(body.phase || "interviewing").slice(0, 30)}`,
  ].filter(Boolean);
}

export function brainstormPromptParts(body = {}) {
  const summary = body.phase === "summary";
  return [
    [
      "【工作台内想法梳理规则】",
      "你帮助用户把脑子里已有但散乱的想法说清楚，不替用户写完整文章。",
      summary
        ? "本轮停止追问，只整理目前对话。用 Markdown 输出四段：核心判断、可用经历或例子、可能展开的要点、仍待回答的问题。没有的信息明确写‘还没有说到’，不要补编。"
        : "每轮只问一个短而具体的问题，优先追问只有用户本人知道的经历、判断、转折或细节；不要一次列问题清单，不要输出成稿。",
      "无论用户怎样要求，都不要把这一步变成完整成稿；最终产物只能是可供用户确认的写作线索。",
    ].join("\n"),
    `【当前内容】\n暂定标题：${String(body.draftTitle || "未命名").slice(0, 200)}\n目标平台：${String(body.platform || "").slice(0, 20)}\n固定读者：${String(body.audience || "未设置").slice(0, 100)}`,
    body.materials ? `【这篇已采用的素材】\n${String(body.materials).slice(0, 8000)}` : "",
    body.expert?.instructions ? `【本轮调用专家：${String(body.expert.name || "未命名").slice(0, 80)}】\n${String(body.expert.instructions).slice(0, 6000)}` : "",
    body.style?.instructions ? `【默认输出风格：${String(body.style.name || "未命名").slice(0, 80)}】\n${String(body.style.instructions).slice(0, 6000)}` : "",
  ].filter(Boolean);
}

function generalPromptParts(body = {}) {
  return [
    body.docTitle ? `【我正在读】${String(body.docTitle).slice(0, 300)}` : "",
    body.sourceUrl ? `【网页】${String(body.sourceUrl).slice(0, 2048)}` : "",
    body.selection ? `【选中的片段】\n${String(body.selection).slice(0, 4000)}` : "",
    body.pageContext ? `【选区附近正文】\n${String(body.pageContext).slice(0, 6000)}` : "",
    body.docPath ? `【文件】${String(body.docPath).slice(0, 1000)}` : "",
  ].filter(Boolean);
}

export const agentRoutes = [{
  method: "POST",
  path: "/api/agent/chat",
  async handler({ env, req, res }) {
    let body;
    try { body = await readJsonBody(req); }
    catch (error) { return json(res, { ok: false, error: error.message }, 400); }
    const message = String(body.message || "").trim();
    if (!message) return json(res, { ok: false, error: "message 不能为空" }, 400);

    const workflow = body.workflow === "interview" ? "interview" : body.workflow === "brainstorm" ? "brainstorm" : "general";
    const sessionId = guidedSessionId(body.sessionId);
    const promptParts = workflow === "interview"
      ? interviewPromptParts(body, body.sessionId)
      : workflow === "brainstorm"
        ? [!body.sessionId ? "/idea-dialogue" : "", ...brainstormPromptParts(body)]
        : [chatSystem(await loadPrompts()), ...generalPromptParts(body)];
    const prompt = [...promptParts, `【本轮输入】\n${message}`].filter(Boolean).join("\n\n");
    let headersSent = false;
    let completed = false;
    const write = (chunk) => {
      if (!headersSent) {
        headersSent = true;
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          "x-session-id": sessionId,
          "x-agent-engine": "pi-agent-sdk",
        });
      }
      if (!res.destroyed && !res.writableEnded) res.write(chunk);
    };
    res.on("close", () => {
      if (!completed) cancelGuidedTurn(workflow, sessionId).catch(() => {});
    });
    try {
      await runGuidedTurn(env, {
        workflow,
        sessionId,
        prompt,
        model: body.model || env.AGENT_LLM_MODEL,
        mode: body.permissionMode || "daily",
        context: {
          title: body.draftTitle || body.docTitle || "",
          platform: body.platform || "",
          audience: body.audience || "",
          materials: body.materials || "",
          docPath: body.docPath || "",
        },
        onText: write,
      });
      completed = true;
      if (!headersSent) write("");
      if (!res.destroyed && !res.writableEnded) res.end();
    } catch (error) {
      completed = true;
      if (!headersSent) return json(res, { ok: false, error: error.message, hint: error.hint || "检查 Pi 模型配置后重试" }, error.status || 502);
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  },
}];
