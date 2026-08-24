// 一级导航只表达五个用户任务：今天做什么、内容走到哪、有什么素材、外面有什么、发布后学到什么。
// 数据库对象和旧工具路由仍保留兼容，但只归属于其中一个任务，不再争抢侧栏位置。

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./lib/api.js";
import { NAV_LABELS } from "./lib/views.js";
import { PIPELINE, SOURCES } from "./lib/sources.js";
import { normalizeMaterialRoute } from "./lib/open-target.js";
import { NAV_ICONS, IconPlus, IconLayoutSidebar, IconSearch, IconSettings, BrandMark } from "./components/icons.jsx";
import { Overview } from "./pages/Overview.jsx";
import { Today } from "./pages/Today.jsx";
import { Content } from "./pages/Content.jsx";
import { Ideas } from "./pages/Ideas.jsx";
import { Seeds } from "./pages/Seeds.jsx";
import { ProjectWorkspace } from "./pages/ProjectWorkspace.jsx";
import { Studio } from "./pages/Studio.jsx";
import { Shelf } from "./pages/Shelf.jsx";
import { Hotspots } from "./pages/Hotspots.jsx";
import { Typeset } from "./pages/Typeset.jsx";
import { Metrics, DATA_TABS } from "./pages/Metrics.jsx";
import { Review } from "./pages/Review.jsx";
import { IntakeDrawer } from "./components/IntakeDrawer.jsx";
import { CommandPalette } from "./components/CommandPalette.jsx";
import { SettingsOverlay } from "./components/SettingsOverlay.jsx";

/**
 * 状态读失败后的退避重试间隔。**三档就够**：代理抖一下是秒级的，30 秒还不通
 * 基本就是代理没开或 Worker 挂了——那种情况再退下去只是让红框来得更晚。
 */
const STATUS_RETRY_MS = [3000, 8000, 20000];

// ⚠️ `typeset` 不在这里：它现在是一级导航自己一项（工具不是阶段）
const CONTENT_VIEWS = new Set(["ideas", "seeds", "content", "project", "topics", "drafts", "review"]);
const MATERIAL_VIEWS = new Set(["materials", "collections", "inbox"]);
const DISCOVER_VIEWS = new Set(["discover", "hot", "insights", "shelf"]);
// ⚠️ `review`（待复盘）**不在这里**：它搬进内容那一栏了（见 CONTENT_VIEWS），
// 留在这儿的话点进去侧栏会同时亮两处。
const REVIEW_VIEWS = new Set(["review-performance", "review-sources", "metrics"]);

// 侧栏项。旧路由通过 match 归回新的用户任务，兼容期仍能准确高亮。
const NAV = [
  { key: "today", to: "today", match: (v) => v === "today" || v === "overview" },
  {
    key: "content", to: "content", match: (v) => CONTENT_VIEWS.has(v),
    children: [
      /**
       * ⚠️ **顺序就是流程**：还没有想写的 → 找题；有话说了 → 种子；
       * 开始写 → 项目；发出去 → 排版。
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
      { to: "ideas", label: "选种" },
      { to: "seeds", label: "种子" },
      { to: "content", label: "发芽" },
      // 「待复盘」本来就是项目的一个阶段，所以它在这一栏而不是单开一级
      { to: "review", label: "收成" },
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
      { to: "shelf", label: "书架" },
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
  /**
   * ⚠️ **「数据」没有二级项。** 「表现 / 来源」原来是两条侧栏项，而它们是**同一批数字的
   * 两个视角**——拆开的代价是每次先想「这个数字在哪一页」。现在是一页三个 tab
   * （内容明细 / 月度总览 / 数据同步），tab 走 hash 的状态段。
   * 两条旧路由留着重定向（见 `readHash`），深链不会断。
   */
  { key: "review", to: "review-performance", match: (v) => REVIEW_VIEWS.has(v) },
];

// ⚠️ **加一页要同时加进这份白名单**，不然 `parseHash` 认不出它、静默退回「今日」——
// 而那看着像「点了没反应」，不像路由漏了一项（种子页栽过一次，冒烟测试才抓到）。
const VIEWS = ["today", "ideas", "seeds", "content", "project", "review", "review-performance", "review-sources", "overview", "hot", "insights", "shelf", "typeset", "metrics", ...PIPELINE];

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
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusRetrying, setStatusRetrying] = useState(false); // 正在退避重试，还没到该报错的时候
  const retryTimer = useRef(null);
  const [intake, setIntake] = useState(null); // null=关闭；{} 或 {content,source}=打开
  const [intakeVersion, setIntakeVersion] = useState(0);
  const [railCollapsed, setRailCollapsed] = useState(loadRail);
  const [finder, setFinder] = useState(false); // 全局检索（Ctrl/⌘ + K）
  const [settings, setSettings] = useState(false); // 设置面板

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

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // 设置面板改完 VAULT_ROOT / WORKER_URL 之后要重新拉一遍：整页的空态引导都看它
  const loadConfig = useCallback(() => {
    api.config().then(setConfig).catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  /**
   * 拉一次流水线状态，失败了自己退着重试。
   *
   * 为什么必须重试：这台机器访问 workers.dev 要过代理，而代理会抖——切节点、刚开机
   * 还没连上，都是几百毫秒到几秒的事。原来这里只在挂载时取一次、失败就定死，
   * 代价是一次抖动换来整页红框 + 侧栏「流水线不可达」+「取不到稿件库」，
   * 一直挂到你手动刷新浏览器。**而那时候它其实早就通了。**
   *
   * 重试期间**不报错、也不停止 loading**：一次网络抖动不该让用户看见任何东西，
   * 界面上继续是骨架屏（它确实还在读）。三次都没成才是真出事了，那时才亮红框。
   */
  const runStatus = useCallback(
    (attempt = 0) => {
      if (!config?.worker?.configured) return;
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
    [config]
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app" data-rail={railCollapsed ? "collapsed" : "open"}>
      {/**
        * ⚠️ **应用顶栏。跨全宽，侧栏在它下面。**
        *
        * 加它是因为在这之前**这个工作台没有外壳，只有一叠文档**：每一页都从一个巨大的
        * 中文标题开始，搜索框塞在侧栏里，设置和连接状态挤在侧栏最底下。
        * 「我在哪」「搜什么」「设置在哪」这三件**跨页面不变**的事，本来就该待在一条
        * 跨页面不变的横条里——它们跟着页面内容一起滚动、一起换位置的时候，
        * 这东西看起来就像一叠网页而不像一个应用。
        *
        * 四段，从左到右：**身份**（logo + 折叠）· **位置**（面包屑）·
        * **找东西**（居中搜索）· **状态与设置**（连接点 + 齿轮）。
        */}
      <header className="topbar">
        {/* 左段包一层：顶栏是三列 grid（左 1fr · 中 auto · 右 1fr），
            中间那格才真的落在视口中心——见 styles.css 里那条注释 */}
        <div className="topbar__left">
        <div className="topbar__brand">
          <BrandMark />
          <span className="topbar__name">Xenho OS</span>
          {/* 折叠钮**常驻在顶栏**。搬上来之前它长在侧栏里，收起态时 logo 还得兼职当
              展开按钮（因为 60px 宽的一条里放不下两个方块）——那套「两种形态」的
              绕法现在整个不需要了：顶栏的宽度不受侧栏收放影响。 */}
          <button
            className="topbar__rail"
            onClick={toggleRail}
            aria-label={railCollapsed ? "展开侧栏" : "收起侧栏"}
            title={railCollapsed ? "展开侧栏" : "收起侧栏"}
          >
            <IconLayoutSidebar aria-hidden="true" stroke={1.7} />
          </button>
        </div>

        {/* 面包屑：一级任务 +（有的话）二级页面。**这是「我在哪」唯一的常驻答案** */}
        <nav className="crumbs" aria-label="当前位置">
          {(() => {
            const item = NAV.find((n) => (n.match ? n.match(route.view) : route.view === n.key));
            const Icon = item ? NAV_ICONS[item.key] : null;
            const child = item?.children?.find(
              (c) => c.to === route.view || (route.view === "project" && c.to === "content")
            );
            return (
              <>
                {Icon ? <Icon aria-hidden="true" stroke={1.7} /> : null}
                <b>{item ? NAV_LABELS[item.key] : "工作台"}</b>
                {child ? <><i aria-hidden="true">/</i><span>{child.label}</span></> : null}
              </>
            );
          })()}
        </nav>
        </div>

        {/**
          * ⚠️ **搜索框居中，而且是一句问句。**
          * 它原来在侧栏里，宽度只有 200px 出头、写着两个字「搜索」——那看着是个
          * 「侧栏功能」，而它其实是整个工作台唯一一个**跨四个库 + vault + posts + 热点**
          * 的入口。放中间、给足宽度、用一句话说清它能干什么，是在说「这是主路」。
          * **快捷键仍然不能是唯一入口**（没人会去猜一个看不见的功能存不存在）。
          */}
        <button className="topbar__find" onClick={() => setFinder(true)} title="全局检索（Ctrl+K）">
          <IconSearch aria-hidden="true" stroke={1.7} />
          <span>搜选题、稿件、素材、书里的一句话…</span>
          <kbd>Ctrl K</kbd>
        </button>

        {/**
          * 右端：连接状态 + 设置。**它们说的是同一件事的两面**——这颗点报的就是
          * 「WORKER_URL / WORKBENCH_KEY 配没配、通不通」，而齿轮是去改它的地方。
          * ⚠️ **点本身不做成按钮**：它只有 7px，一个点看不出可点；齿轮才是入口。
          */}
        <div className="topbar__end">
          <span
            className={`dot ${connTone(config, statusError, status, statusRetrying)}`}
            title={connLabel(config, statusError, status, statusRetrying)}
          />
          <button
            className="topbar__icon"
            onClick={() => setSettings(true)}
            aria-label="设置"
            title="设置：vault 路径、流水线、密钥、本机路径"
          >
            <IconSettings aria-hidden="true" stroke={1.7} />
          </button>
        </div>
      </header>

      <div className="app__body">
      <aside className="sidebar">
        {/* ⚠️ **品牌块和搜索框都搬去顶栏了。** 副标 `CREATOR WORKBENCH` 一起撤掉：
            顶栏一行放不下两行字，而那句话是说给「第一次见」听的——天天看着它，
            它就是「每个都说的话等于没说」里的那一个。 */}
        <nav className="nav">
          {NAV.map((item) => {
            const Icon = NAV_ICONS[item.key];
            const current = item.match ? item.match(route.view) : route.view === item.key;
            // 选题数 + 稿件数不等于内容项目数：同一篇会被算两次。
            // 在项目汇总没有上收到 App 前，导航不显示这个会误导人的数字。
            const badge = 0;
            return (
              <div className={`nav-group${item.children ? " has-children" : ""}`} key={item.key} data-current={current ? "true" : undefined}>
                <button
                  className="nav-item"
                  aria-current={current && !item.children ? "page" : undefined}
                  data-current={current ? "true" : undefined}
                  onClick={() => go(item.to)}
                  // 收起后只剩图标，名字得有地方可查；展开时浏览器不会为同文本再弹一次
                  title={NAV_LABELS[item.key]}
                >
                  <span className="nav-item__icon">
                    <Icon aria-hidden="true" className="nav-icon" stroke={1.7} />
                    {/* 收起态放不下数字，就退成一颗点：它回答的是「这儿有没有事」，
                        具体几件展开或点进去就知道 */}
                    {badge ? <span className="nav-item__dot" aria-hidden="true" /> : null}
                  </span>
                  <span className="nav-item__label">{NAV_LABELS[item.key]}</span>
                  {badge ? <span className="count">{badge}</span> : null}
                </button>
                {item.children && current && !railCollapsed ? (
                  <div className="subnav" aria-label={`${NAV_LABELS[item.key]}下的页面`}>
                    {item.children.map((child) => (
                      <button
                        key={child.to}
                        className="subnav-item"
                        aria-current={route.view === child.to || (route.view === "project" && child.to === "content") ? "page" : undefined}
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

        <div className="sidebar-foot">
          {/* 快捷键提示不刻在按钮上：`n` 这条快捷键学一次就记住了，而那枚小方块要跟着
              这个最显眼的按钮出现在每一屏——常驻的提示只有第一天有用。留在 title 里 */}
          <button className="btn btn-primary btn-block" onClick={() => setIntake({})} title="入库（快捷键 n）">
            <IconPlus aria-hidden="true" stroke={2} />
            <span className="nav-item__label">收集</span>
          </button>
        </div>
      </aside>

      {/* 正文面板。⚠️ **内容多包一层 `.main__inner`**：面板负责「浮起来 + 自己滚」，
          内层负责内边距和可读宽度上限。合成一层的话，限宽会让面板本身缩窄，
          右边露出一条应用底色——那看着是「面板没铺满」，不是「正文不该太宽」。 */}
      <main className="main" key={route.view}>
        <div className="main__inner">
          {route.view === "today" ? (
            <Today
              config={config}
              status={status}
              statusError={statusError}
              statusLoading={statusLoading}
              onRetryStatus={refreshStatus}
              onGo={go}
              onChanged={refreshStatus}
              onSettings={() => setSettings(true)}
            />
          ) : route.view === "ideas" ? (
            <Ideas onGo={go} onChanged={() => setIntakeVersion((v) => v + 1)} />
          ) : route.view === "seeds" ? (
            <Seeds onGo={go} onChanged={() => setIntakeVersion((v) => v + 1)} />
          ) : route.view === "content" ? (
            <Content
              workerReady={config?.worker?.configured}
              onGo={go}
              onChanged={refreshStatus}
              onSettings={() => setSettings(true)}
            />
          ) : route.view === "project" ? (
            <ProjectWorkspace projectId={route.state} onGo={go} onChanged={refreshStatus} />
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
              config={config}
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
            <Shelf onIntake={setIntake} state={route.state} />
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
        </div>
      </main>
      </div>

      <CommandPalette open={finder} onClose={() => setFinder(false)} onGo={go} vaultName={config?.vault?.name} />

      <SettingsOverlay open={settings} onClose={() => setSettings(false)} onSaved={loadConfig} />

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

/**
 * 侧栏那颗点。**重连中是黄的，不是红的**——红色是「你得去处理」，而代理抖一下
 * 用户什么都不用做，几秒后自己就好了。两者用同一个颜色的话，真出事那次就不显眼了。
 */
function connTone(config, error, status, retrying) {
  if (!config?.worker?.configured) return "";
  if (error) return "dot-bad";
  if (retrying) return "dot-warn";
  return status ? "dot-ok" : "";
}

function connLabel(config, error, status, retrying) {
  if (!config) return "本地服务连接中…";
  if (!config.worker.configured) return "未连接流水线";
  if (error) return "流水线不可达";
  if (retrying) return "流水线重连中…";
  return status ? "流水线已连接" : "读取中…";
}
