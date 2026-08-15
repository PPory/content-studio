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

export function buildMaterialDraft(title, materials = []) {
  const cards = materials.map((material) => {
    const body = String(material.note || "").trim().split("\n").map((line) => `> ${line}`).join("\n");
    return `### ${material.title || "未命名素材"}\n\n${body || "> （这条素材没有正文）"}`;
  });
  return [
    title?.trim() ? `# ${title.trim()}` : "",
    "<!-- 以下是本次起稿选中的素材。写完后可删掉这一段。 -->",
    "## 写作素材",
    cards.join("\n\n"),
    "---",
    "",
  ].filter((part, index) => part || index === 5).join("\n\n");
}
