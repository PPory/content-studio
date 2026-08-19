// 阅读工作区的「源适配器」。
//
// 六个入口（灵感库/素材库/书架/选题库/稿件库/洞察）读的是完全不同的东西，但用户的动作
// 是同一套：浏览 → 搜索 → 读 → 划词（批注/问 AI/存素材）→ 改。所以把差异收敛成这个接口，
// 阅读区组件只认接口。加新的可读源只写适配器，**不要动 Workspace.jsx**。
//
// 接口：
//   list({ state, cursor })  → { exists, items, nextCursor }
//   load(item)               → { title, content, notes, meta, format, editable? }
//   annotate(item, {quote, body}) → { notes }
//   save?(item, { title, markdown, fields }) → 可选，支持编辑的源才实现
//   states                   → 状态筛选项（没有就不显示筛选条）
//   annotateLabel / sourceOf / emptyHint

import { api } from "./api.js";
import { readStats } from "./reading.js";

/**
 * 有些字段里存的是**字面的 `\n` 两个字符**而不是真换行——LLM 生成 JSON 时把换行
 * 转义了两遍，落库时就成了这样，读出来满屏 `\n` 没法看。
 *
 * **逐行处理**：页面正文是多个块用真换行拼起来的，整段判断「有真换行就不动」的话，
 * 修复永远不会生效（第一版就是这么写错的）。坏的是单个块内部，所以按行修。
 *
 * 代码围栏内不动——代码里的 `\n` 是合法内容，改了就是破坏。
 */
function unescapeNewlines(text) {
  let inFence = false;
  return String(text || "")
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence || !line.includes("\\n")) return line;
      return line.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    })
    .join("\n");
}

function stripLegacyDraftWarnings(text) {
  return String(text || "")
    .replace(/^>?\s*⚠️\s*含无素材支撑的第一人称经历，发布前必须替换或删除[。.]?\s*/gm, "")
    .replace(/^>?\s*⚠️\s*此历史草稿生成于真实性校验上线前[^\n]*(?:\n>?[^\n]*)*?发布前必须替换为真实经历或删除[。.]?\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 成稿平台。**必须和 content-pipeline 里 `draft.js` 的 `PLATFORMS` 逐字一致**——
 * 写进「适配平台」的值对不上，Worker 会把它 filter 掉然后静默不写那个平台，
 * 界面上看不出任何异常，只是稿子永远不来。
 *
 * ⚠️ **这个声明必须排在 DRAFTS 前面**：DRAFTS 的 facet 在模块加载时就读它，而 const 不提升。
 * 放在文件末尾的话是 `Cannot access 'PLATFORMS' before initialization`——整个模块加载失败、
 * 界面全白，而 `npm run build` 照样过（打包器只看语法，不跑代码）。
 */
export const PLATFORMS = ["公众号", "X", "小红书", "视频号", "YouTube"];

// ---- 流水线四个库共用的实现 ------------------------------------------------

/**
 * ⚠️ 新增配置项**必须同时加进参数解构和返回对象**。
 *
 * 踩过一次，代价不小：`askPlatformsOn` 只写进了 TOPICS 的配置、没进这个函数的解构，
 * 于是 `source.askPlatformsOn` 恒为 undefined，「改成撰写中先弹平台选择」这道闸门
 * 整个失效——状态被直接写回库里，Worker 五分钟内就领走选题、按三个平台跑了三遍 LLM。
 * 这类漏字段不会报错，只会安静地少一个功能。
 */
function pipelineSource({ key, label, eyebrow, eyebrowCn, sub, states = [], stateTabs, facet, pendingKey, askPlatformsOn, quietStates = [], defaultState = "", mapItem, emptyHint, board = true, editable = true, removable = true, editTarget = "流水线" }) {
  return {
    key,
    label,
    eyebrow,
    eyebrowCn,
    sub,
    states,
    stateTabs: stateTabs || states,
    askPlatformsOn,
    quietStates,
    defaultState,
    board,
    // 分面：按条目自身的某个属性筛（素材库按类型）。**在已加载的条目里筛**，
    // 因为素材库在库里根本没有状态列（`materials` 表没有 status），服务端过滤不了。
    facet,
    pendingKey,   // 对应 /wb/status 的计数键，挂在 tab 上当待办角标
    emptyHint,
    kind: "pipeline",

    async list({ state, cursor } = {}) {
      const r = await api.list(key, { state, cursor, pageSize: 30 });
      if (key === "collections" && r.items.length) {
        const refs = r.items.map((item) => `inbox:${item.id}`);
        const links = await api.knowledgeCardLinks(refs).catch(() => ({ counts: {} }));
        for (const item of r.items) item.knowledgeCardCount = links.counts?.[`inbox:${item.id}`] || 0;
      }
      return { exists: true, items: r.items.map(mapItem), nextCursor: r.nextCursor };
    },

    async search({ q, state } = {}) {
      const r = await api.searchLibrary(key, q, state);
      if (key === "collections" && r.items.length) {
        const refs = r.items.map((item) => `inbox:${item.id}`);
        const links = await api.knowledgeCardLinks(refs).catch(() => ({ counts: {} }));
        for (const item of r.items) item.knowledgeCardCount = links.counts?.[`inbox:${item.id}`] || 0;
      }
      return { exists: true, items: r.items.map(mapItem), nextCursor: null, fullLibrary: true };
    },

    async load(item) {
      const [page, comments] = await Promise.all([
        api.page(item.key, key).catch(() => ({ text: "" })),
        // 评论要集成开了「读取评论」才拿得到；没开就是空，不该让整页报错
        api.comments(item.key).catch(() => ({ comments: [] })),
      ]);
      const body = key === "drafts"
        ? stripLegacyDraftWarnings(unescapeNewlines(page.text))
        : unescapeNewlines(page.text);
      // 「内容/摘要」字段和正文块常常重复，重复时只留正文块
      const note = key === "drafts"
        ? stripLegacyDraftWarnings(unescapeNewlines(item.raw.note))
        : unescapeNewlines(item.raw.note);
      const content = note && !body.includes(note.slice(0, 40)) ? [note, body].filter(Boolean).join("\n\n") : body || note;

      const detailItem = page.meta ? mapItem({ ...item.raw, ...page.meta }) : item;
      return {
        title: item.title,
        content,
        markdown: content,
        notes: (comments.comments || [])
          .map((c) => `## ${new Date(c.createdAt).toLocaleString("zh-CN", { hour12: false })}\n\n${c.text}`)
          .join("\n\n"),
        meta: detailItem.meta,
        warning: page.warning || detailItem.warning,
        format: "markdown",
        editable,
        status: item.raw.status || "",
        updatedAt: page.meta?.editedAt || item.raw?.editedAt || "",
      };
    },

    async annotate(item, { quote, body }) {
      await api.comment(item.key, quote ? `> ${quote.slice(0, 200)}\n\n${body}` : body);
      const c = await api.comments(item.key).catch(() => ({ comments: [] }));
      return {
        notes: (c.comments || [])
          .map((x) => `## ${new Date(x.createdAt).toLocaleString("zh-CN", { hour12: false })}\n\n${x.text}`)
          .join("\n\n"),
      };
    },

    // 编辑器上的字**由源来说**：这一套界面书架也在用，写死一个具体的库名就是句假话
    edit: {
      target: editTarget,
      save: `保存到${editTarget}`,
      // ⚠️ **原来这句写的是「Notion 里删掉的块可从页面历史找回」——换 D1 之后它成了假话。**
      // 库里没有逐行的版本历史，一条 UPDATE 覆盖过去就没了。承诺「能找回」的提示，
      // 会让人放心地覆盖掉找不回来的东西，和删除按钮那条是同一个道理。
      hint: "整篇替换正文；库里没有版本历史，存下去就是覆盖",
    },

    // 编辑：标题/状态走属性接口，正文走整体替换
    async save(item, { title, markdown, fields }) {
      const props = { ...(fields || {}) };
      if (title != null && title !== item.title) props.title = title;
      if (Object.keys(props).length) await api.updateFields(key, item.key, props);
      if (markdown != null) await api.saveContent(key, item.key, markdown);
      const fresh = await api.page(item.key, key);
      return { updatedAt: fresh.meta?.editedAt || "" };
    },

    /**
     * 删除**两件事，可恢复性正好相反**，所以回执必须两件都说到
     * （`summarizeArchiveTrash` 负责后半句）：
     *
     * 1. D1 那一行**真删除，删了就没了**。Notion 时代这里是 archived:true——进废纸篓、
     *    30 天可恢复，所以按钮上写的是「移到 Notion 废纸篓」；换成 D1 之后那一层没了，
     *    关联表靠 ON DELETE CASCADE 一起清掉。
     * 2. vault 里那份归档**移进 `.trash/`，能捞回来**。由本地的
     *    `/api/pipe/delete` 做，不是 Worker——它够不着你本机。
     *
     * **按钮上的字只说第 1 件。** 要点两下的那个动作，写的必须是最不可逆的那部分；
     * 「归档能捞回来」是好消息，放回执里说。一个承诺「可恢复」的按钮，
     * 会让人放心地删掉找不回来的东西。
     */
    remove: removable ? (item) => api.removePage(key, item.key) : undefined,
    removeLabel: "永久删除",

    /**
     * 流水线源**不支持高亮**。高亮是「划在一份文件上的记号」，靠原文文本锚定，
     * 落点是 vault 里的一个同名 `.highlights.md`；库里的一行没有这样一个文件，
     * 硬做的话要么另建一张表（工作台就有状态了，违反红线），要么塞进批注（那是另一件事）。
     * 所以这里返回空——划词工具条会据此不画那个按钮，而不是画一个点了报错的按钮。
     */
    highlightPath: () => "",

    // ⚠️ 同样是换库之后成了假话的一句：批注现在写进流水线自己的 comments 表，
    // 没有第二个客户端能看到它。`annotateLabel` 的职责就是如实说明东西落在哪。
    annotateLabel: "批注存进流水线，只在这个工作台里看得到",
    sourceOf: (item) => item.raw.link || item.title,
  };
}

export const COLLECTIONS = pipelineSource({
  key: "collections",
  label: "收件箱",
  eyebrow: "inbox",
  eyebrowCn: "先收藏，后判断",
  sub: "看到有价值或喜欢的内容先放这里；默认不初筛，也不会自动变成素材。",
  pendingKey: "collectionPending",
  states: ["pending", "kept", "archived"],
  stateTabs: ["待整理", "已收藏", "已归档"],
  defaultState: "待整理",
  board: false,
  editable: true,
  editTarget: "收件箱",
  removable: true,
  emptyHint: "收件箱还是空的",
  mapItem: (p) => ({
    key: p.id,
    title: p.title || "（无标题）",
    sub: [p.type, p.source].filter(Boolean).join(" · "),
    preview: unescapeNewlines(p.note || p.selection),
    tags: p.tags,
    badge: { pending: "待整理", kept: "已收藏", archived: "已归档" }[p.reviewStatus] || p.reviewStatus,
    time: p.editedAt,
    meta: {
      类型: p.type,
      来源: p.source,
      收藏备注: p.note,
      抓取状态: { pending: "抓取中", ready: "正文已保存", failed: "抓取失败", not_needed: "无需抓取" }[p.snapshotStatus] || p.snapshotStatus,
      派生关系: [p.convertedToIdea && "已转灵感", p.materialIds?.length && `素材 ${p.materialIds.length}`, p.topicIds?.length && `选题 ${p.topicIds.length}`, p.knowledgeCardCount && `知识卡 ${p.knowledgeCardCount}`].filter(Boolean).join(" · ") || "尚未派生",
      链接: p.link,
    },
    raw: p,
  }),
});

export const INBOX = pipelineSource({
  key: "inbox",
  label: "灵感库",
  eyebrow: "ideas",
  eyebrowCn: "原始材料与想法",
  sub: "热点里收进来的、随手记下的、跟人聊出来的——先存住，等真要写的时候再回来翻。",
  pendingKey: "待初筛",
  states: ["待初筛", "待选题", "已选题", "存档备用", "已弃用", "初筛失败/需人工"],
  stateTabs: ["处理中", "已收纳", "需处理", "已弃用"],
  emptyHint: "灵感库是空的",
  mapItem: (p) => ({
    key: p.id,
    title: p.title || "（无标题）",
    sub: [p.type, p.value].filter(Boolean).join(" · "),
    preview: unescapeNewlines(p.note),
    tags: p.tags,
    badge: p.status,
    time: p.editedAt,
    meta: { 类型: p.type, 价值: p.value, 来源: p.source, 链接: p.link },
    raw: p,
  }),
});

const EVIDENCE_SENSITIVE_MATERIAL_TYPES = new Set([
  "金句/原话",
  "金句·原话",
  "数据/事实",
  "数据·事实",
]);

function relationSummary(items, ids) {
  const labels = (Array.isArray(items) ? items : [])
    .map((value) => {
      if (typeof value === "string") return value.trim();
      return String(value?.title || value?.name || "").trim();
    })
    .filter(Boolean);
  if (labels.length) return labels.join("、");
  const count = Array.isArray(ids) ? ids.filter(Boolean).length : 0;
  return count ? `${count} 条关联` : "未关联";
}

/**
 * 紧凑卡片上，核验状态该不该说出来。
 *
 * 「不适用」的完整意思是「这条不是金句/数据，无需逐字核验」——跟着字段名「核验状态」
 * 时读得懂，但在卡片上它孤零零跟在类型后面，就被读成**「这条素材不适用」**，
 * 于是「核心观点 · 不适用」和「已用 1 处」并排出现，看着自相矛盾。
 *
 * **只说「这一栏跟我无关」的值，在紧凑视图里就是噪音。** 挡路的（待核验，意味着
 * 这条进不了稿）和值得表扬的（已核验）才说。完整状态在素材详情页里带着字段名显示，
 * 那儿一个字都不省——这里省的是上下文足够、说了反而误导的那一份。
 */
export function verificationBadge(status) {
  const value = String(status || "").trim();
  return value === "待核验" || value === "已核验" ? value : "";
}

/**
 * 素材证据契约：Worker 把库里的「核验状态 / 核验说明 / 来源灵感 / 关联选题」
 * 压平成 verificationStatus / verificationNote / inspirationIds / topicIds。
 * 金句和数据缺少核验字段时一律按待核验处理，绝不把“没数据”猜成“已核验”。
 */
export function materialEvidence(item = {}) {
  const type = String(item.type || "").trim();
  const requiresVerification = EVIDENCE_SENSITIVE_MATERIAL_TYPES.has(type);
  const explicitStatus = String(item.verificationStatus || "").trim();
  // 对金句/数据，只有「已核验」能解除警告；旧数据误填「不适用」也按待核验处理。
  const status = requiresVerification && (!explicitStatus || explicitStatus === "不适用")
    ? "待核验"
    : (explicitStatus || "未记录");
  const cleared = status === "已核验";
  const note = String(item.verificationNote || "").trim();
  const sourceInspirations = relationSummary(
    item.sourceInspirations || item.inspirationTitles,
    item.inspirationIds,
  );
  const relatedTopics = relationSummary(
    item.relatedTopics || item.topicTitles,
    item.topicIds,
  );

  let warning = null;
  if (requiresVerification && !cleared) {
    const failed = /(失败|未通过|驳回)/.test(status);
    warning = {
      title: failed
        ? `${type}核验未通过，暂勿用于成稿`
        : `${type}待核验，暂勿用于成稿`,
      detail:
        note || "请先核对原文、数字和出处，再把核验状态更新为“已核验”。",
    };
  }

  return {
    requiresVerification,
    status,
    note: note || "尚无核验说明",
    sourceInspirations,
    relatedTopics,
    warning,
  };
}

export function mapMaterial(item) {
  const evidence = materialEvidence(item);
  const meta = { 类型: item.type, 出处: item.link };
  if (evidence.requiresVerification) {
    meta.核验状态 = evidence.status;
    meta.核验说明 = evidence.note;
  }
  if (Array.isArray(item.inspirations) && item.inspirations.length) meta.来源灵感 = relationSummary(item.inspirations, item.inspirationIds);
  if (Array.isArray(item.topics) && item.topics.length) meta.关联选题 = relationSummary(item.topics, item.topicIds);
  if (item.feedbackTypes?.length) meta.反馈类型 = item.feedbackTypes;
  if (item.performanceBasis) meta.表现依据 = item.performanceBasis;
  return {
    key: item.id,
    title: item.title || "（无标题）",
    sub: item.type,
    preview: unescapeNewlines(item.note),
    tags: item.tags,
    badge: evidence.requiresVerification ? evidence.status : "",
    time: item.editedAt,
    warning: evidence.warning,
    meta,
    raw: item,
  };
}

export const MATERIALS = pipelineSource({
  key: "materials",
  label: "素材库",
  eyebrow: "materials",
  eyebrowCn: "拆好的可复用零件",
  sub: "初筛拆出来的素材卡，成稿时按标签被自动检索到。",
  facet: {
    key: "type",
    label: "分类",
    groups: [
      { label: "观点类", values: ["核心观点", "反直觉点", "内容角度"] },
      { label: "证据类", values: ["金句/原话", "数据/事实", "平台反馈"] },
      { label: "故事类", values: ["案例/故事", "个人经历"] },
      { label: "方法类", values: ["框架/模型", "标题样本"] },
      { label: "其他类", values: ["延展问题"] },
    ],
  },
  emptyHint: "素材库还是空的",
  mapItem: mapMaterial,
});

export const TOPICS = pipelineSource({
  key: "topics",
  label: "选题库",
  eyebrow: "topics",
  eyebrowCn: "准备要写的东西",
  sub: "改成「撰写中」就开始成稿——先选一个主平台，只生成一个版本。",
  pendingKey: "选题待写",
  /**
   * ⚠️ 这几个字符串必须和库里的**状态取值逐字一致**，一个字都不能差，对不上就是 400。
   *
   * **真源是 `worker/schema.sql` 里 topics.status 的 CHECK 约束，直接去那儿看。**
   * （Notion 时代要靠故意传一个非法状态、从报错的 `Available options` 里读出来——
   * 那套反查手法连同 Notion 一起退役了，别再照着做。「搁置」原来叫「搬置」，
   * 改完旧名就摘掉了，别再往回加。）
   */
  states: ["待写", "撰写中", "已成稿", "已发布", "搁置"],
  // 改成这个状态之前先问主平台：一进「撰写中」，Worker 五分钟内就会生成主稿。
  askPlatformsOn: "撰写中",
  /**
   * 「搁置」是流水线的**异常落点**，不是工作流的一站：`draft.js` 在所有平台都生成失败时
   * 把选题丢到这里并在页里写明原因，等人来看。
   *
   * 所以它不该在看板上常年占一列——正常情况下那一列永远是空的，白占五分之一的宽度。
   * 空的时候藏起来，一旦真有东西掉进去就自己冒出来。**不能直接删掉**：删了的话
   * 成稿失败的选题会从看板上凭空消失，那才是真的坑。
   */
  quietStates: ["搁置"],
  /**
   * 进选题这一页**默认只看「待写」**。
   *
   * 这一库里绝大多数条目是已成稿和已发布的历史——它们已经流走了，翻它们是偶尔的事；
   * 而打开这一页的意图基本只有一个：**看接下来要写什么**。默认给全部，等于每次都要
   * 自己点一下「待写」才开始干活。
   *
   * 落地是**跳转时把状态写进 URL**（`#/topics/待写`），不是在页面里偷偷过滤：
   * 那样筛选条上没有任何一项是选中的，用户看不出自己正在被过滤，也点不回「全部」。
   */
  defaultState: "待写",
  emptyHint: "还没有选题",
  mapItem: (p) => ({
    key: p.id,
    title: p.title || "（无标题）",
    sub: [p.priority && `优先级${p.priority}`, p.platforms?.join("/")].filter(Boolean).join(" · "),
    preview: unescapeNewlines(p.note),
    tags: p.platforms,
    badge: p.status,
    time: p.editedAt,
    /**
     * 顺序**就是屏幕上的顺序**（`Object.entries` 按插入序）。短的排前面：
     * 优先级和平台都是一两个词，目标读者是整句话——把长的夹在中间，后面那项
     * 会被挤到第二行，一行看着像两行。
     */
    meta: { 优先级: p.priority, 适配平台: p.platforms, 目标读者: p.audience },
    raw: p,
  }),
});

export const DRAFTS = pipelineSource({
  key: "drafts",
  label: "稿件库",
  eyebrow: "drafts",
  eyebrowCn: "初稿与已发布作品",
  sub: "先完成主平台稿件；发布时记录链接和表现，系统会把有效经验沉淀回素材库。",
  pendingKey: "内容待修改",
  states: ["待修改", "待发布", "已发布", "已弃用"],
  /**
   * 按平台分面：一个选题会成好几篇稿，混在一起看不出「公众号那篇改完没有」。
   *
   * `all` 给一份**权威名单**，于是没有稿子的平台也列出来（计数 0）。
   * 只按已加载条目现算的话，下拉里只有已经写过的那几个平台——**你分不清
   * 「小红书 0 篇」和「小红书不存在」**，而前者才是这一刻你想知道的事。
   * 这里写死不违反「选项从真实数据里现算」那条：`PLATFORMS` 本来就是整套系统的单一真源
   * （必须和 content-pipeline 的 draft.js 逐字一致），不是为这个下拉另抄的一张表。
   * 素材库的「类型」没有这样一份名单（库里随时会多出新类型），所以那边照旧现算。
   */
  facet: { key: "platform", label: "平台", all: PLATFORMS },
  quietStates: ["已弃用"],
  emptyHint: "还没有稿子",
  mapItem: (p) => ({
    key: p.id,
    title: p.title || "（无标题）",
    // 副标题**留空**：平台已经在底部的标签里了，同一张卡上下各写一遍是重复。
    // 留空而不是不渲染——那一行有 min-height，撑着卡片行行对齐（见 .wall-card__sub）。
    // 稿件条目上除了平台只有 topicIds（一串 UUID），铺出来是噪音，所以这里没有别的可填。
    sub: "",
    preview: stripLegacyDraftWarnings(unescapeNewlines(p.note)),
    tags: p.platform ? [p.platform] : [],
    badge: p.status,
    time: p.editedAt,
    meta: {
      平台: p.platform,
      发布链接: p.publishedUrl,
      发布时间: p.publishedAt,
      表现判断: p.feedbackStatus,
      表现摘要: p.performanceSummary,
    },
    raw: p,
  }),
});

/**
 * 稿件删除响应契约（由 Worker 在归档稿件后返回）：
 * - affectedTopicIds: 受影响的父选题 ID
 * - reconciled: 是否已完成关系与状态校正
 * - reconcileTopics: 校正后的父选题摘要，可含 id/title/status
 *
 * 旧 Worker 没有这些字段时明确报“尚未校正”，不能让界面假装清理完整。
 */
export function summarizeDraftReconcile(result = {}) {
  const topicIds = Array.isArray(result.affectedTopicIds)
    ? result.affectedTopicIds.filter(Boolean)
    : [];
  const hasTopicSummaries = Array.isArray(result.reconcileTopics);
  const topics = hasTopicSummaries ? result.reconcileTopics : [];
  const reconciled =
    result.reconciled === true ||
    (result.reconciled == null && hasTopicSummaries);
  if (!reconciled) {
    return {
      ready: false,
      topicIds,
      topics,
      text: "父选题尚未校正：流水线 Worker 未确认 reconcile 结果",
    };
  }
  if (!topicIds.length && !topics.length) {
    return {
      ready: true,
      topicIds,
      topics,
      text: "没有关联父选题需要校正",
    };
  }

  const labels = topics
    .map((topic) => {
      const name = String(topic?.title || topic?.name || topic?.id || "").trim();
      const status = String(topic?.status || "").trim();
      return status ? `${name}（${status}）` : name;
    })
    .filter(Boolean);
  const count = new Set([
    ...topicIds,
    ...topics.map((topic) => topic?.id).filter(Boolean),
  ]).size;
  return {
    ready: true,
    topicIds,
    topics,
    text: labels.length
      ? `父选题已重新计算：${labels.join("、")}`
      : `已重新计算 ${count} 个父选题`,
  };
}

/**
 * 归档清理结果 → 回执上的**第二句**（`archive` 字段由本地 `/api/pipe/delete` 补上）。
 *
 * **删除是两件事**：D1 那一行永久删除（不可恢复），vault 里那份归档移进 `.trash/`
 *（可恢复）。回执必须把两件都说到——只说前半句，用户会以为 Obsidian 里还留着一份；
 * 只说后半句，又会以为整件事都能捞回来。
 *
 * ⚠️ **回的是独立一句，不是拿分号接在主句屁股后面。** 接成一句的结果是一条
 * 六十多字、在回执条里折成两行的长句，两件可恢复性相反的事糊在一起，
 * 读的人得自己找断点。`Toast` 的 `detail` 槽会把它排成一行淡色小字。
 *
 * ⚠️ **`none` 回空串，不回「没有归档」。** 绝大多数条目本来就没归档过
 * （`vault_path` 为空），每次删都附一句「没有归档要清理」是**每个都说的话，
 * 等于没说**——和信源芯片上不写「已刷新」是同一条。
 *
 * ⚠️ **`failed` 必须带下一步。** 这是唯一一种「屏幕上不说就永远没人知道」的情况：
 * 孤儿文件会一直攒着，而下次你数 Obsidian 里的文件时又对不上了。
 */
export function summarizeArchiveTrash(archive) {
  const status = archive?.status;
  if (status === "trashed") return "Obsidian 里的归档已移进 .trash，能捞回来";
  if (status === "missing") return "Obsidian 里那份归档早就不在了";
  if (status === "failed") {
    return `Obsidian 里的归档没能清掉（${archive.error}），${archive.hint || "去 Obsidian 里手动删掉"}`;
  }
  // none，以及旧 Worker 不回 vaultPath 时的 undefined，都保持安静
  return "";
}

// ---- vault 里的两个源 ------------------------------------------------------

/**
 * 正文开头那句和标题一模一样的话，去掉。
 *
 * 两处都会重复：章节文件的第一行是导入时写的 `# 章名`，而 epub 正文里往往**还有**
 * 一行同样的标题（原书的版式）。阅读区上面又画了一遍标题，不去掉就是同一句话连着出现三次。
 *
 * 比较时把空白全抹掉再比：书里的标题常用全角空格（`推荐序二　一场…`），
 * 文件名那边已经被 `safeName` 折成半角空格，逐字比永远对不上。
 * **只看开头连着的两行、只删完全相同的**——差一个字就留着，那多半是真的小标题。
 */
function stripLeadingTitle(text, title) {
  const key = String(title || "").replace(/\s+/g, "");
  if (!key) return text;
  let s = String(text || "").replace(/^\s+/, "");
  for (let i = 0; i < 2; i++) {
    const m = s.match(/^(#{1,6}\s+)?(.+?)\s*(?:\n|$)/);
    if (!m || m[2].replace(/\s+/g, "") !== key) break;
    s = s.slice(m[0].length).replace(/^\s+/, "");
  }
  return s;
}

export const SHELF = {
  key: "shelf",
  label: "书架",
  eyebrow: "shelf",
  eyebrowCn: "读过和在读的",
  sub: "读书笔记与批注，正文和批注都在 Obsidian 里",
  emptyHint: "书架还是空的",
  states: [],
  kind: "vault",

  async list() {
    const r = await api.books();
    return {
      exists: r.exists,
      shelfDir: r.shelfDir,
      items: r.books.map((b) => ({
        key: b.dir,
        title: b.name,
        sub: [b.author, b.status].filter(Boolean).join(" · "),
        preview: b.excerpt || "",
        tags: b.tags,
        badge: b.status,
        time: null,
        meta: { 作者: b.author, 状态: b.status },
        raw: b,
      })),
    };
  },

  /**
   * 读一本书的某一份文档。
   *
   * `docPath` 指向真正要读的那个 md——多章书是某一章，单文件书就是 book.md。
   * 批注**始终写同一本书的 notes.md**，不按章分文件：读一本书时的想法常常是跨章的，
   * 拆成 59 个 notes 文件之后，回头再想找那句话根本无从找起。
   */
  async load(item) {
    const r = await api.vaultDoc(item.raw.docPath || item.raw.bookPath, item.raw.notePath);
    return {
      title: item.title,
      // 章节文件的第一行就是 `# 章名`，阅读区上面又画了一遍标题——不去掉就是同一句话连着出现两次
      content: stripLeadingTitle(r.content, item.title),
      /**
       * **编辑器改的是原文，不是上面那份去掉标题的。**
       *
       * `content` 是给「看」的（掐掉了和大标题重复的那一行），拿它当草稿存回去，
       * 文件里的 `# 章名` 就被安静地删掉了——下次再打开，正文第一行成了正文本身。
       */
      markdown: r.content,
      stamp: r.stamp,
      /**
       * **只有「资料」能改，「藏书」只读。**
       *
       * 分界不是文件格式，是「这是谁写的字」：资料是自己攒的，不能改反而是残废的；
       * 藏书是别人写的，改了之后从它摘的每一句引用都不再可信。
       * 只读时**不画那个按钮**（不是画一个点了报错的），要改就去书详情把类型翻过来
       * ——多两步，而那正是想要的摩擦：改原著该是个明确的决定，不是顺手。
       */
      editable: item.raw.kind !== "藏书",
      // 标题在这儿就是文件名，而文件名同时是阅读进度、高亮伴生文件和 Obsidian
      // 双链的锚点。改名要一起搬这四样，不是一个「顺手改一下」的动作
      editTitle: false,
      notes: r.notes,
      // 切成一条条的（服务端切好），界面才能给每条配「改」和「删」。
      // 认不出格式（用户自己在 Obsidian 里改成了别的写法）时是空数组，界面退回只读。
      noteItems: r.noteItems || [],
      meta: r.meta,
      format: "markdown",
    };
  },

  async annotate(item, { quote, body }) {
    const r = await api.vaultNote({ path: item.raw.notePath, quote, body, source: `[[${item.raw.bookPath}]]` });
    return { notes: r.notes, noteItems: r.noteItems || [] };
  },

  /**
   * 改正文。**书架里的书就是 vault 里的 md，本来就该能改**——自己收集整理的资料
   * 需要边读边补，而「去 Obsidian 里改」意味着离开正在读的这一屏、在另一个应用里
   * 找到同一个文件、改完再回来刷新。
   *
   * 只传正文：frontmatter 由服务端原样接回去，前端碰都不碰。
   */
  async save(item, { markdown, stamp }) {
    return api.saveVaultDoc(item.raw.docPath || item.raw.bookPath, markdown, stamp);
  },
  edit: {
    target: "VAULT",
    save: "保存到 vault",
    // 说清两件用户看不见但会中招的事：这就是 Obsidian 里那个文件；高亮锚的是原文文本
    hint: "直接写回这份 md，Obsidian 里立刻就是新的；改过的句子上原有的高亮会对不上",
  },

  // 批注能不能就地改/删，取决于这个源的批注是不是 vault 里的一份 Markdown。
  // 流水线源的批注是库里的一行，Worker 侧只开了写和读两个端点，所以那边不给这两个口子。
  notePath: (item) => item.raw.notePath || "",

  annotateLabel: "批注追加到 notes.md，Obsidian 里能直接搜到",
  sourceOf: (item) => `《${item.title}》`,
  // 高亮跟着**这一章**走（不同章各有各的记号），文件名挨着正文放
  highlightPath: (item) => (item.raw.docPath || item.raw.bookPath || "").replace(/\.md$/i, ".highlights.md"),
};

// 书架能吃哪些文件。**和 server/lib/books.mjs 的 SUPPORTED 保持一致**——
// 这里放宽了，服务端会拒；这里收窄了，用户压根选不到那个文件。
export const SUPPORTED_BOOKS = [".md", ".markdown", ".txt", ".epub", ".pdf"];

export const INSIGHTS = {
  key: "insights",
  label: "洞察",
  eyebrow: "insights",
  eyebrowCn: "按需生成的研究报告",
  sub: "按需生成的社媒风向研究报告",
  emptyHint: "还没有洞察报告",
  states: [],
  kind: "vault",

  /**
   * 走 `/api/vault/insights` 而不是通用的 vaultTree。
   *
   * tree 只回文件名，于是卡片上除了标题什么都没有——**一张只有标题的卡和一行列表没区别，
   * 卡片墙就白做了**。摘要、覆盖周期、字数、洞察卡张数都要读文件才有，所以那一步放服务端。
   *
   * 顺带修掉一个安静的 bug：tree 那版没排掉伴生文件，给报告写下第一条批注之后
   * （落 `<同名>.notes.md`），列表里会凭空多出一张卡。
   */
  async list() {
    const r = await api.vaultInsights().catch(() => null);
    // `dir` 即使在目录还不存在时也要带出去：空态那段引导要照实说报告会落在哪。
    if (!r?.exists) return { exists: false, items: [], dir: r?.dir || "" };
    return {
      exists: true,
      dir: r.dir,
      items: r.reports.map((f) => ({
        key: f.path,
        title: f.title,
        // 顶栏面包屑要短。不给的话它会一路退到 `sub`，于是那儿显示的是
        // 「覆盖 2026-08-05 — 2026-08-12」一整条日期区间——面包屑是「我在哪」，不是元信息。
        crumb: f.week,
        // 覆盖周期比生成时间有用得多：报告答的是「那一周发生了什么」。
        // 抓不到就退回生成日期，**不猜**——猜错的周期比没有周期更糟。
        sub: f.period ? `覆盖 ${f.period}` : f.generatedAt ? `生成于 ${f.generatedAt.slice(0, 10)}` : "",
        preview: f.preview,
        // 三个标签回答扫卡片时的三个问题：值不值得点、要读多久、有几条结论
        tags: [
          f.cards ? `${f.cards} 张洞察卡` : "",
          readStats(f.chars) ? `${f.chars.toLocaleString()} 字` : "",
          readStats(f.chars) ? `约 ${readStats(f.chars).minutes} 分钟` : "",
        ].filter(Boolean),
        badge: "",
        time: f.generatedAt || null,
        meta: {},
        raw: f,
      })),
    };
  },

  async load(item) {
    const r = await api.vaultDoc(item.key, item.key.replace(/\.md$/i, ".notes.md"));
    // 报告第一行永远是 `# <周次> 个人情报周报`，而阅读区自己已经画了一个大标题
    // （文件名「2026-W33-社媒洞察」）。两个说同一件事的标题连着出现，第一屏就废掉一半。
    // 不能复用书架那个 `stripLeadingTitle`：它按**文字相等**判断，而这两个标题
    // 说的是一回事、写法不一样。这里的 H1 是本 skill 自己生成的，形态固定，所以直接掐掉。
    // 用 `[^\n]*` 而不是 `.+?`：**JS 的 `.` 不匹配 `\r`**，而 vault 里的文件可能是
    // CRLF（Windows 上随手用 Python 改一次就变了）。写成 `.+?(?:\n|$)` 的话，
    // 它会停在 `\r` 前面、等一个等不到的 `\n`，于是整条静默失配——
    // 不报错，只是标题照旧出现两次。
    const content = String(r.content || "").replace(/^\s*#[^\n]*\s*/, "");
    return { title: item.title, content, notes: r.notes, meta: r.meta, format: "markdown" };
  },

  async annotate(item, { quote, body }) {
    const r = await api.vaultNote({
      path: item.key.replace(/\.md$/i, ".notes.md"),
      quote,
      body,
      source: `[[${item.key}]]`,
    });
    return { notes: r.notes };
  },

  annotateLabel: "批注写进同名的 .notes.md（报告重跑不会覆盖它）",
  sourceOf: (item) => item.title,
  highlightPath: (item) => item.key.replace(/\.md$/i, ".highlights.md"),
};

// 流水线四段的顺序 = tab 的顺序 = 东西流动的方向。别乱改。
export const PIPELINE = ["collections", "inbox", "materials", "topics", "drafts"];


export const SOURCES = {
  collections: COLLECTIONS,
  inbox: INBOX,
  materials: MATERIALS,
  shelf: SHELF,
  insights: INSIGHTS,
  topics: TOPICS,
  drafts: DRAFTS,
};
