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
import { DayPlan, usePlan } from "../components/DayPlan.jsx";
import { Empty, ErrorNote, Loading, PageHeader } from "../components/ui.jsx";
import { IconArrowRight, IconBook2, IconBulb, IconCircleCheck, IconCircleDashed } from "../components/icons.jsx";
import { Cover } from "../components/Cover.jsx";
import { pct } from "../lib/reading.js";
import "./workspace-home.css";
import { useDialog } from "../lib/use-dialog.js";

/**
 * 点某一档去哪一页。⚠️ **选题不在创作页里**，它有自己那一页；待复盘归运营下的复盘。
 * 现在只跳到页，不预选那一档——`Content.jsx` 的芯片不接外部 stage（那是另一件事）。
 */
const STAGE_VIEW = { 选题: "research", 策划中: "content", 写作中: "content", 待发布: "content", 待复盘: "review" };

/**
 * 「比上月多 N」。⚠️ **持平也要说出来**，不然这一行只在变好或变差时才有第二句，
 * 读起来像「这个月没数据」。上月是 0 时不说「多 N」——从 0 涨上来说「比上月多」很怪。
 */
function monthTrend({ thisMonth, lastMonth }) {
  if (!lastMonth) return thisMonth ? "" : " · 这个月还没发";
  if (thisMonth === lastMonth) return " · 和上月持平";
  return thisMonth > lastMonth ? ` · 比上月多 ${thisMonth - lastMonth}` : ` · 比上月少 ${lastMonth - thisMonth}`;
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
  const field = useRef(null);
  // 「今天」那份清单。落工作区数据库（`repository.getSetting('plan:<date>')`），
  // 所以它跟着备份走、换台机器还在——见 `components/DayPlan.jsx`。
  const plan = usePlan(true);

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

  const resume = agenda?.resume || null;
  const stages = agenda?.stages || [];
  const inHand = agenda?.inHand || [];
  const waiting = agenda?.waiting || [];
  const reading = agenda?.reading || [];
  const setup = agenda?.setup || null;
  const output = agenda?.output || null;

  /**
   * 「今天新的」那一行说什么。把「在等你决定」里**属于新输入**的两项合起来说一句：
   * 精选未读和待审阅的候选。待发布 / 待复盘不算「新的」——那是你自己的存货，
   * 它们归下面那条流水线和产出那一行。
   */
  const signal = useMemo(() => {
    const say = waiting
      .filter((entry) => entry.key === "briefs" || entry.key === "wiki")
      .map((entry) => `${entry.count} ${entry.unit}${entry.text}`);
    return say.length ? say.join(" · ") : "";
  }, [waiting]);


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
        {/* ── 承诺：我今天答应自己要做什么 ──
            ⚠️ **这是这一页唯一不是「你拥有的对象」的一块，所以它排第一。**
            前几版从上到下全是对象的投影（接着写、在手上、接着读），那样无论怎么排序、
            怎么加状态、怎么上封面，读起来都是库存管理。清单是**你自己定的**，
            也是唯一能回答「今天干了活没有」的东西。
            ⚠️ 组件是现成的（`components/DayPlan.jsx`，当初就是为了「`Today.jsx` 也要用」
            才从 `Overview.jsx` 里搬出来的，而那之后一直没接上）。
            ⚠️ **它的「＋加一条」和页顶那个「记一个想法」不是一回事**：这里加的是
            **今天的任务**，上面记的是**灵感**（进 captures，存完还会去找 Wiki 关联）。
            所以两者一个在块里、一个在页顶，不并排。 */}
        <DayPlan plan={plan} />

        {/* ── 先把工作台跑起来 ──
            ⚠️ **排在「今天」那份清单后面。** 清单是你自己定的承诺，永远该在最前；
            而没配完的设置是**一个提醒**，不该压住今天要干的活。
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

        {/* ── 三条登记行：信号 / 结果 / 续上 ──
            同一种形状、各一行。⚠️ **「接着写」从一张卡降成一行**：承诺块在上面之后，
            它不再是这一页最强的落点了，而两个大块会打架。三条同形状的行读起来是
            「三个性质不同的提要」，正是首页该有的那种混合。
            每一条**没有内容就不画那一条**（判据：0 不是一个值得报的数）。 */}
        {signal || output || resume ? (
          <section className="agenda-lines" aria-label="今天的提要">
            {signal ? (
              <button type="button" className="agenda-line" onClick={() => onGo("intel")}>
                <span className="agenda-line__key">今天新的</span>
                <span className="agenda-line__say">{signal}</span>
                <IconArrowRight size={15} stroke={1.8} aria-hidden="true" />
              </button>
            ) : null}

            {/* ⚠️ 产出这一行**一篇都没发过时整块不给**（服务端返回 null）——
                「本月 0 篇 · 上月 0 篇」是首页上信息量最低的一行。 */}
            {output ? (
              <button type="button" className="agenda-line" onClick={() => onGo("review")}>
                <span className="agenda-line__key">本月产出</span>
                <span className="agenda-line__say">
                  发了 {output.thisMonth} 篇
                  <em>{monthTrend(output)}</em>
                  {output.pendingReview ? ` · ${output.pendingReview} 篇待复盘` : ""}
                </span>
                <IconArrowRight size={15} stroke={1.8} aria-hidden="true" />
              </button>
            ) : null}

            {resume ? (
              <button type="button" className="agenda-line" onClick={() => open(resume)}>
                <span className="agenda-line__key">接着写</span>
                <span className="agenda-line__say">
                  <b>{nameOf(resume)}</b>
                  {/* ⚠️ 分隔号要显式写出来：紧挨着的 `</b><em>` 之间没有空白，
                      量到的是「…更重要写作中 · 1,240 字」——标题和状态黏成一个词。 */}
                  <em>
                    {" · "}{resume.stage} · {resume.progress}
                    {resume.blockers?.length ? ` · 卡在「${resume.blockers[0]}」` : ""}
                    {resume.staleDays ? ` · 放了 ${resume.staleDays} 天` : ""}
                  </em>
                </span>
                <IconArrowRight size={15} stroke={1.8} aria-hidden="true" />
              </button>
            ) : null}
          </section>
        ) : null}

        {/* ── 在手上：只留一条流水线 ──
            ⚠️ **全量列表撤了。** 创作页那张全量表已经存在，首页再摆一份是同一件事两遍，
            而它正是「首页看着像列表页」的那一大块（判据：全量列表不进首页，
            首页放的是摘要和入口）。这一条要回答的是**堵在哪一档**，那只需要计数。
            ⚠️ 行尾那两颗「置顶 / 从首页收起」跟着列表一起没了：不在首页留
            管不到东西的按钮。`api.workState` 仍然决定上面那一行「接着写」挑谁
            （`recentWork` 按 `pinned DESC`），入口挪到创作页才合理。 */}
        {stages.length ? (
          <section className="agenda-flow" aria-label="在手上">
            <h2>在手上</h2>
            <div className="agenda-flow__bar">
              {stages.map((entry, at) => (
                <button
                  key={entry.stage}
                  type="button"
                  onClick={() => onGo(STAGE_VIEW[entry.stage] || "content")}
                  title={`去看${entry.stage}那一档`}
                >
                  <b>{entry.count}</b>
                  <span>{entry.stage}</span>
                  {at < stages.length - 1 ? <i aria-hidden="true">›</i> : null}
                </button>
              ))}
            </div>
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
          <section className="agenda-reading" aria-label="接着读">
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
          <section className="agenda-reading agenda-reading--empty" aria-label="接着读">
            <header><h2>接着读</h2></header>
            <Empty icon={IconBook2} action={<button type="button" className="btn btn-sm" onClick={() => onGo("shelf")}>去书架</button>}>
              读过的书会排在这里，带封面和读到第几章。导入一本，或者接着读书架上那本。
            </Empty>
          </section>
        ) : null}
    </div> : null}

    {pending ? <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="home-leave-title" ref={leaveDialog}><h2 id="home-leave-title">这条想法还没有保存</h2><p>先留下它，下次可以在阅读与 Wiki 中找回。</p><div className="row-actions"><button className="btn" disabled={busy} onClick={() => setPending(null)}>继续记录</button><button className="btn btn-primary" disabled={busy} onClick={async () => { if (await capture({ preventDefault() {} })) onForceGo(pending.view, pending.state); }}>保存并离开</button></div><ErrorNote error={error} what="保存想法" /></section></div> : null}
  </section>;
}
