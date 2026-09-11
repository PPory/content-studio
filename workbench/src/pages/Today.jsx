// 首页。回答三个问题，各占一块，**互不重复**：
// 今天有什么新的（情报一行）、接着做什么（一条列表）、接着读什么（窄栏）。
//
// ⚠️ **上一版最大的毛病不是好不好看，是同一个东西被列了两遍。** 量过：
// 3 选题 + 3 文章 + 2 Wiki 的工作区里，页面上 **15 行、去重后 8 个东西**，
// 七个各出现两次——「正在展开的选题」和「文章」里各一次、「最近打开」里又一次；
// 两个 Wiki 页在「最近阅读」和「阅读与 Wiki」里各一次。
//
// ⚠️ **「最近打开」不是一个面板，是一个排序键**（判据见 `docs/design-system.md`）。
// 它存在的唯一理由是「打开看了但没改」排不进主列表——那件事现在并进了
// `recentWork` 的排序（`server/domain/research.mjs`），面板于是不需要存在。
//
// ⚠️ **「阅读与 Wiki」整块撤了**：它和「最近阅读」是同一批，而「浏览」「管理 Wiki」
// 两个去处都在侧栏。导航不待在正文里。
//
// 记录框收成一行：侧栏收件箱和快捷键 `n` 已经是全局的「记一下」
//（`components/QuickNote.jsx`），这里留一行是因为它多做一件别处没有的事——
// 存完之后找相关 Wiki，再「带着这个角度讨论」直接建成选题。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { NewContentButton } from "../components/NewContentButton.jsx";
import { Empty, ErrorNote, Loading, PageHeader, Toast, relTime } from "../components/ui.jsx";
import { IconBulb, IconEyeOff, IconPin, IconPinFilled, IconRadar2 } from "../components/icons.jsx";
import { stripDuplicateHeading } from "../lib/markdown.js";
import { pct } from "../lib/reading.js";
import { useUndoToast } from "../lib/use-undo-toast.js";
import "./workspace-home.css";
import { useDialog } from "../lib/use-dialog.js";

const KIND_LABEL = { research: "选题", project: "文章", wiki: "Wiki" };

/**
 * 摘要一行：够你认出「上次想到哪儿了」，不够就别占这一行。
 *
 * ⚠️ **先去掉开头那个和标题重复的 H1。** 稿子正文普遍第一行就是 `# 同名标题`，
 * 而摘要就贴在标题下面——上一版屏幕上是
 *「AI 写作里那条真实性硬闸 AI 写作里那条真实性硬闸 这一篇的开头…」。
 * 判据是「同一事实只出现一次」，实现共用 `lib/markdown.js` 那一份。
 */
function excerptOf(item) {
  const raw = stripDuplicateHeading(item.excerpt || "", item.title);
  return raw.replace(/[#*`>]/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
}

export function Today({ onGo, onChanged, onForceGo = onGo, registerNavigationGuard }) {
  const [pending, setPending] = useState(null);
  const leaveDialog = useDialog(Boolean(pending), () => setPending(null));
  const [items, setItems] = useState(null);
  const [reading, setReading] = useState([]);
  const [intel, setIntel] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(null);
  const [connections, setConnections] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [toast, setToast] = useUndoToast();
  const field = useRef(null);

  /**
   * 让输入框跟着内容长高。
   *
   * ⚠️ **不能只靠 CSS 的固定高度。** 390px 上「记一个想法或疑问…」这句
   * placeholder 就要折两行，而固定高度会把第二行切掉——一个把自己的提示文字
   * 切掉一半的输入框，比一个大盒子更糟。上限交给 CSS 的 `max-height`，到顶再滚。
   */
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const load = useCallback(async () => {
    // ⚠️ 三个请求互不依赖，失败一个不能让整页空掉——情报那一行拿不到就不画那一行
    const results = await Promise.allSettled([api.recentWork(), api.workspaceActivity(), api.intelligenceFeedSummary()]);
    if (results[0].status === "fulfilled") setItems(results[0].value.items || []);
    if (results[1].status === "fulfilled") setReading(results[1].value.reading || []);
    setIntel(results[2].status === "fulfilled" ? results[2].value : null);
    setError(results.slice(0, 2).find((r) => r.status === "rejected")?.reason || null);
  }, []);

  useEffect(() => { load(); window.addEventListener("focus", load); return () => window.removeEventListener("focus", load); }, [load]);
  useEffect(() => { const warn = e => { if (text.trim()) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [text]);
  useEffect(() => registerNavigationGuard?.(next => { if (!text.trim()) return false; setPending(next); return true; }), [text, registerNavigationGuard]);

  async function capture(e) {
    e.preventDefault(); if (!text.trim() || busy) return;
    setBusy(true); setError(null); const value = text;
    try {
      const { item } = await api.quickNote({ text: value }); setSaved({ ...item, original: value }); setText(""); setExpanded(false); setConnections(null); setStatus("已留下，正在查找相关 Wiki…");
      try { const result = await api.wikiConnections(value.slice(0, 500)); setConnections(result.items || []); setStatus(result.items?.length ? "已留下" : "已留下，暂未找到相关 Wiki"); } catch { setStatus("想法已保存，暂时无法查找 Wiki 关联"); }
      await load(); onChanged?.(); return true;
    } catch (e) { setError(e); return false; } finally { setBusy(false); }
  }

  async function develop(wikiItem) {
    if (!saved || busy) return; setBusy(true); setError(null);
    try {
      // Keep a created topic on retry if linking fails; never create duplicate topics.
      const id = saved.researchId || (await api.createResearch({ question: saved.original.slice(0, 300), notes: saved.original })).research.id;
      setSaved(prev => ({ ...prev, researchId: id }));
      await api.researchReference(id, { kind: "capture", id: saved.id });
      if (wikiItem) await api.researchReference(id, { kind: "wiki", id: wikiItem.id });
      onGo("research", id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  /**
   * 打开一条。文章要落到它所属选题的写作位置上，不是孤零零一份稿子——
   * 这条路径原来就在，别改。
   */
  async function open(item) {
    const view = item.route?.view || (item.kind === "research" ? "research" : item.kind === "wiki" ? "library" : "project");
    const id = item.route?.state || (item.kind === "wiki" ? `wiki:${item.id}` : item.id);
    if (view !== "project") return onGo(view, id);
    try {
      const { researches } = await api.projectResearches(item.id);
      const topic = researches?.[0];
      if (!topic) return onGo(view, item.id);
      const key = `xenho:research-position:${topic.id}`;
      let previous = {};
      try { previous = JSON.parse(localStorage.getItem(key) || "{}"); } catch {}
      try { localStorage.setItem(key, JSON.stringify({ ...previous, tab: "article", projectId: item.id })); } catch {}
      onGo("research", topic.id);
    } catch (e) { setError(e); }
  }

  /**
   * 置顶 / 从首页收起。
   *
   * ⚠️ 两颗都走**早就写好的** `api.workState`（`server/domain/research.mjs` 的
   * `workState`，校验齐全、`recentWork` 已经按 `pinned DESC` 排序）——在这之前
   * 前端一次都没调用过它，于是首页没有任何优先级表达。
   *
   * 「收起」不是删除，所以文案是「不在首页出现」；但仍然要给撤销，
   * 因为界面上没有「被收起的那些」这一页可以翻回去。
   */
  const setState = async (item, patch) => {
    try { await api.workState(item.kind, item.id, patch); await load(); }
    catch (e) { setError(e); }
  };
  const hide = async (item) => {
    await setState(item, { hidden: true });
    setToast({
      text: `「${item.title}」不在首页出现了`,
      detail: "东西还在，只是不再排进这条列表。",
      undo: async () => { await api.workState(item.kind, item.id, { hidden: false }); setToast(null); load(); },
    });
  };

  const list = items || [];
  const waiting = (intel?.todayUnread || 0) + (intel?.earlierUnread || 0);

  /** 徽章列只在**真有两种以上取值**时画（判据：一整列的值全都相同就不画那一列）。 */
  const showKind = useMemo(() => new Set(list.map((i) => i.kind)).size > 1, [list]);

  return <section className="workspace-overview">
    <PageHeader
      title="首页"
      count={items ? `${list.length} 件在手` : null}
      /* ⚠️ 传 `className="btn"` 把它从实心主按钮降一档：首页唯一的最强主操作留给
         记录框的提交，那才是这一页独有的动作；写新文章在创作页和侧栏都有入口。 */
      aside={<NewContentButton label="直接写文章" className="btn" onGo={onGo} onChanged={onChanged} />}
    />

    {/* 一行记录。⚠️ **没有 label、没有说明句**：一个输入框外面三行说明就是说明书。
        placeholder 说清它接受什么，剩下的交给它自己——打字之后才长高、才露出提交钮。 */}
    <form className={`overview-capture${text ? " is-open" : ""}`} onSubmit={capture}>
      <IconBulb aria-hidden="true" size={16} stroke={1.7} />
      <div className="overview-capture__field">
        <textarea
          ref={field}
          id="home-thought"
          aria-label="记下灵感"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={1}
          placeholder="记一个想法或疑问…"
          maxLength={100000}
        />
        {text ? (
          <div className="overview-capture__foot">
            <span role="status">{status}</span>
            <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>留下这条想法</button>
          </div>
        ) : null}
      </div>
    </form>

    {saved ? <div className="overview-saved">
      <span>{saved.title}</span>
      <span role="status">{status}</span>
      {connections?.length ? <button type="button" className="text-action" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>发现 {connections.length} 条 Wiki 关联</button> : null}
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => develop()}>围绕这个想法讨论 →</button>
    </div> : null}

    {expanded && connections?.length ? <div className="overview-connections">
      <p>这些是知识连接线索，深入讨论时再核对。</p>
      {connections.map(item => <article key={item.id}>
        <h3>{item.title}</h3>
        <p>{item.reason || item.excerpt}</p>
        <div className="row-actions">
          <button type="button" className="btn btn-sm" onClick={() => onGo("library", `wiki:${item.id}`)}>阅读 Wiki</button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => develop(item)}>带着这个角度讨论</button>
        </div>
      </article>)}
    </div> : null}

    {/* 情报一行。⚠️ **没有待看的就不画这一行**，也不画「都看完了」——
        那是状态不是待办，而首页每一行都该是能动手的东西。 */}
    {waiting ? (
      <button type="button" className="overview-signal" onClick={() => onGo("intel")}>
        <IconRadar2 aria-hidden="true" size={15} stroke={1.7} />
        <span>
          {intel.todayUnread ? `今日精选 ${intel.todayUnread} 条未读` : "今日精选已看完"}
          {intel.earlierUnread ? ` · 还有 ${intel.earlierUnread} 条补看` : ""}
        </span>
        <em>去看 →</em>
      </button>
    ) : null}

    <ErrorNote error={error} what="读取工作台" onRetry={load} />
    {items === null && !error ? <Loading rows={4} /> : null}

    {items !== null ? <div className="overview-columns">
      <section className="overview-panel">
        <header><h2>接着做</h2></header>
        {list.length ? (
          <div className="rows overview-rows overview-rows--main">
            {list.map(item => <div className="row" key={`${item.kind}:${item.id}`}>
              <div className="row-head">
                <button type="button" className="row-title overview-row__open" onClick={() => open(item)}>
                  <b>{item.pinned ? <IconPinFilled size={12} stroke={1.8} aria-label="已置顶" /> : null}{item.title || "未命名"}</b>
                  {excerptOf(item) ? <small>{excerptOf(item)}</small> : null}
                </button>
                <span className="row-meta">
                  {showKind ? <span className="overview-row__kind">{KIND_LABEL[item.kind] || "在手"}</span> : null}
                  <time>{relTime(item.touchedAt || item.updatedAt)}</time>
                </span>
                <span className="overview-row__acts">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-pressed={Boolean(item.pinned)}
                    title={item.pinned ? "取消置顶" : "置顶到最前"}
                    aria-label={item.pinned ? `取消置顶「${item.title}」` : `置顶「${item.title}」`}
                    onClick={() => setState(item, { pinned: !item.pinned })}
                  >
                    {item.pinned ? <IconPinFilled size={15} stroke={1.7} aria-hidden="true" /> : <IconPin size={15} stroke={1.7} aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="从首页收起——东西还在，只是不再排进这条列表"
                    aria-label={`把「${item.title}」从首页收起`}
                    onClick={() => hide(item)}
                  >
                    <IconEyeOff size={15} stroke={1.7} aria-hidden="true" />
                  </button>
                </span>
              </div>
            </div>)}
          </div>
        ) : <Empty icon={IconBulb}>记一句疑问就可以开始，不必先起标题或分类。想直接表达时，写一篇文章。</Empty>}
      </section>

      <section className="overview-panel overview-panel--rail">
        <header><h2>最近阅读</h2></header>
        {reading.length ? (
          <div className="rows overview-rows overview-rows--rail">
            {reading.slice(0, 6).map(item => <div className="row" key={`${item.kind}:${item.id}`}>
              <div className="row-head">
                <button type="button" className="row-title overview-row__open" onClick={() => open(item)}>
                  <b>{item.title || "未命名"}</b>
                </button>
                {/* ⚠️ 这里原来是一列全都写着「Wiki」的徽章。换成**读到哪儿**：
                    `position.progress` 一直在数据里，而且每行不一样。 */}
                <span className="row-meta">
                  {item.position?.progress ? <span>读到 {pct(item.position.progress)}</span> : <span>刚开始</span>}
                </span>
              </div>
            </div>)}
          </div>
        ) : <p className="overview-empty">读过的资料会出现在这里，方便接着读。</p>}
      </section>
    </div> : null}

    {pending ? <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="home-leave-title" ref={leaveDialog}><h2 id="home-leave-title">这条想法还没有保存</h2><p>先留下它，下次可以在阅读与 Wiki 中找回。</p><div className="row-actions"><button className="btn" disabled={busy} onClick={() => setPending(null)}>继续记录</button><button className="btn btn-primary" disabled={busy} onClick={async () => { if (await capture({ preventDefault() {} })) onForceGo(pending.view, pending.state); }}>保存并离开</button></div><ErrorNote error={error} what="保存想法" /></section></div> : null}
    <Toast text={toast?.text} detail={toast?.detail} onUndo={toast?.undo} onClose={() => setToast(null)} />
  </section>;
}
