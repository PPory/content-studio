// 首页：指标卡 → 今日清单与知识增长 → 在手上的明细 → 最近阅读。
// 阶段、进展和统计统一取自 workspaceAgenda；快速记录保留导航守卫和 Wiki 关联。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUndoToast } from "../lib/use-undo-toast.js";
import { api } from "../lib/api.js";
import { NewContentButton } from "../components/NewContentButton.jsx";
import { DayPlan, usePlan } from "../components/DayPlan.jsx";
import { Empty, ErrorNote, Loading, PageHeader, StatCard, StatePill, Toast } from "../components/ui.jsx";
import { WeeklyBars } from "../components/WeeklyBars.jsx";
import { IconArrowRight, IconBook2, IconBulb, IconCircleCheck, IconCircleDashed, IconClipboardList, IconDatabase, IconEyeOff, IconPin, IconPinFilled, IconSend, IconSparkles } from "../components/icons.jsx";
import { Cover } from "../components/Cover.jsx";
import { pct } from "../lib/reading.js";
import "./workspace-home.css";
import { useDialog } from "../lib/use-dialog.js";

/**
 * 知识库那张卡的参照行：「9 本书 · 4 份素材」。
 *
 * ⚠️ **0 的那一项不进这句话。** 实测这个库有书没素材，直出会写成「9 本书 · 0 份素材」
 * ——判据是「0 不是一个值得报的数」。这一排 KPI 的例外只开给**主数字**
 *（成排的卡少一张会让下沿参差，而带参照的 0 说的是「这个月还没动」）；
 * 参照行里的一项没有内容，就少一项，不占位。
 */
function kbNote(kb) {
  if (!kb) return "";
  const parts = [kb.books ? `${kb.books} 本书` : "", kb.materials ? `${kb.materials} 份素材` : ""].filter(Boolean);
  // ⚠️ **整张卡都是 0 时仍然要有一句参照**，不然这张卡只剩一个孤零零的 0
  //（判据：这一排可以报 0，条件是带参照）。「还没存过」说的是「没开始」，
  // 而不是「这里没有数据」——后者是一个 bug 的样子。
  if (!parts.length) return kb.wiki ? "都是 Wiki 页" : "还没存过东西";
  return parts.join(" · ");
}

function writingNote(stages) {
  const writing = stages.find((s) => s.stage === "写作中")?.count || 0;
  const ready = stages.find((s) => s.stage === "待发布")?.count || 0;
  // ⚠️ 一件都没有时不能说「都还在选题阶段」——一个选题都没有，那句话是假的
  if (!stages.some((s) => s.count)) return "还没有在手的";
  if (!writing && !ready) return "都还在选题阶段";
  return [writing ? `${writing} 篇在写` : "", ready ? `${ready} 篇待发布` : ""].filter(Boolean).join(" · ");
}

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
  const field = useRef(null);
  // 「今天」那份清单。落工作区数据库（`repository.getSetting('plan:<date>')`），
  // 所以它跟着备份走、换台机器还在——见 `components/DayPlan.jsx`。
  const plan = usePlan(true);
  const [toast, setToast] = useUndoToast();

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
   * 置顶在这一页有一件别处没有的用处：**它决定列表第一行是谁**
   *（`recentWork` 按 `pinned DESC` 排）。所以「系统挑错了」是有解的。
   * 「收起」不是删除，文案说清；但仍然要给撤销——界面上没有「被收起的那些」这一页。
   */
  const setWork = async (item, patch) => {
    try { await api.workState(item.kind, item.id, patch); await load(); return true; }
    catch (e) { setError(e); return false; }
  };
  const hide = async (item) => {
    if (!await setWork(item, { hidden: true })) return;
    setToast({
      text: `「${nameOf(item)}」不在首页出现了`,
      detail: "东西还在，只是不再排进这条列表。",
      undo: async () => { if (await setWork(item, { hidden: false })) setToast(null); },
    });
  };

  const acts = (item) => <span className="agenda-row__acts">
    <button
      type="button" className="icon-btn" aria-pressed={Boolean(item.pinned)}
      title={item.pinned ? "取消置顶" : "置顶——排到列表最前"}
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

  const stages = agenda?.stages || [];
  const inHand = agenda?.inHand || [];
  const waiting = agenda?.waiting || [];
  const reading = agenda?.reading || [];
  const setup = agenda?.setup || null;
  const output = agenda?.output || null;
  const kb = agenda?.kb || null;
  /** 只显示前 8 行；全量表在创作页。首页放的是摘要和入口。 */
  const shown = useMemo(() => (stage ? inHand.filter((r) => r.stage === stage) : inHand).slice(0, 8), [inHand, stage]);

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

    {/* ⚠️ **一栏，不是两栏。** 上一版「接着读」放在右侧窄栏里，而主列那些行的
        min-content 量到 735px（`.row-meta` 是 `flex:none`，长 meta 撑不动），
        窄屏和 1920 上 grid 的 `auto` track 撑不下就溢出——**行直接压到窄栏上面**。
        搬到底部之后主列是整幅宽度，那一类重叠也就没有了。 */}
    {agenda ? <div className="overview-main">
        {/* ── 一排数字：在手上 · 本月产出 · 知识库 · 等你决定 ──
            ⚠️ **四条各管一段，而且都有真数据。** `TodayStats.jsx`（上一代那份，
            现在是死代码）的注释里警告过一个坑：四个数**不能都取流水线计数**，
            那些平时全是 0——首屏最大的四个数字大多数时候在展示「没事」。
            ⚠️ **这一排可以报 0。** 它是**一个形状**，缺一张会让下沿参差
            （`.stat__note` 的注释：「基准那一行没内容也占高」）；而带参照的 0
            （「本月 0 篇 · 上月 0 篇」）说的是「这个月还没动」，不是「这里没数据」。
            独立的一行提要没内容仍然不画。
            ⚠️ `deltaTone` 由调用方给：「等你决定 +3」是坏事，按涨跌自动上色会画成绿的。 */}
        <div className="stats">
          <StatCard
            icon={IconClipboardList} label="在手上" value={inHand.length}
            note={writingNote(stages)} onClick={() => onGo("content")}
            title="去创作页看全部"
          />
          <StatCard
            icon={IconSend} label="本月产出"
            value={output ? output.thisMonth : 0} unit="篇"
            note={output ? `上月 ${output.lastMonth} 篇` : "还没发过"}
            onClick={() => onGo("review")} title="去复盘"
          />
          <StatCard
            icon={IconDatabase} label="知识库"
            value={kb ? kb.wiki : 0} unit="页"
            delta={kb?.weekAdded ? `本周 +${kb.weekAdded}` : ""} deltaTone=""
            note={kbNote(kb)}
            onClick={() => onGo("entries")} title="去 Wiki"
          />
          <StatCard
            icon={IconSparkles} label="等你决定"
            value={waiting.reduce((n, e) => n + e.count, 0)}
            note={waiting[0] ? `${waiting[0].count} ${waiting[0].unit}${waiting[0].text}` : "没有在等的"}
            onClick={() => onGo(waiting[0]?.view || "intel", waiting[0]?.state || "")}
            title={waiting[0] ? "去处理" : undefined}
          />
        </div>

        {/* ── 两栏：今天的清单 | 知识库这 12 周 ──
            ⚠️ 图画的是**知识库增长**，不是发布趋势：实测这个库只有 1 条发布记录，
            12 格发布柱图就是一根孤柱加 11 个空格（判据见
            `domain/workspace-experience.mjs` 的 `knowledgeBase`）。
            ⚠️ **一根柱子都没有就不画这张图。** 上面那排 KPI 卡可以报 0——它是一个形状，
            而且每张都带参照；一张 12 格全空的柱图带不了参照，它只是一个空框。
            首启那一屏该说的是下一步点哪儿，不是「过去 12 周你什么都没存」。 */}
        <div className="home-duo">
          {/* ⚠️ **清单是这一页唯一不是「你拥有的对象」的一块。** 上面那排数字、下面那张表、
              最后那面封面墙全是库存的投影；清单是**你自己定的**，也是唯一能回答
              「今天干了活没有」的东西。所以它和图并排在 KPI 正下方，不排到页尾。
              ⚠️ 组件是现成的（`components/DayPlan.jsx`，当初就是为了「`Today.jsx` 也要用」
              才从 `Overview.jsx` 里搬出来的，而那之后一直没接上）。
              ⚠️ **它的「＋加一条」和页顶那个「记一个想法」不是一回事**：这里加的是
              **今天的任务**，上面记的是**灵感**（进 captures，存完还会去找 Wiki 关联）。 */}
          <section className="home-card home-card--plan">
            <DayPlan plan={plan} />
          </section>
          {kb && kb.weeks.some((w) => w.total) ? (
            <section className="home-card home-chart">
              <header>
                <h2>知识库这 12 周</h2>
                <span>每周新增 {kb.series.join(" / ")}</span>
              </header>
              <WeeklyBars weeks={kb.weeks} platforms={kb.series} dark={false} mono unit="条" />
            </section>
          ) : null}
        </div>

        {/* ── 在手上：明细表 ──
            ⚠️ **上一轮把它撤了，这一轮请回来。** 撤它是因为当时它是页上唯一的东西，
            于是整页读起来就是一张列表；现在上面有 KPI 排和那张图撑住层次，
            它才是这一页的肉（实测这个库有 40 个项目）。
            阶段芯片按**流水线顺序**排（服务端给的顺序，别在这儿重排），点一档只看那一档，
            用 `.chips chips-sm`——和创作页那一排同一种，不新造语汇。 */}
        {/* ⚠️ **首启时这一块整个不画。** 上面那张开局卡已经在说下一步了；
            再摆一个「在手上」标题 + 一句「东西会排进这里」，就是同一件事说第二遍，
            而且又是一个空框（判据：空白不能建立层次就该收紧）。
            一有东西就出现——所以判断的是**它自己空不空**，不是 setup 的状态。 */}
        {inHand.length || setup?.done !== false ? (
          <section className="home-card agenda-hand" aria-label="在手上">
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
            {/* 全量表在创作页，首页只放前 8 行 —— 同一份表摆两遍是同一件事两遍 */}
            <button type="button" className="text-action home-all" onClick={() => onGo("content")}>
              看全部 {inHand.length} 件
              <IconArrowRight size={14} stroke={1.8} aria-hidden="true" />
            </button>
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

        {/* ── 先把工作台跑起来 ──
            ⚠️ **排在提要和流水线之后。** 试过放在清单正下方：它有底色、有三行步骤，
            于是成了整页最重的一块，压过了上面那份清单——正是「同一页上两个大块会打架」。
            没配完的设置是**一个提醒**，提醒放在今天的正事后面。
            ⚠️ **勾没勾上只看真实数据**（`domain/workspace-experience.mjs` 的 `workspaceSetup`），
            不记「我点过了」——一个会说谎的进度条比没有更坏。三条全满足整块不再出现。 */}
        {setup && !setup.done ? (
          <section className="home-card agenda-setup" aria-label="先把工作台跑起来">
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

        {/* ── 接着读 ──
            ⚠️ **只放书，所以它才有资格做封面块。** 「卡片适合有封面」那条判据的前提是
            封面**真的存在于数据里**——只有书有（`books.metadata_json.coverAssetId`）。
            混进 Wiki 页的话一半格子是回落图标，那时它既不是封面墙、也不如一行纯文字清楚，
            所以过滤放在服务端（`workspaceAgenda`）。
            ⚠️ **不拿书架上没动过的书填空**：那会把「你在读这些」变成「书架上有这些」。
            封面走共用的 `components/Cover.jsx`，不在这儿新写一份。 */}
        {reading.length ? (
          <section className="home-card agenda-reading" aria-label="接着读">
            <header><h2>接着读</h2></header>
            <ul>
              {reading.slice(0, 6).map(item => (
                <li key={`${item.kind}:${item.id}`}>
                  <button type="button" onClick={() => open(item)}>
                    {/* ⚠️ **`name` 传空串。** `Cover` 的回落分支会把书名排在格子里——
                        书架那面墙需要（那儿封面下面没有标题），而这里**标题就在封面下面**，
                        传了就会出现两遍。 */}
                    <Cover book={{ cover: item.cover || "", name: "" }} />
                    <b>{item.title || "未命名"}</b>
                    <small className="agenda-reading__at">
                      {item.chapter
                        ? `第 ${item.chapter.at} 章${item.position?.progress ? ` · ${pct(item.position.progress)}` : ""}`
                        : item.position?.progress ? `读到 ${pct(item.position.progress)}` : "刚开始"}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : setup?.done !== false ? (
          /* 首启时不画（开局卡在说别的事）；之后空着要说清为什么空 */
          <section className="home-card agenda-reading agenda-reading--empty" aria-label="接着读">
            <header><h2>接着读</h2></header>
            <Empty icon={IconBook2} action={<button type="button" className="btn btn-sm" onClick={() => onGo("shelf")}>去书架</button>}>
              读过的书会排在这里，带封面和读到第几章。导入一本，或者接着读书架上那本。
            </Empty>
          </section>
        ) : null}
    </div> : null}

    <Toast text={toast?.text} detail={toast?.detail} onUndo={toast?.undo} onClose={() => setToast(null)} />
    {pending ? <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="home-leave-title" ref={leaveDialog}><h2 id="home-leave-title">这条想法还没有保存</h2><p>先留下它，下次可以在阅读与 Wiki 中找回。</p><div className="row-actions"><button className="btn" disabled={busy} onClick={() => setPending(null)}>继续记录</button><button className="btn btn-primary" disabled={busy} onClick={async () => { if (await capture({ preventDefault() {} })) onForceGo(pending.view, pending.state); }}>保存并离开</button></div><ErrorNote error={error} what="保存想法" /></section></div> : null}
  </section>;
}
