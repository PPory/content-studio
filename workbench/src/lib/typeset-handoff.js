// 内容项目 → 公众号排版工具的同源交接。
//
// 排版工具的正文真源是 `wechat-typeset` localStorage；工作台只在进入时
// 放进一份发布稿，不建第二份排版状态。同一版正文重新进入时继续原草稿；
// 主稿发生变化时创建新版，不覆盖用户已经做过的排版。

export const TYPESET_STATE_KEY = "wechat-typeset";
export const TYPESET_CONTEXT_KEY = "workbench:typeset-context:v1";

function fingerprint(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function typesetMarkdown(title, body) {
  const text = String(body || "").trim();
  if (/^#\s+\S/m.test(text.split("\n").slice(0, 3).join("\n"))) return text;
  const heading = String(title || "未命名内容").trim() || "未命名内容";
  return `# ${heading}${text ? `\n\n${text}` : ""}`;
}

export function mergeTypesetState(current = {}, handoff = {}, timestamp = Date.now()) {
  const markdown = typesetMarkdown(handoff.title, handoff.body);
  const revision = fingerprint(`${handoff.title}\n${markdown}`);
  const drafts = Array.isArray(current?.drafts) ? current.drafts.filter((draft) => draft && typeof draft.content === "string") : [];
  const existing = drafts.find((draft) => draft.sourceDraftId === handoff.draftId && draft.sourceRevision === revision);

  if (existing) {
    return {
      state: { ...(current || {}), drafts, currentId: existing.id },
      context: {
        projectId: handoff.projectId,
        draftId: handoff.draftId,
        title: handoff.title,
        platform: handoff.platform || "公众号",
        typesetDraftId: existing.id,
        sourceRevision: revision,
        preparedAt: timestamp,
      },
      mode: "resume",
    };
  }

  const id = `wb-${fingerprint(`${handoff.projectId}:${handoff.draftId}:${revision}`)}`;
  const draft = {
    id,
    name: String(handoff.title || "未命名内容").trim().slice(0, 48) || "未命名内容",
    content: markdown,
    updatedAt: timestamp,
    sourceProjectId: handoff.projectId,
    sourceDraftId: handoff.draftId,
    sourceRevision: revision,
  };
  return {
    state: { ...(current || {}), drafts: [draft, ...drafts.filter((item) => item.id !== id)], currentId: id },
    context: {
      projectId: handoff.projectId,
      draftId: handoff.draftId,
      title: handoff.title,
      platform: handoff.platform || "公众号",
      typesetDraftId: id,
      sourceRevision: revision,
      preparedAt: timestamp,
    },
    mode: "create",
  };
}

export function prepareTypesetHandoff(handoff, storage = window.localStorage) {
  let current = {};
  try { current = JSON.parse(storage.getItem(TYPESET_STATE_KEY) || "{}"); } catch { current = {}; }
  const result = mergeTypesetState(current, handoff);
  storage.setItem(TYPESET_STATE_KEY, JSON.stringify(result.state));
  storage.setItem(TYPESET_CONTEXT_KEY, JSON.stringify(result.context));
  return result;
}

export function readTypesetContext(storage = window.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(TYPESET_CONTEXT_KEY) || "null");
    return value?.projectId && value?.draftId ? value : null;
  } catch {
    return null;
  }
}
