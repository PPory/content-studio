// 侧栏就是一天的动线：看外面（热点/洞察）→ 做内容（创作/书架）→ 发出去（排版）→ 看反馈（数据）。
//
// **流水线四段不占四个侧栏项**。灵感库 → 素材库 → 选题库 → 稿件库是一条链的四段，
// 摊成页内 tab 才看得出「东西是从左往右走的」；排成四行侧栏项反而把这层关系藏了。
// 侧栏那一项高亮的条件是「当前在四段里的任意一段」。

import { useCallback, useEffect, useState } from "react";
import { api } from "./lib/api.js";
import { NAV_LABELS } from "./lib/views.js";
import { PIPELINE, SOURCES } from "./lib/sources.js";
import { NAV_ICONS, IconPlus, IconLayoutSidebar, IconSearch, IconSettings, BrandMark } from "./components/icons.jsx";
import { Overview } from "./pages/Overview.jsx";
import { Studio } from "./pages/Studio.jsx";
import { Shelf } from "./pages/Shelf.jsx";
import { Hotspots } from "./pages/Hotspots.jsx";
import { Typeset } from "./pages/Typeset.jsx";
import { Metrics } from "./pages/Metrics.jsx";
import { IntakeDrawer } from "./components/IntakeDrawer.jsx";
import { CommandPalette } from "./components/CommandPalette.jsx";
import { SettingsOverlay } from "./components/SettingsOverlay.jsx";

// 侧栏项。`match` 用来判断「当前路由算不算这一项」——「创作」要覆盖流水线四段。
const NAV = [
  { key: "overview", to: "overview" },
  { key: "hot", to: "hot" },
  { key: "studio", to: "collections", match: (v) => PIPELINE.includes(v) },
  { key: "insights", to: "insights" },
  { key: "shelf", to: "shelf" },
  { key: "typeset", to: "typeset" },
  { key: "metrics", to: "metrics" },
];

const VIEWS = ["overview", "hot", "insights", "shelf", "typeset", "metrics", ...PIPELINE];

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
  const view = decodeURIComponent(rawView) || "overview";
  return { view: VIEWS.includes(view) ? view : "overview", state: decodeURIComponent(rest.join("/")) };
}

export function App() {
  const [route, setRoute] = useState(readHash);
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
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

  const refreshStatus = useCallback(() => {
    if (!config?.worker?.configured) return;
    setStatusLoading(true);
    setStatusError(null);
    api
      .status()
      .then(setStatus)
      .catch(setStatusError)
      .finally(() => setStatusLoading(false));
  }, [config]);

  useEffect(() => {
    refreshStatus();
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

  // 「创作」那一项的角标 = 整条流水线的待办总数。分段的数字挂在页内 tab 上。
  const pipelinePending =
    (status?.collections?.pending ?? 0) + (status?.counts?.待初筛 ?? 0) + (status?.counts?.选题待写 ?? 0) + (status?.counts?.内容待修改 ?? 0);

  return (
    <div className="app" data-rail={railCollapsed ? "collapsed" : "open"}>
      <aside className="sidebar">
        <div>
          <div className="brand-row">
            <div className="brand">
              {/**
               * 收起态下 logo 自己就是展开按钮，那时收放按钮是藏起来的：60px 宽的一条里
               * 摆两个方块（logo + 开关）显得挤，而 logo 本来就在最顺手的位置上。
               * 展开态它退回纯标识（`pointer-events: none` + 移出无障碍树），
               * 免得「点 logo 是回首页还是收侧栏」变成一个要想一下的问题。
               * **DOM 只有一套**，两种形态的差别全在 CSS 和 title 上。
               */}
              <button
                className="brand-mark"
                onClick={toggleRail}
                tabIndex={railCollapsed ? 0 : -1}
                aria-hidden={!railCollapsed}
                aria-label={railCollapsed ? "展开侧栏" : undefined}
                title={railCollapsed ? "展开侧栏" : undefined}
              >
                <BrandMark />
              </button>
              <div className="brand-name">Xenho OS</div>
            </div>
            {/* 展开态常驻，不做成 hover 才现身：收放侧栏是随手就要用的动作，
                藏起来的话每次都得先拿鼠标去扫一遍才找得到 */}
            <button className="rail-toggle" onClick={toggleRail} aria-label="收起侧栏" title="收起侧栏">
              <IconLayoutSidebar aria-hidden="true" stroke={1.7} />
            </button>
          </div>
          {/* 副标解释主名：「OS」本身不说明这是干什么的，这一行才说明 */}
          <div className="brand-tag">CREATOR WORKBENCH</div>
        </div>

        {/* **快捷键不能是唯一的入口。** Ctrl+K 学一次就记住了，但没人会去猜一个
            看不见的功能存不存在——所以搜索框长成一个真的能点的东西，
            按键提示压在右边（收起态只剩放大镜图标）。 */}
        <button className="rail-find" onClick={() => setFinder(true)} title="全局检索（Ctrl+K）">
          <IconSearch className="nav-icon" aria-hidden="true" stroke={1.7} />
          <span className="nav-item__label">搜索</span>
          <kbd className="nav-item__label">Ctrl K</kbd>
        </button>

        <nav className="nav">
          {NAV.map((item) => {
            const Icon = NAV_ICONS[item.key];
            const current = item.match ? item.match(route.view) : route.view === item.key;
            const badge = item.key === "studio" ? pipelinePending : 0;
            return (
              <button
                key={item.key}
                className="nav-item"
                aria-current={current}
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
            );
          })}
        </nav>

        <div className="sidebar-foot">
          {/* 快捷键提示不刻在按钮上：`n` 这条快捷键学一次就记住了，而那枚小方块要跟着
              这个最显眼的按钮出现在每一屏——常驻的提示只有第一天有用。留在 title 里 */}
          <button className="btn btn-primary btn-block" onClick={() => setIntake({})} title="入库（快捷键 n）">
            <IconPlus aria-hidden="true" stroke={2} />
            <span className="nav-item__label">入库</span>
          </button>
          {/**
            * 连接状态 + 设置入口住在一起，因为它们说的是同一件事的两面：
            * 这一行报的就是「WORKER_URL / WORKBENCH_KEY 配没配、通不通」，
            * 而齿轮是去改它的地方。
            *
            * **这一行本身不做成按钮**：收起态下它只剩一颗 7px 的点，
            * 一个点是看不出可点的。齿轮才是那个可点的东西。
            *
            * 收起态**不写第二套 DOM**：状态点绝对定位到齿轮右上角当角标
            *（复用「60px 里放不下就退成一颗点」那条规则，见 .nav-item__dot），
            * 差别全在 CSS 里。
            */}
          <div className="conn" title={connLabel(config, statusError, status)}>
            <span className={`dot ${connTone(config, statusError, status)}`} />
            <span className="nav-item__label conn__label">{connLabel(config, statusError, status)}</span>
            <button
              className="conn__gear"
              onClick={() => setSettings(true)}
              aria-label="设置"
              title="设置：vault 路径、流水线、密钥、本机路径"
            >
              <IconSettings aria-hidden="true" stroke={1.7} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main" key={route.view}>
        {route.view === "overview" ? (
          <Overview
            config={config}
            status={status}
            statusError={statusError}
            statusLoading={statusLoading}
            onGo={go}
            onIntake={() => setIntake({})}
            onSettings={() => setSettings(true)}
          />
        ) : route.view === "hot" ? (
          <Hotspots onIntake={setIntake} />
        ) : route.view === "typeset" ? (
          <Typeset />
        ) : route.view === "metrics" ? (
          <Metrics onSettings={() => setSettings(true)} />
        ) : route.view === "shelf" ? (
          <Shelf onIntake={setIntake} state={route.state} />
        ) : STUDIO.has(route.view) ? (
          <Studio
            sourceKey={route.view}
            state={route.state}
            counts={{ ...(status?.counts || {}), collectionPending: status?.collections?.pending || 0 }}
            onState={(s) => go(route.view, s)}
            onGo={go}
            onIntake={setIntake}
            onChanged={refreshStatus}
            refreshKey={intakeVersion}
          />
        ) : null}
      </main>

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

function connTone(config, error, status) {
  if (!config?.worker?.configured) return "";
  if (error) return "dot-bad";
  return status ? "dot-ok" : "";
}

function connLabel(config, error, status) {
  if (!config) return "本地服务连接中…";
  if (!config.worker.configured) return "未连接流水线";
  if (error) return "流水线不可达";
  return status ? "流水线已连接" : "读取中…";
}
