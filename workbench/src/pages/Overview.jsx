// 总览页从上往下回答三个问题，顺序不能反：
//
//   1. **我今天答应自己要做什么** —— 你手写的清单（`05 - 计划/<日期>.md`）。它排在最前面
//      是因为这是**你自己定的承诺**，其余几块都只是素材。
//   2. **手上还欠着什么** —— 一排三张卡。左边两张是「等你动手」的两档，每张给
//      **数量 + 最该先做的那几条 + 逐条加进清单**；右边一张收着流水线自己会消化的
//      三个队列。**两组不能画成一样重**：后者的 0 是正常态，和「等你动手」的 0 含义
//      正好相反，摊成三个同样大的数字会让首屏大半在展示「没有事」。
//      「数量」和「该先做哪条」原来是两个独立区块，那是同一件事说了两遍——合并见 `TodoCard`。
//   3. **我上次干到哪了** —— 接着读的书、最近改过的稿、今天值得看的情报。
//
// 每一块独立取数、独立失败：Worker 慢或 AI HOT 挂掉都只让那一块自己安静下去，
// 不能拖着整页转圈，更不能白屏。

import { useCallback, useEffect, useRef, useState } from "react";
import { TODO_CARDS } from "../lib/views.js";
import { SOURCES } from "../lib/sources.js";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, Note, PageHeader, SectionHead, relTime , MenuButton} from "../components/ui.jsx";
import { Cover } from "../components/Cover.jsx";
// ⚠️ 每日清单那一块**搬去了 `components/DayPlan.jsx`**，因为 `Today.jsx` 也要用它，
// 而页面 import 另一个页面是这个项目明令禁止的（改总览会顺手改坏今日，且不报错）。
import { DayPlan, usePlan } from "../components/DayPlan.jsx";
import { bookProgress, pct, recentReadings, resumeEntry } from "../lib/reading.js";
import {
  IconArchive,
  IconArrowRight,
  IconBook2,
  IconCircleDashed,
  IconFileText,
  IconFolder,
  IconHistory,
  IconSparkles,
  IconDatabase,
  IconCheck,
  IconPlus,
  IconTrash,
  IconClipboardList,
} from "../components/icons.jsx";
import { BackupDrawer } from "../components/BackupDrawer.jsx";
import { NewContentButton } from "../components/NewContentButton.jsx";
import { setOpenTarget } from "../lib/open-target.js";

/**
 * 流水线三段各自的图标。**按那一步在做什么选，不按状态选**——筛、归类、写，
 * 三个动作各画各的，比三个形状相近的状态圈好认。
 * 认不出的回落到虚线圈（`views.js` 加一档而这里忘了配时，宁可给个通用的，
 * 也不要一行有图标一行没有）。
 */
/**
 * 一张待办卡里最多列几条。
 *
 * ⚠️ **超出的不列，也不在卡里开滚动区。** 这个项目明确否决过「为了少一条滚动条去套
 * `max-height`」——那只会把一栏切成两半，鼠标在哪滚的是哪（引用块、看板列、左栏目录
 * 都踩过）。卡片上那个数字已经说了总共几条，「去看看」就是看全部的路。
 */
const TOP_N = 3;

export function Overview({ config, status, statusError, statusLoading, onRetryStatus, onGo, onIntake, onSettings }) {
  const workerReady = true;
  /**
   * 每一档**最该先做的那几条**（列表最前面的 `TOP_N` 条）。
   *
   * 这原本是一个独立的「系统建议」区块，和下面的计数卡分开摆——而它们说的是同一件事的
   * 两个层次：一个报「这一档有几条」，一个报「其中该先做哪条」。**分开摆就是同一件事
   * 说了两遍**，还各占一整块。现在第二层直接长在第一层那张卡里。
   */
  const [tops, setTops] = useState(null);
  useEffect(() => {
    if (!workerReady) return;
    let active = true;
    Promise.all(TODO_CARDS.map(async (c) => {
      try {
        const result = await SOURCES[c.view].list({ state: c.state });
        return [c.key, result.items.slice(0, TOP_N)];
      } catch {
        return [c.key, []]; // 一档取不到不能拖着另一档，更不能白屏
      }
    })).then((rows) => active && setTops(Object.fromEntries(rows)));
    return () => { active = false; };
  }, [workerReady, status?.ts]);
  // **只数等你动手的**。把 Worker 正在跑的活也算进「待处理」，会让人以为自己欠着事。
  const pending = TODO_CARDS.reduce((n, c) => n + (status?.counts?.[c.key] ?? 0), 0);
  const plan = usePlan(true);
  // 「新建」和侧栏常驻的「入库」不是一回事：入库是**存一条素材**（已经有的东西），
  // 新建是**开一篇新的**（还不存在的东西）。同一个动作两个入口才该合并，这是两个动作。

  return (
    <>
      {/* **不写 desc。** 原来那句是在解释这一页的段落顺序（先清单、再建议、再队列），
          而顺序本身在屏幕上就摆着——需要一句话说明才看得懂的版面，说明是白写的。
          省下的两行高度直接换成「接着上次」能不能进首屏。 */}
      <PageHeader
        title="总览"
        aside={
          <>
            {status ? (
              <div className="conn" style={{ border: 0, padding: 0 }}>
                <span className={`dot ${pending ? "dot-accent" : "dot-ok"}`} />
                {pending ? `${pending} 件事等你` : "手上没有待办"}
              </div>
            ) : null}
            {/* 和别处是**同一颗按钮**（`components/NewContentButton.jsx`）。
                复制一份简化版的话，以后加一种创建方式会漏掉这一处。 */}
            {workerReady ? <NewContentButton onGo={onGo} /> : null}
          </>
        }
      />

      {workerReady && status ? <CollectionReminder collections={status.collections} onGo={onGo} /> : null}

      <DayPlan plan={plan} />

      {workerReady && (
        <>
          <ErrorNote error={statusError} what="读取本地工作区状态" onRetry={onRetryStatus} />
          {statusLoading && !status ? (
            <Loading rows={2} />
          ) : status ? (
            <div className="overview-block">
              <div className="todo-grid">
                {TODO_CARDS.map((c) => (
                  <TodoCard
                    key={c.key}
                    card={c}
                    n={status.counts?.[c.key] ?? 0}
                    items={tops === null ? undefined : tops[c.key]}
                    plan={plan}
                    onGo={onGo}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* 包一层是为了让这一页的段间距能整体收窄（`.overview-block`）：四段各带 42px 上边距，
          光是段与段之间的空白就把「接着上次」顶到了首屏之外 */}
      <section className="overview-block">
        <SectionHead icon={IconHistory} title="接着上次" />
        <div className="resume-grid">
          <ResumeBook onGo={onGo} />
          {workerReady ? <RecentDrafts onGo={onGo} /> : null}
          <TodayIntel onGo={onGo} />
        </div>
      </section>

      <SystemRow config={config} workerReady={workerReady} onIntake={onIntake} onSettings={onSettings} />

      {/* 建完直接跳去那一条。**不留在总览**：新建完最想做的是接着写，
          而总览上那几个计数要等下一轮心跳才会变，留在这儿看着像没建成功。 */}
    </>
  );
}

function CollectionReminder({ collections, onGo }) {
  if (!collections) return null;
  const oldestDays = collections.oldestPendingAt ? Math.floor((Date.now() - Date.parse(collections.oldestPendingAt)) / 86400_000) : 0;
  if (collections.pending < 20 && oldestDays <= 7) return null;
  return <Note tone="warning" title={`素材工作区有 ${collections.pending} 条待处理来源`}>
    最早一条已放了 {oldestDays} 天。系统不会替你决定它是否值得留下。
    <button className="btn btn-sm" onClick={() => onGo("materials", "待处理")}>去处理</button>
  </Note>;
}

// ---- 计数 ------------------------------------------------------------------

/**
 * 流水线自己在跑的三段，画成**一条有三个节点的流程线**，摆在两张卡底下。
 *
 * **画成流程线不是加装饰，是把真实存在的顺序显出来**：灵感进来先「待初筛」，筛完成为
 * 「待整理」，整理成选题之后「撰写中」——它们本来就是一条链的三段，前一段的产出就是
 * 后一段的输入。摊成一排各不相干的数字，这层关系是看不出来的。
 * （这也是流水线四段在「创作」页做成 tab 而不是四个侧栏项的同一条理由。）
 *
 * ⚠️ **不能删掉这一块。** 这是首页上唯一一处能看出「流水线卡住了」的地方：Worker 挂了、
 * LLM key 过期了，表现就是「待初筛」一路往上涨。删了的话，坏掉是**看不见**的。
 *
 * **摆在页头正下方**，因为它是唯一能看出流水线卡住的地方，得每次打开都扫得到；
 * 但**只占一行、视觉安静**——「显眼」和「安静」是两件事，位置管前者，视觉重量管后者。
 *
 * **0 的时候节点是空心的**——它们的 0 是正常态，给正常态加视觉重量，等于每天都在提醒你
 * 一件不用做的事。堆了东西才变成实心黑点，那时它才该抢你一眼。
 */
/**
 * 「等你动手」的一档：**数量 + 最该先做的那几条 + 逐条加进清单**。
 *
 * 这张卡是两块东西合并来的。原来是「系统建议」区块和这张计数卡各占一块，而它们说的是
 * 同一件事的两个层次——一个报「这一档有几条」，一个报「其中该先做哪条」。**分开摆就是
 * 同一件事说了两遍**，还多一个段头、多一整块高度；而且建议那份的四条队列里有两条引的
 * 状态在 D1 里根本不存在（见 `views.js` 的注释），永远取不到东西也永远不报错。
 *
 * ⚠️ **加进清单的那条不从这里移除，只打个记号。**
 *
 *   **卡片是库的镜子，清单是你的承诺。镜子不能因为你许了愿就改。**
 *
 * 「选题待写 2」数的是库里真实处于「待写」的条数——你把它抄进今天的清单，那条选题
 * 还是待写。移掉它，上面那个 2 和下面的列表当场对不上，等于谎报库存。它真正消失的
 * 时机是**库里状态变了**（选题 → 撰写中、稿件 → 已发布），那时计数自己会减 1、
 * 列表自己会少一条，不需要任何额外机制。清单里打勾同理：那是你对自己说「做完了」，
 * 不是库里的事实。
 *
 * ⚠️ **卡片外壳不是 button**：里面有好几个按钮，button 套 button 是非法结构。
 *
 * `items === undefined` 是「还在取」，`[]` 是「取到了但这一档是空的」。**两者不能混**：
 * 混了的话加载中的那一瞬间会先闪一次「这一档清空了」。
 */
function TodoCard({ card, n, items, plan, onGo }) {
  const dayLabel = plan.data && plan.data.date === plan.data.tomorrow ? "明天" : "今天";
  const tasks = plan.data?.tasks || [];
  const rest = items ? n - items.length : 0;

  return (
    <div className="todo-card" data-empty={!n}>
      <span className="todo-card__label">{card.label}</span>
      <span className="todo-card__value">{n}</span>

      {items === undefined ? (
        <span className="todo-card__hint">正在读…</span>
      ) : items.length ? (
        <ul className="todo-card__list">
          {items.map((it) => {
            const text = `${card.action}：${it.title}`;
            const already = tasks.some((t) => t.text === text);
            return (
              <li key={it.key} className="todo-card__row" data-on={already}>
                {/* 标题点下去开**那一条**，不是它所在的那一页 */}
                <button
                  className="todo-card__top"
                  title={it.title}
                  onClick={() => {
                    setOpenTarget(card.view, it.key);
                    onGo(card.view, card.state);
                  }}
                >
                  {it.title}
                </button>
                {plan.enabled && plan.data ? (
                  <button
                    className="todo-card__add"
                    disabled={already || plan.busy}
                    title={already ? `已经在${dayLabel}的清单里了` : `把这条加进${dayLabel}的清单`}
                    aria-label={already ? `「${it.title}」已在清单里` : `把「${it.title}」加进${dayLabel}的清单`}
                    onClick={() => plan.add(text)}
                  >
                    {already ? <IconCheck size={13} stroke={2.4} aria-hidden="true" /> : <IconPlus size={13} stroke={2.2} aria-hidden="true" />}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <span className="todo-card__hint">这一档清空了</span>
      )}

      {/* 动作行贴着卡片底边，三张卡的按钮才落在同一条线上 */}
      <span className="todo-card__acts">
        {/* 没列全的时候照实说还剩几条——**列表被截断这件事必须写在屏幕上**，
            否则「选题待写 5」配着三行会被读成「另外两条不见了」 */}
        <span className="todo-card__rest">{rest > 0 ? `还有 ${rest} 条` : ""}</span>
        <button className="todo-card__go" onClick={() => onGo(card.view, card.state)}>
          去看看
          <IconArrowRight size={15} stroke={1.8} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

// ---- 今天的清单 ------------------------------------------------------------


// ---- 接着上次 --------------------------------------------------------------

/**
 * 正在读的书，最多两本。**不复制书架顶部那张大卡**——这里只是提醒你手上还有书没读完，
 * 点了直接跳进那本书的上次位置，不是先落到书架列表上再点一次。
 *
 * **两本是因为同时在读两本是常态**，一本时下面那块空白挺显眼。但只有真读过的才算数
 * （`recentReadings` 按进度记录取），不拿书架上没动过的书来填——那样就把
 * 「你正在读这些」变成了「书架上有这些」，而后者书架页自己就是。
 */
function ResumeBook({ onGo }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    api
      .books()
      .then((r) => {
        if (!alive) return;
        const books = r.books || [];
        // 进度指的那份文件可能已经不在书里了（书重新导入过），认不出章节的就不显示
        const items = recentReadings(books, 2)
          .map((x) => ({ ...x, entry: resumeEntry(x.book, x.reading) }))
          .filter((x) => x.entry);
        setState({ loading: false, items, count: books.length });
      })
      .catch(() => alive && setState({ loading: false }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.loading) return <ResumePanel icon={IconBook2} title="接着读" loading />;
  if (!state.items?.length) {
    return (
      <ResumePanel
        icon={IconBook2}
        title="接着读"
        empty={state.count ? "书架上有书，但还没开始读第一本" : "书架还是空的，先导入一本"}
        href="#/shelf"
        action="去书架"
      />
    );
  }

  return (
    <ResumePanel icon={IconBook2} title="接着读" href="#/shelf" action="去书架">
      <div className="resume-books">
        {state.items.map(({ book, reading, entry }) => {
          const whole = bookProgress(book, reading);
          return (
            // 跳的是这一本自己（hash 里带 dir），不是笼统的「最近那本」——
            // 列了两本却只有第一本点得对，是最没道理的那种坏交互
            <button key={book.dir} className="resume-book" onClick={() => onGo("shelf", book.dir)}>
              <Cover book={book} size="cover--sm" />
              <span className="resume-book__body">
                <strong title={book.name}>{book.name}</strong>
                {/* 章节名单独一行、超了就截断；**百分比不跟它挤在一行**——
                    挤在一起时长章节名会把最该看的那个数字先截掉 */}
                <span className="resume-book__where" title={entry.title}>
                  读到「{entry.title}」
                </span>
                <span className="resume-book__foot">
                  <span className="resume-book__bar" aria-hidden="true">
                    <span style={{ width: pct(whole) }} />
                  </span>
                  <em>{book.chapterCount > 1 ? `全书 ${pct(whole)}` : pct(reading.progress)}</em>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </ResumePanel>
  );
}

/**
 * 最近改过的稿。**不带状态过滤**——上面那张「初稿待修改」的大卡已经管了「该改哪些」，
 * 这里回答的是另一个问题：我上次动的是哪一篇。所以已发布的也该出现在列表里。
 *
 * 点一条跳到**它那一档过滤好的列表**，不直接开正文：路由里的 hash 只有「库 + 状态」
 * 两段，塞进条目 id 得改路由格式，而状态值本身带斜杠（灵感库那个「初筛失败/需人工」），
 * 加一段就要重新处理分隔符——为省一次点击去动路由格式，不划算。
 */
function RecentDrafts({ onGo }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    SOURCES.drafts
      .list({})
      .then((r) => {
        if (!alive) return;
        /**
         * **同名的合成一条。** 一个选题会成好几篇稿（一个平台一篇），标题是 LLM 起的
         * 同一个 headline——不合的话列表里就是连着两行一模一样的标题，平台名缩在下面
         * 那行小灰字里，扫过去只会以为是重复渲染的 bug。合成一条之后，四行就是四件事。
         */
        const merged = [];
        for (const it of [...(r.items || [])].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))) {
          const same = merged.find((m) => m.title === it.title);
          if (same) same.platforms.push(it.sub);
          else merged.push({ ...it, platforms: [it.sub].filter(Boolean) });
        }
        setState({ loading: false, items: merged.slice(0, 4) });
      })
      .catch((e) => alive && setState({ loading: false, error: e }));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ResumePanel
      icon={IconFileText}
      title="最近改过的"
      loading={state.loading}
      empty={!state.loading && !state.items?.length ? (state.error ? "取不到稿件库" : "稿件库里还没有稿子") : ""}
      onAction={() => onGo("drafts", "")}
      action="全部稿子"
    >
      {state.items?.length ? (
        <ul className="mini-list">
          {state.items.map((it) => (
            <li key={it.key}>
              <button onClick={() => onGo("drafts", it.badge || "")} title={it.title}>
                <span className="mini-list__title">{it.title}</span>
                <span className="mini-list__meta">
                  {[it.badge, it.platforms.filter(Boolean).join(" / ")].filter(Boolean).join(" · ")}
                  {it.time ? <span className="mini-list__time">{relTime(it.time)}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </ResumePanel>
  );
}

/**
 * 今天值得看的三条 AI 情报。**过滤后的那一份**（跟着 config/attention.json 的关注词），
 * 总览不是用来通读热点的——通读去热点页，这里只回答「今天有没有必要点进去」。
 *
 * 抓不到就整块安静收起：AI HOT 是解析别人的页面来的，它挂掉不该在总览上报一个红框。
 */
function TodayIntel({ onGo }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    api
      .hotAi()
      .then((r) => {
        if (!alive) return;
        const first = (r.groups || [])[0];
        setState({ loading: false, date: first?.date || "", items: (first?.items || []).slice(0, 3) });
      })
      .catch(() => alive && setState({ loading: false }));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ResumePanel
      icon={IconSparkles}
      title="今天值得看"
      loading={state.loading}
      empty={!state.loading && !state.items?.length ? "关注领域里今天没有新东西" : ""}
      onAction={() => onGo("hot")}
      action="全部热点"
    >
      {state.items?.length ? (
        <ul className="mini-list">
          {state.items.map((it) => (
            <li key={it.title}>
              <button onClick={() => onGo("hot")} title={it.summary || it.title}>
                <span className="mini-list__title">{it.title}</span>
                {it.summary ? <span className="mini-list__meta">{it.summary}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </ResumePanel>
  );
}

/**
 * 三块共用的外壳：图标 + 标题 + 内容 + 底部一个出口。
 *
 * 出口固定在底部，三块的按钮就永远在同一条水平线上——每块各摆各的话，
 * 一行三个出口会因为内容长短各在各的高度上。
 */
function ResumePanel({ icon: Icon, title, children, loading, empty, action, href, onAction }) {
  return (
    <section className="resume-panel">
      <h3 className="resume-panel__head">
        <Icon size={16} stroke={1.7} aria-hidden="true" />
        {title}
      </h3>
      <div className="resume-panel__body">
        {loading ? (
          <div className="grid" style={{ gap: 8 }}>
            <div className="skeleton" style={{ width: "82%" }} />
            <div className="skeleton" style={{ width: "58%" }} />
          </div>
        ) : empty ? (
          <p className="resume-panel__empty">{empty}</p>
        ) : (
          children
        )}
      </div>
      {action ? (
        href ? (
          <a className="resume-panel__go" href={href}>
            {action}
            <IconArrowRight size={14} stroke={1.8} aria-hidden="true" />
          </a>
        ) : (
          <button className="resume-panel__go" onClick={onAction}>
            {action}
            <IconArrowRight size={14} stroke={1.8} aria-hidden="true" />
          </button>
        )
      ) : null}
    </section>
  );
}

// ---- 底部的系统行 ----------------------------------------------------------

/**
 * vault 路径、归档、外部入口。
 *
 * 这些**不该占首屏**：路径正常的时候没人需要看它，归档是几周想起来一次的动作。
 * 但也不能藏起来——路径出错时它是唯一的线索，所以出错分支照旧是一个显眼的 Note。
 *
 * 原先的「快捷动作」区在这里被吃掉了：那三个入口里，「存一条素材」和侧栏常驻的
 * 「入库」是同一个按钮，「公众号排版」是侧栏就有的一页（而且它当时还是 target=_blank
 * 跳出工作台的外链，同一个工具两个入口两种行为）。只有「打开 Obsidian」在别处没有，
 * 它就该待在 vault 路径旁边。
 */
function SystemRow({ workerReady, onIntake }) {
  return (
    <div className="sysrow">
      <span className="sysrow__path mono" title="当前单工作区">
        当前本地工作区 · SQLite
      </span>
      <span className="sysrow__acts">
        <button className="sysrow__btn" onClick={onIntake}>
          存一条素材
        </button>
        {workerReady ? <ArchiveButton /> : null}
        <BackupButton />
      </span>
    </div>
  );
}
/**
 * 备份入口。抽屉挂在按钮自己身上而不是页面顶层：这一屏只有它需要，
 * 提到 `Overview` 里就要多一个只为它存在的 state。
 */
function BackupButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="sysrow__btn"
        onClick={() => setOpen(true)}
        title="阶段 5 完成后启用本地工作区备份与恢复"
      >
        <IconDatabase size={14} stroke={1.7} aria-hidden="true" />
        备份与恢复
      </button>
      <BackupDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// 核对当前工作区中的发布事实，不创建第二份归档状态。
function ArchiveButton() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setState(await api.runArchive());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const done = state
    ? state.total === 0
      ? "当前本地工作区还没有已发布记录"
      : state.message || `已核对 ${state.total} 篇发布记录`
    : "";

  return (
    <>
      <button
        className="sysrow__btn"
        onClick={run}
        disabled={busy}
        title="核对已发布内容是否都已记录在当前本地工作区"
      >
        <IconArchive size={14} stroke={1.7} aria-hidden="true" />
        {busy ? "核对中…" : "核对发布记录"}
      </button>
      {done ? <span className="sysrow__done">{done}</span> : null}
      {error ? <span className="sysrow__done">核对失败：{error.message}</span> : null}
    </>
  );
}
