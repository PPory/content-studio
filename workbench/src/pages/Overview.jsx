// 今日页回答两个问题，顺序不能反：
//
//   1. **有没有新活** —— 等你动手的两个数字（选题待写 / 初稿待修改）。流水线自己会消化的
//      那三个队列（待初筛 / 待整理 / 撰写中）压成一条细横条：它们的 0 是正常态，
//      和「等你动手」的 0 含义正好相反，摊成一排同样大的卡片会让首屏大半在展示「没有事」。
//   2. **我上次干到哪了** —— 接着读的书、最近改过的稿、今天值得看的情报。
//
// 每一块独立取数、独立失败：Notion 慢或 AI HOT 挂掉都只让那一块自己安静下去，
// 不能拖着整页转圈，更不能白屏。

import { useEffect, useState } from "react";
import { AUTO_CARDS, TODO_CARDS } from "../lib/views.js";
import { SOURCES } from "../lib/sources.js";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, Note, PageHeader, SectionHead, relTime } from "../components/ui.jsx";
import { Cover } from "../components/Cover.jsx";
import { bookProgress, pct, recentReadings, resumeEntry } from "../lib/reading.js";
import {
  IconArchive,
  IconArrowRight,
  IconBook2,
  IconCategory,
  IconCircleDashed,
  IconExternalLink,
  IconFileText,
  IconFilter,
  IconFolder,
  IconHistory,
  IconPencil,
  IconSparkles,
  IconDatabase,
  IconSettings,
} from "../components/icons.jsx";
import { BackupDrawer } from "../components/BackupDrawer.jsx";
import { setOpenTarget } from "../lib/open-target.js";

const DECISION_QUEUES = [
  { view: "drafts", state: "待修改", action: "先完成主稿", why: "离发布最近" },
  { view: "drafts", state: "待发布", action: "确认并发布", why: "内容已经准备好" },
  { view: "topics", state: "待写", action: "选择今天要写的题", why: "决定今天产出什么" },
  { view: "inbox", state: "需处理", action: "处理异常灵感", why: "避免有价值的输入卡住" },
];

/**
 * 流水线三段各自的图标。**按那一步在做什么选，不按状态选**——筛、归类、写，
 * 三个动作各画各的，比三个形状相近的状态圈好认。
 * 认不出的回落到虚线圈（`views.js` 加一档而这里忘了配时，宁可给个通用的，
 * 也不要一行有图标一行没有）。
 */
const AUTO_ICONS = {
  待初筛: IconFilter,
  待整理: IconCategory,
  选题撰写中: IconPencil,
};

export function Overview({ config, status, statusError, statusLoading, onGo, onIntake, onSettings }) {
  const workerReady = config?.worker?.configured;
  const [decisions, setDecisions] = useState(null);
  useEffect(() => {
    if (!workerReady) return;
    let active = true;
    Promise.all(DECISION_QUEUES.map(async (queue) => {
      try {
        const result = await SOURCES[queue.view].list({ state: queue.state });
        return result.items[0] ? { ...queue, item: result.items[0] } : null;
      } catch {
        return null;
      }
    })).then((rows) => active && setDecisions(rows.filter(Boolean).slice(0, 3)));
    return () => { active = false; };
  }, [workerReady, status?.ts]);
  // **只数等你动手的**。把 Worker 正在跑的活也算进「待处理」，会让人以为自己欠着事。
  const pending = TODO_CARDS.reduce((n, c) => n + (status?.counts?.[c.key] ?? 0), 0);

  return (
    <>
      <PageHeader
        eyebrow="TODAY"
        title="今日决策"
        desc="先决定今天推进哪一篇；数据库和自动队列退到后面，需要时再看。"
        aside={
          status ? (
            <div className="conn" style={{ border: 0, padding: 0 }}>
              <span className={`dot ${pending ? "dot-accent" : "dot-ok"}`} />
              {pending ? `${pending} 件事等你` : "手上没有待办"}
            </div>
          ) : null
        }
      />

      {!workerReady && <SetupGuide onSettings={onSettings} />}

      {workerReady ? (
        <section className="today-decisions">
          <SectionHead eyebrow="NEXT BEST ACTION" title="今天先做什么" desc="按离发布的距离排序，最多只给三件事。" />
          {decisions === null ? <Loading rows={3} /> : decisions.length ? (
            <div className="today-decisions__list">
              {decisions.map(({ view, state, action, why, item }, index) => (
                <button key={`${view}:${item.key}`} className="today-decision" onClick={() => {
                  setOpenTarget(view, item.key);
                  onGo(view, state);
                }}>
                  <span className="today-decision__rank">0{index + 1}</span>
                  <span className="today-decision__body">
                    <strong>{action}</strong>
                    <b>{item.title}</b>
                    <small>{why} · {SOURCES[view].label} / {state}</small>
                  </span>
                  <IconArrowRight aria-hidden="true" stroke={1.8} />
                </button>
              ))}
            </div>
          ) : <Note tone="success" title="今天的关键队列已经清空">可以去灵感库收集新输入，或在数据页复盘已发布内容。</Note>}
        </section>
      ) : null}

      {workerReady && (
        <>
          <ErrorNote error={statusError} what="读取流水线状态" />
          {statusLoading && !status ? (
            <Loading rows={2} />
          ) : status ? (
            <div className="todo-grid">
              {TODO_CARDS.map((c) => {
                const n = status.counts?.[c.key] ?? 0;
                return (
                  <button key={c.key} className="todo-card" data-empty={!n} onClick={() => onGo(c.view, c.state)}>
                    <span className="todo-card__label">{c.label}</span>
                    <span className="todo-card__value">{n}</span>
                    <span className="todo-card__hint">{n ? c.hint : "这一档清空了"}</span>
                    <span className="todo-card__go">
                      去看看
                      <IconArrowRight size={15} stroke={1.8} aria-hidden="true" />
                    </span>
                  </button>
                );
              })}

              {/* 流水线自己在跑的三段，占第三格。**外壳和左边两张卡一样**（同样的边框、
                  圆角、内边距、同一行的标题），层次靠内容拉开：那边是一个 46px 的数字，
                  这边是三行小字。同一排里一张卡有壳、一张没壳，看着像那格没加载出来。
                  机制说明（几分钟跑一轮）留在 title 里：那种话第一天有用，之后每天都在读同一句。 */}
              <div className="auto-card">
                <span className="auto-card__label">流水线在跑</span>
                <div className="auto-card__list">
                  {AUTO_CARDS.map((c) => {
                    const n = status.counts?.[c.key] ?? 0;
                    const Icon = AUTO_ICONS[c.key] || IconCircleDashed;
                    return (
                      <button key={c.key} className="auto-card__item" title={c.hint} onClick={() => onGo(c.view, c.state)}>
                        <Icon size={16} stroke={1.7} aria-hidden="true" />
                        <span className="auto-card__name">{c.label}</span>
                        <span className={n ? "auto-card__n" : "auto-card__n is-zero"}>{n}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      <SectionHead icon={IconHistory} title="接着上次" />
      <div className="resume-grid">
        <ResumeBook onGo={onGo} />
        {workerReady ? <RecentDrafts onGo={onGo} /> : null}
        <TodayIntel onGo={onGo} />
      </div>

      <SystemRow config={config} workerReady={workerReady} onIntake={onIntake} onSettings={onSettings} />
    </>
  );
}

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
function SystemRow({ config, workerReady, onIntake, onSettings }) {
  const vault = config?.vault;
  // 这两条原来是死胡同：告诉你「去 .env 里填 VAULT_ROOT」，然后就没有然后了。
  // **只报告问题不引导行动，是这个项目明确要避免的反馈方式**——所以那句话本身就是入口。
  if (vault?.configured && !vault.exists) {
    return (
      <Note tone="danger" title="vault 路径不存在">
        <code>{vault.root}</code> 打不开。
        <FixButton onSettings={onSettings}>去设置里改路径</FixButton>
      </Note>
    );
  }
  if (!vault?.configured) {
    return (
      <Note title="还没配置 vault">
        书架、洞察、批注和全局检索都要它。
        <FixButton onSettings={onSettings}>去设置里填 vault 路径</FixButton>
      </Note>
    );
  }

  return (
    <div className="sysrow">
      <span className="sysrow__path mono" title={vault.root}>
        {vault.root}
      </span>
      <span className="sysrow__acts">
        <button className="sysrow__btn" onClick={onIntake}>
          存一条素材
        </button>
        {vault.name ? (
          <a className="sysrow__btn" href={`obsidian://open?vault=${encodeURIComponent(vault.name)}`}>
            <IconFolder size={14} stroke={1.7} aria-hidden="true" />
            打开 Obsidian
          </a>
        ) : null}
        {workerReady ? <ArchiveButton /> : null}
        {/* 备份和 vault 路径待在一起：它们回答的是同一类问题——「我的东西放在哪、
            出事了怎么办」。做成侧栏一项的话，一个几周才点一次的东西会全程占着一屏。 */}
        <BackupButton />
        {Object.entries(config?.links?.notion || {})
          .filter(([, url]) => url)
          .map(([name, url]) => (
            <a key={name} className="sysrow__btn" href={url} target="_blank" rel="noreferrer">
              <IconExternalLink size={14} stroke={1.7} aria-hidden="true" />
              {name}
            </a>
          ))}
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
        title="导出一份可以带走的备份，或从备份 / 自动快照恢复"
      >
        <IconDatabase size={14} stroke={1.7} aria-hidden="true" />
        备份与恢复
      </button>
      <BackupDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// Notion 稿件库「已发布」→ vault Markdown。单向、只增不改：
// 已导出的文件绝不覆盖，你在 Obsidian 里给归档稿加过的批注不会被重跑冲掉。
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
      ? "稿件库里还没有「已发布」的稿子"
      : `新导出 ${state.written.length} 篇，跳过 ${state.skipped} 篇`
    : "";

  return (
    <>
      <button
        className="sysrow__btn"
        onClick={run}
        disabled={busy}
        title="把稿件库里「已发布」的稿子单向导出到 归档/发布作品/，只增不改，已导过的会跳过"
      >
        <IconArchive size={14} stroke={1.7} aria-hidden="true" />
        {busy ? "导出中…" : "归档已发布"}
      </button>
      {done ? <span className="sysrow__done">{done}</span> : null}
      {error ? <span className="sysrow__done">归档失败：{error.message}</span> : null}
    </>
  );
}

function SetupGuide({ onSettings }) {
  return (
    <Note title="还没连上 content-pipeline，先做两步">
      <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
        <li>
          在 content-pipeline 目录执行 <code>npx wrangler secret put WORKBENCH_KEY</code>，随便设一串长密码，然后{" "}
          <code>npx wrangler deploy</code>
        </li>
        <li>把同一串密码和 Worker 地址填进设置面板的「流水线」那一段</li>
      </ol>
      <FixButton onSettings={onSettings}>去设置里填</FixButton>
    </Note>
  );
}

/**
 * 「去设置」。**空态引导必须能点**——「在 .env 里填 X」这句话本身要是个入口，
 * 否则用户读完这句话之后的下一步是去开编辑器，而这一步机器完全可以替他走。
 *
 * 拿不到 `onSettings` 时**不画**（比如以后有人把 Overview 用在别处），
 * 而不是画一个点了没反应的按钮。
 */
function FixButton({ onSettings, children }) {
  if (!onSettings) return null;
  return (
    <button className="sysrow__btn" onClick={onSettings} style={{ marginTop: 8 }}>
      <IconSettings size={14} stroke={1.7} aria-hidden="true" />
      {children}
    </button>
  );
}
