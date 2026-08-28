import { json, readJsonBody } from "../lib/http.mjs";
import { callWorker } from "../lib/worker.mjs";
import {
  createFeishuDocument,
  decideDocumentSync,
  documentFingerprint,
  fetchFeishuDocument,
  hasProtectedFeishuBlocks,
  overwriteFeishuDocument,
} from "../lib/feishu-sync.mjs";

function workerError(result, fallback) {
  const error = new Error(result.data?.error || fallback);
  error.hint = result.data?.hint;
  error.status = result.status;
  return error;
}

async function workerJson(env, path, options, fallback) {
  const result = await callWorker(env, path, options);
  if (result.status >= 400 || !result.data?.ok) throw workerError(result, fallback);
  return result.data;
}

async function draftOf(env, id) {
  const data = await workerJson(env, `page/${encodeURIComponent(id)}`, { search: "view=drafts" }, "读取稿件失败");
  return {
    id,
    title: String(data.meta?.title || "未命名"),
    markdown: String(data.text || ""),
  };
}

async function bindingOf(env, id) {
  const data = await workerJson(
    env,
    `external-documents/draft/${encodeURIComponent(id)}`,
    { search: "provider=feishu" },
    "读取飞书映射失败"
  );
  return data.document || null;
}

async function saveBinding(env, draft, remote, target, lastSource) {
  const data = await workerJson(env, `external-documents/draft/${encodeURIComponent(draft.id)}`, {
    method: "POST",
    body: {
      provider: "feishu",
      externalId: remote.id,
      externalUrl: remote.url || "",
      containerId: target,
      contentHash: documentFingerprint(draft.title, draft.markdown),
      remoteHash: documentFingerprint(remote.title, remote.markdown),
      lastSource,
    },
  }, "保存飞书映射失败");
  return data.document;
}

function targetOf(env) {
  const wikiNode = String(env.FEISHU_WIKI_NODE || "").trim();
  const wikiSpace = String(env.FEISHU_WIKI_SPACE || "").trim() || "my_library";
  return { wikiNode, wikiSpace, id: wikiNode || wikiSpace };
}

async function inspect(env, id) {
  const [draft, binding] = await Promise.all([draftOf(env, id), bindingOf(env, id)]);
  if (!binding) return { draft, binding: null, remote: null, decision: { action: "create", localChanged: true, remoteChanged: false } };
  const remote = await fetchFeishuDocument(binding.externalId);
  const decision = decideDocumentSync(
    binding,
    documentFingerprint(draft.title, draft.markdown),
    documentFingerprint(remote.title, remote.markdown)
  );
  return { draft, binding, remote, decision };
}

async function pushDraft(env, res, id) {
  const state = await inspect(env, id);
  const target = targetOf(env);
  if (["conflict", "pull-preview"].includes(state.decision.action)) {
    return json(res, {
      ok: false,
      error: state.decision.action === "conflict" ? "工作台和飞书都修改过这篇内容" : "飞书内容比上次同步更新",
      hint: "先查看飞书版本并选择保留、覆盖或合并；本次没有写入任何一端",
      conflict: true,
      documentUrl: state.binding.externalUrl,
      ...state.decision,
    }, 409);
  }
  if (state.decision.action === "none") {
    return json(res, { ok: true, action: "none", document: state.binding, message: "两端内容没有变化" });
  }
  if (state.decision.action === "push" && hasProtectedFeishuBlocks(state.remote.markdown)) {
    return json(res, {
      ok: false,
      error: "飞书文档里包含图片、附件或其他不能安全重建的内容",
      hint: "请先在飞书保留这些内容并手动合并正文；本次没有覆盖飞书文档",
      protectedBlocks: true,
      documentUrl: state.binding.externalUrl,
    }, 409);
  }

  let targetDocument;
  if (state.decision.action === "create") {
    targetDocument = await createFeishuDocument({
      title: state.draft.title,
      markdown: state.draft.markdown,
      wikiNode: target.wikiNode,
      wikiSpace: target.wikiSpace,
    });
  } else {
    await overwriteFeishuDocument(state.binding.externalId, state.draft);
    targetDocument = { id: state.binding.externalId, url: state.binding.externalUrl };
  }

  const fetched = await fetchFeishuDocument(targetDocument.id);
  const remote = { ...fetched, url: targetDocument.url || state.binding?.externalUrl || "" };
  const binding = await saveBinding(env, state.draft, remote, target.id, "local");
  return json(res, {
    ok: true,
    action: state.decision.action,
    document: binding,
    message: state.decision.action === "create" ? "已创建飞书文档" : "已更新飞书文档",
  });
}

async function pullDraft(env, req, res, id) {
  const input = await readJsonBody(req);
  if (input?.confirm !== true) {
    return json(res, { ok: false, error: "同步回工作台前需要明确确认" }, 400);
  }
  const state = await inspect(env, id);
  if (!state.binding) return json(res, { ok: false, error: "这篇稿件还没有对应的飞书文档" }, 404);
  if (state.decision.localChanged && input?.overwriteLocal !== true) {
    return json(res, {
      ok: false,
      error: "工作台正文也有未同步修改",
      hint: "先比较两端内容；只有明确选择以飞书覆盖工作台后才能继续",
      conflict: true,
    }, 409);
  }

  await workerJson(env, "update", {
    method: "POST",
    body: { view: "drafts", pageId: id, fields: { title: state.remote.title } },
  }, "更新工作台标题失败");
  await workerJson(env, "content", {
    method: "POST",
    body: { view: "drafts", pageId: id, markdown: state.remote.markdown },
  }, "更新工作台正文失败");

  const applied = { id, title: state.remote.title, markdown: state.remote.markdown };
  const remote = { ...state.remote, url: state.binding.externalUrl };
  const binding = await saveBinding(env, applied, remote, state.binding.containerId, "remote");
  return json(res, { ok: true, action: "pull", document: binding, message: "已把飞书版本同步回工作台" });
}

export const feishuRoutes = [
  {
    method: "GET",
    path: "/api/feishu/drafts/:id/status",
    async handler({ env, res, params }) {
      const state = await inspect(env, params.id);
      json(res, { ok: true, bound: Boolean(state.binding), decision: state.decision, document: state.binding });
    },
  },
  {
    method: "POST",
    path: "/api/feishu/drafts/:id/push",
    handler: ({ env, res, params }) => pushDraft(env, res, params.id),
  },
  {
    method: "GET",
    path: "/api/feishu/drafts/:id/pull-preview",
    async handler({ env, res, params }) {
      const state = await inspect(env, params.id);
      if (!state.binding) return json(res, { ok: false, error: "这篇稿件还没有对应的飞书文档" }, 404);
      json(res, {
        ok: true,
        document: state.binding,
        decision: state.decision,
        remote: { title: state.remote.title, markdown: state.remote.markdown },
      });
    },
  },
  {
    method: "POST",
    path: "/api/feishu/drafts/:id/pull",
    handler: ({ env, req, res, params }) => pullDraft(env, req, res, params.id),
  },
];
