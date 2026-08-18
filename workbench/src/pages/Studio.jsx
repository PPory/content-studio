// 内容工作台：一个页面吃掉整条流水线（灵感库 → 素材库 → 选题库 → 稿件库），洞察也共用它。
//
// 三层导航，各司其职：
//   **卡片墙**  「有什么」。一眼扫十几条，搜索/筛状态/翻页都在这一层。
//   **看板**    「卡在哪一步」。一列一个状态，拖一张卡就换状态。
//   **阅读区**  「细看这一条」。点开一张卡才进来，正文 + 批注台 + 编辑/排版/封面/删除。
//
// 为什么不是「左列表 + 正文」的三栏常驻：那种布局逼你每看一条点一次，而且列表列
// 永远只能显示标题。卡片墙能显示摘要和标签，扫的效率高一个量级；真要细读时，
// 阅读区又能吃满整屏。**浏览和精读是两件事，不该挤在同一屏。**
//
// 四个流水线库共用这一个页面，差异全在 lib/sources.js 的适配器里。加新的可读源
// 只写适配器，不要动这个文件。书架不走这里——它有自己的三层动线（见 pages/Shelf.jsx）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SOURCES, PIPELINE, summarizeDraftReconcile, summarizeArchiveTrash } from "../lib/sources.js";
import { api } from "../lib/api.js";
import { contextOf } from "../lib/reading.js";
import { noteOpened } from "../lib/recent.js";
import { setOpenTarget, takeOpenTarget } from "../lib/open-target.js";
import { useAiRuns } from "../lib/use-ai-runs.js";
import { agentName } from "../lib/chat-agent.js";
import { useDocChat } from "../lib/use-doc-chat.js";
import { ReaderOverlay, DraftLinks } from "../components/ReaderOverlay.jsx";
import { ACTIONS } from "../components/Reader.jsx";
import { PlatformGate } from "../components/PlatformGate.jsx";
import { PublishPanel } from "../components/PublishPanel.jsx";
import { MaterialVerificationPanel } from "../components/MaterialVerificationPanel.jsx";
import { CreationDialog } from "../components/CreationDialog.jsx";
import { CollectionActions, CollectionOrganizer } from "../components/CollectionOrganizer.jsx";
import { IconPlus } from "../components/icons.jsx";
// 展示件搬进 pages/studio/。**页面只留组合和状态边界。**
// 这三样搬走之后，`Board` / `Empty` / `Select` / 那一排图标也跟着不在这儿用了——
// 死 import 留着不报错，但它会让人以为这个文件还在管那些事。
import { ListHead } from "./studio/ListHead.jsx";
import { FilterBar } from "./studio/FilterBar.jsx";
import { DocList } from "./studio/DocList.jsx";
import { PageHeader, Toast } from "../components/ui.jsx";
import { InsightRunButton, InsightRunProgress, useInsightRun } from "../components/InsightRun.jsx";

// 流水线源的划词动作 = 全套减去「高亮」。高亮靠原文文本锚在一个 .highlights.md 上，
// 而库里的一行没有那个文件（见 sources.js 的 highlightPath）。
const PIPELINE_ACTIONS = ACTIONS.filter((a) => a.key !== "highlight");

export function Studio({ sourceKey, state, onState, onGo, onIntake, onChanged, counts, refreshKey = 0 }) {
  const source = SOURCES[sourceKey];

  const [list, setList] = useState(null);
  const [searchList, setSearchList] = useState(null);
  const [listError, setListError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [facet, setFacet] = useState("");   // 分面筛选（素材库按类型、稿件库按平台），在已加载的条目里筛
  const [layout, setLayout] = useState("wall"); // wall | board

  const [active, setActive] = useState(null);
  const [doc, setDoc] = useState(null);
  const [docError, setDocError] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [drafts, setDrafts] = useState(null);  // 选题的成稿去向

  const [gate, setGate] = useState(null);   // { item, next } 等待选平台
  const [toast, setToast] = useState(null); // { text, undo? }
  const [creation, setCreation] = useState(null); // choose | topic | blank
  const [organizerItems, setOrganizerItems] = useState(null);

  const [railMode, setRailMode] = useState("notes");
  const [outline, setOutline] = useState([]);   // 正文的小标题，画在阅读区左栏
  const [quote, setQuote] = useState("");
  /**
   * 和 agent 聊这一篇。**和书架共用 `useDocChat`**——合并之前两边各一份 66 行，
   * 逐行只差两行（标题和路径从哪儿取）。
   */
  const { chat, chatAgent, sendChat, switchAgent, newChat, stopChat } = useDocChat({
    docTitle: active?.title || "",
    docPath: active?.raw?.bookPath || active?.key || "",
  });
  const searchRef = useRef(null);

  // 划词 AI 那一套（攒结果、中止、翻译）三处共用一个 hook，见 lib/use-ai-runs.js
  const { ai, runAi, translate, stopAi, resetAi } = useAiRuns({
    title: active?.title || "",
    onStart: useCallback((text) => {
      setQuote(text);
      setRailMode("ai");
    }, []),
  });

  const reload = useCallback(() => {
    setList(null);
    setSearchList(null);
    setListError(null);
    source.list({ state }).then(setList).catch(setListError);
  }, [source, state]);

  // 换源或换筛选：一切归零。不清的话会出现「上一个源的批注挂在这条上」这种串台。
  useEffect(() => {
    setActive(null);
    setDoc(null);
    resetAi();
    setQuery("");
    setFacet("");
    setRailMode("notes");
    newChat();   // 换源：掐掉在跑的、清会话号、清消息
    reload();
  }, [reload, resetAi]);

  useEffect(() => {
    if (refreshKey > 0) reload();
  }, [refreshKey, reload]);

  // 输入停顿后走 Worker 全库检索，不再只筛当前已经加载的 30 条。
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchList(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      source.search({ q, state })
        .then((result) => !cancelled && setSearchList(result))
        .catch((error) => !cancelled && setListError(error));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, source, state]);

  // **默认一律卡片墙。** 看板回答的是「卡在哪一步」，那是偶尔要问一次的问题；
  // 日常打开这几个库是来找内容的，卡片墙带摘要和标签，信息密度高一个量级。
  // 默认给看板等于每次进来都先看一屏标题。
  useEffect(() => {
    setLayout("wall");
  }, [source]);

  const openItem = useCallback(
    (item) => {
      setActive(item);
      // 记一条「最近打开」，Ctrl+K 的空态靠它回答「我上次在看什么」。
      // 存的是**动作**（回到哪个库的哪一档）不是位置——只存标题的话，
      // 点回去还得自己想它在哪个页面，那就等于没记。
      noteOpened({
        id: `${sourceKey}:${item.key}`,
        type: sourceKey,
        typeLabel: source.label,
        title: item.title,
        source: item.sub || "",
        // **`open` 不能漏。** 只写 `{view, state}` 的话，这条「最近打开」点回去
        // 只是跳到那个库的列表——而这一行的全部意思就是「回到我刚才在看的那一篇」。
        // 检索结果那条路早就带上了 `open`，这条当时漏了，现象一模一样：点了像没反应。
        go: { view: sourceKey, state: item.raw?.status || "", open: item.key },
      });
      setDoc(null);
      setDrafts(null);
      setOutline([]);
      setDocError(null);
      setDocLoading(true);
      resetAi();
      setRailMode("notes");
      newChat();   // 换一篇：不清的话上一条的对话会挂在这一条上
      source.load(item).then(setDoc).catch(setDocError).finally(() => setDocLoading(false));
      // 选题：顺带把「这题写出来的稿子在哪」查出来。查不到就不显示，不该报错
      if (sourceKey === "topics" && item.raw?.draftIds?.length) {
        api.draftsOf(item.key).then((r) => setDrafts(r.items || [])).catch(() => setDrafts(null));
      }
    },
    [source, sourceKey, resetAi]
  );

  /**
   * 从全局检索跳进来时，把那一条直接打开。
   *
   * **等列表加载完再取**：那张交接条上只有 key，正文要靠列表里那条 item 的
   * `raw`（元信息、状态、出处）才装得起来。取不到就什么都不做——检索跳过来时
   * 带的是这一条自己的状态，所以它基本一定在这一档的第一页里；万一不在
   * （改过状态、或者被挤到第二页），**退化成「停在这张过滤好的列表上」**，
   * 而不是弹一个空的阅读区。
   *
   * **一次性**（`takeOpenTarget` 取完即清）：不清的话，这一页因为回写状态、
   * 刷新列表重新加载时会又把它打开一遍，关掉它会立刻被弹回来。
   */
  useEffect(() => {
    if (!list?.items?.length) return;
    const want = takeOpenTarget(sourceKey);
    if (!want) return;
    const hit = list.items.find((it) => it.key === want);
    if (hit) openItem(hit);
  }, [list, sourceKey, openItem]);


  const closeItem = useCallback(() => {
    resetAi();
    stopChat();
    setActive(null);
    setDoc(null);
  }, [resetAi]);

  const shown = useMemo(() => {
    let items = (query.trim() ? searchList : list)?.items || [];
    if (facet && source.facet) {
      const group = source.facet.groups?.find((entry) => entry.label === facet);
      items = items.filter((it) => group ? group.values.includes(it.raw?.[source.facet.key]) : it.raw?.[source.facet.key] === facet);
    }
    const q = query.trim().toLowerCase();
    if (!q || searchList) return items;
    return items.filter((it) =>
      [it.title, it.sub, it.preview, ...(it.tags || [])].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [list, searchList, query, facet, source]);

  // 分面的选项从**已加载的条目里现算**，不写死一张表：库里的取值随时可能加，
  // 写死的话新增一个类型就会在界面上凭空消失。
  /**
   * 分面选项 = 计数 + 顺序。
   *
   * **有权威名单（`facet.all`）时列全，没有时从数据现算。** 稿件库属于前者：只列已加载条目里
   * 出现过的平台，你就分不清「小红书 0 篇」和「小红书不存在」，而前者才是这一刻想知道的事。
   * 素材库属于后者——「类型」的取值在库里随时会加，写死一张表的话新类型会凭空消失。
   *
   * 名单之外**真实出现过的值也要带上**（`extra`）：手填错一个平台名时，
   * 那几条稿子仍然筛得到；悄悄藏掉才是真的坑。
   */
  const facetOptions = useMemo(() => {
    if (!source.facet) return [];
    const items = (query.trim() ? searchList : list)?.items || [];
    if (source.facet.groups) {
      return source.facet.groups
        .map((group) => [group.label, items.filter((it) => group.values.includes(it.raw?.[source.facet.key])).length])
        .filter(([, count]) => count > 0);
    }
    const counts = new Map();
    for (const it of items) {
      const v = it.raw?.[source.facet.key];
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    }
    const all = source.facet.all;
    if (!all?.length) return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const extra = [...counts.keys()].filter((v) => !all.includes(v));
    return [...all, ...extra].map((v) => [v, counts.get(v) || 0]);
  }, [list, searchList, query, source]);

  /**
   * 分面做成**一个下拉**，不是第二排芯片。
   *
   * 两排芯片摞在一起时，第一眼分不出「上面那排是状态、下面那排是平台」——它们长得一模一样，
   * 而且第二排会随平台数量变长，把整个卡片墙往下顶。收成一个下拉之后筛选条只有一行，
   * 而且「现在按哪个平台在看」直接写在按钮上，比在一排芯片里找哪个是选中的更快。
   *
   * 选项标签带计数（`公众号 2`），所以要在**同一个数组里**同时算出标签和值——
   * 各拼一次的话，平台名里只要有个空格，回读就会对不上。
   */
  const facetPick = useMemo(() => {
    if (!source.facet || facetOptions.length < 2) return null;
    const all = `全部${source.facet.label}`;
    const rows = facetOptions.map(([value, n]) => ({ value, label: `${value} ${n}` }));
    return { all, rows, options: [all, ...rows.map((r) => r.label)] };
  }, [source.facet, facetOptions]);

  async function loadMore() {
    if (!list?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await source.list({ state, cursor: list.nextCursor });
      setList((l) => ({ ...more, items: [...l.items, ...more.items] }));
    } catch (e) {
      setListError(e);
    } finally {
      setLoadingMore(false);
    }
  }

  // 键盘：卡片墙上 / 聚焦搜索；阅读区里 j/k 上下切换、Esc 返回。
  // 两层各有各的键位，不会打架。
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!active) {
        if (e.key === "/") {
          e.preventDefault();
          searchRef.current?.focus();
        }
        return;
      }
      if (e.key === "Escape") return closeItem();
      if (!"jk".includes(e.key) || !shown.length) return;
      e.preventDefault();
      const i = shown.findIndex((it) => it.key === active.key);
      const next = e.key === "j" ? Math.min(i + 1, shown.length - 1) : Math.max(i - 1, 0);
      openItem(shown[i === -1 ? 0 : next]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, active, openItem, closeItem]);

  // ---- 状态流转 -------------------------------------------------------------

  // 就地改一条的状态，不整页重载——重载会丢滚动位置，而且拖完卡要等两秒才动很难受
  const patchItem = useCallback((key, patch) => {
    setList((l) => (l ? { ...l, items: l.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) } : l));
    setActive((a) => (a && a.key === key ? { ...a, ...patch } : a));
  }, []);

  const applyStatus = useCallback(
    async (item, next, { undoTo } = {}) => {
      const prev = item.badge;
      await source.save(item, { fields: { status: next } });
      patchItem(item.key, { badge: next, raw: { ...item.raw, status: next } });
      setDoc((d) => (d && active?.key === item.key ? { ...d, status: next } : d));
      if (undoTo) {
        setToast({
          text: `《${item.title}》→ ${next}`,
          undo: async () => {
            await source.save(item, { fields: { status: undoTo } });
            patchItem(item.key, { badge: undoTo, raw: { ...item.raw, status: undoTo } });
            setToast(null);
          },
        });
      }
    },
    [source, patchItem, active]
  );

  /**
   * 拖卡换列 / 下拉改状态的统一入口。
   * 「撰写中」不直接改——它会真的开始烧 token，先弹平台选择（见 PlatformGate）。
   */
  const changeStatus = useCallback(
    async (item, next) => {
      if (sourceKey === "drafts" && next === "已发布") {
        setToast({ text: "请在稿件详情里用“记录发布”，链接、时间和数据会一起进入复盘。" });
        return;
      }
      if (next === source.askPlatformsOn) return setGate({ item, next });
      await applyStatus(item, next, { undoTo: item.badge });
    },
    [source, sourceKey, applyStatus]
  );

  // 平台闸门确认：**先写平台，再改状态**。反过来的话 Worker 可能在平台还没写进去时
  // 就把这条选题领走了，结果按旧的勾选成稿。
  const confirmGate = useCallback(
    async (platforms) => {
      const { item, next } = gate;
      await source.save(item, { fields: { platforms } });
      patchItem(item.key, { tags: platforms, raw: { ...item.raw, platforms } });
      await applyStatus(item, next);
      setGate(null);
      setToast({ text: `《${item.title}》开始撰写：${platforms.join("、")}。成稿任务每 5 分钟轮询一次。` });
    },
    [gate, source, applyStatus, patchItem]
  );

  const removeItem = useCallback(
    async (item) => {
      const result = await source.remove(item);
      setList((l) => (l ? { ...l, items: l.items.filter((it) => it.key !== item.key) } : l));
      if (active?.key === item.key) closeItem();
      let reconcileText = "";
      if (sourceKey === "drafts") {
        const reconcile = summarizeDraftReconcile(result);
        reconcileText = `；${reconcile.text}`;
        // Worker 完成父选题关系/状态校正后，重新取一次流水线计数。
        // 旧 Worker 没返回契约时也刷新，但提示会明确告诉用户尚未确认校正。
        onChanged?.({ sourceKey, item, result, reconcile });
      } else {
        onChanged?.({ sourceKey, item, result });
      }
      setToast({
        text: `《${item.title}》已永久删除${reconcileText}`,
        detail: summarizeArchiveTrash(result?.archive),
      });
    },
    [source, sourceKey, active, closeItem, onChanged]
  );

  // toast 自己消失。带撤销的多留一会儿——2 秒读不完一句话，更别说做决定
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- AI / 批注 ------------------------------------------------------------


  const onSelect = useCallback(
    ({ action, text, context }) => {
      if (action === "annotate") {
        setQuote(text);
        setRailMode("annotate");
      } else if (action === "translate") {
        translate(text);
      } else if (action === "chat") {
        // 划一段直接扔进对话，不用自己再复制粘贴一遍
        setRailMode("chat");
        sendChat(`就这一段说说你的看法：\n\n> ${text.slice(0, 1200)}`);
      } else if (action === "intake") {
        onIntake({ content: text, source: source.sourceOf(active) });
      } else {
        runAi(action, text, context);
      }
    },
    [active, onIntake, runAi, source, translate, sendChat]
  );

  const saveNote = useCallback(
    async ({ quote: q, body }) => {
      const r = await source.annotate(active, { quote: q, body });
      setDoc((d) => (d ? { ...d, notes: r.notes ?? d.notes } : d));
      setRailMode("notes");
    },
    [active, source]
  );

  /**
   * 在右栏里划词（AI 的回答、对话上）。三个去处，和正文那八个不是一套：
   * 解释/展开/反驳在 AI 自己的输出上再来一遍是套娃，高亮更没有落点。
   *
   * ⚠️ 必须定义在 `saveNote` **后面**：useCallback 的依赖数组是当场求值的，
   * 写在前面就是 TDZ 崩溃（这个坑在这两个页面上各踩过一次）。
   */
  const onRailSelect = useCallback(
    ({ action, text }) => {
      if (action === "选题") {
        // 从 AI 输出里划一段生成选题。**不传 context**——contextOf 是在正文里找上下文的，
        // 而这段话不在正文里，传了只会给出一段不相干的原文。选中的这段本身就够了。
        runAi("选题", text);
      } else if (action === "intake") {
        onIntake({ content: text, source: source.sourceOf(active) });
      } else if (action === "note") {
        saveNote({ quote: "", body: text }).then(() => setToast({ text: "已写进批注" }));
      } else if (action === "copy") {
        navigator.clipboard?.writeText(text).then(
          () => setToast({ text: "复制好了" }),
          () => setToast({ text: "复制失败，手动选中拷一下吧" })
        );
      }
    },
    [active, onIntake, source, saveNote, runAi]
  );

  // 存哪一段是分开的决定，所以收的是「那一条结果」而不是「当前这条」
  const saveAiAsNote = useCallback(
    async (r) => {
      if (!r?.text) return;
      await saveNote({ quote: ai?.quote, body: `**AI ${r.mode}**\n\n${r.text}` });
    },
    [ai, saveNote]
  );

  const saveChatAsNote = useCallback(
    async (text) => {
      await saveNote({ quote: "", body: `**与 ${agentName(chatAgent)} 的讨论**\n\n${text}` });
    },
    [saveNote, chatAgent]
  );

  // 配封面：不在工作台里重写一遍出图逻辑，而是把已有的 xenho-cover skill 通过
  // agent 通道跑起来。工作台只负责把「这篇稿子 + 目标平台」喂进去、把提示词流回来。
  //
  // **那句指令的真源在服务端**（`config/prompts.json`，设置面板里可改），点的时候才去拿——
  // 在这儿留一份默认文案就是第二真源，用户改完设置发现「配封面」还是老样子，
  // 而且不报错。`{platform}` 是唯一的占位符，删掉了也只是少一个词，不会把上下文带没
  //（标题和正文由下面这段代码拼，不进模板）。
  const runCover = useCallback(async () => {
    if (!doc) return;
    const platform = active?.raw?.platform || "公众号";
    setRailMode("chat");
    const { values } = await api.prompts();
    const head = String(values?.cover?.instruction || "").replaceAll("{platform}", platform);
    sendChat(`${head}\n\n标题：${doc.title}\n\n正文：\n${(doc.content || "").slice(0, 3000)}`);
  }, [doc, active, sendChat]);

  // 去排版：正文进剪贴板，然后跳工作台自己的排版页（不再另开浏览器标签）
  const openTypeset = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(doc?.markdown ?? doc?.content ?? "");
    } catch {
      /* 剪贴板没权限也照常跳，用户自己复制 */
    }
    onGo("typeset");
  }, [doc, onGo]);

  // 编辑保存后就地刷新那一张卡，不整页重载。
  // 正文也要跟着换——不换的话，退出编辑器看到的还是改之前那一版，像是没存上
  const onSaved = useCallback(
    ({ title, status, markdown }) => {
      setDoc((d) =>
        d
          ? {
              ...d,
              title: title ?? d.title,
              status: status ?? d.status,
              content: markdown ?? d.content,
              markdown: markdown ?? d.markdown,
            }
          : d
      );
      if (active) patchItem(active.key, { title: title ?? active.title, badge: status ?? active.badge });
    },
    [active, patchItem]
  );

  // 划词 AI 的中止归 useAiRuns 自己管，这里只收对话那条
  useEffect(() => () => stopChat(), [stopChat]);   // 卸载时别让请求接着烧 token

  const isPipeline = PIPELINE.includes(sourceKey);
  const canBoard = source.board !== false && !!source.states?.length;

  // 洞察跑批的状态归一个 hook 管：按钮在页头 aside（窄），进度条在正文顶（宽），
  // 两处隔着整个 PageHeader，各自轮询会互相打架、百分比还会差一拍。
  const insightRun = useInsightRun(reload);

  return (
    <>
      <PageHeader
        eyebrow={source.eyebrowCn || "个人内容运营"}
        title={source.label}
        desc={source.sub}
        aside={
          isPipeline ? (
            <button className="btn btn-primary" onClick={() => setCreation("choose")}>
              <IconPlus aria-hidden="true" stroke={2} />新建
            </button>
          ) : sourceKey === "insights" ? (
            <InsightRunButton run={insightRun.run} onStarted={insightRun.markStarted} />
          ) : null
        }
      />

      {/* 进度条铺在正文顶而不是塞进页头：它要显示阶段名、百分比和失败原因，
          页头右侧那个窄槽装不下，挤进去会把「新建 / 跑一次洞察」按钮顶到换行。 */}
      {sourceKey === "insights" ? (
        <InsightRunProgress run={insightRun.run} onCancel={insightRun.cancel} />
      ) : null}

      {/* 流水线四段做成一排 tab：它们是**一条链的四段**，不是四个不相干的页面。
          摊成 tab 才看得出「东西是从左往右走的」，侧栏里排四行反而把这层关系藏了。 */}
      {isPipeline ? (
        <div className="pill-tabs" role="tablist">
          {PIPELINE.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={k === sourceKey}
              className="pill-tab"
              onClick={() => onGo(k)}
            >
              {SOURCES[k].label}
              {counts?.[SOURCES[k].pendingKey] ? <span className="pill-tab__count">{counts[SOURCES[k].pendingKey]}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <section className="panel-block">
<ListHead
          source={source}
          list={list}
          searchRef={searchRef}
          query={query}
          setQuery={setQuery}
          canBoard={canBoard}
          layout={layout}
          setLayout={setLayout}
          isPipeline={isPipeline}
          sourceKey={sourceKey}
          onIntake={onIntake}
          onCreate={setCreation}
          onOrganize={() => setOrganizerItems((query.trim() ? searchList : list)?.items || [])}
        />

        {/* 筛选条**只占一行**：状态是芯片（互斥的分流，一眼看全），平台是下拉（选项会变多）。
            状态筛选在看板里是多余的——看板每一列就是一个状态。 */}
        {(source.states?.length && layout === "wall") || facetPick ? (
<FilterBar
            source={source}
            layout={layout}
            state={state}
            onState={onState}
            facet={facet}
            setFacet={setFacet}
            facetPick={facetPick}
          />
        ) : null}

<DocList
          list={query.trim() ? (searchList || list) : list}
          listError={listError}
          source={source}
          shown={shown}
          layout={layout}
          canBoard={canBoard}
          query={query}
          state={state}
          loadingMore={loadingMore}
          openItem={openItem}
          changeStatus={changeStatus}
          removeItem={sourceKey === "collections" ? undefined : removeItem}
          loadMore={loadMore}
        />
      </section>

      {active ? (
        <ReaderOverlay
          source={source}
          item={active}
          doc={doc}
          loading={docLoading}
          error={docError}
          onClose={closeItem}
          onSelect={onSelect}
          // 流水线源没有高亮的落点（见 sources.js 的 highlightPath），
          // 那就不画那个按钮——画一个点了报错的按钮比没有更糟
          actions={PIPELINE_ACTIONS}
          onSaved={onSaved}
          onStatus={sourceKey === "collections" ? null : (next) => changeStatus(active, next)}
          onDelete={sourceKey === "collections" ? null : source.remove ? removeItem : null}
          onCover={runCover}
          onTypeset={openTypeset}
          outline={outline}
          onOutline={setOutline}
          /**
           * 补录**带着被点名的那句原文走**，而不是开一个空输入框。
           *
           * 闸门是逐句比对的（`isPersonalClaimGrounded`），依据里必须真的含着这句话；
           * 让用户凭记忆重打一遍，打出来的版本很可能又对不上，于是补了也不管用。
           * 存完重取一次正文——告警是 Worker 在读的时候现算的，不重取它会一直挂着。
           */
          onCaptureExperience={(issue) => onIntake({
            target: "material",
            cmd: "经历",
            content: issue || "",
            source: `补充《${active.title}》的真实经历`,
            hint: "把这件事补充完整，但别改掉这句话本身——闸门要在这条素材里找到它。",
            onStored: () => source.load(active).then(setDoc).catch(() => {}),
          })}
          extra={
            sourceKey === "collections" ? (
              <CollectionActions item={active} onExtract={(item) => setOrganizerItems([item])} onChanged={() => { reload(); source.load(active).then(setDoc).catch(() => {}); onChanged?.(); }} />
            ) : sourceKey === "materials" ? (
              <MaterialVerificationPanel
                item={active}
                onVerified={(verificationNote) => {
                  const raw = { ...active.raw, verificationStatus: "已核验", verificationNote };
                  patchItem(active.key, { badge: "已核验", warning: null, raw });
                  setDoc((current) => current ? {
                    ...current,
                    warning: null,
                    meta: { ...current.meta, 核验状态: "已核验", 核验说明: verificationNote },
                  } : current);
                  setToast({ text: "已核验；这条证据现在可以进入成稿。" });
                }}
              />
            ) : sourceKey === "topics" ? (
              <DraftLinks
                drafts={drafts}
                onOpen={(d) => {
                  closeItem();
                  onGo("drafts");
                  // 稿件库那边靠搜索定位到这一篇：跨页带一个 id 过去要给 hash 加一套
                  // 「打开某条」的语义，为一个跳转不值得
                  setTimeout(() => setToast({ text: `在稿件库搜「${d.title}」` }), 300);
                }}
              />
            ) : null
          }
          actionsExtra={
            sourceKey === "drafts" ? (
              <PublishPanel
                item={active}
                doc={doc}
                // 一边警告「缺真实素材支撑」一边把「确认已发布」递过去，是系统自己打架
                blocked={Boolean(doc?.warning)}
                onPublished={(result, form) => {
                  const raw = {
                    ...active.raw,
                    status: "已发布",
                    publishedUrl: form.url,
                    publishedAt: form.publishedAt,
                    feedbackStatus: result.feedbackStatus,
                    performanceSummary: result.performance?.summary || "",
                  };
                  patchItem(active.key, { badge: "已发布", raw });
                  setDoc((current) => current ? { ...current, status: "已发布", meta: { ...current.meta, 发布链接: form.url, 发布时间: form.publishedAt, 表现判断: result.feedbackStatus, 表现摘要: result.performance?.summary } } : current);
                  onChanged?.({ sourceKey, item: active, result });
                  setToast({ text: result.feedbackCreated ? `发布已记录，并沉淀 ${result.feedbackCreated} 条有效素材` : "发布已记录，表现数据已进入复盘" });
                }}
              />
            ) : null
          }
          rail={{
            mode: railMode,
            onMode: setRailMode,
            annotateLabel: source.annotateLabel,
            notes: doc?.notes,
            quote,
            onSaveNote: saveNote,
            ai,
            onSaveAiAsNote: saveAiAsNote,
            onStopAi: stopAi,
            // 右栏换模式重跑同一段：上下文从正文里现取，用户不用回去重新划一次
            onRunAi: (mode, text) => runAi(mode, text, contextOf(doc?.content, text)),
            chat: { ...chat, agent: chatAgent },
            onSend: sendChat,
            onStopChat: stopChat,
            onChatAgent: switchAgent,
            onNewChat: newChat,
            onRailSelect,
            onSaveChatAsNote: saveChatAsNote,
            knowledgeSource: {
              kind: sourceKey === "collections" ? "inbox" : sourceKey,
              ref: active ? (sourceKey === "collections" ? `inbox:${active.key}` : `${sourceKey}:${active.key}`) : "",
              url: active?.raw?.link || "",
              title: doc?.title || active?.title || "",
              selection: quote || "",
              text: doc?.content || "",
            },
          }}
        />
      ) : null}

      {gate ? (
        <PlatformGate
          item={gate.item}
          initial={gate.item.raw?.platforms || []}
          done={(drafts || []).map((d) => d.platform).filter(Boolean)}
          onCancel={() => setGate(null)}
          onConfirm={confirmGate}
        />
      ) : null}

      <CreationDialog
        open={!!creation}
        preset={creation}
        onClose={() => setCreation(null)}
        onCreated={(draft) => {
          setOpenTarget("drafts", draft.id);
          onChanged?.();
          onGo("drafts", "");
        }}
        onTopicCreated={(topic) => {
          onChanged?.();
          setToast({ text: `选题《${topic.title}》已建立` });
          if (sourceKey === "topics") reload();
          else onGo("topics", "待写");
        }}
      />

      <CollectionOrganizer
        open={Array.isArray(organizerItems)}
        items={organizerItems || []}
        onClose={() => setOrganizerItems(null)}
        onDone={() => { reload(); onChanged?.(); }}
      />

      <Toast text={toast?.text} detail={toast?.detail} onUndo={toast?.undo} onClose={() => setToast(null)} />
    </>
  );
}
