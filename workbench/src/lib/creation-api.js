async function jsonRequest(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw Object.assign(new Error("本地服务没响应"), { hint: "确认工作台仍在运行" });
  }
  const data = await response.json().catch(() => ({ ok: false, error: `响应不是 JSON（HTTP ${response.status}）` }));
  if (!response.ok || !data.ok) throw Object.assign(new Error(data.error || "请求失败"), { hint: data.hint });
  return data;
}

const post = (path, body) => jsonRequest(path, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const creationApi = {
  create: (body) => post("/api/pipe/create", body),
  searchMaterials: (query) => jsonRequest(`/api/pipe/search/materials?q=${encodeURIComponent(query)}&limit=30`),
  /**
   * 关键词搜不到时的第二条路：按意思挑。
   * **整件事在 Worker 那侧做**（库和 LLM 代理都在那儿），这里只把「想找什么」送过去。
   */
  pickMaterials: (body) => post("/api/pipe/pick/materials", body),
  /**
   * 按素材起稿。**不流式**：Worker 那边要先收齐、过完真实性闸门才放行——
   * 边写边显示的话，被判定为编造的那段用户已经读完了，再撤等于没拦。
   * 只传 id，不传素材正文：闸门拿「个人经历」素材当证据，证据由客户端给就等于没有闸门。
   */
  draftFromMaterials: (body, signal) => jsonRequest("/api/pipe/draft/material", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }),
  /**
   * 重新核对引用：用户改完正文之后，哪些标注还成立。
   * 只传 id，素材原文由 Worker 从库里读——标注是给用户「这句有出处」的信号，
   * 证据由客户端给的话那个信号就能被伪造。
   */
  cite: (body, signal) => jsonRequest("/api/pipe/cite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }),
  audiences: () => jsonRequest("/api/audiences"),
  // 记不下来不该让主动作跟着失败，所以调用方一律 catch 掉
  rememberAudience: (value) => post("/api/audiences", { value }),
  async saveDraft(id, title, markdown) {
    await post("/api/pipe/update", { view: "drafts", pageId: id, fields: { title } });
    return post("/api/pipe/content", { view: "drafts", pageId: id, markdown });
  },
};

export async function interviewStream({ signal, sessionId, message, title, platform, phase, onSession, onChunk }) {
  const response = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workflow: "interview",
      agent: "claude",
      sessionId: sessionId || undefined,
      message,
      draftTitle: title,
      platform,
      phase,
    }),
    signal,
  });
  const type = response.headers.get("content-type") || "";
  if (!response.ok || type.includes("application/json")) {
    const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw Object.assign(new Error(data.error || "访谈服务没有响应"), { hint: data.hint });
  }
  onSession?.(response.headers.get("x-session-id") || "");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    onChunk?.(full);
  }
  return full.trim();
}

export function cleanGeneratedDraft(text) {
  const value = String(text || "").trim();
  const fenced = value.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/i);
  return (fenced ? fenced[1] : value).trim();
}

export function deriveDraftTitle(title, markdown) {
  const explicit = String(title || "").trim();
  if (explicit) return explicit.slice(0, 200);
  const lines = String(markdown || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => /^#{1,6}\s+/.test(line));
  const source = heading || lines[0] || "未命名稿";
  return source
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*>\d.)\s]+/, "")
    .replace(/[*_`~\[\]]/g, "")
    .trim()
    .slice(0, 60) || "未命名稿";
}

export function formatMaterialQuote(material = {}) {
  const note = String(material.note || "").trim();
  if (!note) return "";
  const quote = note.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
  return `${quote}\n>\n> —— 素材：${String(material.title || "未命名素材").trim()}`;
}
