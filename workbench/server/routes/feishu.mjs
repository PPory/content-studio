import fs from "node:fs/promises";
import path from "node:path";
import { json, readJsonBody } from "../lib/http.mjs";
import { callWorker } from "../lib/worker.mjs";
import { safeJoin, vaultRoot } from "../lib/vault.mjs";
import {
  canRebuildFeishuImages,
  createFeishuDocument,
  decideDocumentSync,
  documentFingerprint,
  feishuImageTokens,
  fetchFeishuDocument,
  formatFeishuDraftTitle,
  hasProtectedFeishuBlocks,
  isDifferentFeishuTarget,
  localDraftTitle,
  overwriteFeishuDocument,
  replaceMarkdownImages,
} from "../lib/feishu-sync.mjs";
import {
  createMediaSignedUrl,
  mediaAssetById,
  mediaIdFromReference,
  replaceExternalDocumentAssetMappings,
  uploadMediaAsset,
} from "../lib/supabase-media.mjs";

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
    platform: String(data.meta?.platform || ""),
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

function decodeImageSource(value) {
  try {
    return decodeURIComponent(String(value || "").trim());
  } catch {
    throw Object.assign(new Error("正文里的图片路径编码不正确"), { status: 400 });
  }
}

async function prepareMarkdownForFeishu(env, markdown) {
  return replaceMarkdownImages(markdown, async (reference) => {
    const source = decodeImageSource(reference.source);
    if (/^https:\/\//i.test(source)) return { url: source, asset: null };
    if (/^(?:data|http):/i.test(source)) {
      throw Object.assign(new Error("飞书同步只接受 HTTPS 或工作台受管图片"), { status: 400 });
    }
    const assetId = mediaIdFromReference(source);
    let asset = assetId ? await mediaAssetById(env, assetId) : null;
    if (assetId && !asset) throw Object.assign(new Error(`找不到图片资产 ${assetId}`), { status: 404 });
    if (!asset) {
      let bytes;
      try {
        bytes = await fs.readFile(safeJoin(vaultRoot(env), source));
      } catch {
        throw Object.assign(new Error(`找不到正文图片：${source}`), {
          status: 404,
          hint: "请确认 Obsidian 中的原图仍在，或删除这条失效图片引用",
        });
      }
      asset = await uploadMediaAsset(env, {
        bytes,
        originalName: path.basename(source) || reference.alt || "image",
        source: "vault-migration",
      });
    }
    return { url: await createMediaSignedUrl(env, asset), asset };
  });
}

async function inspect(env, id) {
  const [draft, binding] = await Promise.all([draftOf(env, id), bindingOf(env, id)]);
  const expectedRemoteTitle = formatFeishuDraftTitle(draft.title, draft.platform);
  if (!binding) return { draft, binding: null, remote: null, expectedRemoteTitle, titleNeedsNormalization: false, decision: { action: "create", localChanged: true, remoteChanged: false } };
  const remote = await fetchFeishuDocument(binding.externalId);
  const decision = decideDocumentSync(
    binding,
    documentFingerprint(draft.title, draft.markdown),
    documentFingerprint(remote.title, remote.markdown)
  );
  const titleNeedsNormalization = decision.action === "none"
    && remote.title === draft.title
    && remote.title !== expectedRemoteTitle;
  return { draft, binding, remote, expectedRemoteTitle, titleNeedsNormalization, decision };
}

async function pushDraft(env, res, id) {
  const state = await inspect(env, id);
  const target = targetOf(env);
  const targetChanged = isDifferentFeishuTarget(state.binding, target.id);
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
  const effectiveAction = targetChanged ? "create" : state.titleNeedsNormalization ? "push" : state.decision.action;
  if (effectiveAction === "none") {
    return json(res, { ok: true, action: "none", document: state.binding, message: "两端内容没有变化" });
  }
  const canRebuildImages = canRebuildFeishuImages(state.binding, state.draft.markdown);
  if (!targetChanged && effectiveAction === "push" && hasProtectedFeishuBlocks(state.remote.markdown, { allowImages: canRebuildImages })) {
    return json(res, {
      ok: false,
      error: "飞书文档里包含附件、画板或其他不能安全重建的内容",
      hint: "图片可以从 Supabase 重建；其他复杂内容请先在飞书手动合并，本次没有覆盖文档",
      protectedBlocks: true,
      documentUrl: state.binding.externalUrl,
    }, 409);
  }

  const prepared = await prepareMarkdownForFeishu(env, state.draft.markdown);
  let targetDocument;
  if (effectiveAction === "create") {
    targetDocument = await createFeishuDocument({
      title: state.expectedRemoteTitle,
      markdown: prepared.markdown,
      wikiNode: target.wikiNode,
      wikiSpace: target.wikiSpace,
    });
  } else {
    await overwriteFeishuDocument(state.binding.externalId, {
      title: state.expectedRemoteTitle,
      markdown: prepared.markdown,
    });
    targetDocument = { id: state.binding.externalId, url: state.binding.externalUrl };
  }

  const fetched = await fetchFeishuDocument(targetDocument.id);
  const remote = { ...fetched, url: targetDocument.url || state.binding?.externalUrl || "" };
  const binding = await saveBinding(env, state.draft, remote, target.id, "local");
  let mediaWarning = "";
  try {
    await replaceExternalDocumentAssetMappings(env, {
      entityId: state.draft.id,
      externalDocumentId: remote.id,
      images: prepared.images,
      tokens: feishuImageTokens(remote.markdown),
    });
  } catch (error) {
    mediaWarning = `正文已同步，但图片映射记录失败：${error.message}`;
  }
  return json(res, {
    ok: true,
    action: effectiveAction,
    document: binding,
    message: targetChanged ? "已在指定知识库重新创建并改绑飞书文档" : effectiveAction === "create" ? "已创建飞书文档" : "已更新飞书文档",
    ...(targetChanged ? { previousDocumentUrl: state.binding.externalUrl } : {}),
    ...(mediaWarning ? { warning: mediaWarning } : {}),
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

  const pulledTitle = localDraftTitle(state.remote.title, state.draft.platform, state.draft.title);

  await workerJson(env, "update", {
    method: "POST",
    body: { view: "drafts", pageId: id, fields: { title: pulledTitle } },
  }, "更新工作台标题失败");
  await workerJson(env, "content", {
    method: "POST",
    body: { view: "drafts", pageId: id, markdown: state.remote.markdown },
  }, "更新工作台正文失败");

  const applied = { id, title: pulledTitle, markdown: state.remote.markdown };
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
