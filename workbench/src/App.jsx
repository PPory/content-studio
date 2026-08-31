// 一级导航只表达五个用户任务：今天做什么、内容走到哪、有什么素材、外面有什么、发布后学到什么。
// 数据库对象和旧工具路由仍保留兼容，但只归属于其中一个任务，不再争抢侧栏位置。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./lib/api.js";
import { NAV_LABELS } from "./lib/views.js";
import { PIPELINE, SOURCES } from "./lib/sources.js";
import { normalizeMaterialRoute, setOpenTarget } from "./lib/open-target.js";
import { ViewSlots } from "./lib/view-slots.js";
import { NAV_ICONS, IconInbox, IconLayoutSidebar, IconSearch, IconSettings, IconChevronDown, IconSparkles, BrandMark } from "./components/icons.jsx";
import { Overview } from "./pages/Overview.jsx";
import { Today } from "./pages/Today.jsx";
import { Assistant } from "./pages/Assistant.jsx";
import { Content } from "./pages/Content.jsx";
import { Series } from "./pages/Series.jsx";
import { SeriesWorkspace } from "./pages/SeriesWorkspace.jsx";
import { Ideas } from "./pages/Ideas.jsx";
import { Seeds } from "./pages/Seeds.jsx";
import { ProjectWorkspace } from "./pages/ProjectWorkspace.jsx";
import { Studio } from "./pages/Studio.jsx";
import { Entries } from "./pages/Entries.jsx";
import { EntryDetail } from "./pages/EntryDetail.jsx";
import { Sources } from "./pages/Sources.jsx";
import { Shelf } from "./pages/Shelf.jsx";
import { Hotspots } from "./pages/Hotspots.jsx";
import { Typeset } from "./pages/Typeset.jsx";
import { Metrics, DATA_TABS } from "./pages/Metrics.jsx";
import { Review } from "./pages/Review.jsx";
import { IntakeDrawer } from "./components/IntakeDrawer.jsx";
import { CommandPalette } from "./components/CommandPalette.jsx";
import { SettingsOverlay } from "./components/SettingsOverlay.jsx";
import { QuickAssistant } from "./components/QuickAssistant.jsx";
import { assistantSummonDestination, summonAssistant } from "./lib/assistant-summoner.js";

/**
 * 状态读失败后的退避重试间隔。**三档就够**：代理抖一下是秒级的，30 秒还不通
 * 基本就是代理没开或 Worker 挂了——那种情况再退下去只是让红框来得更晚。
 */
const STATUS_RETRY_MS = [3000, 8000, 20000];

// ⚠️ `typeset` 不在这里：它现在是一级导航自己一项（工具不是阶段）
const CONTENT_VIEWS = new Set(["ideas", "seeds", "content", "project", "series", "series-detail", "topics", "drafts", "review"]);
const MATERIAL_VIEWS = new Set(["materials", "collections", "inbox"]);
const DISCOVER_VIEWS = new Set(["discover", "hot", "insights"]);
// 知识库：词条（提炼出来的）+ 来源（书架和其他资料）
const KNOWLEDGE_VIEWS = new Set(["knowledge", "entries", "shelf", "sources"]);
// 知识库的来源归类。⚠️ 和每本书的「藏书 / 资料」正交：那个管正文能不能改。
const SHELF_KINDS = Object.freeze(["书籍"]);
// ⚠️ `review`（待复盘）**不在这里**：它搬进内容那一栏了（见 CONTENT_VIEWS），
// 留在这儿的话点进去侧栏会同时亮两处。
const REVIEW_VIEWS = new Set(["review-performance", "review-sources", "metrics"]);

// 侧栏项。旧路由通过 match 归回新的用户任务，兼容期仍能准确高亮。
const NAV = [
  { key: "today", to: "today", match: (v) => v === "today" || v === "overview" },
  { key: "assistant", to: "assistant", match: (v) => v === "assistant" },
  {
    key: "content", to: "content", match: (v) => CONTENT_VIEWS.has(v),
    children: [
      /**
       * ⚠️ **顺序就是流程**：还没有想写的 → 找题；挑定这一篇 → 选题；
       * 开始写 → 创作；发布后 → 复盘。
       *
       * ⚠️ **「选题」和「稿件」都从导航里拿掉了**（路由和页面都留着，深链仍然有效）。
       * 两者都是**同一批东西的第二个入口**：`getContentProject` 以 topic 为项目根，
       * 所以每个选题就是一个项目；`listContentProjects` 连**孤立稿件**也会包成
       * `draft:<id>` 项目。**没有任何一行会因此看不到。**
       *
       * ⚠️ **拿掉「选题」等于封存了自动成稿那条路**：任务3 只领
       * `topics.status = 撰写中`，而改成那个状态的唯一界面入口就在那一页
       *（`sources.js` 的 `askPlatformsOn`）。这是**有意的**——
       * 新模型下你是从种子开始自己写，或者走素材/访谈起稿，那两条都是你在场的；
       * 而查库时那条路一次都没跑过（选题全是「已成稿」、0 个「撰写中」）。
       * cron 照跑，只是永远领不到东西。要它回来就得先把那道会花钱的闸门搬进项目页。
       *
       * 丢掉的另一样是「按平台横着看全部稿子」，需要时走 Ctrl+K。
       */
      { to: "ideas", label: "找题" },
      { to: "seeds", label: "选题" },
      { to: "content", label: "创作" },
      // 「待复盘」本来就是项目的一个阶段，所以它在这一栏而不是单开一级
      { to: "review", label: "复盘" },
    ],
  },
  {
    /**
     * ⚠️ **「排版」是一级，不在「内容」底下。**
     * 内容那一栏读下来是**一条链**（选种 → 种子 → 发芽 → 收成），
     * 而排版是一个**工具页**（嵌进来的 wechat-typeset）——它夹在几个阶段中间很突兀。
     * 这也是它当初没跟着起植物名的同一个理由：**工具不是阶段**。
     */
    key: "typeset", to: "typeset", match: (v) => v === "typeset",
  },
  {
    key: "discover", to: "hot", match: (v) => DISCOVER_VIEWS.has(v) || MATERIAL_VIEWS.has(v),
    children: [
      { to: "hot", label: "热点" },
      { to: "insights", label: "洞察" },
      /**
       * ⚠️ **「素材」归到「发现」，不归「内容」。**
       * 发现回答的是「东西从哪儿来」（热点 / 洞察 / 书架），而素材是
       * **已经收下来并拆好的那些**——同一类，只是更靠后一步。
       * 放进内容会把那条链插断：素材不在链上，它是链**旁边**的储备；
       * 而且写的时候你是从**项目页右栏**用它的，不需要跳过去。
       */
      { to: "materials", label: "素材" },
    ],
  },
  {
    /**
     * ⚠️ **书架在这儿，不在「发现」。** 发现回答「东西从哪儿来」，
     * 而这一栏回答「我已经有什么」——沉淀下来的东西和从中提炼的词条。
     *
     * 顺序是**从产物到原料**：词条是你真正会去用的，来源是它的依据。
     * 反过来排会把最常点的那一项压到第二位。
     */
    key: "knowledge", to: "entries", match: (v) => KNOWLEDGE_VIEWS.has(v),
    children: [
      { to: "entries", label: "词条" },
      { to: "shelf", label: "书架" },
      /**
       * ⚠️ **「来源」列全部，包括书架里那 15 本。**
       * 一开始按归类把书排除在外，两栏正好互斥、看着很整齐——但那样就再也看不到
       * 「《平凡的世界》170 节、未提炼」这类事实，而书占了全库 90% 的章节。
       * 这张表回答的是「我有什么、读到哪儿了、哪些真被用上了」，
       * 排除掉最大的那部分就等于不回答。
       *
       * 书架不因此多余：它是**读**的地方（封面、进度、划词、批注），
       * 而这里是**清点**的地方。两件事，两个界面。
       */
      { to: "sources", label: "来源" },
    ],
  },
  /**
   * ⚠️ **「数据」没有二级项。** 「表现 / 来源」原来是两条侧栏项，而它们是**同一批数字的
   * 两个视角**——拆开的代价是每次先想「这个数字在哪一页」。现在是一页三个 tab
   * （内容明细 / 月度总览 / 数据同步），tab 走 hash 的状态段。
   * 两条旧路由留着重定向（见 `readHash`），深链不会断。
   */
  { key: "review", to: "review-performance", match: (v) => REVIEW_VIEWS.has(v) },
];

// 这个 view 归哪一栏。侧栏高亮、面包屑、二级展开三处都问它，别各写各的
const groupOf = (view) => NAV.find((n) => (n.match ? n.match(view) : view === n.key));

function assistantPageContext(route) {
  const item = groupOf(route.view);
  const child = item?.children?.find((entry) => entry.to === route.view);
  const detail = route.view === "overview"
    ? "总览"
    : route.view === "review-performance"
      ? DATA_TABS.find((entry) => entry.key === route.state)?.label || "数据"
      : child?.label || "";
  return {
    pageType: route.view,
    label: [item ? NAV_LABELS[item.key] : "工作台", detail].filter(Boolean).join(" · "),
  };
}

// ⚠️ **加一页要同时加进这份白名单**，不然 `parseHash` 认不出它、静默退回「今日」——
// 而那看着像「点了没反应」，不像路由漏了一项（种子页栽过一次，冒烟测试才抓到）。
const VIEWS = ["today", "assistant", "ideas", "seeds", "content", "project", "series", "series-detail", "review", "review-performance", "review-sources", "overview", "hot", "insights", "shelf", "sources", "entries", "typeset", "metrics", ...PIPELINE];

/**
 * 侧栏收起状态。**存 localStorage**：这是「这台机器上这个人怎么用」的偏好，
 * 和阅读区两侧栏、阅读进度同一类，不是知识，不进 vault（工作台无状态那条红线管的是内容）。
 */
const RAIL_KEY = "workbench:sidebar:v1";
const loadRail = () => {
  try {
    return localStorage.getItem(RAIL_KEY) === "collapsed";
  } catch {
    return false; // 隐私模式下读不了，默认展开
  }
};
// 卡片墙 + 覆盖层阅读区共用一个页面组件。**书架不在里面**——
// 一本书是几十份文档，中间要多一层「挑章节」，动线和这几个库不是一回事。
const STUDIO = new Set([...PIPELINE, "insights"]);

// 路由放 hash 里（#/inbox/待初筛）：本地工具不值得为几条路由引一个路由库，
// 而 hash 能让「总览的计数卡 → 过滤好的列表」这个跳转天然可回退。
function readHash() {
  // **先切段、再解码**，顺序反了就是个真 bug：状态值里本来就带斜杠
  // （灵感库有「初筛失败/需人工」）。整串先 decodeURIComponent 的话，`%2F` 会被还原成
  // 真斜杠，再 split 就把状态劈成两半，只剩「初筛失败」送去库里 —— 那不是合法取值，
  // 库里直接回 400，界面上是一坨 validation_error。
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [rawView = "", ...rest] = raw.split("/");
  const decodedView = decodeURIComponent(rawView) || "today";
  const decodedState = decodeURIComponent(rest.join("/"));
  // 数据页的三个 tab 走状态段（`#/review-performance/明细`）。
  // ⚠️ **旧的三条入口全部收敛到这一页**，各自落在它原来对应的那个 tab 上：
  // `review-sources` 说的就是「数据同步」，直接丢去默认 tab 等于把人送错地方。
  if (decodedView === "metrics" || decodedView === "review-sources") {
    const tab = decodedView === "review-sources" ? "同步" : "明细";
    window.history.replaceState(null, "", `#/review-performance/${encodeURIComponent(tab)}`);
    return { view: "review-performance", state: tab };
  }
  const legacyMaterial = normalizeMaterialRoute(decodedView, decodedState);
  if (legacyMaterial) {
    const canonical = `#/materials${legacyMaterial.state ? `/${encodeURIComponent(legacyMaterial.state)}` : ""}`;
    window.history.replaceState(null, "", canonical);
    return legacyMaterial;
  }
  // 发现旧入口只做兼容跳转，不再让用户经过一张中转页。
  const view = decodedView === "discover" ? "hot" : decodedView;
  const known = VIEWS.includes(view) ? view : "today";
  /**
   * ⚠️ **没带状态时套上那个源的 `defaultState`，而且写回地址栏。**
   *
   * 原来只有 `go()` 干这件事，所以从导航点进去落在「待写」、
   * **而直接敲 `#/topics` 落在「全部」**——同一个页面两种进法两种结果。
   * 这个差别一直被导航遮着（那时导航是唯一入口）；「选题」从导航拿掉之后
   * 深链成了唯一进法，它立刻就露出来了。
   *
   * 用 `replaceState` 不留历史：这是补全地址，不是一次跳转，
   * 留一条的话按后退会退回那个不完整的地址，然后又被补一次，退不出去。
   */
  const fallback = decodedState ? "" : SOURCES[known]?.defaultState || "";
  if (fallback) {
    window.history.replaceState(null, "", `#/${known}/${encodeURIComponent(fallback)}`);
    return { view: known, state: fallback };
  }
  return { view: known, state: decodedState };
}

export function App() {
  const [route, setRoute] = useState(readHash);
  const acceptedHash = useRef(window.location.hash || "#/today");
  const navigationGuard = useRef(null);
  const bypassNavigationGuard = useRef(false);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusRetrying, setStatusRetrying] = useState(false); // 正在退避重试，还没到该报错的时候
  const retryTimer = useRef(null);
  const [intake, setIntake] = useState(null); // null=关闭；{} 或 {content,source}=打开
  const [intakeVersion, setIntakeVersion] = useState(0);
  const [railCollapsed, setRailCollapsed] = useState(loadRail);
  /**
   * 页头两个插槽的 DOM 节点。**走 state 不走 ref**：消费方（`PageHeader`）在渲染阶段
   * 就要拿到节点去 `createPortal`，而 ref 要等提交阶段。回调 ref 里 setState 会在
   * 浏览器绘制前再跑一轮，所以第一帧不会缺按钮。
   */
  const [headLead, setHeadLead] = useState(null);
  const [headCenter, setHeadCenter] = useState(null);
  const [headEnd, setHeadEnd] = useState(null);
  const [frameOverlay, setFrameOverlay] = useState(null);
  const slots = useMemo(
    () => ({ lead: headLead, center: headCenter, end: headEnd, overlay: frameOverlay }),
    [headLead, headCenter, headEnd, frameOverlay]
  );
  const [finder, setFinder] = useState(false); // 全局检索（Ctrl/⌘ + K）
  const [settings, setSettings] = useState(false); // 设置面板
  const [quickAssistantOpen, setQuickAssistantOpen] = useState(false);
  const [globalConversationId, setGlobalConversationId] = useState("");
  /**
   * ⚠️ **侧栏有自己的会话，不和 `#/assistant` 那一页共用。**
   * 共用那一版的问题：在别的页面顺手问一句，回到 AI 助手页时那句话已经躺在里面了，
   * 而这两处的用法根本不同——侧栏是「手头这件事顺便问一下」，整页是「坐下来想一件事」。
   * 侧栏每次打开都是一段新对话；要把它带进整页，走「⤢ 在完整工作区继续」那一颗。
   */
  const [railConversationId, setRailConversationId] = useState("");
  /**
   * 哪一栏的二级项是展开的。
   *
   * ⚠️ **点「内容」「发现」只展开，不跳页。** 上一版点一下就直接落到那一栏的第一页
   *（内容→创作、发现→热点），于是**「想看看这栏底下有什么」和「我要去那一页」
   * 用的是同一个动作**——你只是想展开看看，页面已经换掉了，回不去刚才那一屏。
   * 现在一级项是纯粹的展开开关，去哪一页由二级项说。
   *
   * 初始值和路由变化都跟着当前页走：深链进来时那一栏必须是开的，
   * 否则屏幕上看不出自己在哪一组底下。
   */
  const [openGroup, setOpenGroup] = useState(() => {
    const g = groupOf(route.view);
    return g?.children ? g.key : null;
  });

  // 换页时把当前页所在那一栏展开。**只开不关**：用户手动收起别的栏是他的选择，
  // 不该因为换了个页面又被摆回去。
  useEffect(() => {
    const g = groupOf(route.view);
    if (g?.children) setOpenGroup(g.key);
  }, [route.view]);

  // 滚动标记：吸顶的页头只在真有内容从它底下过去时才画分隔线（见 `.main[data-scrolled]`）
  const onMainScroll = useCallback((e) => {
    const el = e.currentTarget;
    const on = el.scrollTop > 4 ? "true" : "false";
    if (el.dataset.scrolled !== on) el.dataset.scrolled = on;
  }, []);

  const toggleRail = useCallback(() => {
    setRailCollapsed((v) => {
      try {
        localStorage.setItem(RAIL_KEY, v ? "expanded" : "collapsed");
      } catch {
        /* 隐私模式下写不了，本次会话内照样能收起 */
      }
      return !v;
    });
  }, []);

  /**
   * ⚠️ **一屏只能有一个 AI 侧栏。**
   * 全局侧栏开着的时候切到项目页或阅读页，那两个页面自带协作右栏——
   * 于是同一屏并排出现两个「AI 助手」，各自一段对话、各自一个输入框，
   * 用户得先分辨该对哪一个说话。判据不在这儿另写一份：
   * `assistantSummonDestination` 已经决定了「这一页的 AI 归谁管」，
   * 不归 `quick` 管的页面就把全局侧栏收起来。
   */
  useEffect(() => {
    if (!quickAssistantOpen) return;
    if (assistantSummonDestination({ routeView: route.view }) !== "quick") setQuickAssistantOpen(false);
  }, [quickAssistantOpen, route.view]);

  const summon = useCallback(() => summonAssistant({
    routeView: route.view,
    onQuick: () => setQuickAssistantOpen((value) => {
      if (!value) setRailConversationId("");
      return !value;
    }),
  }), [route.view]);

  useEffect(() => {
    const onHash = () => {
      const next = readHash();
      if (!bypassNavigationGuard.current && navigationGuard.current?.(next)) {
        // hashchange 已经发生，但页面还没换：把地址轻量还原，等项目页里的确认框做决定。
        window.history.replaceState(null, "", acceptedHash.current);
        return;
      }
      bypassNavigationGuard.current = false;
      acceptedHash.current = window.location.hash || "#/today";
      setRoute(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const registerNavigationGuard = useCallback((guard) => {
    navigationGuard.current = guard;
    return () => {
      if (navigationGuard.current === guard) navigationGuard.current = null;
    };
  }, []);

  // 本机刚启动或刚保存 .env 时服务可能短暂重启，状态读取做有限重试。
  const runStatus = useCallback(
    (attempt = 0) => {
      clearTimeout(retryTimer.current);
      setStatusLoading(true);
      setStatusError(null);
      api
        .status()
        .then((data) => {
          setStatus(data);
          setStatusLoading(false);
          setStatusRetrying(false);
        })
        .catch((e) => {
          const delay = STATUS_RETRY_MS[attempt];
          // 退完了还不行：这才是用户需要知道的那种失败
          if (delay == null) {
            setStatusError(e);
            setStatusLoading(false);
            setStatusRetrying(false);
            return;
          }
          setStatusRetrying(true);
          retryTimer.current = setTimeout(() => runStatus(attempt + 1), delay);
        });
    },
    []
  );

  // 手动触发的刷新（入库完、设置改完）一律从头数：上一轮退到第三档了，
  // 不该让用户点一下还要等 20 秒
  const refreshStatus = useCallback(() => runStatus(0), [runStatus]);

  useEffect(() => {
    refreshStatus();
    return () => clearTimeout(retryTimer.current);
  }, [refreshStatus]);

  /**
   * 跳转。**没指定状态时，用那个源自己的默认状态**（选题默认「待写」）。
   *
   * 写进 URL 而不是在页面里偷偷过滤：偷偷过滤的话，筛选条上没有任何一项是选中的，
   * 用户看不出自己正在被过滤、也点不回「全部」。写进 URL 之后「待写」那颗芯片是亮的，
   * 一眼就知道现在看的是哪一档。
   */
  const go = useCallback((view, state) => {
    const s = state === undefined ? SOURCES[view]?.defaultState || "" : state;
    window.location.hash = `#/${view}${s ? `/${encodeURIComponent(s)}` : ""}`;
  }, []);

  const forceGo = useCallback((view, state) => {
    bypassNavigationGuard.current = true;
    const s = state === undefined ? SOURCES[view]?.defaultState || "" : state;
    window.location.hash = `#/${view}${s ? `/${encodeURIComponent(s)}` : ""}`;
  }, []);

  /**
   * 外链一律新窗口打开。
   *
   * 界面上自己写的 `<a>` 早就都带 `target="_blank"` 了，漏的是**正文里的链接**——
   * 那些是 `marked.parse` 从 Markdown 生成的裸 `<a href>`，点下去就地跳转，
   * **整个工作台被这个网页顶掉**；再关掉窗口，工作台跟着一起没了。
   *
   * 做成一个委托监听而不是去给 marked 配 renderer：正文、右栏 AI 输出、热点原文
   * 各有各的渲染路径，以后再多一个源就又漏一处。**判据只写一处**，谁生成的 HTML 都管得住。
   *
   * **做法是把 `target` 补上再放行，不是 `preventDefault` + `window.open`。**
   * 界面上那些手写的 `<a target="_blank">` 本来就工作得好好的，补完之后正文链接和它们
   * 是同一种东西，浏览器怎么处理就怎么处理——而 `window.open` 是**第二套机制**，
   * 它在 Chrome 的 `--app` 窗口里开出来的是标签页还是弹窗，得另外验一遍才敢说。
   * 已经有一条走通的路时，不要再修第二条。
   */
  useEffect(() => {
    const onClick = (e) => {
      // 带修饰键的点击和中键交给浏览器自己处理，它本来就开新标签
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target?.closest?.("a[href]");
      if (!a || a.target === "_blank") return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return; // hash 路由，是自己人
      let url;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return; // 解析不了的（相对怪路径）原样交给浏览器，别把它变成一个打不开的链接
      }
      // 同源的是工作台自己的资源（图片、/tools/typeset/），协议不是 http(s) 的
      // 是 mailto:/javascript: 这类——两种都不该被劫持
      if (url.origin === window.location.origin) return;
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      // 补上属性就放行，剩下的交给浏览器。React 下次重渲染会把它抹掉，无所谓——
      // 每次点击都会重新补一遍，而属性只在这一下导航时起作用。
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  /**
   * 全局快捷键。两条，规则不一样，**不能写在同一个判断里**：
   *
   *  - `Ctrl/⌘ + K` 开全局检索。**带修饰键，所以在输入框里也要生效**——
   *    正在写批注时想起「刚才那本书叫什么」是常事，这时候要求先点出输入框才能搜，
   *    等于把这条快捷键的用处砍掉一半。
   *  - `n` 开入库。**裸键，所以输入框里绝不能触发**，否则打字打到 n 就弹抽屉。
   */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        summon();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setFinder((v) => !v);
        return;
      }
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        setIntake({});
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [summon]);

  return (
    <div className="app" data-rail={railCollapsed ? "collapsed" : "open"}>
      {/**
        * ⚠️ **顶栏整条撤了。**
        *
        * 它当初解决的是「这个工作台没有外壳，只有一叠文档」，而代价是**同一屏上三处在争
        * 最重的那一块**：顶栏正中的搜索、侧栏顶上那颗黑色「收集」大按钮、页面右上的主操作。
        * 参照 ln-dev7/circle：外壳只有两件东西——**侧栏**，和一块四周留沟、带边框圆角的**面板**；
        * 「我在哪」和「这一页能干什么」都归面板顶上那条 `.view-head`，跟着内容走。
        *
        * 搬家清单（都在下面）：搜索 → 侧栏一整行；设置 + 收集 → 侧栏栏头的小图标；
        * 面包屑 → `.view-head` 的页名；AI 召唤键 → `.view-head` 右端；
        * **连接状态整条删掉**（后续全本地，Worker 会退场）。
        */}
      <aside className="sidebar">
        {/**
          * 栏头：身份 + 三颗随手就用的图标。
          * ⚠️ **收起态它变成一列 40px 的方块**（logo / 收集 / 设置），不是把这几颗甩去别处——
          * 靶子换位置比靶子变小难用得多。收放钮在收起态盖在 logo 上（60px 里摆不下两个方块）。
          */}
        <div className="sidebar__head">
          <div className="sidebar__brand">
            <BrandMark />
            <span className="sidebar__name">Xenho OS</span>
          </div>
          {/* ⚠️ **收件箱图标，不是一个 `+`。** 挨着「Xenho OS」的加号读起来是
              **「Xenho OS＋」**——它成了品牌名的一部分，而不是一颗按钮。 */}
          <button
            className="rail-icon"
            onClick={() => setIntake({})}
            aria-label="收集"
            title="收集（快捷键 n）"
          >
            <IconInbox aria-hidden="true" stroke={1.7} />
          </button>
          <button
            className="sidebar__rail"
            onClick={toggleRail}
            aria-label={railCollapsed ? "展开侧栏" : "收起侧栏"}
            title={railCollapsed ? "展开侧栏" : "收起侧栏"}
          >
            <IconLayoutSidebar aria-hidden="true" stroke={1.7} />
          </button>
        </div>

        {/**
          * ⚠️ **搜索只有这一个入口。** 栏头里不再放第二枚放大镜——同一件事两个入口，
          * 用户得先想它俩是不是一回事。**快捷键不能是唯一入口**（没人会去猜一个看不见的功能）。
          *
          * ⚠️ **字只写「搜索」。** 顶栏时代那句「搜选题、稿件、素材、书里的一句话…」
          * 是给 440px 写的；180px 的一行里它被截成「搜选题、稿…」，等于既没说清、
          * 又把那颗 `Ctrl K` 挤到没地方。那句话搬进了命令面板自己的 placeholder——
          * 打开的第一眼就能看见，比在一个截断的按钮上读半句强。
          * 收起态退成一颗无边框图标：框里只剩放大镜时，那个框不再解释任何东西。
          */}
        <button className="sidebar__find" onClick={() => setFinder(true)} title="全局检索（Ctrl+K）">
          <IconSearch aria-hidden="true" stroke={1.7} />
          <span>搜索</span>
          <kbd>Ctrl K</kbd>
        </button>

        <nav className="nav">
          {NAV.map((item) => {
            const Icon = NAV_ICONS[item.key];
            const current = item.match ? item.match(route.view) : route.view === item.key;
            // 选题数 + 稿件数不等于内容项目数：同一篇会被算两次。
            // 在项目汇总没有上收到 App 前，导航不显示这个会误导人的数字。
            const badge = 0;
            const open = !!item.children && openGroup === item.key;
            return (
              <div
                className={`nav-group${item.children ? " has-children" : ""}`}
                key={item.key}
                data-current={current ? "true" : undefined}
                data-open={open ? "true" : undefined}
              >
                <button
                  className="nav-item"
                  aria-current={current && !item.children ? "page" : undefined}
                  aria-expanded={item.children ? open : undefined}
                  data-current={current ? "true" : undefined}
                  // ⚠️ **有下级的项只展开，不跳页**（见上面 `openGroup` 那段注释）。
                  onClick={() => (item.children ? setOpenGroup((k) => (k === item.key ? null : item.key)) : go(item.to))}
                  // 收起后只剩图标，名字得有地方可查；展开时浏览器不会为同文本再弹一次
                  title={item.children ? `${NAV_LABELS[item.key]}（展开）` : NAV_LABELS[item.key]}
                >
                  <span className="nav-item__icon">
                    <Icon aria-hidden="true" className="nav-icon" stroke={1.7} />
                    {/* 收起态放不下数字，就退成一颗点：它回答的是「这儿有没有事」，
                        具体几件展开或点进去就知道 */}
                    {badge ? <span className="nav-item__dot" aria-hidden="true" /> : null}
                  </span>
                  <span className="nav-item__label">{NAV_LABELS[item.key]}</span>
                  {badge ? <span className="count">{badge}</span> : null}
                  {/* 有下级的项给一枚小角标：这一项**就是**那个开关（点它只展开、不跳页），
                      所以它要照实报开合。没有它的话，「内容」和「排版」长得一模一样——
                      看不出其中一个点下去是展开、另一个点下去是换页。 */}
                  {item.children ? (
                    <IconChevronDown className="nav-item__caret" aria-hidden="true" stroke={2} />
                  ) : null}
                </button>
                {/**
                  * ⚠️ **收起态也要渲染二级项，只是改成浮层。**
                  * 上一版是 `display: none` 一刀切，代价是收起之后「找题 / 选题 / 创作 / 复盘」
                  * **一个都点不到**——而收起是个会一直保持的状态，等于那四页从此只能靠 Ctrl+K。
                  * 浮层靠 CSS 的 `:hover` / `:focus-within` 出现（键盘 Tab 进去同样能用），
                  * DOM 仍然只有一套：加一个二级项不用改两处。
                  */}
                {item.children && (railCollapsed || open) ? (
                  <div
                    className="subnav"
                    data-flyout={railCollapsed ? "true" : undefined}
                    aria-label={`${NAV_LABELS[item.key]}下的页面`}
                  >
                    {railCollapsed ? <span className="subnav__title">{NAV_LABELS[item.key]}</span> : null}
                    {item.children.map((child) => (
                      <button
                        key={child.to}
                        className="subnav-item"
                        aria-current={route.view === child.to || (["project", "series", "series-detail"].includes(route.view) && child.to === "content") ? "page" : undefined}
                        // ⚠️ **不传第二个参数**。传 `""` 的话 `state === undefined` 不成立，
                        // `go` 里那条「没指定就用适配器的 defaultState」的分支永远走不到——
                        // 于是进选题库看到的是「全部」，而 `sources.js` 写着 `defaultState: "待写"`、
                        // CLAUDE.md 写着「默认状态要写进 URL」。三处说法两个结果，
                        // 而这种不一致不报错：屏幕上只是安静地少过滤了一次。
                        onClick={() => go(child.to)}
                      >
                        <span aria-hidden="true" />{child.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        {/**
          * 栏底：设置。⚠️ **它长得和导航项一样**（图标 + 两个字），不是一颗孤零零的齿轮——
          * 栏头三颗图标挤在 200px 里时，那个 `+` 会读成品牌名的一部分；
          * 而设置本来就不是「随手点」那一类，它是「偶尔去一趟的一个地方」，
          * 和导航是同一种东西。参照的几个侧栏底部压的也都是这一类（帮助 / 账号 / 设置）。
          *
          * 连接状态那一行**整条删掉了**：这台工作台正在往全本地走，Worker 会退场，
          * 而一条永远亮着绿灯的状态行是纯装饰。真出事时各页面自己会报（`statusError`）。
          */}
        <div className="sidebar__foot">
          <button
            className="nav-item"
            onClick={() => setSettings(true)}
            title="设置：本地工作区、模型与本机工具"
          >
            <span className="nav-item__icon">
              <IconSettings aria-hidden="true" className="nav-icon" stroke={1.7} />
            </span>
            <span className="nav-item__label">设置</span>
          </button>
        </div>
      </aside>

      {/**
        * 工作面板：**四周留 8px 沟、一圈边框、一个圆角**，里面装页头 + 正文 + AI 侧栏。
        * ⚠️ **AI 侧栏在这一圈边框里面**，所以整屏只有一圈边框；助手栏自己那条 header 高度
        * 对齐 `--view-head-h`，两条连成同一条水平线。
        *
        * ⚠️ **类名不叫 `.panel`。** 那个名字在这套设计系统里**已经是「卡片」**
        *（`styles.css` 里 `.card, .panel { padding: 20px; border; shadow }`）。
        * 叫 `.panel` 的那一版外壳白白吃了 20px 内边距，于是浅灰的工作区被一圈白边框住——
        * 屏幕上就是「框里画框」，而**没有任何地方报错**，只是看着多了一层。
        * 沟也从外面那层 `div` 的 padding 改成了这一层的 margin：少一层 DOM，少一次「这层是干嘛的」。
        */}
      <div className="app__frame">
        {/**
          * ⚠️ **页头在面板里，不是跨全宽的顶栏。** 左边「我在哪」，右边「这一页能干什么」。
          * 右端两段：`.view-head__end` 是插槽（页面自己往里画，见 `lib/view-slots.js`），
          * `.view-head__fixed` 是外壳自己的——现在只有 AI 召唤键。
          */}
        <header className="view-head">
          <div className="view-head__name">
            {(() => {
              const item = groupOf(route.view);
              const Icon = item ? NAV_ICONS[item.key] : null;
              const child = item?.children?.find(
                (c) => c.to === route.view || (["project", "series", "series-detail"].includes(route.view) && c.to === "content")
              );
              return (
                <>
                  {Icon ? <Icon aria-hidden="true" stroke={1.7} /> : null}
                  <b>{item ? NAV_LABELS[item.key] : "工作台"}</b>
                  {child ? <><i aria-hidden="true">/</i><span>{child.label}</span></> : null}
                </>
              );
            })()}
          </div>
          {/* 页名右边紧挨着的一格：**页名的下一级**。AI 助手页的「当前对话标题 ⌄」
              落在这儿，读起来是「AI助手 / 帮我梳理这周的选题」，而不是第二条横栏。 */}
          <div className="view-head__lead" ref={setHeadLead} />
          {/* 居中那一格：**给「自己接管这条页头」的页用**（现在只有 AI 助手）。
              它绝对定位在页头正中，所以左右两边放多少东西都不会把它推歪。 */}
          <div className="view-head__center" ref={setHeadCenter} />
          <div className="view-head__end" ref={setHeadEnd} />
          <div className="view-head__fixed">
            <button
              className="rail-icon"
              data-assistant-summoner
              onClick={summon}
              aria-label="召唤 AI 助手"
              title="AI 助手（Ctrl+I）"
            >
              <IconSparkles aria-hidden="true" stroke={1.7} />
            </button>
          </div>
        </header>
        {/* ⚠️ **页头只有这一条。** 曾经在它下面挂过第二条放筛选胶囊——
            结果是两条平行的白带夹着一句说明，读起来像同一件事说了两遍；
            而 40px 的一条也塞不下一颗胶囊。胶囊搬回正文居中了（`ui.jsx` 的 `FilterHeader`）。 */}
        {/**
          * 面板级覆盖层的挂载点：**盖住整个面板，含页头**。
          *
          * AI 助手页的历史抽屉要从窗口顶上一路盖到底（参考里就是这样）——
          * 而它自己长在 `.main` 里，那一层的顶已经是页头**以下**了，
          * 定位再怎么算也够不到页头。所以由外壳提供这一层，页面往里 portal。
          *
          * ⚠️ **`pointer-events: none`**：空着的时候它铺满整个面板，不挡住任何东西；
          * 画进来的东西自己再打开 `auto`。不写的话整块面板从此点不动，
          * 而这**不报错**——屏幕上只是「哪儿都点不了」。
          */}
        <div className="app__frame-overlay" ref={setFrameOverlay} />

        <div className="app__frame-body">
          <main className="main" key={route.view} onScroll={onMainScroll}>
            <div className="main__inner">
              <ViewSlots.Provider value={slots}>
              {route.view === "today" ? (
                <Today
                  status={status}
                  statusError={statusError}
                  statusLoading={statusLoading}
                  onRetryStatus={refreshStatus}
                  onGo={go}
                  onChanged={refreshStatus}
                  onSettings={() => setSettings(true)}
                />
              ) : route.view === "assistant" ? (
                <Assistant conversationId={globalConversationId} onConversationChange={setGlobalConversationId} />
              ) : route.view === "ideas" ? (
                <Ideas onGo={go} onChanged={() => setIntakeVersion((v) => v + 1)} />
              ) : route.view === "seeds" ? (
                <Seeds onGo={go} onChanged={() => setIntakeVersion((v) => v + 1)} />
              ) : route.view === "content" ? (
                <Content
                  workerReady={true}
                  onGo={go}
                  onChanged={refreshStatus}
                  onSettings={() => setSettings(true)}
                />
              ) : route.view === "series" ? (
                <Series onGo={go} onChanged={refreshStatus} />
              ) : route.view === "series-detail" ? (
                <SeriesWorkspace seriesId={route.state} onGo={go} onChanged={refreshStatus} />
              ) : route.view === "project" ? (
                <ProjectWorkspace
                  projectId={route.state}
                  onGo={go}
                  onForceGo={forceGo}
                  registerNavigationGuard={registerNavigationGuard}
                  onChanged={refreshStatus}
                />
              ) : route.view === "review" ? (
                <Review onGo={go} />
              ) : route.view === "review-performance" ? (
                <Metrics
                  tab={DATA_TABS.some((t) => t.key === route.state) ? route.state : "明细"}
                  onTab={(t) => go("review-performance", t)}
                  onSettings={() => setSettings(true)}
                />
              ) : route.view === "overview" ? (
                <Overview
                  status={status}
                  statusError={statusError}
                  statusLoading={statusLoading}
                  onRetryStatus={refreshStatus}
                  onGo={go}
                  onIntake={() => setIntake({})}
                  onSettings={() => setSettings(true)}
                />
              ) : route.view === "hot" ? (
                <Hotspots onIntake={setIntake} />
              ) : route.view === "typeset" ? (
                <Typeset onGo={go} />
              ) : route.view === "shelf" ? (
                // 书架只放真正的书；课程、文档和自己写的走「资料」那一栏，
                // 否则 15 本藏书会被上百节导入的讲义淹掉。
                <Shelf onIntake={setIntake} state={route.state} sourceKinds={SHELF_KINDS} />
              ) : route.view === "sources" ? (
                // 资料是**表格**不是封面墙：课程章节和文档导出没有封面，
                // 摆成墙就是一屏「加封面」占位框。阅读仍然走书架那个阅读器。
                <Sources onOpen={(source, doc) => { setOpenTarget("shelf", `bookdoc:${doc.id}`); go("shelf", `book:${source.id}`); }} />
              ) : route.view === "entries" ? (
                // `#/entries/<id>` 是同一条路由的第二段，不另开一个 view——
                // 词条详情是列表的下一层，不是并列的另一页。
                route.state ? (
                  <EntryDetail
                    entryId={route.state}
                    onBack={() => go("entries")}
                    onGo={(target) => go("entries", String(target).split("/")[1] || "")}
                    onOpenSource={(sourceId) => { setOpenTarget("shelf", `bookdoc:${sourceId}`); go("shelf", "resume"); }}
                  />
                ) : (
                  <Entries onGo={(target) => {
                    const value = String(target);
                    if (value.startsWith("entries/")) go("entries", value.slice("entries/".length));
                    else go(value);
                  }} />
                )
              ) : STUDIO.has(route.view) ? (
                <Studio
                  sourceKey={route.view === "materials" ? "material-workspace" : route.view}
                  state={route.state}
                  counts={{ ...(status?.counts || {}), collectionPending: status?.collections?.pending || 0 }}
                  onState={(s) => go(route.view, s)}
                  onGo={go}
                  onIntake={setIntake}
                  onChanged={refreshStatus}
                  refreshKey={intakeVersion}
                />
              ) : null}
              </ViewSlots.Provider>
            </div>
          </main>
          {/* ⚠️ **AI 助手是面板里的第二列，不是浮在页面上的层。**
              做过浮层版：520px 的卡片压在正文上，遮住的正好是用户想一边看一边问的那块内容，
              而且它有自己的边框、阴影和圆角，看着像另一个应用贴上来的。
              现在它和正文一样在同一圈边框里——打开时正文让出宽度，两边都完整可见。 */}
          <QuickAssistant
            open={quickAssistantOpen}
            context={assistantPageContext(route)}
            conversationId={railConversationId}
            onConversationChange={setRailConversationId}
            onClose={() => setQuickAssistantOpen(false)}
            onContinue={() => { setGlobalConversationId(railConversationId); setQuickAssistantOpen(false); go("assistant"); }}
          />
        </div>
      </div>

      <CommandPalette open={finder} onClose={() => setFinder(false)} onGo={go} />

      <SettingsOverlay open={settings} onClose={() => setSettings(false)} onSaved={refreshStatus} />

      <IntakeDrawer
        open={!!intake}
        preset={intake}
        onClose={() => setIntake(null)}
        onStored={() => { refreshStatus(); setIntakeVersion((value) => value + 1); }}
        collectionsEnabled={status?.capabilities?.collectionsV1 === true}
      />
    </div>
  );
}
