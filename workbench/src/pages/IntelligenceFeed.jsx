// 情报 · 今日精选 / 解读详情 / 每周回顾。
//
// 这一页每天要做的事只有一件：**一批精选进来，逐条判断留、弃、还是展开成选题。**
// 所有版面决定都从这句话推出来——
//   - 页名和说明不占正文（外壳页头已经写了「情报 / 今日精选」，见 `lib/view-slots.js`）；
//   - 系统状态（这批什么时候采的、覆盖了哪些来源）压成一行，它是注解不是主角；
//   - 读一条不离开列表（右侧 peek 面板），↑/↓ 换条、Esc 关掉、S 收藏、E 不感兴趣；
//   - 一屏只有一颗实心黑：「获取一批精选」，或者面板里的「加入选题」。
//
// ⚠️ **页头、页签、空态、错误框、时间格式一律用 `components/ui.jsx` 那一份。**
// 这一页曾经每样都自己写了一遍（`.brief-page-header` / `.brief-tabs` / `.brief-empty` …），
// 于是同一个动作在情报和别的模块长两个样子，而两边都不会报错。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { AssistantPane } from "../components/assistant/AssistantPane.jsx";
import { IntelligenceAngles } from "../components/IntelligenceAngles.jsx";
import { BriefPeek } from "../components/BriefPeek.jsx";
import { BriefReading, briefCardMeta, briefDate, confidenceLabel, markdown, platformName, safeUrl, sourceDate } from "../components/BriefReading.jsx";
import { Empty, ErrorNote, FilterHeader, Loading, Note, PageHeader, SectionHead, Toast, ViewTabs } from "../components/ui.jsx";
import { useUndoToast } from "../lib/use-undo-toast.js";
import { IconRadar2, IconSettings } from "../components/icons.jsx";
import "./intelligence-feed.css";

const empty = { briefs: [], reports: [], blockedSources: [], preferences: { directions: [] }, activeRuns: [] };
/**
 * ⚠️ **「已忽略」不是新概念，是缺了的那个出口。** `intel_briefs.dismissed` 一直都在，
 * 而列表把它整条过滤掉了——按下「不感兴趣」之后那一条就此消失，没有地方看到、
 * 也没有地方恢复。归档而没有归档箱，等于按下去之前得先想清楚，那不该是一次判断的成本。
 */
const TABS = [
  { key: "today", label: "本期精选" },
  { key: "unread", label: "未读补看" },
  { key: "saved", label: "我的收藏" },
  { key: "dismissed", label: "已忽略" },
];
const acquisitionName = (key) =>
  ({ brightdata: "原生采集", aihot: "AI Hot 信息流", "industry-feed": "AI Hot 信息流", "public-search": "公开搜索", local: "本地检索" }[key] || key);
const providerLabel = (key) =>
  ({ local: "已有知识", web: "公开搜索", x: "X", reddit: "Reddit", xiaohongshu: "小红书", douyin: "抖音", aihot: "AI 信息", screen: "相关性筛选", plan: "调研方案" }[key] || key);

/**
 * 键盘要不要接管这一下。
 *
 * ⚠️ **输入框里按 e 是在打字，不是「不感兴趣」。** 少这一层判断的后果是
 * 用户在搜索框里输入时，每敲一个 s 就收藏掉一条情报——而且不会有任何提示。
 */
const typingIn = (target) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function IntelligenceFeed({ view, state, onGo }) {
  const [data, setData] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useUndoToast();
  const [tab, setTab] = useState("today");

  // 整页详情（`#/intel-detail/<id>`）：长文阅读 + 和 AI 聊聊需要一整屏的宽度。
  const [brief, setBrief] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [chat, setChat] = useState(false);

  // 右侧 peek：列表还在，读的是同一条情报的同一段内容（`BriefReading`）。
  const [peekId, setPeekId] = useState("");
  const [peek, setPeek] = useState(null);
  const [peekError, setPeekError] = useState("");
  // 重试要真的再发一次请求。只把 id 设成同一个值 React 不会重跑 effect——
  // 那颗「重试」按下去屏幕上什么都不会变，看着像按钮坏了。
  const [peekNonce, setPeekNonce] = useState(0);

  const [selected, setSelected] = useState([]);
  const [merge, setMerge] = useState(false);
  const [researches, setResearches] = useState([]);
  const [researchId, setResearchId] = useState("");
  const [question, setQuestion] = useState("");
  const [selectedAngle, setSelectedAngle] = useState(null);
  const mergeRef = useRef(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);
  const [directions, setDirections] = useState("");
  const directionsDirty = useRef(false);

  const detail = view === "intel-detail";
  const reports = view === "intel-reports";

  const load = useCallback(async (quiet = false) => {
    try {
      const result = await api.intelligenceFeed();
      setData({ ...empty, ...result });
      if (!quiet) setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, view]);
  useEffect(() => { if (!directionsDirty.current) setDirections((data.preferences.directions || []).join("\n")); }, [data.preferences]);
  useEffect(() => {
    if (!data.activeRuns.length) return undefined;
    const timer = setInterval(() => { if (!document.hidden) void load(true); }, 4000);
    return () => clearInterval(timer);
  }, [data.activeRuns.length, load]);

  // `#/intel-settings` 仍是合法路由（旧书签、旧链接、测试都还指着它），
  // 但它现在打开的是今日精选 + 这一层设置，而不是一整页只放一个 textarea。
  useEffect(() => { if (view === "intel-settings") setSettingsOpen(true); }, [view]);
  useEffect(() => { if (settingsOpen) settingsRef.current?.showModal(); else settingsRef.current?.close(); }, [settingsOpen]);
  useEffect(() => { if (merge) mergeRef.current?.showModal(); }, [merge]);

  const action = async (key, fn, message = "") => {
    setBusy(key);
    setError("");
    setNotice(null);
    try {
      const result = await fn();
      if (message) setNotice({ text: message });
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy("");
    }
  };

  const applyBrief = (next) => {
    setData((d) => ({ ...d, briefs: d.briefs.map((b) => (b.id === next.id ? next : b)) }));
    setBrief((item) => (item?.id === next.id ? next : item));
    setPeek((item) => (item?.id === next.id ? next : item));
  };
  const feedback = async (item, patch) => {
    const result = await action(item.id, () => api.intelligenceFeedback(item.id, patch));
    if (result?.brief) applyBrief(result.brief);
  };
  /**
   * 忽略 / 恢复。**一定带撤销**：这是一次点击就让它从列表上消失的动作，
   * 而「已忽略」那一档虽然找得回来，代价是先想起它在哪儿。
   */
  const dismiss = async (item, dismissed) => {
    const result = await action(item.id, () => api.intelligenceFeedback(item.id, { dismissed }));
    if (!result?.brief) return;
    applyBrief(result.brief);
    setNotice(dismissed
      ? { text: "已移到「已忽略」", detail: "这一档随时能翻回来。", undo: async () => { setNotice(null); await dismiss(item, false); } }
      : { text: "已恢复推荐" });
  };
  const blockHost = (host) =>
    action("block", () => api.intelligenceBlockSource({ host, blocked: true }), `已屏蔽 ${host} 网站`);

  const rememberConversation = useCallback((id) => {
    if (id) setBrief((item) => (item ? { ...item, conversations: [{ id }, ...(item.conversations || []).filter((c) => c.id !== id)] } : item));
  }, []);

  // ---- 整页详情 -----------------------------------------------------------
  useEffect(() => {
    if (!detail) return undefined;
    let stopped = false;
    setBrief(null);
    setDetailError("");
    setChat(false);
    api.intelligenceBrief(state)
      .then(async (result) => {
        if (stopped) return;
        setBrief(result.brief);
        if (result.brief.read) return;
        try {
          const read = await api.intelligenceFeedback(state, { read: true });
          if (!stopped) setBrief(read.brief);
        } catch (e) {
          if (!stopped) setError(e.message);
        }
      })
      .catch((e) => { if (!stopped) { setDetailError(e.message); setError(e.message); } });
    return () => { stopped = true; };
  }, [detail, state]);

  const retryDetail = async () => {
    setDetailError("");
    const result = await action("detail", async () => {
      const fresh = await api.intelligenceBrief(state);
      return fresh.brief.read ? fresh : api.intelligenceFeedback(state, { read: true });
    });
    if (result?.brief) setBrief(result.brief);
    else setDetailError("这条解读暂时无法打开，请稍后重试。");
  };

  // ---- 列表与 peek --------------------------------------------------------
  const items = useMemo(
    () => (tab === "dismissed"
      ? data.briefs.filter((b) => b.dismissed)
      : data.briefs
        .filter((b) => !b.dismissed)
        .filter((b) => (tab === "saved" ? b.saved : tab === "unread" ? !b.read && b.editionDate !== data.latestEditionDate : b.editionDate === data.latestEditionDate))),
    [data.briefs, data.latestEditionDate, tab],
  );
  const dismissedCount = useMemo(() => data.briefs.filter((b) => b.dismissed).length, [data.briefs]);
  const peekIndex = items.findIndex((b) => b.id === peekId);

  useEffect(() => {
    if (!peekId) { setPeek(null); setPeekError(""); return undefined; }
    let stopped = false;
    setPeek(null);
    setPeekError("");
    api.intelligenceBrief(peekId)
      .then(async (result) => {
        if (stopped) return;
        setPeek(result.brief);
        if (result.brief.read) return;
        const read = await api.intelligenceFeedback(peekId, { read: true });
        if (!stopped) applyBrief(read.brief);
      })
      .catch((e) => { if (!stopped) setPeekError(e.message); });
    return () => { stopped = true; };
  }, [peekId, peekNonce]);

  // 打开的那条要留在视野里——按 ↓ 走到第七条时列表得跟着滚，否则面板换了内容
  // 而左边看不出是哪一条在读。
  useEffect(() => {
    if (!peekId) return;
    document.querySelector(`[data-brief="${CSS.escape(peekId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [peekId]);

  const step = useCallback((delta) => {
    if (!items.length) return;
    const at = peekIndex < 0 ? (delta > 0 ? -1 : 0) : peekIndex;
    const next = items[Math.min(items.length - 1, Math.max(0, at + delta))];
    if (next) setPeekId(next.id);
  }, [items, peekIndex]);

  const listMode = !detail && !reports;
  useEffect(() => {
    if (!listMode) return undefined;
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typingIn(event.target)) return;
      if (merge || settingsOpen) return;
      const active = peekIndex >= 0 ? items[peekIndex] : null;
      const keys = {
        ArrowDown: () => step(1), j: () => step(1),
        ArrowUp: () => step(-1), k: () => step(-1),
        Escape: () => setPeekId(""),
        Enter: () => { if (peekId) onGo("intel-detail", peekId); },
        s: () => { if (active) void feedback(active, { saved: !active.saved }); },
        e: () => { if (active) void feedback(active, { dismissed: true }); },
        x: () => { if (active) setSelected((ids) => (ids.includes(active.id) ? ids.filter((id) => id !== active.id) : [...ids, active.id])); },
      };
      const run = keys[event.key];
      if (!run) return;
      event.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listMode, merge, settingsOpen, items, peekIndex, peekId, step, onGo]);

  // ---- 汇入选题 -----------------------------------------------------------
  const startMerge = async (ids, angle = null) => {
    setSelectedAngle(angle);
    setQuestion(angle?.question || "");
    setResearchId("");
    setSelected(ids);
    setMerge(true);
    const result = await action("researches", () => api.researches());
    if (result) setResearches(result.researches || []);
  };
  const submitMerge = async (event) => {
    event.preventDefault();
    const result = await action("merge", () => api.intelligenceMerge({
      briefIds: selected,
      ...(selectedAngle ? { angle: selectedAngle } : {}),
      ...(researchId ? { researchId } : { question: question.trim() }),
    }));
    if (!result?.research?.id) return;
    // 先关掉弹层再跳。留着它的话，回到情报时那一层还盖在页面上——
    // 而它问的问题已经答完了。
    setMerge(false);
    setSelectedAngle(null);
    setSelected([]);
    onGo("research", result.research.id);
  };

  const report = data.reports.find((r) => r.id === state);
  const latestRun = data.latestRun;
  const errorNote = error ? <ErrorNote error={{ message: error }} what="读取情报" onRetry={() => load()} /> : null;

  // ---- 整页详情 -----------------------------------------------------------
  if (detail) {
    return (
      <div className="intel-feed intel-feed--detail">
        {!brief ? (
          detailError ? (
            <section className="brief-detail-fallback">
              <Empty icon={IconRadar2}>
                <h2>这条解读暂时无法打开</h2>
                <p>{detailError}</p>
                <div className="empty-acts">
                  <button type="button" className="btn" disabled={Boolean(busy)} onClick={retryDetail}>重试打开</button>
                  <button type="button" className="btn" onClick={() => onGo("intel")}>返回精选</button>
                </div>
              </Empty>
            </section>
          ) : (
            <p role="status" className="brief-detail-fallback">正在打开解读…</p>
          )
        ) : (
          <>
            <header className="brief-detail-toolbar">
              <button type="button" className="btn" onClick={() => onGo("intel")}>← 返回精选</button>
              <div>
                <button
                  type="button"
                  className="btn"
                  disabled={Boolean(busy)}
                  aria-pressed={Boolean(brief.saved)}
                  onClick={() => feedback(brief, { saved: !brief.saved })}
                >
                  {brief.saved ? "已收藏" : "收藏"}
                </button>
                {/* ⚠️ **讨论只有这一个入口。** 正文中间原来还有一整块「这个发现让你想到什么？[继续讨论]」，
                    和这颗按钮是同一个动作、两种说法、两个位置——用户得先分辨它们是不是同一件事。 */}
                <button type="button" className="btn" aria-pressed={chat} onClick={() => setChat((v) => !v)}>
                  {chat ? "收起讨论" : "和 AI 聊聊"}
                </button>
                <button type="button" className="btn btn-primary" onClick={() => startMerge([brief.id])}>加入选题</button>
              </div>
            </header>
            <div className={`brief-detail-layout ${chat ? "with-chat" : ""}`}>
              <article className="brief-reading">
                {errorNote}
                <BriefReading brief={brief} onGo={onGo} onBlock={blockHost} />
                <IntelligenceAngles key={`${brief.id}:${brief.version || 1}`} brief={brief} onChoose={(angle) => startMerge([brief.id], angle)} />
                <footer className="brief-reading-actions">
                  <button
                    type="button"
                    className="text-action"
                    disabled={Boolean(busy)}
                    aria-pressed={Boolean(brief.helpful)}
                    onClick={() => feedback(brief, { helpful: !brief.helpful })}
                  >
                    {brief.helpful ? "已记为有启发" : "有启发"}
                  </button>
                  <button type="button" className="text-action" disabled={Boolean(busy)} onClick={() => feedback(brief, { dismissed: !brief.dismissed })}>
                    {brief.dismissed ? "恢复推荐" : "不感兴趣"}
                  </button>
                </footer>
              </article>
              {chat ? (
                <aside className="brief-chat">
                  <header><strong>围绕这条信息聊聊</strong></header>
                  <AssistantPane
                    key={brief.id}
                    embedded
                    scope="global"
                    surface="page"
                    scopeId={brief.scopeId || `intelligence:${brief.id}`}
                    initialConversationId={brief.conversations?.[0]?.id || ""}
                    onConversationChange={rememberConversation}
                    document={{ title: brief.title, body: brief.body, intelligenceId: brief.id }}
                    materials={[]}
                    target={{ kind: "none", editable: false }}
                    emptyMessage="哪里值得展开、与你有什么关系，都可以接着聊。"
                    draftStorageKey={`intelligence:${brief.id}`}
                  />
                </aside>
              ) : null}
            </div>
          </>
        )}
        {mergeDialog()}
        <Toast text={notice?.text} detail={notice?.detail} onUndo={notice?.undo} onClose={() => setNotice(null)} />
      </div>
    );
  }

  // ---- 每周回顾 -----------------------------------------------------------
  if (reports) {
    return (
      <div className="intel-feed">
        <PageHeader
          title="每周回顾"
          count={data.reports.length || undefined}
          aside={
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy) || Boolean(data.activeRuns.length)}
              onClick={() => action("refresh", async () => {
                const result = await api.intelligenceReport();
                await load();
                return result;
              }, "周报已生成")}
            >
              {busy === "refresh" ? "正在整理…" : "生成本周回顾"}
            </button>
          }
        />
        {errorNote}
        {loading ? <Loading rows={4} /> : report ? (
          <article className="brief-report">
            <button type="button" className="btn btn-sm brief-back" onClick={() => onGo("intel-reports")}>← 全部周报</button>
            <h1>{report.title}</h1>
            <p className="brief-meta">
              {briefDate(report.periodStart || report.coverage?.from)} — {briefDate(report.periodEnd || report.coverage?.to)}
            </p>
            {markdown(report.body)}
            {report.evidence?.length > 0 ? (
              <section className="brief-report-evidence">
                <h2>引用来源</h2>
                <ol>
                  {report.evidence.map((source, index) => (
                    <li key={`${source.id || source.sourceId || source.url}-${index}`}>
                      <strong>[{source.number || source.index || index + 1}] {source.title || "参考来源"}</strong>
                      {source.quote ? <p>{source.quote}</p> : null}
                      {safeUrl(source.url) ? <a href={safeUrl(source.url)} target="_blank" rel="noreferrer">查看原文 ↗</a> : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </article>
        ) : !data.reports.length ? (
          <Empty icon={IconRadar2}>
            <h2>把一周的信息连起来</h2>
            <p>点击「生成本周回顾」，整理本周的变化、实践与待观察问题。</p>
          </Empty>
        ) : (
          <div className="rows brief-reports">
            {data.reports.map((r) => (
              <div className="row" key={r.id}>
                <button type="button" className="row-head" onClick={() => onGo("intel-reports", r.id)}>
                  <span className="row-title">{r.title}</span>
                  <span className="row-meta">
                    {briefDate(r.periodStart || r.coverage?.from)} — {briefDate(r.periodEnd || r.coverage?.to)}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
        {mergeDialog()}
        <Toast text={notice?.text} detail={notice?.detail} onUndo={notice?.undo} onClose={() => setNotice(null)} />
      </div>
    );
  }

  // ---- 今日精选 -----------------------------------------------------------
  return (
    <div className="intel-feed">
      {/* 胶囊、动作和计数走和 找题 / 选题 / 复盘 / 数据 / 热点 同一份页头。
          说明句不传：它是给第一次来的人的，不该每天占着第一屏最上面一行（空态里有）。 */}
      <FilterHeader
        title="今日精选"
        chips={
          <ViewTabs
            items={TABS.map((item) => ({
              ...item,
              count: item.key === "unread" ? data.unreadEarlierCount || undefined : undefined,
            }))}
            value={tab}
            onChange={(next) => { setTab(next); setSelected([]); setPeekId(""); }}
            label="精选范围"
          />
        }
        action={
          <>
            <span className="view-head__count brief-head-count">{items.length} 条</span>
            {/* 窄屏只留图标（文字由 CSS 收起来）。`aria-label` always 在，
                所以可访问名不会跟着屏幕宽度变。 */}
            <button type="button" className="btn brief-head-settings" aria-label="关注方向设置" onClick={() => setSettingsOpen(true)}>
              <IconSettings aria-hidden="true" stroke={1.7} />
              <span>关注方向</span>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(busy) || Boolean(data.activeRuns.length)}
              onClick={() => action("refresh", async () => {
                const result = await api.intelligenceRefreshFeed();
                await load();
                return result;
              }, "已开始整理这一批精选")}
            >
              {busy === "refresh" ? "正在整理…" : "获取一批精选"}
            </button>
          </>
        }
      />

      {errorNote}

      {loading ? <Loading rows={5} /> : (
        <>
          {/* 系统状态一行说完：这批什么时候采的、覆盖了哪些来源、整理了几条。
              这四件事原来是四条独立的灰字，把第一条情报推到了首屏 536px 处。 */}
          <div className="brief-status">
            <span>{data.preferences.nativeSocialEnabled ? "手动采集 · X / Reddit 原生" : "手动整理 · 公开搜索与 AI Hot"}</span>
            {latestRun?.window ? (
              <span>本次查找：{sourceDate(latestRun.window.start)} — {sourceDate(latestRun.window.end)}（北京时间）</span>
            ) : null}
            {!data.activeRuns.length && latestRun ? (
              <details className="brief-run-result">
                <summary>
                  {latestRun.status === "failed"
                    ? `本次未完成：${latestRun.error || "未能完成整理"}`
                    : latestRun.status === "cancelled"
                      ? "本次整理已取消"
                      : `本次已整理 ${latestRun.briefCount ?? latestRun.count ?? data.briefs.filter((b) => b.editionDate === data.latestEditionDate).length} 条精选`}
                  <span>本次来源</span>
                </summary>
                {(latestRun.coverage || []).filter((c) => c.targets?.length).map((c) => (
                  <p key={`targets-${c.provider}`}>{platformName(c.provider)} 范围：{c.targets.join("、")}</p>
                ))}
                {(latestRun.coverage || []).flatMap((c) => c.rejectionReasons || []).map((r, i) => (
                  <p key={`rejected-${i}`}>未采用：{r.title} · {r.error}</p>
                ))}
                {latestRun.error && latestRun.status !== "failed" ? <p>{latestRun.error}</p> : null}
                {latestRun.sourceStats?.length
                  ? latestRun.sourceStats.map((source, index) => (
                      <p key={`${source.provider}-${index}`}>
                        {platformName(source.provider)} · {acquisitionName(source.acquisitionMethod)} · 收集 {source.collected || 0} 条
                        {["x", "reddit"].includes(source.provider) ? `（${source.posts || 0} 篇帖子、${source.comments || 0} 条评论）` : ""}
                        {" · "}采用 {source.adopted || 0} 条
                        {source.publicationUnknown ? ` · ${source.publicationUnknown} 条原始日期未知` : ""}
                      </p>
                    ))
                  : (latestRun.coverage || []).filter((c) => c.provider !== "plan").map((c, index) => (
                      <p key={`${c.provider}-${index}`}>
                        {providerLabel(c.provider)} · {c.count || 0} 条{c.error ? ` · ${c.error}` : c.count ? "" : " · 未取得匹配资料"}
                      </p>
                    ))}
                {latestRun.sourceStats?.length > 0
                  ? (latestRun.coverage || []).filter((c) => c.error).map((c, index) => (
                      <p key={`error-${c.provider}-${index}`}>{platformName(c.provider)}：{c.error}</p>
                    ))
                  : null}
                {["failed", "partial"].includes(latestRun.status) ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={Boolean(busy)}
                    onClick={() => action("retry", async () => {
                      const result = await api.intelligenceRetry(latestRun.id);
                      await load();
                      return result;
                    }, "已继续整理这批内容")}
                  >
                    重试这批内容
                  </button>
                ) : null}
              </details>
            ) : null}
          </div>

          {data.activeRuns.length > 0 ? <Note tone="default" title="正在阅读资料、筛选和整理精选">完成后会自动显示，不用守着这一页。</Note> : null}

          <div className={`intel-feed__body ${peekId ? "has-peek" : ""}`}>
            <div className="intel-feed__list">
              {!items.length ? (
                <Empty icon={IconRadar2}>
                  <h2>{tab === "saved" ? "还没有收藏" : tab === "dismissed" ? "还没有忽略过任何一条" : tab === "unread" ? "未读已经看完了" : data.activeRuns.length ? "这一批正在整理" : "从第一批精选开始"}</h2>
                  <p>
                    {tab === "today"
                      ? "根据关注方向阅读相关资料，留下可靠的信息和值得观察的线索。点右上角开始一次试用。"
                      : tab === "dismissed" ? "按过「不感兴趣」的会留在这里，随时可以恢复推荐。"
                      : "有价值的内容可以留着慢慢看。"}
                  </p>
                  {!data.preferences.directions?.length ? (
                    <div className="empty-acts">
                      <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>设置关注方向</button>
                    </div>
                  ) : null}
                </Empty>
              ) : null}

              {["reliable", "watch"].map((confidence) => {
                const group = items.filter((b) => (b.confidence || "watch") === confidence);
                if (!group.length) return null;
                return (
                  <section className="brief-group" key={confidence}>
                    <SectionHead
                      title={confidenceLabel(confidence)}
                      aside={<span className="brief-group__hint">{confidence === "reliable" ? "有依据，可以进一步了解" : "保留线索，结论仍需验证"}</span>}
                    />
                    <div className="brief-grid">{group.map(card)}</div>
                  </section>
                );
              })}
            </div>

            {peekId ? (
              <BriefPeek
                brief={peek}
                error={peekError}
                position={peekIndex + 1}
                total={items.length}
                busy={busy}
                onRetry={() => setPeekNonce((n) => n + 1)}
                onClose={() => setPeekId("")}
                onFull={() => onGo("intel-detail", peekId)}
                onPrev={peekIndex > 0 ? () => step(-1) : undefined}
                onNext={peekIndex >= 0 && peekIndex < items.length - 1 ? () => step(1) : undefined}
                onFeedback={(patch) => ("dismissed" in patch ? dismiss(peek || { id: peekId }, patch.dismissed) : feedback(peek || { id: peekId }, patch))}
                onMerge={() => startMerge([peekId])}
                onGo={onGo}
                onBlock={blockHost}
              />
            ) : null}
          </div>

          {selected.length > 0 && !merge ? (
            <div className="brief-selection-bar">
              <span>已选 {selected.length} 条</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => startMerge(selected)}>一起展开成选题</button>
              <button type="button" className="btn btn-sm" onClick={() => setSelected([])}>取消选择</button>
            </div>
          ) : null}
        </>
      )}

      {settingsDialog()}
      {mergeDialog()}
      <Toast text={notice?.text} detail={notice?.detail} onUndo={notice?.undo} onClose={() => setNotice(null)} />
    </div>
  );

  // ---- 局部渲染 -----------------------------------------------------------

  /**
   * 一条情报的卡片。
   *
   * ⚠️ **卡上只放做决定要用的东西**：未读点、标题、一句摘要、来源和原文日期。
   * AI 的推荐理由和「首次收集」日期是**读完之后**才需要的注解，进 peek。
   * 上一版把它们全摊在卡上，一条 240px 高，一屏看得到一条半。
   */
  function card(item) {
    const active = item.id === peekId;
    const picked = selected.includes(item.id);
    return (
      <article
        key={item.id}
        data-brief={item.id}
        className={`brief-card ${item.read ? "is-read" : ""} ${active ? "is-active" : ""} ${picked ? "is-picked" : ""} ${item.dismissed ? "is-dismissed" : ""}`}
      >
        <div className="brief-card__top">
          {/* 选择和已读是两件事，不共用一枚标签。checkbox 平时收起来——
              一屏九张卡各挂一个空方框，那九个框会成为屏幕上最先被看见的东西。 */}
          <label className="brief-card__pick">
            <input
              type="checkbox"
              aria-label={`选择：${item.title}`}
              checked={picked}
              onChange={(e) => setSelected((ids) => (e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id)))}
            />
          </label>
          {/* 已读/未读靠标题前那枚点和字重读出来。这一条是给读屏用的——
              「文本和状态不只依赖颜色」，而它不能进标题按钮，
              否则按钮的可访问名就不再是标题本身了。 */}
          <span className="brief-card__sr">{item.read ? "已读" : "未读"}</span>
          <span className="brief-card__kind">
            {item.analysis ? (item.analysis.documentCount > 1 ? `综合 ${item.analysis.documentCount} 份` : "单篇") : ""}
            {item.changeNote ? " · 有更新" : ""}
          </span>
        </div>
        <button type="button" className="brief-card__title" onClick={() => setPeekId(item.id)}>
          {item.read ? null : <span className="brief-card__dot" aria-hidden="true" />}
          {item.title}
        </button>
        <p className="brief-card__summary">{item.summary}</p>
        <footer>
          <span className="brief-card__meta">{briefCardMeta(item)}</span>
          {/* 「已忽略」那一档里，这一行唯一要回答的问题是「要不要拿回来」 */}
          <span className="brief-card__acts">
            {item.dismissed ? (
              <button type="button" className="text-action" disabled={Boolean(busy)} onClick={() => dismiss(item, false)}>
                恢复推荐
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="text-action"
                  disabled={Boolean(busy)}
                  aria-pressed={Boolean(item.saved)}
                  onClick={() => feedback(item, { saved: !item.saved })}
                >
                  {item.saved ? "已收藏" : "收藏"}
                </button>
                <button type="button" className="text-action" disabled={Boolean(busy)} onClick={() => dismiss(item, true)}>
                  不感兴趣
                </button>
              </>
            )}
          </span>
        </footer>
      </article>
    );
  }

  function settingsDialog() {
    return (
      <dialog ref={settingsRef} className="brief-settings" aria-label="关注方向设置" onClose={() => setSettingsOpen(false)} onCancel={() => setSettingsOpen(false)}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await action("preferences", async () => {
              const saved = await api.intelligencePreferences({ directions: directions.split("\n").map((s) => s.trim()).filter(Boolean) });
              directionsDirty.current = false;
              await load();
              return saved;
            }, "关注方向已保存");
            // 存完就关，确认落在你刚才动手的地方旁边——不是让弹层继续挡着结果。
            if (result) setSettingsOpen(false);
          }}
        >
          <h2>关注方向</h2>
          <label>
            关注哪些方向？
            <textarea
              aria-label="关注方向"
              rows={5}
              value={directions}
              onChange={(e) => { directionsDirty.current = true; setDirections(e.target.value); }}
              placeholder={"AI 产品与模型进展\nAI 的真实使用方法与案例\n与我的创作有关的新思路"}
            />
          </label>
          <p className="brief-settings__hint">
            每行一个方向，按你的实际兴趣写即可。
            {data.preferences.nativeSocialEnabled
              ? "当前每次采集最多 6 个 X 账号、4 个 Reddit 社区，各 3 篇。"
              : "当前用公开搜索与 AI Hot 取材。"}
            持续采集保持关闭，先按次试用。
          </p>

          {data.blockedSources.length > 0 ? (
            <section className="brief-blocked">
              <h3>不再推荐的来源</h3>
              {data.blockedSources.map((entry) => {
                const host = typeof entry === "string" ? entry : entry.host;
                return (
                  <div key={host}>
                    <span>{host}</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={Boolean(busy)}
                      onClick={() => action(host, async () => {
                        const result = await api.intelligenceBlockSource({ host, blocked: false });
                        await load();
                        return result;
                      })}
                    >
                      恢复推荐
                    </button>
                  </div>
                );
              })}
            </section>
          ) : null}

          <footer>
            <button type="submit" className="btn btn-primary" disabled={Boolean(busy)}>保存关注方向</button>
            <button type="button" className="btn" onClick={() => setSettingsOpen(false)}>关闭</button>
          </footer>
        </form>
      </dialog>
    );
  }

  function mergeDialog() {
    if (!merge) return null;
    return (
      <dialog ref={mergeRef} className="brief-merge" aria-label="汇入选题" onCancel={() => setMerge(false)}>
        <form onSubmit={submitMerge}>
          <h2>把 {selected.length} 条信息汇入选题</h2>
          <p>资料与解读会一起带过去，继续讨论和写作。</p>
          {selectedAngle ? (
            <section className="brief-angle-preview">
              <strong>表达角度：{selectedAngle.question}</strong>
              <p>{selectedAngle.audience}</p>
              <p>还需要验证：{selectedAngle.gap}</p>
              <small>确认后，这个角度与依据会作为待验证笔记带入，已有笔记会保留。</small>
            </section>
          ) : null}
          <label>
            放到哪里？
            <select aria-label="目标选题" value={researchId} onChange={(e) => setResearchId(e.target.value)}>
              <option value="">新建一个选题</option>
              {researches.map((r) => <option key={r.id} value={r.id}>{r.question || r.title}</option>)}
            </select>
          </label>
          {!researchId ? (
            <label>
              想研究的问题
              <input aria-label="想研究的问题" required value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="这些信息让你想进一步了解什么？" />
            </label>
          ) : null}
          <footer>
            <button type="submit" className="btn btn-primary" disabled={Boolean(busy) || (!researchId && !question.trim())}>汇入并继续</button>
            <button type="button" className="btn" onClick={() => setMerge(false)}>取消</button>
          </footer>
        </form>
      </dialog>
    );
  }
}
