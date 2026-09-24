// Saving exploration does not approve claims or write article text.
const limits = { thought: 20000, audience: 10000, intent: 10000, questions: 10000, evidenceNotes: 20000 };
// `plan`：选题流程里 AI 给的角度、结构和用户的选择（2026-09-24，见 content-plan-ai.mjs）。
const editable = new Set([...Object.keys(limits), "alternatives", "agendaId", "discovery", "plan", "expectedVersion"]);
const invalid = (message) => Object.assign(new Error(message), { status: 400 });
function text(value, label, max) {
  if (typeof value !== "string" || value.length > max) throw invalid(`${label}必须是长度不超过 ${max} 的文字`);
  return value;
}
function jsonObject(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("探索状态必须是对象或 null");
  let count = 0;
  function inspect(node, depth) {
    if (++count > 10000 || depth > 10) throw invalid("探索状态层级或条目过多");
    if (node === null || typeof node === "string" || typeof node === "boolean") return;
    if (typeof node === "number" && Number.isFinite(node)) return;
    if (typeof node !== "object") throw invalid("探索状态必须是有效 JSON");
    if (!Array.isArray(node) && Object.getPrototypeOf(node) !== Object.prototype && Object.getPrototypeOf(node) !== null) throw invalid("探索状态必须是普通对象");
    for (const [key, child] of Object.entries(node)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw invalid("探索状态包含无效字段");
      inspect(child, depth + 1);
    }
  }
  inspect(value, 0);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 100000) throw invalid("探索状态不能超过 100KB");
  return JSON.parse(serialized);
}
export function getProjectNotebook(workspace, projectId) {
  workspace.domain.entity(projectId, "project");
  const row = workspace.db.prepare("SELECT * FROM project_notebooks WHERE project_id = ?").get(projectId);
  const legacy = row ? null : workspace.db.prepare(`SELECT o.core_claim, o.knowledge_explanation, o.agenda_id, p.statement,
    a.audience, a.desired_judgment FROM content_project_opportunities link
    JOIN content_opportunities o ON o.id=link.opportunity_id
    JOIN entities e ON e.id=o.id AND e.deleted_at IS NULL
    LEFT JOIN audience_problems p ON p.id=o.audience_problem_id
    LEFT JOIN content_agendas a ON a.id=o.agenda_id
    WHERE link.project_id=? AND link.role='primary'`).get(projectId);
  return {
    projectId, thought: "", audience: "", intent: "", questions: "", evidenceNotes: "", alternatives: [], discovery: null, plan: null,
    ...(legacy ? { thought: legacy.core_claim || "", questions: legacy.statement || "", evidenceNotes: legacy.knowledge_explanation || "", audience: legacy.audience || "", intent: legacy.desired_judgment || "" } : {}),
    ...(row ? JSON.parse(row.notes_json) : {}),
    agendaId: row ? row.agenda_id : legacy?.agenda_id ?? null, version: row?.version ?? 0, updatedAt: row?.updated_at ?? null,
  };
}
export function saveProjectNotebook(workspace, projectId, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("构思数据必须是对象");
  if (Object.keys(input).some((key) => !editable.has(key))) throw invalid("构思数据包含未知字段");
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw invalid("expectedVersion 必须是非负整数");
  const patch = {};
  for (const [key, max] of Object.entries(limits)) if (Object.hasOwn(input, key)) patch[key] = text(input[key], key, max);
  if (Object.hasOwn(input, "alternatives")) {
    if (!Array.isArray(input.alternatives) || input.alternatives.length > 20) throw invalid("讲法候选最多 20 项");
    patch.alternatives = input.alternatives.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((key) => !["id", "label", "body"].includes(key))) throw invalid("讲法候选格式无效");
      const id = text(item.id, "候选 ID", 120);
      if (!id.trim()) throw invalid("候选 ID 不能为空");
      return { id, label: text(item.label, "候选标题", 500), body: text(item.body, "候选内容", 20000) };
    });
    if (new Set(patch.alternatives.map((item) => item.id)).size !== patch.alternatives.length) throw invalid("候选 ID 不能重复");
  }
  if (Object.hasOwn(input, "discovery")) patch.discovery = jsonObject(input.discovery);
  if (Object.hasOwn(input, "plan")) patch.plan = jsonObject(input.plan);
  if (Object.hasOwn(input, "agendaId")) {
    patch.agendaId = input.agendaId === null ? null : text(input.agendaId, "创作方向 ID", 120);
    if (patch.agendaId === "") patch.agendaId = null;
  }
  return workspace.repository.transaction(() => {
    const current = getProjectNotebook(workspace, projectId);
    if (current.version !== input.expectedVersion) throw Object.assign(new Error("构思已在另一处更新，请重新载入后再保存"), { status: 409 });
    // An archived direction can stay attached, but cannot be chosen anew.
    if (patch.agendaId && patch.agendaId !== current.agendaId) {
      const agenda = workspace.db.prepare("SELECT a.id FROM content_agendas a JOIN entities e ON e.id=a.id WHERE a.id=? AND a.status='active' AND e.deleted_at IS NULL").get(patch.agendaId);
      if (!agenda) throw invalid("创作方向不存在或已归档");
    }
    const next = { ...current, ...patch };
    const notes = Object.fromEntries([...Object.keys(limits), "alternatives", "discovery", "plan"].map((key) => [key, next[key]]));
    const serialized = JSON.stringify(notes);
    if (Buffer.byteLength(serialized, "utf8") > 250000) throw invalid("构思数据不能超过 250KB");
    workspace.db.prepare(`INSERT INTO project_notebooks(project_id,version,notes_json,agenda_id,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET version=excluded.version,notes_json=excluded.notes_json,agenda_id=excluded.agenda_id,updated_at=excluded.updated_at`)
      .run(projectId, current.version + 1, serialized, next.agendaId, new Date().toISOString());
    return getProjectNotebook(workspace, projectId);
  });
}

export function createProjectExploration(workspace, input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["requestKey", "title", "thought", "discovery"].includes(key))) throw invalid("探索创建数据格式无效");
  const requestKey = text(input.requestKey, "请求 ID", 120);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)) throw invalid("请求 ID 必须是 UUID");
  const title = input.title === undefined ? "未命名" : text(input.title, "标题", 200).trim() || "未命名";
  return workspace.repository.transaction(() => {
    const existing = workspace.db.prepare("SELECT project_id FROM project_notebooks WHERE request_key=?").get(requestKey);
    if (existing) return { projectId: existing.project_id, notebook: getProjectNotebook(workspace, existing.project_id) };
    const stamp = new Date();
    const projectId = workspace.domain.createProject({ title, primaryPlatform: "公众号", confirmed: true, actor: "user", now: stamp });
    const draftId = workspace.domain.createDraft({ projectId, title, bodyMarkdown: "", platform: "公众号", actor: "user", now: stamp });
    workspace.domain.setPrimaryDraft(projectId, draftId, { actor: "user", now: stamp });
    const notebook = saveProjectNotebook(workspace, projectId, {
      expectedVersion: 0,
      ...(Object.hasOwn(input, "thought") ? { thought: input.thought } : {}),
      ...(Object.hasOwn(input, "discovery") ? { discovery: input.discovery } : {}),
    });
    workspace.db.prepare("UPDATE project_notebooks SET request_key=? WHERE project_id=?").run(requestKey, projectId);
    return { projectId, notebook };
  });
}
