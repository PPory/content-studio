// 前端只跟本机 API 说话，不直接读取 SQLite，也不把模型密钥放进浏览器。
// 统一契约：失败一律抛 Error，并把服务端给的 hint 挂在 err.hint 上供界面显示。

async function req(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (e) {
    throw Object.assign(new Error("本地服务没响应"), { hint: "dev server 可能已停止，回终端看 npm run dev" });
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`响应不是 JSON（HTTP ${res.status}）`);
  }
  if (!data.ok) throw Object.assign(new Error(data.error || `请求失败（HTTP ${res.status}）`), { hint: data.hint, status: res.status });
  return data;
}

function postJson(path, body) {
  return req(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const extOf = (name) => (String(name).match(/\.[a-z0-9]+$/i) || [".jpg"])[0].toLowerCase();

export const api = {
  status: () => req("/api/workspace/status"),
  seriesList: () => req("/api/workspace/series"),
  series: (id) => req(`/api/workspace/series/${encodeURIComponent(id)}`),
  createSeries: (body) => postJson("/api/workspace/series", body),
  updateSeries: (id, body) => postJson(`/api/workspace/series/${encodeURIComponent(id)}/update`, body),
  addSeriesArticles: (id, projectIds) => postJson(`/api/workspace/series/${encodeURIComponent(id)}/articles`, { projectIds }),
  createArticleInSeries: (id, body) => postJson(`/api/workspace/series/${encodeURIComponent(id)}/articles/new`, body),
  addSeriesSection: (id, heading) => postJson(`/api/workspace/series/${encodeURIComponent(id)}/sections`, { heading }),
  reorderSeriesEntries: (id, entryIds) => postJson(`/api/workspace/series/${encodeURIComponent(id)}/entries/reorder`, { entryIds }),
  updateSeriesEntry: (id, entryId, body) => postJson(`/api/workspace/series/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/update`, body),
  removeSeriesEntry: (id, entryId) => postJson(`/api/workspace/series/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/remove`, {}),
  seriesRead: (id) => req(`/api/workspace/series/${encodeURIComponent(id)}/read`),
  exportSeries: (id) => postJson(`/api/workspace/series/${encodeURIComponent(id)}/export`, {}),
  removeSeries: (id) => postJson(`/api/workspace/series/${encodeURIComponent(id)}/trash`, {}),
  /** 一次写定这篇文章属于哪些合集。⚠️ 别在前端拆成「先删两条再加三条」，中途失败会留一半状态。 */
  setProjectSeries: (projectId, seriesIds) => postJson(`/api/workspace/projects/${encodeURIComponent(projectId)}/series`, { seriesIds }),
  projects: (stage = "") => req(`/api/workspace/projects${stage ? `?stage=${encodeURIComponent(stage)}` : ""}`),
  project: (id) => req(`/api/workspace/projects/${encodeURIComponent(id)}`),
  transitionProject: (id, action, input = {}) => postJson(`/api/workspace/projects/${encodeURIComponent(id)}/transition`, { action, ...input }),
  /**
   * 给项目挂上 / 摘掉素材。
   * ⚠️ **只有点过「用这条」的才走这儿**——AI 挑出来的候选不自动挂，
   * `topic_materials` 的语义是「这篇真的用了它」，见 worker 那侧的注释。
   */
  /**
   * 删掉一个内容项目。⚠️ **移入本地回收站，并保留所属稿件**——
   * 界面上必须点两下并且把这件事说出来。
   */
  removeProject: (id) => postJson(`/api/workspace/projects/${encodeURIComponent(id)}/trash`, {}),
  updateProjectMaterials: (id, body) => postJson(`/api/workspace/projects/${encodeURIComponent(id)}/materials`, body),
  createProjectVariant: (id, platform) => postJson(`/api/workspace/projects/${encodeURIComponent(id)}/variants`, { platform }),
  removeProjectVariant: (id, draftId) => postJson(`/api/workspace/projects/${encodeURIComponent(id)}/variants/${encodeURIComponent(draftId)}/remove`, {}),
  saveProjectDraft: (draftId, body) => postJson(`/api/workspace/drafts/${encodeURIComponent(draftId)}/save`, body),
  saveProjectRelease: (id, draftId, release) => postJson(`/api/workspace/projects/${encodeURIComponent(id)}/releases/${encodeURIComponent(draftId)}`, release),
  saveProjectReview: (id, review) => postJson(`/api/workspace/projects/${encodeURIComponent(id)}/review`, review),
  materialWorkspace: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "" && value != null));
    return req(`/api/workspace/materials${qs.toString() ? `?${qs}` : ""}`);
  },
  list: (view, params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return req(`/api/workspace/items/${view}${qs.toString() ? `?${qs}` : ""}`);
  },
  searchLibrary: (view, q, state = "") =>
    req(`/api/workspace/search/${view}?q=${encodeURIComponent(q)}${state ? `&state=${encodeURIComponent(state)}` : ""}`),
  page: (id, view = "") => req(`/api/workspace/items/${encodeURIComponent(view)}/${encodeURIComponent(id)}`),
  intake: (body) => postJson("/api/workspace/intake", body),
  entries: () => req("/api/workspace/entries"),
  entry: (id) => req(`/api/workspace/entries/${encodeURIComponent(id)}`),
  wiki: (query = "") => req(`/api/workspace/wiki${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  wikiPage: (id) => req(`/api/workspace/wiki/${encodeURIComponent(id)}`),
  trashWikiPage: (id) => postJson(`/api/workspace/wiki/${encodeURIComponent(id)}/trash`, {}),
  knowledgeSources: () => req("/api/workspace/knowledge/sources"),
  knowledgeSourceDocs: (id) => req(`/api/workspace/knowledge/sources/${encodeURIComponent(id)}`),
  importKnowledgeSource: (body) => postJson("/api/workspace/knowledge/sources/import", body),
  knowledgeLint: () => req("/api/workspace/knowledge/lint"),
  runKnowledgeLint: (mode, limit = 5) => postJson("/api/workspace/knowledge/lint/run", { mode, limit }),
  queueKnowledgeIngest: (body) => postJson("/api/workspace/knowledge/ingest", body),
  knowledgeCandidates: () => req("/api/workspace/knowledge/candidates"),
  knowledgeCandidateDecide: (id, action, include) => postJson(`/api/workspace/knowledge/candidates/${encodeURIComponent(id)}`, { action, include }),
  knowledgeCandidateRepair: (id, include) => postJson(`/api/workspace/knowledge/candidates/${encodeURIComponent(id)}/repair`, { include }),
  knowledgeCandidateResearch: (id, include) => postJson(`/api/workspace/knowledge/candidates/${encodeURIComponent(id)}/research`, { include }),
  knowledgeRecall: (text, limit = 6) => postJson("/api/workspace/knowledge/recall", { text, limit }),
  // 种子响应携带领域层的反应清单，前端不复制业务规则。
  seeds: (status = "") => req(`/api/workspace/seeds${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createSeed: (body) => postJson("/api/workspace/seeds", body),
  updateSeed: (id, patch) => postJson(`/api/workspace/seeds/${encodeURIComponent(id)}`, patch),
  removeSeed: (id) => postJson(`/api/workspace/seeds/${encodeURIComponent(id)}/trash`, {}),
  retryCollectionSnapshot: (id) => postJson(`/api/workspace/collections/${encodeURIComponent(id)}/snapshot`, {}),
  previewCollectionOrganize: (ids) => postJson("/api/workspace/collections/organize/preview", { ids }),
  applyCollectionOrganize: (items) => postJson("/api/workspace/collections/organize/apply", { items }),
  previewKnowledgeCard: (body) => postJson("/api/workspace/ai/knowledge-card", body),
  saveKnowledgeCard: (card) => postJson("/api/workspace/knowledge-cards", card),
  knowledgeCardLinks: (refs) => postJson("/api/workspace/knowledge-cards/links", { refs }),
  comment: (pageId, text) => postJson(`/api/workspace/annotations/${encodeURIComponent(pageId)}`, { text }),
  comments: (pageId) => req(`/api/workspace/annotations/${encodeURIComponent(pageId)}`),
  revisions: (scope) => req(`/api/revisions?scope=${encodeURIComponent(scope)}`),
  saveRevision: (scope, item) => postJson("/api/revisions", { scope, item }),
  moveRevisions: (from, to) => postJson("/api/revisions/move", { from, to }),

  // 每日计划只传日期和动作；服务端用版本号避免覆盖并发更新。
  plan: (date = "") => req(`/api/plan${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  addTask: (date, text) => postJson("/api/plan", { date, action: "add", text }),
  toggleTask: (date, stamp, index, done) => postJson("/api/plan", { date, stamp, action: "toggle", index, done }),
  removeTask: (date, stamp, index) => postJson("/api/plan", { date, stamp, action: "remove", index }),

  // 洞察报告清单直接读取当前 SQLite 工作区。
  workspaceInsights: () => req("/api/workspace/insights"),
  workspaceInsight: (id) => req(`/api/workspace/insights/${encodeURIComponent(id)}`),
  agendas: () => req("/api/workspace/agendas"),
  createAgenda: (body) => postJson("/api/workspace/agendas", body),
  updateAgenda: (id, body) => postJson(`/api/workspace/agendas/${encodeURIComponent(id)}/update`, body),
  audienceProblems: () => req("/api/workspace/audience-problems"),
  // 原始用户声音：只记录和读取，没有修改接口——证据一旦可改就不再证明任何事。
  audienceVoices: (query = "") => req(`/api/workspace/audience-voices${query}`),
  audienceVoice: (id) => req(`/api/workspace/audience-voices/${encodeURIComponent(id)}`),
  recordAudienceVoice: (body) => postJson("/api/workspace/audience-voices", body),
  // AI 发现：读一次缓存，扫描是显式动作——进页面不自动烧模型。
  contentDiscovery: (query = "") => req(`/api/workspace/content-discovery${query}`),
  scanContentDiscovery: (body) => postJson("/api/workspace/content-discovery/scan", body),
  // 内容构造：提几种讲法、按一句话继续推。两个都只产候选，不写库。
  constructionRoutes: (body) => postJson("/api/workspace/content-construction/routes", body),
  refineConstructionRoute: (body) => postJson("/api/workspace/content-construction/refine", body),
  // 项目 AI：默认继承内容机会、讲法和来源，先搭结构、再起稿；两个都只产候选。
  projectCreativeContext: (id) => req(`/api/workspace/projects/${encodeURIComponent(id)}/creative-context`),
  projectOutline: (id) => postJson(`/api/workspace/projects/${encodeURIComponent(id)}/outline`, {}),
  projectDraftCandidate: (id, outline) => postJson(`/api/workspace/projects/${encodeURIComponent(id)}/draft-candidate`, { outline }),
  extractAudienceProblems: (insightId) => postJson("/api/workspace/audience-problems/extract", { insightId }),
  agendaProblemCandidates: (agendaId) => postJson("/api/workspace/audience-problems/from-agenda", { agendaId }),
  positioning: () => req("/api/workspace/positioning"),
  experiments: (query = "") => req(`/api/workspace/experiments${query}`),
  experiment: (id) => req(`/api/workspace/experiments/${encodeURIComponent(id)}`),
  recordHypothesis: (body) => postJson("/api/workspace/experiments", body),
  updateHypothesis: (id, body) => postJson(`/api/workspace/experiments/${encodeURIComponent(id)}/update`, body),
  settleExperiment: (id, body) => postJson(`/api/workspace/experiments/${encodeURIComponent(id)}/settle`, body),
  experimentProblemCandidates: (id, body) => postJson(`/api/workspace/experiments/${encodeURIComponent(id)}/problem-candidates`, body),
  linkExperimentProblem: (id, body) => postJson(`/api/workspace/experiments/${encodeURIComponent(id)}/link-problem`, body),
  createAudienceProblem: (body) => postJson("/api/workspace/audience-problems", body),
  updateAudienceProblem: (id, body) => postJson(`/api/workspace/audience-problems/${encodeURIComponent(id)}/update`, body),
  previewContentOpportunity: (body) => postJson("/api/workspace/content-opportunities/preview", body),
  previewContentOpportunityAgendaFit: (body) => postJson("/api/workspace/content-opportunities/agenda-fit", body),
  contentOpportunities: () => req("/api/workspace/content-opportunities"),
  contentOpportunity: (id) => req(`/api/workspace/content-opportunities/${encodeURIComponent(id)}`),
  saveContentOpportunity: (body) => postJson("/api/workspace/content-opportunities", body),
  updateContentOpportunity: (id, body) => postJson(`/api/workspace/content-opportunities/${encodeURIComponent(id)}/update`, body),
  createProjectFromOpportunity: (id, body) => postJson(`/api/workspace/content-opportunities/${encodeURIComponent(id)}/project`, body),
  projectContentIntent: (projectId) => req(`/api/workspace/projects/${encodeURIComponent(projectId)}/content-intent`),

  // 洞察跑批。ready 回答「现在能不能跑、缺什么、上周挂了什么账」——
  // 这才是按钮真正省掉的事：以前要翻三个目录才能确认。
  insightReady: (week = "") => req(`/api/insights/ready${week ? `?week=${encodeURIComponent(week)}` : ""}`),
  insightRunStatus: () => req("/api/insights/run"),
  insightRunStart: (week = "") => postJson("/api/insights/run", { week }),
  insightRunCancel: () => postJson("/api/insights/run/cancel", {}),
  workspaceDoc: (path, notePath = "") =>
    req(`/api/workspace/doc?path=${encodeURIComponent(path)}&notePath=${encodeURIComponent(notePath)}`),
  // 改正文。stamp 是打开时拿到的版本号，对不上就 409，不硬覆盖。
  saveWorkspaceDoc: (path, content, stamp = "") => postJson("/api/workspace/doc", { path, content, stamp }),
  workspaceNote: (body) => postJson("/api/workspace/note", body),
  // 改一条 / 删一条批注。带 stamp 做乐观锁，防止覆盖并发修改。
  editNote: (path, index, stamp, body) => postJson("/api/workspace/note/edit", { path, index, stamp, body }),
  removeNote: (path, index, stamp) => postJson("/api/workspace/note/edit", { path, index, stamp, remove: true }),
  books: () => req("/api/workspace/books"),
  // 资料（自己攒的，可改）/ 藏书（别人写的，只读）。写进 book.md 的 frontmatter
  setBookKind: (dir, kind) => postJson("/api/workspace/books/kind", { dir, kind }),
  createBook: (name, content = "") => postJson("/api/workspace/books", { name, content }),

  // 导入书：整个文件原样 POST 过去，解析在服务端做。
  // 不在浏览器里解 epub/pdf——那要往前端包里塞两个解析器，而本机就有 Node。
  importBook: (file, name = "", options = {}) => {
    const params = new URLSearchParams({ filename: file.name, name });
    for (const [key, value] of Object.entries(options)) if (value !== "" && value != null && value !== false) params.set(key, value === true ? "1" : String(value));
    return req(`/api/workspace/books/import?${params}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
  },

  // 下架进入当前工作区回收站，可由恢复入口找回。
  trashBook: (dir) => postJson("/api/workspace/books/trash", { dir }),
  restoreBook: (from, to) => postJson("/api/workspace/books/restore", { from, to }),
  // 在一本书里全文搜：拆成几十章之后，「那句话在哪一章」是刚需
  searchBook: (dir, q) =>
    req(`/api/workspace/books/search?dir=${encodeURIComponent(dir)}&q=${encodeURIComponent(q)}`),

  // 一本书里的全部标记（高亮 + 批注），按章排。聚合规则在 server/lib/marks.mjs
  bookMarks: (dir) => req(`/api/workspace/book-marks?dir=${encodeURIComponent(dir)}`),

  highlights: (path) => req(`/api/workspace/highlights?path=${encodeURIComponent(path)}`),
  markHighlight: (path, add, remove) => postJson("/api/workspace/highlights", { path, add, remove }),
  // 换封面：整块二进制原样传过去，和导入书籍走同一条路
  setCover: (dir, file) =>
    req(`/api/workspace/books/cover?dir=${encodeURIComponent(dir)}&ext=${encodeURIComponent(extOf(file.name))}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    }),
  // 划词翻译。key 在服务端，前端只管发文字
  translate: (text, target) => postJson("/api/translate", { text, target }),

  /**
   * 正文里插图片 / 视频 / GIF。文件进入当前工作区资产库，正文只保留 asset URI。
   * 和换封面走同一条二进制路子：不引 multipart 解析器，后缀和文件名走 query。
   */
  uploadMedia: (file) =>
    req(`/api/workspace/assets/images?name=${encodeURIComponent(file.name || "image.bin")}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    }),

  // 当前工作区里的图片地址。图片走 <img src>，不经过 req()。
  imageUrl: (path) => String(path || "").startsWith("asset://") ? `/api/workspace/assets/${encodeURIComponent(String(path).slice(8))}` : "",
  // 视频不能走 imageUrl：那个端点的白名单只有图片
  mediaUrl: (path) => String(path || "").startsWith("asset://") ? `/api/workspace/assets/${encodeURIComponent(String(path).slice(8))}` : "",

  // 两个 tab 各刷各的：热搜按分钟变、AI 精选按天变，合成一个请求就只能迁就快的那个
  // 候选只读；变成种子仍必须由用户补一句并明确确认。
  ideaCandidates: (refresh) => req(`/api/insights/candidates${refresh ? "?refresh=1" : ""}`),
  ideaAngles: (body) => postJson("/api/workspace/ideas/angles", body),
  ideaMaterials: (body) => postJson("/api/workspace/ideas/materials", body),
  hotBoards: (refresh) => req(`/api/hot/boards${refresh ? "?refresh=1" : ""}`),
  // 把一条热点的原文抓下来读成 Markdown，在工作台里看完，不用先跳出去
  readArticle: (url) => req(`/api/hot/read?url=${encodeURIComponent(url)}`),
  // 大模型共识分。**解析 AI HOT 的页面来的，不是公开 API**，会随对方改版失效
  hotModels: (refresh) => req(`/api/hot/models${refresh ? "?refresh=1" : ""}`),
  hotAi: ({ refresh, all } = {}) => {
    const q = [refresh && "refresh=1", all && "all=1"].filter(Boolean).join("&");
    return req(`/api/hot/ai${q ? `?${q}` : ""}`);
  },
  updateFields: (view, pageId, fields) => postJson(`/api/workspace/items/${encodeURIComponent(view)}/${encodeURIComponent(pageId)}/update`, { fields }),
  saveContent: (view, pageId, markdown) => postJson(`/api/workspace/items/${encodeURIComponent(view)}/${encodeURIComponent(pageId)}/update`, { markdown }),
  publishDraft: (body) => postJson("/api/workspace/publications", body),
  // 删除会写入本地回收站，不移除正文和关系。界面上要照实说。
  removePage: (view, pageId) => postJson(`/api/workspace/items/${encodeURIComponent(view)}/${encodeURIComponent(pageId)}/trash`, {}),
  draftsOf: (topicId) => req(`/api/workspace/drafts-of/${topicId}`),
  metrics: () => req("/api/workspace/account-metrics"),
  saveMetric: (body) => postJson("/api/workspace/account-metrics", body),

  posts: () => req("/api/workspace/publications"),
  savePost: (body) => postJson("/api/workspace/external-publications", body),
  // 导入分两步：`dry` 只解析、只回报「我是怎么读这份文件的」，不写盘。
  // 解析器只能靠列名认字段，认错了不会报错——所以必须让人先看一眼再点确认。
  importPosts: (file, platform, { dry = false } = {}) =>
    req(
      `/api/workspace/external-publications/import?filename=${encodeURIComponent(file.name)}&platform=${encodeURIComponent(platform)}${dry ? "&dry=1" : ""}`,
      { method: "POST", headers: { "content-type": "application/octet-stream" }, body: file }
    ),
  runArchive: () => postJson("/api/workspace/publications/reconcile", {}),

  // 全局检索：一个入口搜遍当前工作区。
  search: (q, limit) => req(`/api/workspace/search?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ""}`),
  // 这些热点后来怎么样了（未处理 → 已收藏 → 已形成选题 → 已成稿 → 已发布）。
  // 一屏几十条链接，走 POST 是为了带 body，不是因为有副作用
  traceHot: (links) => postJson("/api/hot/trace", { links }),

  // 备份与恢复。导出走 POST 是因为 localStorage（阅读进度/书签/阅读设置/排版草稿）
  // 服务端读不到，只能由前端交上去一起打包
  backupStatus: () => req("/api/backup/status"),
  restoreSnapshot: (key, name) => postJson(`/api/backup/snapshot/${encodeURIComponent(key)}/restore`, { name }),
  previewBackup: (file) =>
    req("/api/backup/restore?dry=1", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    }),
  applyBackup: (file, confirmationSha256) =>
    req(`/api/backup/restore?confirm=${encodeURIComponent(confirmationSha256 || "")}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    }),

  // 设置面板。**字段表整个从服务端来**（`server/lib/settings-schema.mjs`），
  // 前端不写第二份——抄一份的话，以后加一个 .env 变量会在面板上安静地不出现。
  settings: () => req("/api/settings"),
  // `values` 里密钥留空 = 不改（面板读不回密钥，「没动它」和「想清空」在请求体里长得一样）；
  // 真要清空得把 key 放进 `clear`。这条判据在服务端，这里只是别把它写反
  saveSettings: (values, clear = []) => postJson("/api/settings", { values, clear }),
  // 会真的打网络、真的 spawn 进程，所以是 POST 不是 GET
  verifySettings: () => postJson("/api/settings/verify", {}),
  // 长期创作设置。专家/风格是工作台自己的内置能力；这里只保存长期默认风格。
  writingProfile: () => req("/api/writing-profile"),
  saveWritingProfile: (profile) => postJson("/api/writing-profile", { profile }),
  saveWritingStyle: (style) => postJson("/api/writing-style", style),
  expertRuntime: () => req("/api/expert-runtime"),
  startExpertRun: (body) => postJson("/api/expert-runs", body),
  expertRun: (id) => req(`/api/expert-runs/${encodeURIComponent(id)}`),
  expertRuns: (scope = "") => req(`/api/expert-runs${scope ? `?scope=${encodeURIComponent(scope)}` : ""}`),
  cancelExpertRun: (id) => postJson(`/api/expert-runs/${encodeURIComponent(id)}/cancel`, {}),
  assistantConversation: (scope, conversationId = "") => req(`/api/assistant/conversation?scope=${encodeURIComponent(scope)}${conversationId ? `&conversationId=${encodeURIComponent(conversationId)}` : ""}`),
  assistantConversations: (scope) => req(`/api/assistant/conversations?scope=${encodeURIComponent(scope)}`),
  manageAssistantConversation: (body) => postJson("/api/assistant/conversation/manage", body),
  assistantModels: () => req("/api/assistant/models"),
  assistantSkills: () => req("/api/assistant/skills"),
  assistantExperts: () => req("/api/assistant/experts"),
  assistantModes: () => req("/api/assistant/modes"),
  setAssistantMode: (body) => postJson("/api/assistant/mode", body),
  setAssistantModel: (body) => postJson("/api/assistant/model", body),
  assistantChat: (body) => postJson("/api/assistant/chat", body),
  async assistantChatStream(body, onEvent) {
    let response;
    try {
      response = await fetch("/api/assistant/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw Object.assign(new Error("本地服务没响应"), { hint: "确认工作台仍在运行" });
    }
    if (!response.ok || !response.body) throw new Error(`AI 助手响应异常（HTTP ${response.status}）`);
    if (response.headers.get("content-type")?.includes("application/json")) {
      return response.json();
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result = null;
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "error") throw Object.assign(new Error(event.error || "AI 助手没有完成"), { hint: event.hint, status: event.status });
        if (event.type === "done") result = event.result;
        else onEvent?.(event);
      }
      if (done) break;
    }
    if (!result) throw new Error("AI 助手连接已结束，可稍后重新打开该对话查看结果");
    return result;
  },
  cancelAssistant: (scopeId, conversationId = "") => postJson("/api/assistant/cancel", { scopeId, conversationId }),
  rewindAssistant: (scopeId, conversationId) => postJson("/api/assistant/rewind", { scopeId, conversationId }),
  applyAssistantAction: (scopeId, conversationId, actionId) => postJson("/api/assistant/action", { scopeId, conversationId, actionId }),
  proposeAssistantWikiPage: (body) => postJson("/api/assistant/wiki-candidate", body),
  // 正文里那次问答搬进右栏（不重新生成），返回带着这一轮的新对话
  adoptAssistantExchange: (body) => postJson("/api/assistant/adopt", body),
  newAssistantConversation: (scopeId, model = "", permissionMode = "daily") => postJson("/api/assistant/new", { scopeId, model, permissionMode }),
  uploadAssistantAttachment: (scope, conversationId, file) => req(`/api/assistant/attachment?scope=${encodeURIComponent(scope)}&conversationId=${encodeURIComponent(conversationId)}&filename=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: file,
  }),

  prompts: () => req("/api/prompts"),
  savePrompts: (values) => postJson("/api/prompts", values),
};

/**
 * 浏览器本地数据：进备份的是**内容性/不可再生**的那些，不是全部 localStorage。
 *
 * 阅读进度、书签、阅读设置、排版草稿丢了要么重来一遍要么真的没了；
 * 而侧栏收起没收起、上次选的对话引擎这种，丢了下次点一下就回来。
 * 备份文件里塞进一堆一次性的 UI 状态，只会让「恢复」这个动作变得不敢按。
 */
export const BACKED_UP_LOCAL_KEYS = [
  /^workbench:reading/,   // 阅读进度（reading:v1）和阅读设置（reading-prefs:v3）
  /^workbench:bookmarks/, // 书签
  /^wechat-typeset$/,     // 内嵌排版工具的草稿
];

export function collectLocalData() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (BACKED_UP_LOCAL_KEYS.some((re) => re.test(k))) out[k] = localStorage.getItem(k);
    }
  } catch {
    /* 隐私模式下读不了，那就只备份服务端那部分 */
  }
  return out;
}

/**
 * 恢复时写回 localStorage。**只覆盖备份里有的键，不清空其余**——
 * `localStorage.clear()` 会把排版草稿、侧栏状态一起抹掉，
 * 而恢复一份只含阅读进度的备份，不该有那个副作用。
 */
export function applyLocalData(data) {
  let n = 0;
  try {
    for (const [k, v] of Object.entries(data || {})) {
      if (!BACKED_UP_LOCAL_KEYS.some((re) => re.test(k))) continue; // 备份文件也是外来内容
      localStorage.setItem(k, String(v));
      n++;
    }
  } catch {
    /* 写不了就算了，服务端那部分已经恢复好了 */
  }
  return n;
}

/**
 * 导出：拿服务端压好的 zip，直接触发下载。
 * 不走 `req()`——那个会把响应 `json()` 掉，而这里回的是二进制。
 */
export async function downloadBackup({ kind = "portable", includeBookAssets = false } = {}) {
  const res = await fetch("/api/backup/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, includeBookAssets }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `导出失败（HTTP ${res.status}）`), { hint: data.hint });
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || "xenho-workbench-backup.zip";
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name, bytes: blob.size };
}

/**
 * 单篇文章导出。服务端一律回二进制，所以不走 `req()`（那个会 `json()` 掉响应）。
 *
 * ⚠️ **文件名以服务端回的 `content-disposition` 为准，不在这里再拼一次。**
 * Markdown 有图时回的是 zip 而不是 `.md`——扩展名是服务端的判断，
 * 前端自己拼的话会把一个 zip 存成 `.md`，双击打不开。
 */
export async function downloadProjectExport(projectId, format = "md") {
  const res = await fetch(`/api/workspace/projects/${encodeURIComponent(projectId)}/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ format }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `导出失败（HTTP ${res.status}）`), { hint: data.hint });
  }
  const disposition = res.headers.get("content-disposition") || "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const name = (encoded ? decodeURIComponent(encoded) : /filename="([^"]+)"/.exec(disposition)?.[1]) || `导出.${format}`;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name, bytes: blob.size };
}

/**
 * 把整个合集下载成一份 Markdown。
 *
 * 服务端只把拼好的文本回过来，**不落盘**：写文件要过根目录限制和真实路径检查，
 * 而这里根本不需要写。下载动作和 `downloadBackup` 同一套 Blob + `<a download>`。
 */
export async function downloadSeriesMarkdown(seriesId) {
  const { title, markdown } = await api.exportSeries(seriesId);
  const name = `${String(title || "合集").replace(/[\\/:*?"<>|]/g, "_")}.md`;
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name, bytes: markdown.length };
}

/**
 * 和本机 agent 深聊：流式读取，和 explainStream 同一套路。
 * 通用对话统一走 Pi Agent SDK，服务端固定权限工具；x-session-id 用于续聊。
 * 额外把 x-session-id 回调出去——续聊要靠它，不然每轮都是新会话、没有上下文。
 */
export function agentStream({ signal, onChunk, onSession, ...body }) {
  return fetch("/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }).then(async (res) => {
    const type = res.headers.get("content-type") || "";
    if (!res.ok || type.includes("application/json")) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw Object.assign(new Error(data.error || "对话失败"), { hint: data.hint });
    }
    onSession?.(res.headers.get("x-session-id") || "");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      full += decoder.decode(value, { stream: true });
      onChunk(full);
    }
    return full;
  });
}

/**
 * 划词 AI：按纯文本响应读取；本地服务完成真实性校验后返回。
 * 不走上面的 req()——那个会把纯文本响应当 JSON 解析。
 * 返回一个 abort 函数：用户关掉面板就该停下，别让请求在后台继续烧 token。
 */
export function explainStream({ signal, onChunk, ...body }) {
  return fetch("/api/ai/explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }).then(async (res) => {
    const type = res.headers.get("content-type") || "";
    if (!res.ok || type.includes("application/json")) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw Object.assign(new Error(data.error || "AI 调用失败"), { hint: data.hint });
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      full += text;
      onChunk(full);
    }
    return full;
  });
}
