// /api/agent/chat → 和一个**本机 agent** 深聊当前这篇东西。可选 Claude Code 或 Codex。
//
// 为什么不自己实现一个 chat：那等于重写一遍 agent 壳（管上下文、管工具调用、管权限）。
// 直接 spawn headless CLI，对话的对象就不是「一段贴进 prompt 的文字」，而是一个**能读你整个
// vault** 的 agent——它能顺着当前这篇去翻你以前的笔记，这是贴文本做不到的。
//
// **两个引擎的差别只有一条要让用户知道：Codex 不吐增量。** claude 的 stream-json 里有
// content_block_delta，一个字一个字往外走；codex 的 --json 只在整条消息完成时给一个
// item.completed，所以它是「转半天，然后整段落地」。这不是坏了，但等待文案必须说清楚，
// 否则用户会以为卡死。
//
// 两条安全约束，改这个文件前先看懂：
//
// 1. **用户输入只走 stdin，绝不进命令行参数。** Claude 现在是原生 exe，必须 shell:false；
//    Codex 仍可能走 .cmd 包装，才单独开 shell。拼进命令行的话用户在提问里写个引号或
//    `&&` 就能执行任意命令。所有 args 都是写死的常量，唯一变量 session id 也过了 UUID 校验。
// 2. **只给只读能力。** claude 侧靠 --allowedTools 白名单（Read/Glob/Grep），codex 侧靠
//    --sandbox read-only（它没有等价的工具白名单，但沙箱是更硬的那一层）。让 agent 直接写
//    vault 很香，但那意味着一句话就能改你的知识库。结论要留下时走界面上的「存为笔记」。

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { json, readJsonBody } from "../lib/http.mjs";
import { vaultRoot } from "../lib/vault.mjs";
import { DEFAULT_PROMPTS, chatSystem, loadPrompts } from "../lib/prompts.mjs";
import { cancelGuidedTurn, guidedSessionId, runGuidedTurn } from "../agent-runtime/guided-runner.mjs";

const MAX_TURNS = "12"; // 兜住失控的多轮工具调用
const WORKBENCH_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

/**
 * 系统提示词。**角色设定用户可改（设置面板），安全约束是常量、永远拼在最后。**
 *
 * 拼接的判据只写在 `lib/prompts.mjs` 的 `chatSystem()` 里，这儿不自己拼——
 * 分头拼的话，以后加第二个 spawn 入口时那一处会漏掉 guard，而漏了不报错，
 * 只是那条通道变得可以被正文里的一句话指挥（它能读你整个 vault）。
 *
 * ⚠️ **`claudeArgs` 现在要传 system 进来。** 它被 `tests/unit.mjs` 直接调用，
 * 不传就退回默认——**不能退回空串**，那等于把角色设定和安全约束一起丢掉。
 */
export function claudeArgs(sessionId = "", system = chatSystem(DEFAULT_PROMPTS)) {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--allowedTools", "Read", "Glob", "Grep",
    "--max-turns", MAX_TURNS,
    "--append-system-prompt", system,
  ];
  // Claude 的 --resume 是 optional value。等号形式能避开不同启动环境的参数解析差异，
  // 确保 UUID 始终进入 resume 分支，而不是悄悄新建一轮会话。
  if (sessionId) args.push(`--resume=${sessionId}`);
  return args;
}

/**
 * 引擎表。加第三个引擎只要往这里加一项：给 bin / args / prompt / onEvent 四件套。
 *
 * `onEvent(ev, out)` 把各家的事件流翻译成同一套动作：
 *   out.session(id) 记会话号（续聊要用，只在正文开始前发得出去）
 *   out.write(text) 往响应里吐字
 *   out.fail(msg)   记下失败原因，供「一个字都没输出」时报错用
 *
 * **导出是给设置面板的自检用的**（`lib/settings-check.mjs`）：那边照着 `bin` + `shell`
 * 探一次 `--version`，探的必须是这里真正会 spawn 的那套配置。自己另写一份
 * 「claude 在不在」的判断，就会出现「自检说装了、点对话起不来」这种最难查的错。
 */
export const ENGINES = {
  claude: {
    label: "Claude Code",
    bin: "claude",
    shell: false,
    args: claudeArgs,
    prompt: (parts) => parts.join("\n\n"),
    onEvent(ev, out) {
      if (ev.type === "system" && ev.session_id) out.session(ev.session_id);
      if (ev.type === "stream_event" && ev.event?.type === "content_block_delta") {
        const text = ev.event.delta?.text;
        if (text) {
          out.session(ev.session_id);
          out.write(text);
        }
      }
    },
    hint: "确认命令行里 claude 可用（claude --version）",
  },

  codex: {
    label: "Codex",
    bin: "codex",
    shell: true,
    args(sessionId) {
      // 不传 prompt 参数：codex 在 stdin 是管道时就从 stdin 读，正好符合「用户输入不进 argv」。
      //
      // 只读用 `-c sandbox_mode=read-only` 而不是 `--sandbox read-only`：**`exec resume`
      // 这个子命令不认 --sandbox**（它只继承 -c/--model/--json 那几个），两条路各写一套的话
      // 续聊那一路会直接 "unexpected argument" 起不来。值不加引号是故意的——codex 先按 TOML
      // 解析，解析不了就当原字符串用，正好绕开 shell:true 下的引号转义。
      const flags = ["--json", "--skip-git-repo-check", "-c", "sandbox_mode=read-only"];
      return sessionId ? ["exec", "resume", ...flags, sessionId] : ["exec", ...flags];
    },
    // codex 没有 --append-system-prompt，角色设定只能拼进 stdin 的提示里（stdin 是安全的那条路）
    prompt: (parts, system) => [system, ...parts].join("\n\n"),
    onEvent(ev, out) {
      if (ev.type === "thread.started" && ev.thread_id) out.session(ev.thread_id);
      if (ev.type === "item.completed" && ev.item?.type === "agent_message" && ev.item.text) {
        // 一轮里可能有多条消息，接着往下写而不是覆盖
        out.write(out.wrote ? `\n\n${ev.item.text}` : ev.item.text);
      }
      // item.type === "error" 多半是「skill 描述被截短了」这类环境提醒，铺到对话里纯属噪音；
      // 真正的失败走 turn.failed。
      if (ev.type === "turn.failed" && ev.error?.message) out.fail(ev.error.message);
    },
    hint: "确认命令行里 codex 可用（codex --version），并且已经 codex login",
  },
};

export const agentRoutes = [
  {
    method: "POST",
    path: "/api/agent/chat",
    async handler({ env, req, res }) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return json(res, { ok: false, error: e.message }, 400);
      }

      const message = String(body.message || "").trim();
      if (!message) return json(res, { ok: false, error: "message 不能为空" }, 400);

      const interview = body.workflow === "interview";
      const brainstorm = body.workflow === "brainstorm";
      const guidedWriting = interview || brainstorm;
      if (guidedWriting) {
        const workflow = interview ? "interview" : "brainstorm";
        const sessionId = guidedSessionId(body.sessionId);
        const promptParts = interview ? interviewPromptParts(body, body.sessionId) : [!body.sessionId ? "/idea-dialogue" : "", ...brainstormPromptParts(body)];
        const prompt = [...promptParts, `【本轮输入】\n${message}`].filter(Boolean).join("\n\n");
        let headersSent = false;
        let completed = false;
        const write = (text) => {
          if (!headersSent) {
            headersSent = true;
            res.writeHead(200, {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-cache, no-transform",
              "x-session-id": sessionId,
              "x-agent-engine": "deepseek-harness",
            });
          }
          if (!res.destroyed && !res.writableEnded) res.write(text);
        };
        res.on("close", () => {
          if (!completed) cancelGuidedTurn(workflow, sessionId, body.model || env.HARNESS_LLM_MODEL).catch(() => {});
        });
        try {
          await runGuidedTurn(env, {
            workflow,
            sessionId,
            prompt,
            model: body.model || env.HARNESS_LLM_MODEL,
            context: { title: body.draftTitle || "", platform: body.platform || "", audience: body.audience || "", materials: body.materials || "" },
            onText: write,
          });
          completed = true;
          if (!headersSent) write("");
          if (!res.destroyed && !res.writableEnded) res.end();
        } catch (error) {
          completed = true;
          if (!headersSent) return json(res, { ok: false, error: error.message, hint: error.hint || "检查 AI 助手模型配置后重试" }, error.status || 502);
          if (!res.destroyed && !res.writableEnded) res.end();
        }
        return;
      }
      // 访谈和想法梳理已在上方交给 Harness；这里仅保留旧的通用文档读取入口，
      // 继续按白名单选择 Claude/Codex，避免改变尚未迁移的工作流。
      //
      // ⚠️ **「按素材起稿」曾经也在这条通道上，已经搬去 Worker 了**（`/wb/draft/material`）。
      // 它既不读 vault 也不用 skill——CLI 只是被当成一个要冷启动十几秒的 API 客户端，
      // 而且那条路上没有真实性硬闸。别再往这儿加这类「纯生成」的活。
      const engine = interview ? ENGINES.claude : ENGINES[String(body.agent || "")] || ENGINES.claude;

      let cwd;
      if (guidedWriting) {
        // cwd 放在 workbench 根目录，Claude Code 才会发现 `.claude/skills/interview-to-draft`。
        // 访谈不读 vault，所以即使用户还没配置 Obsidian 也能正常起稿。
        cwd = WORKBENCH_ROOT;
      } else {
        try {
          cwd = vaultRoot(env);
        } catch (e) {
          return json(res, { ok: false, error: e.message, hint: e.hint }, 503);
        }
      }

      // 续聊：session id 由前一轮的响应头带回前端，再原样传回来。
      // 校验形状，别把任意字符串塞进命令行。
      const raw = String(body.sessionId || "");
      const sessionId = /^[0-9a-f-]{16,64}$/i.test(raw) ? raw : "";

      // 角色设定来自设置面板（config/prompts.json），安全约束由 chatSystem 恒定拼在最后。
      // 读失败也照跑：loadPrompts 自己会退回默认值，而默认值里 guard 一样在
      const system = chatSystem(await loadPrompts());

      const child = spawn(engine.bin, engine.args(sessionId, system), {
        cwd,
        shell: engine.shell,
        windowsHide: true,
      });

      // 当前在读的东西作为上下文，和问题一起从 stdin 进去
      const parts = [
            ...(interview ? interviewPromptParts(body, sessionId) : brainstorm ? brainstormPromptParts(body) : []),
            body.docTitle ? `【我正在读】${body.docTitle}` : "",
            body.sourceUrl ? `【网页】${String(body.sourceUrl).slice(0, 2048)}` : "",
            body.selection ? `【选中的片段】\n${String(body.selection).slice(0, 4000)}` : "",
            body.pageContext ? `【选区附近正文】\n${String(body.pageContext).slice(0, 6000)}` : "",
            body.docPath ? `【文件】${body.docPath}` : "",
            `${guidedWriting ? "【本轮输入】" : "【我的问题】"}\n${message}`,
          ].filter(Boolean);
      const prompt = engine.prompt(
        parts,
        system
      );
      child.stdin.end(prompt, "utf8");

      let headersSent = false;
      let pendingSessionId = "";
      let stderr = "";
      let failure = "";
      const out = {
        wrote: false,
        session(id) {
          if (headersSent || !id) return;
          pendingSessionId = id;
        },
        start() {
          if (headersSent) return;
          headersSent = true;
          res.writeHead(200, {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            // 会话号先暂存，等第一段正文真正到达再发头。
            // 否则 agent 在 init 后失败时，前端只会收到一次空白的 200。
            "x-session-id": pendingSessionId,
          });
        },
        write(text) {
          out.start();
          out.wrote = true;
          res.write(text);
        },
        fail(msg) {
          failure = String(msg);
        },
      };

      let buf = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buf += chunk;
        const lines = buf.split("\n");
        buf = lines.pop(); // 末行可能不完整
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            continue; // 非 JSON 行直接忽略（codex 会往 stdout 混日志）
          }
          engine.onEvent(ev, out);
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (d) => {
        stderr += d;
      });

      // 用户关掉面板就把子进程杀掉，别让它在后台继续烧 token
      res.on("close", () => {
        if (!child.killed) child.kill();
      });

      await new Promise((resolve) => {
        const die = (error, hint, status) => {
          if (!headersSent) {
            // 会话号过期是前端可恢复的控制分支：它会携带已有对话重建一次。
            // 仍返回 JSON 失败契约，但不把这次预期内恢复记成浏览器网络错误。
            const recoverable = /No conversation found with session ID/i.test(String(error || ""));
            json(res, { ok: false, error, hint, code: recoverable ? "SESSION_EXPIRED" : undefined }, recoverable ? 200 : status);
          }
          else res.end();
          resolve();
        };
        child.on("error", (e) => die(`起不动 ${engine.bin}：${e.message}`, engine.hint, 503));
        child.on("close", (code) => {
          if (headersSent) return die();
          const why = failure || (stderr ? stderr.slice(-300).trim() : "");
          die(
            `${engine.label} 退出（code ${code}）${why ? "：" + why : "，且没有输出"}`,
            engine.hint,
            502
          );
        });
      });
    },
  },
];
