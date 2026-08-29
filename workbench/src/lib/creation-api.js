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
  /**
   * 关键词搜不到时的第二条路：按意思挑。
   * **整件事在 Worker 那侧做**（库和 LLM 代理都在那儿），这里只把「想找什么」送过去。
   */
  pickMaterials: (body) => post("/api/pipe/pick/materials", body),
  writingAssist: (body, signal) => jsonRequest("/api/pipe/writing-assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }),
  reviseText: (body, signal) => jsonRequest("/api/pipe/text-revision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }),
  revisions: (scope) => jsonRequest(`/api/revisions?scope=${encodeURIComponent(scope)}`),
  saveRevision: (scope, item) => post("/api/revisions", { scope, item }),
  moveRevisions: (from, to) => post("/api/revisions/move", { from, to }),
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
  saveDraft: (id, title, markdown) => post(`/api/workspace/drafts/${encodeURIComponent(id)}/save`, { title, body: markdown }),
};
