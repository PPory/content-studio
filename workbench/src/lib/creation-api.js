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
  create: (body) => post("/api/workspace/projects", body),
  // 关键词搜不到时，在当前 SQLite 工作区按意思挑。
  pickMaterials: (body) => post("/api/workspace/materials/pick", body),
  writingAssist: (body, signal) => jsonRequest("/api/workspace/ai/writing-assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }),
  reviseText: (body, signal) => jsonRequest("/api/workspace/ai/text-revision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }),
  revisions: (scope) => jsonRequest(`/api/revisions?scope=${encodeURIComponent(scope)}`),
  saveRevision: (scope, item) => post("/api/revisions", { scope, item }),
  moveRevisions: (from, to) => post("/api/revisions/move", { from, to }),
  audiences: () => jsonRequest("/api/audiences"),
  // 记不下来不该让主动作跟着失败，所以调用方一律 catch 掉
  rememberAudience: (value) => post("/api/audiences", { value }),
  saveDraft: (id, title, markdown) => post(`/api/workspace/drafts/${encodeURIComponent(id)}/save`, { title, body: markdown }),
};
