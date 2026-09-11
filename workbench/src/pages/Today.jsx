// 首页。三层，**层次来自状态而不是时间**：
// 接着写（一张卡）→ 在等你决定（跨模块的几队）→ 在手上（阶段轴 + 列表）。
//
// ⚠️ **上一版的毛病不是重复，是没有层次。** 那一轮把 15 行去重成了 9 行，
// 但 9 行一样重、一样大、一样的灰，按时间倒序，每行右边一个「22 天前」——
// 那是 changelog 的视觉语言，所以它看起来是历史记录而不是首页。
// **去重不产生层次**（判据见 `docs/design-system.md`）。
//
// ⚠️ **根因在数据层。** 上一版建在 `recentWork` 上，那是个 feed 查询
//（`标题 + 摘要 + 时间戳`），而一个 feed 查询只能画出 feed。现在走
// `api.workspaceAgenda()`：阶段、卡在哪儿、下一步、进展、在等你决定的几队，
// 一个请求给完，而且**一个字正文都不发**（判据见 `domain/workspace-experience.mjs`）。
//
// ⚠️ **时间戳只在真的放久了时才出现**（超过一周）。一周以内那个数字什么也没
// 告诉你，只是把每一行都变成日志里的一条。位置让给阶段和进展。
//
// 一行记录、导航守卫、Wiki 关联 →「带着这个角度讨论」那条路原样保留：
// 它是这一页独有的东西（侧栏收件箱和 `n` 只管存，不找 Wiki 关联）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { NewContentButton } from "../components/NewContentButton.jsx";
import { Empty, ErrorNote, Loading, PageHeader, StatePill, Toast } from "../components/ui.jsx";
import { IconAlertTriangle, IconArrowRight, IconBulb, IconCircleCheck, IconCircleDashed, IconEyeOff, IconFolder, IconPin, IconPinFilled } from "../components/icons.jsx";
import { pct } from "../lib/reading.js";
import { useUndoToast } from "../lib/use-undo-toast.js";
import "./workspace-home.css";
import { useDialog } from "../lib/use-dialog.js";

/**
 * 一条的可读名字。
 *
 * ⚠️ **标题为空时不显示「未命名」这三个字。** 真实数据里首页上就挂着一行「未命名」
 * ——那是屏幕上信息量最低的一行，你既认不出它是哪一条，也不知道该不该动它。
 * 换成「还没起名字 · 3 天前开的」：至少能认出是哪一条。
 */
function nameOf(item) {
  if (item.hasTitle !== false && String(item.title || "").trim()) return item.title;
  const at = Date.parse(item.openedAt || "");
  if (!Number.isFinite(at)) return "还没起名字";
  const days = Math.floor((Date.now() - at) / 86400000);
  return `还没起名字 · ${days <= 0 ? "今天" : `${days} 天前`}开的`;
}

export function Today({ onGo, onChanged, onForceGo = onGo, registerNavigationGuard }) {
  const [pending, setPending] = useState(null);
  const leaveDialog = useDialog(Boolean(pending), () => setPending(null));
  const [agenda, setAgenda] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(null);
  const [connections, setConnections] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState("");
  const [toast, setToast] = useUndoToast();
  const field = useRef(null);

  /**
   * 让输入框跟着内容长高。
   *
   * ⚠️ **不能只靠 CSS 的固定高度。** 390px 上那句 placeholder 就要折两行，
   * 而固定高度会把第二行切掉——一个把自己的提示文字切掉一半的输入框更糟。
   * 上限交给 CSS 的 `max-height`，到顶再滚。
   */
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const load = useCallback(async () => {
    try { setAgenda(await api.workspaceAgenda()); setError(null); }
    catch (cause) { setError(cause); }
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
    if (item.kind === "research") return onGo("research", item.id);
    if (item.kind !== "project") return onGo("library", `${item.kind}:${item.id}`);
    try {
      const { researches } = await api.projectResearches(item.id);
      const topic = researches?.[0];
      if (!topic) return onGo("project", item.id);
      const key = `xenho:research-position:${topic.id}`;
      let previous = {};
      try { previous = JSON.parse(localStorage.getItem(key) || "{}"); } catch {}
      try { localStorage.setItem(key, JSON.stringify({ ...previous, tab: "article", projectId: item.id })); } catch {}
      onGo("research", topic.id);
    } catch (e) { setError(e); }
  }

  /**
   * 置顶 / 从首页收起，走已有的 `api.workState`。
   *
   * 置顶在这一页有一件别处没有的用处：**它决定第一层那张卡是谁**
   *（`recentWork` 按 `pinned DESC` 排）。所以「系统挑错了」是有解的。
   * 「收起」不是删除，文案说清；但仍然要给撤销——界面上没有「被收起的那些」这一页。
   */
  const setWork = async (item, patch) => {
    try { await api.workState(item.kind, item.id, patch); await load(); }
    catch (e) { setError(e); }
  };
  const hide = async (item) => {
    await setWork(item, { hidden: true });
    setToast({
      text: `「${nameOf(item)}」不在首页出现了`,
      detail: "东西还在，只是不再排进这条列表。",
      undo: async () => { await api.workState(item.kind, item.id, { hidden: false }); setToast(null); load(); },
    });
  };

  const resume = agenda?.resume || null;
  const stages = agenda?.stages || [];
  const inHand = agenda?.inHand || [];
  const waiting = agenda?.waiting || [];
  const reading = agenda?.reading || [];
  const setup = agenda?.setup || null;
  const shown = useMemo(() => (stage ? inHand.filter((row) => row.stage === stage) : inHand), [inHand, stage]);

  const acts = (item) => <span className="agenda-row__acts">
    <button
      type="button" className="icon-btn" aria-pressed={Boolean(item.pinned)}
      title={item.pinned ? "取消置顶" : "置顶——它同时决定上面那张卡是谁"}
      aria-label={item.pinned ? `取消置顶「${nameOf(item)}」` : `置顶「${nameOf(item)}」`}
      onClick={() => setWork(item, { pinned: !item.pinned })}
    >
      {item.pinned ? <IconPinFilled size={15} stroke={1.7} aria-hidden="true" /> : <IconPin size={15} stroke={1.7} aria-hidden="true" />}
    </button>
    <button
      type="button" className="icon-btn"
      title="从首页收起——东西还在，只是不再排进这条列表"
      aria-label={`把「${nameOf(item)}」从首页收起`}
      onClick={() => hide(item)}
    >
      <IconEyeOff size={15} stroke={1.7} aria-hidden="true" />
    </button>
  </span>;

  return <section className="workspace-overview">
    <PageHeader
      title="首页"
      /* ⚠️ **首启不报「0 件在手」。** 新用户看到的第一个数字不该是 0——
         那一格是给「你手上有多少」用的，手上还什么都没有的时候它只是在宣布这件事。 */
      count={inHand.length ? `${inHand.length} 件在手` : null}
      /* ⚠️ `className="btn"` 把它降一档：这一页唯一的实心主按钮是那张卡上的
         「继续写」——它是**带着具体对象的**动作，比「随便新开一篇」强得多。 */
      aside={<NewContentButton label="直接写文章" className="btn" onGo={onGo} onChanged={onChanged} />}
    />

    {/* 一行记录。⚠️ 没有 label、没有说明句：一个输入框外面三行说明就是说明书。 */}
    <form className={`overview-capture${text ? " is-open" : ""}`} onSubmit={capture}>
      <IconBulb aria-hidden="true" size={16} stroke={1.7} />
      <div className="overview-capture__field">
        <textarea
          ref={field} id="home-thought" aria-label="记下灵感"
          value={text} onChange={e => setText(e.target.value)} rows={1}
          placeholder="记一个想法或疑问…" maxLength={100000}
        />
        {text ? (
          <div className="overview-capture__foot">
            <span role="status">{status}</span>
            <button className="btn btn-sm" disabled={busy || !text.trim()}>留下这条想法</button>
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

    <ErrorNote error={error} what="读取工作台" onRetry={load} />
    {!agenda && !error ? <Loading rows={4} /> : null}

    {agenda ? <div className="overview-columns">
      <div className="overview-main">
        {/* ── 第一层：接着写 ──
            ⚠️ **这一张不是「最近那一条」，是「接着做那一条」。** 差别全在它说什么：
            阶段、卡在哪儿、进展、下一步的动词。没有时间戳（放久了才在角上标一句）。 */}
        {/* ⚠️ **不要再加「setup 没做完就别画这张卡」的条件。** 试过，是错的：
            只是没设过关注方向、但手上已经有稿子的人会永远看不到「接着写」。
            「两张卡不同时出现」这件事**已经由数据保证了**——`resume` 取自 `inHand`，
            而首启时 `inHand` 是空的，`resume` 自然是 null。 */}
        {resume ? (
          <article className="agenda-resume">
            <header>
              <StatePill state={resume.stage} />
              {/* ⚠️ **只画 blockers，不画 `stageReason`。** 那句话要么和阶段 pill 说的是
                  同一件事（「主稿已完成，可以发布」vs 待发布），要么和下面那行进展说的是
                  同一件事（「主稿还是空的」vs「还是空的」）——同一张卡上同一个事实两遍。 */}
              {resume.blockers?.length ? (
                <em className="agenda-resume__blocker">
                  <IconAlertTriangle size={13} stroke={1.9} aria-hidden="true" />
                  卡在「{resume.blockers[0]}」
                </em>
              ) : null}
              {resume.staleDays ? <span className="agenda-resume__stale">放了 {resume.staleDays} 天</span> : null}
            </header>
            <h2>{nameOf(resume)}</h2>
            <p className="agenda-resume__meta">
              <span>{resume.progress}</span>
              {resume.collections?.length ? <span><IconFolder size={13} stroke={1.8} aria-hidden="true" />{resume.collections.join(" · ")}</span> : null}
            </p>
            <footer>
              <button type="button" className="btn btn-primary" onClick={() => open(resume)}>
                {resume.nextAction}<IconArrowRight size={15} stroke={1.8} aria-hidden="true" />
              </button>
            </footer>
          </article>
        ) : null}

        {/* ── 先把工作台跑起来 ──
            ⚠️ **排在「接着写」后面，不是前面。** 全新工作区里 `resume` 是 null，
            所以这一块自然就是第一屏的第一件事；而手上已经有稿子、只是没设过关注方向的人，
            第一位仍然该是「接着写」——**没配完的设置是个提醒，不该压住今天要干的活**。
            ⚠️ **勾没勾上只看真实数据**（`domain/workspace-experience.mjs` 的 `workspaceSetup`），
            不记「我点过了」——一个会说谎的进度条比没有更坏。三条全满足整块不再出现。 */}
        {setup && !setup.done ? (
          <section className="agenda-setup" aria-label="先把工作台跑起来">
            <header>
              <h2>先把工作台跑起来</h2>
              <span className="agenda-setup__count">{setup.steps.filter((s) => s.done).length} / {setup.steps.length}</span>
            </header>
            <ol>
              {setup.steps.map((step) => (
                <li key={step.key} data-done={step.done ? "" : undefined}>
                  {step.done
                    ? <IconCircleCheck size={17} stroke={1.8} aria-label="已完成" />
                    : <IconCircleDashed size={17} stroke={1.8} aria-hidden="true" />}
                  <div>
                    <b>{step.title}</b>
                    <small>{step.why}</small>
                  </div>
                  {step.done ? null : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      /* ⚠️ 「记下第一个疑问」**不跳页**：那一行输入框就在这一屏顶上，
                         按钮只把焦点放过去。跳到别处再回来是更长的一条路。 */
                      onClick={() => (step.view ? onGo(step.view, step.state || "") : field.current?.focus())}
                    >
                      {step.action}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {/* ── 第二层：在等你决定 ──
            跨模块，只列真有在等的。一个都没有时整块不画——「都处理完了」是状态不是
            待办，而首页每一行都该是能动手的东西。 */}
        {waiting.length ? (
          <section className="agenda-waiting" aria-label="在等你决定">
            <h2>在等你决定</h2>
            <ul>
              {waiting.map((entry) => (
                <li key={entry.key}>
                  <button type="button" onClick={() => onGo(entry.view, entry.state || "")}>
                    <b>{entry.count}</b>
                    <span>{entry.unit}{entry.text}</span>
                    <IconArrowRight size={14} stroke={1.8} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ── 第三层：在手上 ──
            阶段轴按**流水线顺序**排（服务端给的顺序，别在这儿重排），点一档只看那一档。
            芯片用 `.chips chips-sm`——和创作页那一排同一种，不新造语汇。 */}
        {/* ⚠️ **首启时这一块整个不画。** 上面那张开局卡已经在说下一步了；
            再摆一个「在手上」标题 + 一句「东西会排进这里」，就是同一件事说第二遍，
            而且又是一个空框（判据：空白不能建立层次就该收紧）。
            一有东西就出现——所以判断的是**它自己空不空**，不是 setup 的状态。 */}
        {inHand.length || setup?.done !== false ? (
        <section className="agenda-hand" aria-label="在手上">
          <header>
            <h2>在手上</h2>
            {stages.length ? (
              <div className="chips chips-sm" role="group" aria-label="按阶段筛选">
                <button type="button" className="chip" aria-pressed={stage === ""} onClick={() => setStage("")}>全部 {inHand.length}</button>
                {stages.map((entry) => (
                  <button key={entry.stage} type="button" className="chip" aria-pressed={stage === entry.stage} onClick={() => setStage(entry.stage)}>
                    {entry.stage} {entry.count}
                  </button>
                ))}
              </div>
            ) : null}
          </header>

          {shown.length ? (
            <div className="rows agenda-rows">
              {shown.map((item) => (
                <div className="row" key={`${item.kind}:${item.id}`}>
                  <div className="row-head">
                    <StatePill state={item.stage} />
                    <button type="button" className="row-title agenda-row__open" onClick={() => open(item)}>
                      {item.pinned ? <IconPinFilled size={12} stroke={1.8} aria-label="已置顶" /> : null}
                      {nameOf(item)}
                    </button>
                    {/* 中间那一列放能做决定的东西：进展。**不是摘要**——摘要在这个
                        工作台里是正文第一行的截断，句子从中间断掉。 */}
                    <span className="row-meta">
                      <span className="agenda-row__progress">{item.progress}</span>
                      {item.staleDays ? <span className="agenda-row__stale">放了 {item.staleDays} 天</span> : null}
                    </span>
                    {acts(item)}
                  </div>
                </div>
              ))}
            </div>
          ) : inHand.length ? (
            <p className="overview-empty">「{stage}」这一档现在空着。切到别的阶段看看。</p>
          ) : setup && !setup.done ? (
            /* 首启时上面那块开局卡已经在教下一步了，这儿再写一句就是同一件事说两遍 */
            <p className="overview-empty">选题和文章都会排进这里，按阶段分。</p>
          ) : (
            <Empty
              icon={IconBulb}
              action={<NewContentButton label="写第一篇" className="btn btn-sm" onGo={onGo} onChanged={onChanged} />}
            >
              记一句疑问就可以开始，不必先起标题或分类。想直接表达时，写一篇文章。
            </Empty>
          )}
        </section>
        ) : null}
      </div>

      {reading.length || setup?.done !== false ? (
      <aside className="overview-rail">
        <section className="overview-panel">
          <header><h2>最近阅读</h2></header>
          {reading.length ? (
            <div className="rows agenda-rows agenda-rows--rail">
              {reading.slice(0, 6).map(item => <div className="row" key={`${item.kind}:${item.id}`}>
                <div className="row-head">
                  <button type="button" className="row-title agenda-row__open" onClick={() => open(item)}>{item.title || "未命名"}</button>
                  {/* 这里原来是一列全都写着「Wiki」的徽章。换成读到哪儿——每行不一样。 */}
                  <span className="row-meta">{item.position?.progress ? <span>读到 {pct(item.position.progress)}</span> : <span>刚开始</span>}</span>
                </div>
              </div>)}
            </div>
          ) : <p className="overview-empty">读过的资料会出现在这里，方便接着读。</p>}
        </section>
      </aside>
      ) : null}
    </div> : null}

    {pending ? <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="home-leave-title" ref={leaveDialog}><h2 id="home-leave-title">这条想法还没有保存</h2><p>先留下它，下次可以在阅读与 Wiki 中找回。</p><div className="row-actions"><button className="btn" disabled={busy} onClick={() => setPending(null)}>继续记录</button><button className="btn btn-primary" disabled={busy} onClick={async () => { if (await capture({ preventDefault() {} })) onForceGo(pending.view, pending.state); }}>保存并离开</button></div><ErrorNote error={error} what="保存想法" /></section></div> : null}
    <Toast text={toast?.text} detail={toast?.detail} onUndo={toast?.undo} onClose={() => setToast(null)} />
  </section>;
}
