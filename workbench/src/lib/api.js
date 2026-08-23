// 前端只跟本地 API 说话，永远不直连 Worker / 数据库 / LLM。
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
  if (!data.ok) throw Object.assign(new Error(data.error || `请求失败（HTTP ${res.status}）`), { hint: data.hint });
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
  config: () => req("/api/config"),
  status: () => req("/api/pipe/status"),
  projects: (stage = "") => req(`/api/pipe/projects${stage ? `?stage=${encodeURIComponent(stage)}` : ""}`),
  project: (id) => req(`/api/pipe/projects/${encodeURIComponent(id)}`),
  transitionProject: (id, action, input = {}) => postJson(`/api/pipe/projects/${encodeURIComponent(id)}/transition`, { action, ...input }),
  createProjectVariant: (id, platform) => postJson(`/api/pipe/projects/${encodeURIComponent(id)}/variants`, { platform }),
  removeProjectVariant: (id, draftId) => postJson(`/api/pipe/projects/${encodeURIComponent(id)}/variants/${encodeURIComponent(draftId)}/remove`, {}),
  saveProjectRelease: (id, draftId, release) => postJson(`/api/pipe/projects/${encodeURIComponent(id)}/releases/${encodeURIComponent(draftId)}`, release),
  saveProjectReview: (id, review) => postJson(`/api/pipe/projects/${encodeURIComponent(id)}/review`, review),
  materialWorkspace: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "" && value != null));
    return req(`/api/pipe/materials${qs.toString() ? `?${qs}` : ""}`);
  },
  list: (view, params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return req(`/api/pipe/list/${view}${qs.toString() ? `?${qs}` : ""}`);
  },
  searchLibrary: (view, q, state = "") =>
    req(`/api/pipe/search/${view}?q=${encodeURIComponent(q)}${state ? `&state=${encodeURIComponent(state)}` : ""}`),
  page: (id, view = "") => req(`/api/pipe/page/${id}${view ? `?view=${encodeURIComponent(view)}` : ""}`),
  intake: (body) => postJson("/api/pipe/intake", body),
  // 种子。⚠️ `seeds()` 的响应里带 `reactions`——**反应清单的真源在 Worker**，
  // 前端不写死那七条（`sources.js` 那几处 `states` 抄了一份，对不上就是 400）。
  seeds: (status = "") => req(`/api/pipe/seeds${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createSeed: (body) => postJson("/api/pipe/seeds", body),
  updateSeed: (id, patch) => postJson(`/api/pipe/seeds/${encodeURIComponent(id)}`, patch),
  removeSeed: (id) => postJson(`/api/pipe/seeds/${encodeURIComponent(id)}/delete`, {}),
  retryCollectionSnapshot: (id) => postJson(`/api/pipe/collections/${encodeURIComponent(id)}/snapshot`, {}),
  previewCollectionOrganize: (ids) => postJson("/api/pipe/collections/organize/preview", { ids }),
  applyCollectionOrganize: (items) => postJson("/api/pipe/collections/organize/apply", { items }),
  previewKnowledgeCard: (body) => postJson("/api/ai/knowledge-card", body),
  saveKnowledgeCard: (card) => postJson("/api/vault/knowledge-card", card),
  knowledgeCardLinks: (refs) => postJson("/api/vault/knowledge-card/links", { refs }),
  comment: (pageId, text) => postJson("/api/pipe/comment", { pageId, text }),
  comments: (pageId) => req(`/api/pipe/comments/${pageId}`),
  revisions: (scope) => req(`/api/revisions?scope=${encodeURIComponent(scope)}`),
  saveRevision: (scope, item) => postJson("/api/revisions", { scope, item }),
  moveRevisions: (from, to) => postJson("/api/revisions/move", { from, to }),

  // 每日计划。**只传日期串不传路径**，路径由服务端从 `05 - 计划/` 派生。
  // 打钩和删除带 stamp（文件 mtime）做乐观锁：它们按**行号**改写，而这份 md 同时可能
  // 在 Obsidian 里开着，对不上就 409。**「加一条」不带**——追加不依赖旧状态，
  // 给它上锁的结果是最无害的操作反而第一个被拦（见 server/lib/plan.mjs）
  plan: (date = "") => req(`/api/plan${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  addTask: (date, text) => postJson("/api/plan", { date, action: "add", text }),
  toggleTask: (date, stamp, index, done) => postJson("/api/plan", { date, stamp, action: "toggle", index, done }),
  removeTask: (date, stamp, index) => postJson("/api/plan", { date, stamp, action: "remove", index }),

  vaultTree: (dir = "") => req(`/api/vault/tree?dir=${encodeURIComponent(dir)}`),
  // 洞察报告清单。不用 vaultTree：卡片要摘要、覆盖周期、字数，那些只有读文件才有
  vaultInsights: () => req("/api/vault/insights"),

  // 洞察跑批。ready 回答「现在能不能跑、缺什么、上周挂了什么账」——
  // 这才是按钮真正省掉的事：以前要翻三个目录才能确认。
  insightReady: (week = "") => req(`/api/insights/ready${week ? `?week=${encodeURIComponent(week)}` : ""}`),
  insightRunStatus: () => req("/api/insights/run"),
  insightRunStart: (week = "") => postJson("/api/insights/run", { week }),
  insightRunCancel: () => postJson("/api/insights/run/cancel", {}),
  vaultFile: (path) => req(`/api/vault/file?path=${encodeURIComponent(path)}`),
  vaultDoc: (path, notePath = "") =>
    req(`/api/vault/doc?path=${encodeURIComponent(path)}&notePath=${encodeURIComponent(notePath)}`),
  // 改正文。stamp 是打开时拿到的版本号——这些 md 同时在 Obsidian 里开着，
  // 对不上就 409，不硬覆盖。frontmatter 由服务端原样保留，前端只管正文
  saveVaultDoc: (path, content, stamp = "") => postJson("/api/vault/doc", { path, content, stamp }),
  vaultNote: (body) => postJson("/api/vault/note", body),
  // 改一条 / 删一条批注。带 stamp 做乐观锁：文件在 Obsidian 里被动过就 409，不硬覆盖
  editNote: (path, index, stamp, body) => postJson("/api/vault/note/edit", { path, index, stamp, body }),
  removeNote: (path, index, stamp) => postJson("/api/vault/note/edit", { path, index, stamp, remove: true }),
  books: () => req("/api/vault/books"),
  // 资料（自己攒的，可改）/ 藏书（别人写的，只读）。写进 book.md 的 frontmatter
  setBookKind: (dir, kind) => postJson("/api/vault/books/kind", { dir, kind }),
  createBook: (name, content = "") => postJson("/api/vault/books", { name, content }),

  // 导入书：整个文件原样 POST 过去，解析在服务端做。
  // 不在浏览器里解 epub/pdf——那要往前端包里塞两个解析器，而本机就有 Node。
  importBook: (file, name = "") =>
    req(`/api/vault/books/import?filename=${encodeURIComponent(file.name)}&name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    }),

  // 下架 = 整个目录移进 vault 的 .trash/，和在 Obsidian 里删它是同一个地方
  trashBook: (dir) => postJson("/api/vault/books/trash", { dir }),
  restoreBook: (from, to) => postJson("/api/vault/books/restore", { from, to }),
  // 在一本书里全文搜：拆成几十章之后，「那句话在哪一章」是刚需
  searchBook: (dir, q) =>
    req(`/api/vault/books/search?dir=${encodeURIComponent(dir)}&q=${encodeURIComponent(q)}`),

  // 一本书里的全部标记（高亮 + 批注），按章排。聚合规则在 server/lib/marks.mjs
  bookMarks: (dir) => req(`/api/vault/book-marks?dir=${encodeURIComponent(dir)}`),

  highlights: (path) => req(`/api/vault/highlights?path=${encodeURIComponent(path)}`),
  markHighlight: (path, add, remove) => postJson("/api/vault/highlights", { path, add, remove }),
  // 换封面：整块二进制原样传过去，和导入书籍走同一条路
  setCover: (dir, file) =>
    req(`/api/vault/books/cover?dir=${encodeURIComponent(dir)}&ext=${encodeURIComponent(extOf(file.name))}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    }),
  // 划词翻译。key 在服务端，前端只管发文字
  translate: (text, target) => postJson("/api/translate", { text, target }),

  // vault 里的图片（封面、正文插图）的地址。图片走 <img src>，不经过 req()
  imageUrl: (path) => `/api/vault/image?path=${encodeURIComponent(path)}`,

  // 两个 tab 各刷各的：热搜按分钟变、AI 精选按天变，合成一个请求就只能迁就快的那个
  hotBoards: (refresh) => req(`/api/hot/boards${refresh ? "?refresh=1" : ""}`),
  // 把一条热点的原文抓下来读成 Markdown，在工作台里看完，不用先跳出去
  readArticle: (url) => req(`/api/hot/read?url=${encodeURIComponent(url)}`),
  // 大模型共识分。**解析 AI HOT 的页面来的，不是公开 API**，会随对方改版失效
  hotModels: (refresh) => req(`/api/hot/models${refresh ? "?refresh=1" : ""}`),
  hotAi: ({ refresh, all } = {}) => {
    const q = [refresh && "refresh=1", all && "all=1"].filter(Boolean).join("&");
    return req(`/api/hot/ai${q ? `?${q}` : ""}`);
  },
  updateFields: (view, pageId, fields) => postJson("/api/pipe/update", { view, pageId, fields }),
  saveContent: (view, pageId, markdown) => postJson("/api/pipe/content", { view, pageId, markdown }),
  publishDraft: (body) => postJson("/api/posts/publish", body),
  // 删除是**真删除**：库已从 Notion 换成 D1，没有废纸篓那一层了。界面上要照实说。
  // 响应里的 `archive` 是本地路由补的：vault 里那份归档移进 `.trash/` 的结果，
  // 四种状态见 `sources.js` 的 `summarizeArchiveTrash`。**Worker 不回这个字段。**
  removePage: (view, pageId) => postJson("/api/pipe/delete", { view, pageId }),
  draftsOf: (topicId) => req(`/api/pipe/drafts-of/${topicId}`),
  metrics: () => req("/api/metrics"),
  saveMetric: (body) => postJson("/api/metrics", body),

  posts: () => req("/api/posts"),
  savePost: (body) => postJson("/api/posts", body),
  // 导入分两步：`dry` 只解析、只回报「我是怎么读这份文件的」，不写盘。
  // 解析器只能靠列名认字段，认错了不会报错——所以必须让人先看一眼再点确认。
  importPosts: (file, platform, { dry = false } = {}) =>
    req(
      `/api/posts/import?filename=${encodeURIComponent(file.name)}&platform=${encodeURIComponent(platform)}${dry ? "&dry=1" : ""}`,
      { method: "POST", headers: { "content-type": "application/octet-stream" }, body: file }
    ),
  // 下载文件夹里还没导进来的导出文件。能推断的不让用户填：文件在哪、哪个最新、
  // 哪个是刚下的，机器全知道——不该让人再去文件对话框里翻一遍
  postsInbox: () => req("/api/posts/inbox"),
  importInbox: (id, platform, { dry = false } = {}) =>
    postJson(`/api/posts/inbox/import${dry ? "?dry=1" : ""}`, { id, platform }),
  runArchive: () => postJson("/api/archive/run", {}),

  // 全局检索：一个入口搜遍 vault、流水线四库和已发布作品
  search: (q, limit) => req(`/api/search?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ""}`),
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
  applyBackup: (file) =>
    req("/api/backup/restore", {
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

  // 提示词分两组端点，**因为它们生效的方式不同**：工作台自己的改完立刻生效；
  // 流水线那些打包进 Worker，改完要 npx wrangler deploy。合成一组的话，
  // 前端就得靠一个字段去分辨「这次要不要提醒部署」，而漏掉那个提醒不会报错
  // 各环节用哪个模型。真源在 Worker 的 D1 里，本地只转发（`server/routes/pipe.mjs`）
  models: () => req("/api/pipe/models"),
  saveModels: (values) => postJson("/api/pipe/models", { values }),
  prompts: () => req("/api/prompts"),
  savePrompts: (values) => postJson("/api/prompts", values),
  // 列表回的每一项带 id（相对路径的哈希）。**后面读写只认 id 不认路径**——
  // 路径当参数等于开了个任意文件写入的口子
  pipelinePrompts: () => req("/api/prompts/pipeline"),
  pipelinePrompt: (id) => req(`/api/prompts/pipeline/${encodeURIComponent(id)}`),
  savePipelinePrompt: (id, text, stamp) =>
    postJson(`/api/prompts/pipeline/${encodeURIComponent(id)}`, { text, stamp }),
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
export async function downloadBackup() {
  const res = await fetch("/api/backup/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ browser: collectLocalData() }),
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
 * 和本机 agent 深聊：流式读取，和 explainStream 同一套路。
 * `agent` 选引擎（claude / codex），服务端按白名单取，认不出就退回 claude。
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
 * 划词 AI：按纯文本响应读取；当前 Worker 会先完成真实性校验再返回，通常只有一块。
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
