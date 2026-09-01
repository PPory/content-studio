import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPiTools } from "../server/agent-runtime/pi-tools.mjs";
import { agentAccess, agentMountsFromUserMessage, resolveAgentMountPath } from "../server/agent-runtime/agent-access.mjs";
import { permissionModeCatalog, PERMISSION_MODES, resolveProjectPath } from "../server/agent-runtime/permission-modes.mjs";
import { PI_RUNTIME_VERSION, piImageContent, piRuntimeInfo, probePiRuntime } from "../server/agent-runtime/pi-runtime.mjs";
import { EXPERT_READONLY_TOOLS, MAX_EXPERT_SUBAGENTS, runExpertSubagents } from "../server/agent-runtime/expert-subagents.mjs";
import { validateExpertReport } from "../server/agent-runtime/expert-contracts.mjs";
import {
  assistantConversations,
  assistantExperts,
  assistantReferencePrompt,
  assistantSkills,
  applyKnowledgeUpdate,
  configureAssistantWorkspace,
  createAssistantConversation,
  expertTargetDocument,
  manageAssistantConversation,
  requestedExpertKinds,
  resolveAssistantReferences,
  runAssistantTurn,
} from "../server/agent-runtime/assistant-runner.mjs";
import { XENHO_QUALITY_NINE } from "../server/lib/quality-nine.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { documentVersion } from "../src/lib/document-version.js";

const info = await piRuntimeInfo({});
assert.equal(info.available, true, info.reason);
assert.equal(info.version, PI_RUNTIME_VERSION);
assert.deepEqual(info.versions, {
  "@earendil-works/pi-coding-agent": "0.84.3",
  "@earendil-works/pi-ai": "0.84.3",
});
assert.equal(info.configured, false, "空配置不该被误判为可执行");
assert.deepEqual(piImageContent(Buffer.from([1, 2, 3]), "image/png"), { type: "image", data: "AQID", mimeType: "image/png" });
assert.equal(XENHO_QUALITY_NINE.length, 9, "Xenho 品控问题必须保持九项唯一真源");
assert.equal(new Set(XENHO_QUALITY_NINE.map((item) => item.id)).size, 9, "品控九问 id 重复");

const modes = permissionModeCatalog();
assert.deepEqual(modes.map((item) => item.id), ["daily", "creative", "developer"]);
assert(!PERMISSION_MODES.daily.tools.includes("document_create"));
assert(!PERMISSION_MODES.creative.tools.includes("document_create"));
assert(!PERMISSION_MODES.developer.tools.includes("document_create"));
assert(!PERMISSION_MODES.creative.tools.includes("powershell"));
assert(PERMISSION_MODES.developer.tools.includes("powershell"));
assert(PERMISSION_MODES.daily.tools.includes("workbench_projects"));
assert(PERMISSION_MODES.daily.tools.includes("delegate_experts"), "日常模式必须允许只读专家委派");
// 收资料进知识库只产候选，抓取和写库都在用户确认之后，所以归日常档。
assert(PERMISSION_MODES.daily.tools.includes("propose_knowledge_source"), "日常模式必须允许提出收资料候选");
assert(PERMISSION_MODES.daily.tools.includes("propose_wiki_page"), "日常模式必须允许提出完整 Wiki 页面候选");
assert(!PERMISSION_MODES.daily.tools.includes("propose_knowledge_update"), "新会话不能再绕过 Wiki 写原子词条");
{
  const names = createPiTools({ env: {}, mode: "daily", context: {}, actionsFile: "" }).map((item) => item.name ?? item.spec?.name);
  assert(names.includes("propose_knowledge_source"), "日常模式的工具集里必须真的带上 propose_knowledge_source");
  assert(names.includes("propose_wiki_page"), "日常模式的工具集里必须真的带上 propose_wiki_page");
  assert(!names.includes("propose_knowledge_update"), "日常模式不能暴露旧原子词条工具");
  /**
   * ⚠️ **每个 propose_* 工具产出的动作类型，都必须在 normalizeProposedAction 里登记。**
   * 漏登记不会报错——动作被静默丢掉，而工具、模型和界面**全都在报成功**。
   * 这条断言就是为了让下一个加工具的人立刻撞上去。
   */
  const { normalizeProposedActionForTest } = await import("../server/agent-runtime/assistant-runner.mjs");
  for (const type of ["create_content", "rewrite_body", "knowledge_source_add", "wiki_page"]) {
    assert(normalizeProposedActionForTest({ type, url: "https://example.com/a", title: "t", why: "w", body: "b", platform: "公众号" }, "daily"),
      `候选动作类型 ${type} 没有在 normalizeProposedAction 里登记，会被静默丢弃`);
  }
}

const skills = await assistantSkills();
assert.deepEqual(skills.items.map((item) => item.id).sort(), ["fact-check", "idea-dialogue", "interview-to-draft", "material-extraction", "material-gap", "publish-review", "topic-clustering", "xenho-quality-nine"]);
assert(skills.items.every((item) => item.source === ".agents/skills"));
assert.equal(assistantExperts().items.length, 6);
assert.notEqual(documentVersion({ title: "A", body: "第一版" }), documentVersion({ title: "A", body: "第二版" }));

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-pi-runtime-"));
const xenhoHome = path.join(tempRoot, "Xenho");
const outside = path.join(tempRoot, "authorized-folder");
const actionsFile = path.join(tempRoot, "actions.jsonl");
let workspace = await openWorkspace({ xenhoHome });

try {
  configureAssistantWorkspace(workspace);
  assert(path.resolve(workspace.paths.root).startsWith(path.resolve(tempRoot)), "测试工作区必须位于系统临时目录");
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, "source.txt"), "isolated source", "utf8");

  const projectId = workspace.domain.createProject({ title: "隔离 Pi 项目", confirmed: true, actor: "user", now: new Date() });
  const draftId = workspace.domain.createDraft({ projectId, title: "隔离 Pi 项目", bodyMarkdown: "本地正文", platform: "公众号", actor: "user", now: new Date() });
  workspace.domain.setPrimaryDraft(projectId, draftId, { actor: "user", now: new Date() });

  /**
   * 输入框 `+` 菜单选中的文章 / 专家 / Skill 走结构化 `references` 字段，
   * 服务端必须**真读出正文**再进 prompt——上一版专家靠正则从消息里抠 `@名字`，
   * Skill 那半截 `/skill-id` 根本没人读，用户选了等于什么都没发生。
   */
  const references = await resolveAssistantReferences(workspace, [
    { kind: "article", id: projectId, title: "用户看到的标题" },
    { kind: "expert", id: "writing-coach", title: "写作教练" },
    { kind: "skill", id: "material-gap", title: "material-gap" },
    { kind: "article", id: "01NOTAREALPROJECTID0000000", title: "已经删掉的文章" },
    { kind: "skill", id: "../../../etc/passwd", title: "越界" },
  ]);
  const byKind = (kind) => references.filter((item) => item.kind === kind);
  assert.equal(byKind("article")[0].body, "本地正文", "引用的文章必须带上 SQLite 里的真实正文");
  assert.equal(byKind("article")[0].delegationBody, "本地正文", "专家委派必须拿到未截断的真实正文");
  assert.equal(byKind("article")[0].title, "隔离 Pi 项目", "标题以库里的为准，不采信前端传来的那份");
  assert(byKind("expert")[0].body.includes("写作教练"), "引用的专家必须带上完整指令");
  assert(byKind("skill").find((item) => item.id === "material-gap")?.body.includes("material-gap"), "引用的 Skill 必须真读到 SKILL.md");
  assert.equal(byKind("article")[1].missing, true, "找不到的引用必须标成失效，不能静默丢掉");
  assert.equal(byKind("skill").find((item) => item.id === "../../../etc/passwd")?.missing, true, "Skill id 必须挡住路径穿越");
  const referenceText = assistantReferencePrompt({ references });
  assert.match(referenceText, /【本轮引用的文章：隔离 Pi 项目/);
  assert.match(referenceText, /本地正文/);
  assert.match(referenceText, /【本轮调用专家：写作教练】/);
  assert.match(referenceText, /【本轮指定 Skill：material-gap】/);
  assert.match(referenceText, /【引用已失效】/);
  assert.equal(assistantReferencePrompt({ references: [] }), "", "没有引用时不往 prompt 里塞空段");
  const delegatedReferenceText = assistantReferencePrompt({ references: [...references, { kind: "expert", id: "fact-checker", title: "事实核查", body: "事实核查指令" }], delegateExperts: async () => ({}) });
  assert.match(delegatedReferenceText, /【本轮指定专家子 Agent】/);
  assert.match(delegatedReferenceText, /"fact-check"/);
  assert.match(delegatedReferenceText, /【本轮调用专家：写作教练】/, "非审查型专家仍应保留在主会话");
  assert.deepEqual(requestedExpertKinds("请三位分别检查", [{ kind: "expert", id: "fact-checker" }, { kind: "expert", id: "quality-reviewer" }]), ["fact-check", "quality-review"]);
  assert.deepEqual(requestedExpertKinds("请素材顾问、审稿顾问和事实核查分别独立检查全文"), ["material-research", "quality-review", "fact-check"]);
  assert.deepEqual(requestedExpertKinds("事实核查是什么意思"), [], "普通询问专家名称不能误启动子 Agent");
  assert.equal(expertTargetDocument({ project: {}, references }).body, "本地正文", "全局助手必须把唯一文章引用作为专家检查目标");
  assert.throws(() => expertTargetDocument({ project: {}, references: [byKind("article")[0], { ...byKind("article")[0], id: "other" }] }, { required: true }), /只能检查一篇明确文章/);

  await assert.rejects(() => resolveProjectPath("../outside.txt", { write: true }), /路径越界/);
  await assert.rejects(() => resolveProjectPath("node_modules/blocked.txt", { write: true }), /依赖目录/);

  const [external] = await agentMountsFromUserMessage(`请读取项目目录 "${outside}"`);
  assert(external && external.kind === "folder", "明确授权目录没有生成对话级挂载");
  assert.deepEqual(await agentMountsFromUserMessage(`错误日志：${outside}`), [], "没有访问意图的路径不该自动授权");
  assert.deepEqual(await agentMountsFromUserMessage("请读取 \\\\server\\share"), [], "UNC 路径不该自动授权");

  const dailyEnv = { AGENT_SESSION_MOUNTS: [external], AGENT_PERMISSION_MODE: "daily" };
  const dailyAccess = await agentAccess(dailyEnv);
  assert(dailyAccess.public.every((item) => !item.write && !item.execute), "日常模式必须保持只读");
  const developerEnv = { AGENT_SESSION_MOUNTS: [external], AGENT_PERMISSION_MODE: "developer" };
  const developerAccess = await agentAccess(developerEnv);
  assert(developerAccess.public.some((item) => item.id === external.id && item.write && item.execute));
  assert.equal((await resolveAgentMountPath(developerEnv, external.id, "source.txt")).absolute, path.join(outside, "source.txt"));
  await assert.rejects(() => resolveAgentMountPath(developerEnv, external.id, "../outside"), /越过/);
  await assert.rejects(() => resolveAgentMountPath(developerEnv, external.id, "source.txt:stream"), /数据流/);

  const imageAttachmentPath = path.join(tempRoot, "attachment.png");
  await fs.writeFile(imageAttachmentPath, Buffer.from([1, 2, 3]));
  const context = {
    workspace,
    project: { id: projectId, title: "隔离 Pi 项目" },
    attachments: [
      { id: "image-1", name: "attachment.png", kind: "image", type: "image/png", originalPath: imageAttachmentPath, imageRef: { mediaType: "image/png" } },
      { id: "text-1", name: "note.txt", kind: "text", type: "text/plain", extractedText: "已导入 SQLite 的附件文本" },
    ],
    localSources: [],
    projectMaterials: [],
  };
  const daily = createPiTools({ env: dailyEnv, mode: "daily", context, actionsFile });
  const creative = createPiTools({ env: dailyEnv, mode: "creative", context, actionsFile });
  const developer = createPiTools({ env: developerEnv, mode: "developer", context, actionsFile });
  const allNames = new Set(developer.map((item) => item.name));
  for (const name of ["workbench_projects", "knowledge_search", "propose_wiki_page", "workspace_list", "workspace_search", "workspace_read", "workspace_write", "workspace_edit", "workspace_powershell", "hotspot_search", "attachment_read", "web_search", "web_fetch"]) {
    assert(allNames.has(name), `缺少 Pi defineTool：${name}`);
  }
  for (const name of ["vault_list", "vault_read", "annotation_list", "document_create", "document_update", "annotation_append", "reference_insert"]) {
    assert(!allNames.has(name), `本地优先运行时不应暴露旧 vault 工具：${name}`);
  }
  const execute = (items, name, params) => items.find((item) => item.name === name).execute("test-call", params, undefined, undefined, {});
  assert(!daily.some((item) => item.name === "delegate_experts"), "没有服务端委派器时不能暴露空壳工具");
  let delegatedInput;
  const delegatedTools = createPiTools({
    env: dailyEnv,
    mode: "daily",
    context: {
      ...context,
      delegateExperts: async (input) => {
        delegatedInput = input;
        return { batchId: "test-batch", completed: input.kinds.length, results: [] };
      },
    },
    actionsFile,
  });
  const delegatedResult = JSON.parse((await execute(delegatedTools, "delegate_experts", { kinds: ["fact-check", "quality-review"], instruction: "重点核对开头" })).content[0].text);
  assert.equal(delegatedResult.completed, 2);
  assert.deepEqual(delegatedInput.kinds, ["fact-check", "quality-review"]);
  assert.equal(delegatedInput.instruction, "重点核对开头");
  const imageAttachment = await execute(daily, "attachment_read", { id: "image-1" });
  assert.deepEqual(imageAttachment.content, [
    { type: "text", text: "图片附件：attachment.png" },
    { type: "image", data: "AQID", mimeType: "image/png" },
  ]);
  const textAttachment = JSON.parse((await execute(daily, "attachment_read", { id: "text-1" })).content[0].text);
  assert.equal(textAttachment.text, "已导入 SQLite 的附件文本");
  const overview = JSON.parse((await execute(daily, "workbench_projects", {})).content[0].text);
  assert.equal(overview.total, 1);
  assert.equal(overview.projects[0].id, projectId);
  const localRead = await execute(daily, "workspace_read", { mountId: external.id, path: "source.txt" });
  assert.match(localRead.content[0].text, /isolated source/);
  await assert.rejects(() => execute(daily, "workspace_write", { mountId: external.id, path: "new.txt", content: "x" }), /日常模式不允许/);
  await execute(developer, "workspace_write", { mountId: external.id, path: "new.txt", content: "candidate" });
  await execute(developer, "workspace_edit", { mountId: external.id, path: "source.txt", oldText: "isolated", newText: "candidate" });
  await assert.rejects(() => fs.access(path.join(outside, "new.txt")), { code: "ENOENT" });
  await assert.rejects(() => execute(creative, "powershell", { command: "Get-Location" }), /创作模式不允许/);
  await assert.rejects(() => execute(developer, "powershell", { command: "Remove-Item -Recurse ." }), /破坏性删除/);
  /**
   * 「整理全文」走结构化候选，不把正文倒进对话。
   *
   * ⚠️ **日常模式就要有**：它只产候选，正文的写入仍然要用户在编辑器里逐处审阅后采纳。
   * 把它锁进创作/开发模式的话，最常见的那句「帮我整理一下全文」在默认档下无路可走，
   * 模型只会退回去把四千字写进回复里——那正是这条要修的东西。
   */
  assert(PERMISSION_MODES.daily.tools.includes("propose_body_rewrite"), "日常模式必须能提交全文整理候选");
  await assert.rejects(() => execute(daily, "propose_body_rewrite", { reason: "清理乱码", body: "   " }), /完整正文/);
  await execute(daily, "propose_body_rewrite", { reason: "删掉测试残留", body: "# 标题\n\n整理后的正文。" });

  const groundedQuote = "稳定的个人知识应该保留逐字证据，并由用户确认后再写入。";
  const knowledgeSourceId = workspace.domain.createCapture({
    kind: "article", title: "知识沉淀来源", bodyMarkdown: groundedQuote, actor: "user", now: new Date("2025-01-02T03:04:05.000Z"),
  });
  await execute(daily, "propose_wiki_page", {
    title: "知识沉淀原则", pageType: "stance", summary: "解释个人知识为什么要以完整页面持续演化。",
    bodyMarkdown: "# 知识沉淀原则\n\n个人知识不应被拆成孤立事实，而要形成带来源、连接和版本的完整页面，并在后续探索中继续修订。\n\n## 当前判断\n\n用户确认是正式写入前的最后一步。",
    basedOnPageIds: ["wiki-base-page"], why: "这是可长期复用的知识库边界。",
  });
  // 旧动作的执行器继续保留，只用于已经存在的历史动作；新会话已无法再生成它。
  const appliedKnowledge = applyKnowledgeUpdate(workspace, {
    id: "test-knowledge-action", change: "new_entry", entry: "知识沉淀原则", kind: "stance",
    text: "个人知识应保留证据并经确认后写入。", sourceId: knowledgeSourceId,
    sourceTitle: "知识沉淀来源", quote: groundedQuote, why: "这是可长期复用的知识库边界。",
  }, new Date("2025-01-03T00:00:00.000Z"));
  assert(workspace.domain.entryRow(appliedKnowledge.entryId).definition_quote === groundedQuote, "对话沉淀的新词条必须保存逐字证据");
  const appliedFact = applyKnowledgeUpdate(workspace, {
    id: "test-knowledge-fact", change: "fact", entry: "知识沉淀原则", text: "用户确认是正式写入前的最后一步。",
    sourceId: knowledgeSourceId, sourceTitle: "知识沉淀来源", quote: groundedQuote, why: "补充一个可检索事实。",
  }, new Date("2025-01-03T00:01:00.000Z"));
  assert.equal(workspace.db.prepare("SELECT source_quote FROM entry_facts WHERE id=?").get(appliedFact.factId).source_quote, groundedQuote);
  assert.throws(() => applyKnowledgeUpdate(workspace, {
    change: "fact", entry: "知识沉淀原则", text: "这条不应写入。", sourceId: knowledgeSourceId,
    quote: "这是一段来源里根本没有的伪造引用文字。", why: "测试硬闸。",
  }), /逐字原文无法在本地来源中找到/);

  const childCalls = [];
  const fakeExpertRun = async (input) => {
    childCalls.push(input);
    assert.equal(input.mode, "daily", "专家子 Agent 必须固定为日常只读模式");
    assert.deepEqual(input.allowedTools, EXPERT_READONLY_TOOLS, "专家子 Agent 只能拿到精确的只读工具集");
    assert(!input.allowedTools.includes("propose_body_rewrite") && !input.allowedTools.includes("delegate_experts"));
    assert.equal(typeof input.context.delegateExperts, "undefined", "专家子 Agent 不能继续委派");
    const reports = {
      "material-research": { kind: "material-research", summary: "素材报告", claims: [], nextSteps: [] },
      "quality-review": { kind: "quality-review", summary: "品控报告", strengths: [], questions: XENHO_QUALITY_NINE.map((item) => ({ id: item.id, status: "pass", location: "全文", finding: "通过", direction: "保持" })), mustFix: [] },
      "fact-check": { kind: "fact-check", summary: "事实报告", claims: [] },
    };
    await fs.writeFile(input.reportFile, JSON.stringify(reports[input.kind]), "utf8");
    const session = { abort: async () => {}, dispose: () => {} };
    input.onSession?.(session, { sessionId: `child-${input.kind}`, sessionFile: path.join(input.runDir, "session.jsonl") });
    return { piSessionId: `child-${input.kind}`, piSessionFile: path.join(input.runDir, "session.jsonl") };
  };
  const expertBatch = await runExpertSubagents({
    env: dailyEnv,
    workspace,
    context: { ...context, project: { id: projectId, title: "隔离 Pi 项目", body: "这是一段需要联合检查的正文。", platform: "公众号", audience: "测试读者" } },
    parentDir: tempRoot,
    scopeId: `draft:${draftId}`,
    conversationId: "chat-subagent-test",
    model: "test-model",
    kinds: ["material-research", "quality-review", "fact-check"],
    instruction: "分别独立判断，不要互相覆盖",
    executeRun: fakeExpertRun,
  });
  assert.equal(expertBatch.mode, "parallel");
  assert.equal(expertBatch.completed, 3);
  assert.equal(expertBatch.failed, 0);
  assert.equal(childCalls.length, 3);
  assert(childCalls.find((item) => item.kind === "material-research")?.prompt.includes("material-gap/SKILL.md"));
  assert(childCalls.find((item) => item.kind === "quality-review")?.prompt.includes("xenho-quality-nine/SKILL.md"));
  assert(childCalls.find((item) => item.kind === "fact-check")?.prompt.includes("fact-check/SKILL.md"));
  const delegatedRuns = workspace.db.prepare("SELECT value_json FROM workspace_settings WHERE key LIKE 'expert-delegation:%'").all().map((row) => JSON.parse(row.value_json)).filter((item) => item.delegated);
  assert.equal(delegatedRuns.length, 3, "每个专家子 Agent 都必须留下 SQLite 运行记录");
  assert(delegatedRuns.every((item) => item.status === "done" && item.parentConversationId === "chat-subagent-test"));

  let concurrentChildren = 0;
  let peakChildren = 0;
  const concurrentRun = async (input) => {
    concurrentChildren += 1;
    peakChildren = Math.max(peakChildren, concurrentChildren);
    await new Promise((resolve) => setTimeout(resolve, 15));
    concurrentChildren -= 1;
    const report = input.kind === "quality-review"
      ? { kind: input.kind, summary: "并发品控", strengths: [], questions: XENHO_QUALITY_NINE.map((item) => ({ id: item.id, status: "pass", location: "全文", finding: "通过", direction: "保持" })), mustFix: [] }
      : { kind: input.kind, summary: "并发检查", claims: [], ...(input.kind === "material-research" ? { nextSteps: [] } : {}) };
    await fs.writeFile(input.reportFile, JSON.stringify(report), "utf8");
    return { piSessionId: `concurrent-${input.kind}`, piSessionFile: "" };
  };
  await Promise.all([
    runExpertSubagents({ env: dailyEnv, workspace, context: { ...context, project: { body: "并发正文 A" } }, parentDir: tempRoot, scopeId: "parallel:a", conversationId: "parallel-a", model: "test", kinds: ["material-research", "quality-review", "fact-check"], executeRun: concurrentRun }),
    runExpertSubagents({ env: dailyEnv, workspace, context: { ...context, project: { body: "并发正文 B" } }, parentDir: tempRoot, scopeId: "parallel:b", conversationId: "parallel-b", model: "test", kinds: ["material-research", "quality-review", "fact-check"], executeRun: concurrentRun }),
  ]);
  assert.equal(peakChildren, MAX_EXPERT_SUBAGENTS, "跨对话同时运行的专家数也不能超过全局上限");

  const longPrefix = "长正文".repeat(30_000);
  const longA = await runExpertSubagents({ env: dailyEnv, workspace, context: { ...context, project: { body: `${longPrefix}尾部-A` } }, parentDir: tempRoot, scopeId: "long:a", conversationId: "long-a", model: "test", kinds: ["fact-check"], executeRun: fakeExpertRun });
  const longB = await runExpertSubagents({ env: dailyEnv, workspace, context: { ...context, project: { body: `${longPrefix}尾部-B` } }, parentDir: tempRoot, scopeId: "long:b", conversationId: "long-b", model: "test", kinds: ["fact-check"], executeRun: fakeExpertRun });
  assert.notEqual(longA.documentVersion, longB.documentVersion, "长正文尾部变化必须进入专家报告版本");
  assert(childCalls.at(-1).context.document.body.endsWith("尾部-B"), "专家必须收到完整长正文");
  const abortController = new AbortController();
  let childStarted = 0;
  let childDisposed = 0;
  const cancelledBatch = runExpertSubagents({
    env: dailyEnv,
    workspace,
    context: { ...context, project: { id: projectId, title: "取消测试", body: "等待取消的正文。" } },
    parentDir: tempRoot,
    scopeId: `draft:${draftId}`,
    conversationId: "chat-subagent-cancel",
    model: "test-model",
    kinds: ["material-research", "quality-review", "fact-check"],
    signal: abortController.signal,
    executeRun: (input) => new Promise((_resolve, reject) => {
      childStarted += 1;
      input.onSession?.({ abort: async () => reject(new Error("子任务已停止")), dispose: () => { childDisposed += 1; } }, { sessionId: `child-cancel-${input.kind}`, sessionFile: path.join(input.runDir, "session.jsonl") });
    }),
  });
  while (childStarted < 3) await new Promise((resolve) => setImmediate(resolve));
  abortController.abort(new Error("用户取消"));
  await assert.rejects(() => cancelledBatch, /用户取消/);
  assert.equal(childDisposed, 3, "批量取消必须等待所有专家会话完成清理");
  const cancelledRuns = workspace.db.prepare("SELECT value_json FROM workspace_settings WHERE key LIKE 'expert-delegation:%'").all()
    .map((row) => JSON.parse(row.value_json))
    .filter((item) => item.parentConversationId === "chat-subagent-cancel");
  assert.equal(cancelledRuns.length, 3);
  assert(cancelledRuns.every((item) => item.status === "cancelled"), "取消后不能留下永远运行中的专家记录");

  workspace.repository.setSetting("expert-delegation:stale-test", { id: "stale-test", kind: "fact-check", status: "running", stage: "expert-run" });
  await runExpertSubagents({ env: dailyEnv, workspace, context: { ...context, project: { body: "触发恢复检查" } }, parentDir: tempRoot, scopeId: "recover", conversationId: "recover", model: "test", kinds: ["fact-check"], executeRun: fakeExpertRun });
  assert.equal(workspace.repository.getSetting("expert-delegation:stale-test").status, "failed", "应用重启留下的运行中记录必须自动收口");

  assert.throws(() => validateExpertReport("fact-check", { kind: "fact-check", summary: "不完整", claims: [{ quote: "x", status: "maybe" }] }), /字段不完整/);
  await assert.rejects(() => runExpertSubagents({
    env: dailyEnv,
    workspace,
    context: { ...context, project: { body: "正文" } },
    parentDir: tempRoot,
    scopeId: "test",
    conversationId: "test",
    model: "test-model",
    kinds: ["style-calibration"],
    executeRun: fakeExpertRun,
  }), /请选择 1 到 3 位可用的只读专家/);

  const queued = (await fs.readFile(actionsFile, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(queued.length, 4);
  assert(queued.slice(0, 2).every((item) => ["workspace_write", "workspace_edit"].includes(item.type)));
  assert.deepEqual(
    { type: queued[2].type, reason: queued[2].reason, body: queued[2].body },
    { type: "rewrite_body", reason: "删掉测试残留", body: "# 标题\n\n整理后的正文。" },
  );
  assert.deepEqual(
    { type: queued[3].type, title: queued[3].title, pageType: queued[3].pageType, basedOnPageIds: queued[3].basedOnPageIds },
    { type: "wiki_page", title: "知识沉淀原则", pageType: "stance", basedOnPageIds: ["wiki-base-page"] },
  );

  const orchestrationEvents = [];
  let orchestrationInput;
  const globalExpertTurn = await runAssistantTurn(dailyEnv, {
    scopeId: "global:assistant-test",
    message: "请素材顾问、审稿顾问和事实核查分别独立检查全文，最后汇总",
    references: [{ kind: "article", id: projectId, title: "隔离 Pi 项目" }],
    document: {},
    materials: [],
    model: "test-model",
    permissionMode: "daily",
    mode: "general",
  }, {
    onEvent: (event) => orchestrationEvents.push(event),
    runExperts: async (input) => {
      orchestrationInput = input;
      const results = input.kinds.map((kind, index) => {
        const task = { "material-research": "素材顾问", "quality-review": "审稿顾问", "fact-check": "事实核查" }[kind];
        input.onEvent?.({ type: "expert", id: `run-${kind}`, batchId: "batch-global-test", kind, expertName: task, status: "running", stageLabel: "正在独立检查", percent: 40 });
        input.onEvent?.({ type: "expert", id: `run-${kind}`, batchId: "batch-global-test", kind, expertName: task, status: "done", stageLabel: "检查完成", percent: 100 });
        return { id: `run-${kind}`, kind, expertName: task, status: "done", report: { kind, summary: `报告 ${index + 1}` } };
      });
      return { batchId: "batch-global-test", requested: results.length, completed: results.length, failed: 0, results };
    },
    createRun: async (input) => {
      assert.match(input.prompt, /服务端真实专家协作记录/);
      assert.match(input.prompt, /batch-global-test/);
      assert.match(input.prompt, /run-fact-check/);
      assert.equal(typeof input.context.delegateExperts, "undefined", "确定性委派完成后不能让主助手重复调用");
      input.onSession?.({ abort: async () => {}, dispose: () => {} }, { sessionId: "parent-global-test", sessionFile: "" });
      return { result: { finalResponse: "已根据三份真实专家报告完成汇总。" }, piSessionId: "parent-global-test", piSessionFile: "", permissionMode: "daily" };
    },
  });
  assert.deepEqual(orchestrationInput.kinds, ["material-research", "quality-review", "fact-check"]);
  assert.equal(orchestrationInput.context.project.body, "本地正文", "全局页面必须把引用文章全文交给子 Agent");
  assert.equal(globalExpertTurn.message.expertActivity.length, 3, "完成回复必须保留三位专家的真实状态");
  assert.equal(globalExpertTurn.conversation.lastTurn.expertBatchId, "batch-global-test");
  assert(orchestrationEvents.filter((event) => event.type === "expert" && event.status === "done").length === 3);

  const scope = `draft:${draftId}`;
  const first = await createAssistantConversation(scope);
  const second = await createAssistantConversation(scope);
  await manageAssistantConversation(scope, first.id, { action: "rename", title: "手动标题 A" });
  await manageAssistantConversation(scope, second.id, { action: "rename", title: "手动标题 B" });
  await manageAssistantConversation(scope, first.id, { action: "pin" });
  let index = await assistantConversations(scope);
  assert.equal(index.items[0].id, first.id, "置顶对话没有排在前面");
  await manageAssistantConversation(scope, second.id, { action: "archive" });
  assert((await assistantConversations(scope)).items.find((item) => item.id === second.id)?.archivedAt);
  await manageAssistantConversation(scope, second.id, { action: "restore" });
  assert(!(await assistantConversations(scope)).items.find((item) => item.id === second.id)?.archivedAt);
  await manageAssistantConversation(scope, first.id, { action: "delete" });
  assert(!(await assistantConversations(scope)).items.some((item) => item.id === first.id));
  const deleted = workspace.db.prepare("SELECT deleted_at FROM entities WHERE id=?").get(first.id);
  assert(deleted?.deleted_at, "删除对话必须进入 SQLite 软删除状态");
  assert(workspace.db.prepare("SELECT record_json FROM ai_conversations WHERE id=?").get(first.id)?.record_json, "软删除不能丢失恢复数据");
  assert.equal(workspace.check().ok, true);

  workspace.close();
  workspace = await openWorkspace({ xenhoHome });
  configureAssistantWorkspace(workspace);
  const reopened = await assistantConversations(scope);
  assert(reopened.items.some((item) => item.id === second.id), "重开后未保留有效对话");
  assert(!reopened.items.some((item) => item.id === first.id), "重开后软删除对话重新出现");

  const probe = await probePiRuntime();
  assert.equal(probe.ok, true);
  assert.equal(probe.version, "0.84.3");
} finally {
  if (workspace?.db?.open) workspace.close();
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log("✓ Pi Agent SDK、权限预设、本地工具与隔离工作区已校验");
console.log("✓ AI 会话使用 SQLite 软删除，并通过关闭重开验证");
console.log("✓ 测试只使用系统临时目录，没有读写真实个人工作区或历史存储");
