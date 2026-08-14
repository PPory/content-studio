// OpenAI 兼容 LLM 调用 + 防御性 JSON 解析。
// 实测 claude-opus-4-6-thinking 会包 ```json 围栏，解析前先剥。

// 附在 user 消息末尾的格式提醒（system prompt 保持原文，不在此改动）
const JSON_HINT = "\n\n（格式要求：输出必须是可被 JSON.parse 解析的合法 JSON——字符串内部的双引号必须转义为 \\\"，换行必须写成 \\n，不要输出裸换行。）";

export async function chatJson(env, { system, user, maxTokens = 8000 }) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { content, finishReason } = await chat(env, { system, user: user + JSON_HINT, maxTokens });
    try {
      return { json: parseLooseJson(content), finishReason };
    } catch (e) {
      lastErr = new Error(`LLM JSON parse failed (attempt ${attempt + 1}): ${e.message}; head=${content.slice(0, 200)}`);
    }
  }
  throw lastErr;
}

// 流式调用：LLM 代理经 Cloudflare，非流式请求超 100 秒会被 524 掐断；
// SSE 持续有字节到达，长生成（成稿数分钟）也能安全完成。
export async function chat(env, { system, user, maxTokens = 8000 }) {
  const res = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LLM_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      stream: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM ${res.status}: ${body.slice(0, 500)}`);
  }
  let content = "";
  let finishReason = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop(); // 最后一段可能不完整，留到下一轮
    for (const line of lines) {
      const data = line.replace(/^data:\s*/, "").trim();
      if (!data || !line.startsWith("data:") || data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data);
        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) content += choice.delta.content;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      } catch {
        // 忽略非 JSON 的 SSE 行（注释/心跳）
      }
    }
  }
  if (!content) throw new Error("LLM empty streamed response");
  return { content, finishReason };
}

// 可选的纯文本透传流。需要“输出前完成整段校验”的场景不能直接使用它，应调用 chat() 收齐后校验。
export async function chatStream(env, { system, user, maxTokens = 2000 }) {
  const res = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LLM_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      stream: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM ${res.status}: ${body.slice(0, 500)}`);
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = "";
  return res.body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop(); // 最后一段可能不完整，留到下一轮
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const text = JSON.parse(data).choices?.[0]?.delta?.content;
            if (text) controller.enqueue(encoder.encode(text));
          } catch {
            // 忽略非 JSON 的 SSE 行（注释/心跳）
          }
        }
      },
    })
  );
}

export function parseLooseJson(text) {
  let s = text.trim();
  // 剥 ```json ... ``` 围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  // 取首个 { 到末个 }（容忍前后多余文字）
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object found");
  s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    // 常见故障：模型在 string 里输出裸换行，或内容里的英文双引号未转义
    return JSON.parse(repairJsonStrings(s));
  }
}

// 逐字符扫描修复 JSON string 字面量内部的两类问题：
// 1) 裸控制字符（换行/制表符）→ 转义序列
// 2) 未转义的内容双引号 → \"（启发式：引号后的下个非空白字符若不是 , } ] :，视为内容引号）
function repairJsonStrings(s) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && (s[j] === " " || s[j] === "\t" || s[j] === "\r" || s[j] === "\n")) j++;
      const next = s[j];
      if (next === undefined || next === "," || next === "}" || next === "]" || next === ":") {
        inString = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }
    const code = ch.codePointAt(0);
    if (code < 0x20) {
      out += { "\n": "\\n", "\r": "\\r", "\t": "\\t" }[ch] || `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    out += ch;
  }
  return out;
}
