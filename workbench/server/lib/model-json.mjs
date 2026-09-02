// 一次性的结构化模型调用。
//
// ⚠️ **为什么不走 `runAssistantTurn`。** 那条路是给**交互**用的：建会话、挂工具、
// 流式输出、写进 `ai_conversations`。提炼是一个无人值守的批处理——它不需要会话历史，
// 不需要工具，也不该在库里留下几百条「对话」。硬套那条路的代价不是慢，是**语义错了**：
// 用户点开 AI 助手的历史，会看到一百条自己从没说过的话。
//
// 这里只做一件事：发一次 chat/completions，拿回一段 JSON。

import { proxyFetch } from "./fetch.mjs";

const clean = (value, max) => String(value ?? "").trim().slice(0, max);

export function ingestModelId(env = {}) {
  // 提炼有自己的模型位。**和助手的模型分开**：助手那个是你随手换着用的，
  // 而提炼要跑一百多份资料，它的质量/成本取舍是另一个决定，不该被顺手改掉。
  return clean(env.AGENT_INGEST_MODEL, 240) || "gemini-3.7-flash-high";
}

/**
 * 提炼走哪个端点。**可以整条换掉，不只是换模型名。**
 *
 * 助手那条通道的配额会断（实测一整批里七份挂在 `auth_unavailable` 上），
 * 而提炼是长跑。留一个独立的地址位，就能在不动助手配置的前提下把它整条挪走——
 * 比如指向本机跑着的 OpenAI 兼容代理，用另一个账号或另一个模型继续跑。
 *
 * ⚠️ 只留 base_url + key 这一个口子，不去调 codex 这类 CLI 的子进程：
 * 那会为**每一份资料**起一个带沙箱和审批的完整 agent，而这里要的只是一次
 * JSON 补全。工具用错了不会报错，只会慢十倍并且难以排查。
 */
export function ingestEndpoint(env = {}) {
  return {
    base: (clean(env.AGENT_INGEST_BASE_URL, 2_000) || clean(env.AGENT_LLM_BASE_URL, 2_000)).replace(/\/+$/, ""),
    key: clean(env.AGENT_INGEST_API_KEY, 4_000) || clean(env.AGENT_LLM_API_KEY, 4_000),
  };
}

/**
 * 从模型回复里取出 JSON。
 *
 * 模型经常把 JSON 包在 ```json 围栏里，或者在前面加一句「好的，以下是……」。
 * 这不是模型不听话，是这类前缀在训练数据里太常见了——与其在提示里反复禁止，
 * 不如在这里容忍掉，省下的提示预算留给真正重要的约束。
 */
export function extractJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("模型没有返回 JSON");
  const opening = body[start];
  const closing = opening === "{" ? "}" : "]";
  const end = body.lastIndexOf(closing);
  if (end <= start) throw new Error("模型返回的 JSON 不完整");
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (error) {
    throw new Error(`模型返回的 JSON 无法解析：${error.message}`);
  }
}

export async function completeJson(env, { system, user, model = "", maxTokens = 8_000, signal } = {}) {
  const { base, key } = ingestEndpoint(env);
  const modelId = clean(model, 240) || ingestModelId(env);
  if (!base || !key || !modelId) throw Object.assign(new Error("模型尚未配置"), { status: 400, hint: "到 设置 → AI 助手 填写模型地址、模型名和密钥。" });

  let response;
  try {
    response = await proxyFetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens,
        temperature: 0,
      }),
      signal,
    });
  } catch (error) {
    /**
     * ⚠️ **连不上和「模型说不行」是两回事，界面上必须分得出来。**
     * 上一版网络抖一下，用户看到的是「内容发现失败：fetch failed」加一句
     * 「回终端看 npm run dev 的日志」——他既不知道自己的东西有没有被改，
     * 也不知道该重试还是去改配置。真实跑的时候就这么撞上过一次。
     */
    if (error?.name === "AbortError") throw error;
    throw Object.assign(new Error("连不上模型服务，你的知识、原话和已有内容都没有被改动"), {
      status: 503,
      hint: "多半是网络或代理抖了一下，可以直接重试；一直不通就到 设置 → AI 助手 检查地址和密钥。",
      cause: error,
    });
  }
  const text = await response.text();
  if (!response.ok) {
    if ([502, 503, 504, 524].includes(response.status)) {
      throw new Error(`知识编译模型服务超时（HTTP ${response.status}），资料没有损坏；可以稍后重试，或在设置中切换知识编译地址/模型`);
    }
    const detail = /<\s*!doctype|<\s*html/i.test(text) ? "上游返回了错误页面" : clean(text, 300);
    throw new Error(`模型调用失败（HTTP ${response.status}）：${detail}`);
  }
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`模型响应不是 JSON：${clean(text, 300)}`); }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型没有返回内容");
  return { model: modelId, data: extractJson(content), usage: payload.usage || null };
}
