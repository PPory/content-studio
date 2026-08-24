// 数据页：发出去之后怎么样。
//
// **地基是「一条内容一行」**（`data/posts.csv`），不是账号级的周录。总览的发布量、
// 渠道分布、以后的内容明细和复盘四象限，全是从那一份聚合出来的——没有它，上面几块都是空的。
// 账号级周录（metrics.csv）没有消失，它管**粉丝数**：那是账号级的，posts 里没有也不会有。
//
// 三个 tab（内容明细 / 月度总览 / 数据同步），在**同一页**里切。
//
// ⚠️ **默认落在「内容明细」，不是总览。** 总览回答「这个月整体怎么样」——那个问题
// 要攒够几个月才有答案；而「每篇长什么样」从第一篇起就有信息量。一打开就看到
// 四张写着 2、1 的卡和一根孤零零的柱子，人的结论是「这功能没数据」。
//
// ⚠️ **侧栏不给它二级项。** 数据只有一件事，就是「发出去之后怎么样」；拆成
// 「表现 / 来源」两个侧栏项等于让人每次先想「这个数字在哪一页」，而它们本来就是
// 同一批数字的两个视角。旧的两条路由留着，重定向到对应 tab。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { TrendChart, platformColor } from "../components/TrendChart.jsx";
import { WeeklyBars } from "../components/WeeklyBars.jsx";
import { ErrorNote, Note, Loading, Select, Empty, relTime, FilterHeader, SearchBox } from "../components/ui.jsx";
import {
  IconChartBar,
  IconChevronLeft,
  IconChevronRight,
  IconCloudUpload,
  IconDatabase,
  IconExternalLink,
  IconRefresh,
  IconSettings,
} from "../components/icons.jsx";
import {
  detailRows, docMatch, extraColumns, fmtExtra, fmtMonth, fmtNum, inMonth, metricLabel, monthsOf,
  overview, parseExtra, platformSummary, platformsIn, recent, trendWorthDrawing, weeklyPublish, METRIC_KEYS,
} from "../lib/posts.js";

/** 三个 tab 的真源。⚠️ 顺序就是屏幕上的顺序，`key` 进 URL——改字面量等于改深链。 */
export const DATA_TABS = [
  { key: "明细", label: "内容明细" },
  { key: "总览", label: "月度总览" },
  { key: "同步", label: "数据同步" },
];

const thisMonth = () => new Date().toISOString().slice(0, 7);
const todayStr = () => new Date().toISOString().slice(0, 10);

function useDark() {
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = (e) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

export function Metrics({ onSettings, tab = "明细", onTab }) {
  const [posts, setPosts] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);
  const [month, setMonth] = useState(thisMonth);

  const load = useCallback(() => {
    api.posts().then(setPosts).catch(setError);
    api.metrics().then(setMetrics).catch(setError);
  }, []);
  useEffect(load, [load]);

  const rows = posts?.rows || [];
  const months = useMemo(() => monthsOf(rows), [rows]);

  // 打开时落在**有数据的最近一个月**，不是死认当月。月初打开时当月常常只有一两条，
  // 而这一页的问题是「上个月怎么样」——每次都要手动往回翻一格是没必要的负担。
  useEffect(() => {
    if (months.length && !months.includes(month)) setMonth(months[0]);
  }, [months, month]);

  const shift = (d) => {
    const i = months.indexOf(month);
    const next = months[i + d];
    if (next) setMonth(next);
  };

  // ⚠️ **月份选择器只在跟月份有关的那两个 tab 上画。** 「数据同步」管的是文件和录入，
  // 和当前看的是哪个月毫无关系——挂在那儿会让人以为导入的东西只进当前这一个月。
  const monthly = tab !== "同步";

  return (
    <>
      <FilterHeader
        title="数据"
        desc="先把平台数字和稿子对上，再判断什么有效、下一篇具体改变什么。"
        chips={
          <div className="chips chips-sm" aria-label="切换视图">
            {DATA_TABS.map((t) => (
              <button key={t.key} className="chip" aria-pressed={tab === t.key} onClick={() => onTab?.(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        }
        action={
          rows.length && monthly ? (
            <div className="month-nav">
              <button className="icon-btn" onClick={() => shift(1)} disabled={months.indexOf(month) >= months.length - 1} aria-label="上一个月">
                <IconChevronLeft aria-hidden="true" stroke={1.8} />
              </button>
              <strong>{fmtMonth(month)}</strong>
              <button className="icon-btn" onClick={() => shift(-1)} disabled={months.indexOf(month) <= 0} aria-label="下一个月">
                <IconChevronRight aria-hidden="true" stroke={1.8} />
              </button>
            </div>
          ) : null
        }
      />

      <ErrorNote error={error} what="读取数据" />
      {!posts && !error ? <Loading rows={3} /> : null}

      {posts && (
        <>
          {/* ⚠️ 一条内容都没有时，除「数据同步」外哪个 tab 都只能是空的——
              这时不画空态，直接给第一次上手那一屏（它自己会讲话）。 */}
          {rows.length === 0 && monthly ? (
            <FirstRun onDone={load} onSettings={onSettings} />
          ) : tab === "总览" ? (
            <OverviewTab rows={rows} month={month} />
          ) : tab === "明细" ? (
            <DetailTab rows={rows} month={month} />
          ) : (
            <SourcesTab posts={posts} metrics={metrics} onPosts={setPosts} onMetrics={setMetrics} onReload={load} onSettings={onSettings} />
          )}
        </>
      )}
    </>
  );
}

/* ---------- 空态：这才是你第一次打开时看到的东西 ---------------------------
 *
 * 参考的那个界面里全是数据，所以看不出这一块。但我们的第一屏就是空的——
 * 摆四个 0 和一张空图等于让人自己去猜从哪开始。第一屏必须自己会讲话：
 * 把文件拖进来，以及**去哪导这份文件**。
 */
const GUIDES = [
  { platform: "小红书", where: "创作服务平台 → 数据中心 → 内容分析 → 导出" },
  { platform: "公众号", where: "公众号后台 → 内容与互动 → 图文分析 → 导出 Excel" },
  { platform: "抖音", where: "创作者中心 → 数据中心 → 内容数据 → 下载数据" },
  { platform: "视频号", where: "视频号助手 → 数据中心 → 内容数据（导不了就手动录）" },
];

function FirstRun({ onDone, onSettings }) {
  const [error, setError] = useState(null);
  return (
    <>
      <Note title="还没有任何内容数据">
        这一页的每个数字都来自「一条内容一行」。先去平台后台点一下导出——数据是平台给你的，
        我们只是换个地方看，工作台不碰任何平台接口，也不会替你登录。下载完直接回这儿，它会自己找到那份文件。
      </Note>
      {/* 第一次打开时这块最有用：多半你刚下完文件，它已经在下面等着了 */}
      <Inbox onDone={onDone} onError={setError} onSettings={onSettings} />
      <ErrorNote error={error} what="导入" />
      <Importer onDone={onDone} />
      <div className="guide-grid">
        {GUIDES.map((g) => (
          <div key={g.platform} className="guide-card">
            <span className="tag tag--state">
              <span className="dot" style={{ background: platformColor(g.platform, false) }} />
              {g.platform}
            </span>
            <p>{g.where}</p>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- 月度总览 ------------------------------------------------------ */

function OverviewTab({ rows, month }) {
  const dark = useDark();
  const mine = useMemo(() => inMonth(rows, month), [rows, month]);
  const stat = useMemo(() => overview(rows, month), [rows, month]);
  const weeks = useMemo(() => weeklyPublish(mine, month), [mine, month]);
  const summary = useMemo(() => platformSummary(mine), [mine]);
  const platforms = platformsIn(mine);

  if (!mine.length) {
    return <Empty icon={IconChartBar}>{fmtMonth(month)}这个月没有内容记录。换个月份，或者去「数据来源」补一份导出文件。</Empty>;
  }

  return (
    <>
      <div className="stat-strip">
        <div>
          <strong>{stat.count}</strong>
          <span>本月发布 · {stat.platforms.length} 个渠道合计</span>
        </div>
        <div>
          <strong>{stat.platforms.length}</strong>
          <span>{stat.platforms.join("、") || "—"}</span>
        </div>
        <div>
          <strong className={stat.synced ? "" : "zero"}>{stat.synced ? stat.synced.slice(5) : "—"}</strong>
          <span>最近同步</span>
        </div>
        {/* 第四格不写「可分析」这种模糊词，直接写缺口——它既是状态也是下一步 */}
        <div>
          <strong className={stat.missing ? "" : ""}>{stat.missing ? `缺 ${stat.missing}` : "齐了"}</strong>
          <span>{stat.missing ? stat.byPlatformMissing.map((x) => `${x.platform} ${x.n} 篇`).join("、") : "每篇都有数字"}</span>
        </div>
      </div>

      <div className="data-grid">
        <section className="panel-block">
          <div className="panel-head">
            <div className="panel-head__main">
              <span className="eyebrow">按自然周统计</span>
              <h2>每周发布量</h2>
            </div>
          </div>
          {/* ⚠️ **一根柱子不是趋势。** 只有一周有内容时画出来是一根孤柱加几周空白，
              它没回答任何问题却占着这一屏最大的一块。「样本不够就说不够」在这儿的落地是
              不画、并说清**攒到什么程度它才会出现**——不然看着就像图表坏了。 */}
          {trendWorthDrawing(weeks) ? (
            <WeeklyBars weeks={weeks} platforms={platforms} dark={dark} />
          ) : (
            <p className="panel-none">
              这个月只有 1 周发过内容，画不出趋势。至少两周各有内容时，这里会出现每周发布量。
            </p>
          )}
        </section>

        <section className="panel-block">
          <div className="panel-head">
            <div className="panel-head__main">
              <span className="eyebrow">渠道分布</span>
              <h2>内容发在了哪里</h2>
            </div>
          </div>
          <div className="channels">
            {summary.map((c) => (
              <div key={c.platform} className="channel">
                <div className="channel__head">
                  <span className="tag tag--state">
                    <span className="dot" style={{ background: platformColor(c.platform, dark) }} />
                    {c.platform}
                  </span>
                  <span className="channel__count">
                    <strong>{c.count}</strong> 篇
                  </span>
                </div>
                {c.metrics.length ? (
                  <div className="channel__metrics">
                    {c.metrics.map((m) => (
                      <div key={m.key}>
                        {/* 覆盖不全时如实标出来，别让人以为这是全月合计 */}
                        <span title={m.n < c.count ? `只有 ${m.n}/${c.count} 篇有这个数字` : undefined}>
                          {m.label}
                          {m.n < c.count ? ` (${m.n}/${c.count})` : ""}
                        </span>
                        <strong>{fmtNum(m.total)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="channel__none">这批只有发布记录，还没有数字</p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel-block">
        <div className="panel-head">
          <div className="panel-head__main">
            <span className="eyebrow">最近内容</span>
            <h2>最近发了什么</h2>
          </div>
        </div>
        <RecentTable rows={recent(mine, 6)} dark={dark} />
      </section>
    </>
  );
}

function RecentTable({ rows, dark }) {
  return (
    <div className="table-wrap" style={{ marginTop: 0 }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>渠道</th>
            <th>内容</th>
            <th>发布时间</th>
            <th className="num">数据</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.date}-${r.title}-${i}`}>
              <td>
                <span className="dot" style={{ background: platformColor(r.platform, dark) }} />
                {r.platform}
              </td>
              <td className="cell-title">
                <span title={r.title}>{r.title || "（无标题）"}</span>
                {r.url ? (
                  <a className="doc-meta__link" href={r.url} target="_blank" rel="noreferrer noopener">
                    原文
                    <IconExternalLink aria-hidden="true" size={12} stroke={1.8} />
                  </a>
                ) : null}
              </td>
              <td className="muted">{r.date}</td>
              <td className="num">
                {/* 一行只给最要紧的两个数：这张表是「最近发了什么」，不是内容明细 */}
                {r.views == null ? (
                  <span className="muted">还没有数据</span>
                ) : (
                  <>
                    {metricLabel(r.platform, "views")} <strong>{fmtNum(r.views)}</strong>
                    {r.likes != null ? <> · {metricLabel(r.platform, "likes")} <strong>{fmtNum(r.likes)}</strong></> : null}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- 内容明细：一条内容一行 -----------------------------------------
 *
 * 总览回答「这个月整体怎么样」，这一屏回答「**具体是哪几篇、各自什么样**」。
 * 内容少的时候后者才有信息量——四篇的时候「平均阅读 163」不如直接看那四行。
 *
 * ⚠️ **平台特有指标在这儿才第一次露面**（小红书的曝光/封面点击率、公众号的完读率/在看）。
 * 它们导入时就落进了 `extra`，但在总览上没有落点——总览是跨平台合计，
 * 而这几个数**根本不跨平台可比**，加进去只会让人拿曝光和阅读数相加。
 */
function DetailTab({ rows, month }) {
  const dark = useDark();
  const [platform, setPlatform] = useState("");
  const [q, setQ] = useState("");

  const mine = useMemo(() => inMonth(rows, month), [rows, month]);
  const platforms = useMemo(() => platformsIn(mine), [mine]);
  const shown = useMemo(() => detailRows(mine, { platform, q }), [mine, platform, q]);
  // ⚠️ **列按「这一批里有没有非零值」算一次**，不按行算：按行判的话同一列时有时无，
  // 一列扫下去是锯齿，而且分不出「这条是 0」和「这个平台没这个指标」。
  const extras = useMemo(() => extraColumns(shown), [shown]);
  const match = useMemo(() => docMatch(mine), [mine]);

  if (!mine.length) {
    return <Empty icon={IconChartBar}>{fmtMonth(month)}这个月没有内容记录。换个月份，或者去「数据同步」补一份导出文件。</Empty>;
  }

  return (
    <>
      <div className="detail-bar">
        <div className="chips chips-sm" aria-label="按渠道筛选">
          <button className="chip" aria-pressed={!platform} onClick={() => setPlatform("")}>
            全部 {mine.length}
          </button>
          {platforms.map((p) => (
            <button key={p} className="chip" aria-pressed={platform === p} onClick={() => setPlatform(p)}>
              <span className="dot" style={{ background: platformColor(p, dark) }} />
              {p} {mine.filter((r) => r.platform === p).length}
            </button>
          ))}
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="搜标题" ariaLabel="在本月内容里搜标题" />
      </div>

      {/* ⚠️ 对不上稿子**不是错误，是常态**——从平台后台导进来的内容，工作台压根不知道
          它是谁写的。但它决定了复盘能说到什么程度，所以照实说一句、并说清下一步。 */}
      {match.total && match.matched < match.total ? (
        <Note tone="info">
          {match.total} 篇里有 {match.total - match.matched} 篇还没和工作台里的稿子对上——
          对上之后，复盘时才能把数字和「当初想说什么」放在一起看。
        </Note>
      ) : null}

      {shown.length ? (
        <div className="table-wrap">
          <table className="data-table detail-table">
            <thead>
              <tr>
                <th>渠道</th>
                <th>内容</th>
                <th>发布</th>
                {METRIC_KEYS.map((k) => (
                  <th key={k} className="num">{metricLabel(platform || shown[0].platform, k)}</th>
                ))}
                {extras.map((k) => (
                  <th key={k} className="num detail-table__extra">{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const ex = parseExtra(r);
                return (
                  <tr key={`${r.platform}-${r.date}-${r.title}-${i}`}>
                    <td>
                      <span className="dot" style={{ background: platformColor(r.platform, dark) }} />
                      {r.platform}
                    </td>
                    <td className="cell-title">
                      {/* ⚠️ 没标题的照实说「（无标题）」并标出体裁，别留一格空白：
                          空白看着像渲染坏了，而它其实是一条真发出去的内容。 */}
                      <span title={r.title || undefined}>{r.title || `（无标题${ex.体裁 ? `·${ex.体裁}` : ""}）`}</span>
                      {r.doc ? <span className="tag tag--state detail-table__doc">文字稿已匹配</span> : null}
                      {r.url ? (
                        <a className="doc-meta__link" href={r.url} target="_blank" rel="noreferrer noopener">
                          原文
                          <IconExternalLink aria-hidden="true" size={12} stroke={1.8} />
                        </a>
                      ) : null}
                    </td>
                    <td className="muted">{r.date.slice(5)}</td>
                    {METRIC_KEYS.map((k) => (
                      // ⚠️ **`null` 是「这个平台没这个指标」，画「—」不画 0。**
                      // 摆一个 0 会被读成「收藏了 0 次」，那是句假话。
                      <td key={k} className="num">
                        {r[k] == null ? <span className="muted">—</span> : <strong>{fmtNum(r[k])}</strong>}
                      </td>
                    ))}
                    {extras.map((k) => {
                      const f = fmtExtra(k, ex[k]);
                      return (
                        <td key={k} className="num detail-table__extra">
                          {f ? f.text : <span className="muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon={IconChartBar}>这个月没有符合条件的内容。换个渠道，或者清掉搜索词。</Empty>
      )}
    </>
  );
}

/* ---------- 数据来源 ------------------------------------------------------ */

function SourcesTab({ posts, metrics, onPosts, onMetrics, onReload, onSettings }) {
  const [inboxError, setInboxError] = useState(null);
  const rows = posts.rows;
  const perPlatform = platformsIn(rows).map((p) => {
    const mine = rows.filter((r) => r.platform === p);
    const dates = mine.map((r) => r.date).sort();
    return {
      platform: p,
      count: mine.length,
      last: dates[dates.length - 1],
      synced: mine.map((r) => r.synced).filter(Boolean).sort().pop() || "",
      missing: mine.filter((r) => r.views == null).length,
    };
  });

  return (
    <>
      {/* 自动发现排在手动拖拽**前面**：多数时候你刚从后台下完文件，
          这一块就已经等在那儿了，根本用不着往下走 */}
      <Inbox onDone={onReload} onError={setInboxError} onSettings={onSettings} />
      <ErrorNote error={inboxError} what="导入" />
      <Importer onDone={onReload} />

      {perPlatform.length > 0 && (
      <section className="panel-block">
        <div className="panel-head">
          <div className="panel-head__main">
            <span className="eyebrow">各渠道的数据新不新</span>
            <h2>已经导进来的</h2>
          </div>
        </div>
        <div className="channels">
          {perPlatform.map((c) => (
            <div key={c.platform} className="channel">
              <div className="channel__head">
                <span className="tag tag--state">
                  <span className="dot" style={{ background: platformColor(c.platform, false) }} />
                  {c.platform}
                </span>
                <span className="channel__count">
                  <strong>{c.count}</strong> 篇
                </span>
              </div>
              <div className="channel__metrics">
                <div><span>最近一篇</span><strong>{c.last || "—"}</strong></div>
                <div><span>数据采于</span><strong>{c.synced || "—"}</strong></div>
                <div><span>缺数字</span><strong>{c.missing || 0}</strong></div>
              </div>
            </div>
          ))}
        </div>
        <p className="panel-note">
          导出文件里没有的东西这里也不会有。同一份文件拖两次不会变成两行——按链接（没有链接就按
          平台+日期+标题）合并，新数字覆盖旧数字。
        </p>
      </section>
      )}

      <ManualPost platforms={posts.platforms} onSaved={onPosts} />

      <section className="panel-block">
        <div className="panel-head">
          <div className="panel-head__main">
            <span className="eyebrow">账号级</span>
            <h2>粉丝数（每周手录一次）</h2>
            <p className="page-sub">粉丝是账号级的数字，导出文件里没有，只能自己记。它和上面那份是两件事。</p>
          </div>
        </div>
        {metrics ? <FollowerEntry platforms={metrics.platforms} rows={metrics.rows} onSaved={onMetrics} /> : <Loading rows={2} />}
      </section>
    </>
  );
}

/* ---------- 导入：先看，再写 ----------------------------------------------
 *
 * 两步不是啰嗦。解析器只能靠**列名**认字段（各家导出的列顺序完全不同，改版还会变），
 * 认错了不会报错、不会白屏——只会让一列数字安静地进错格子，然后你按着错的数字做决定。
 * 所以先 dry 跑一遍，把「我把哪一列当成了什么」摊开给人看，再让人点确认。
 */
/**
 * 下载文件夹里发现的导出文件。
 *
 * 手动那条路里最烦的不是点确认，是「开文件对话框 → 翻到下载目录 → 在一堆文件里认出
 * 刚下的那个」。而这三步机器全知道答案。**卡片上直接写清导进来会发生什么**
 * （新增几条、更新几条），点之前就知道会不会白点——多数时候答案是「已经导过了」。
 */
function Inbox({ onDone, onError, onSettings }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");

  // ⚠️ **要 `return` 那个 promise**：下面 `take()` 得等它，否则「导入中」会提前收掉
  const scan = useCallback(
    () => api.postsInbox().then(setData).catch(() => setData({ files: [], dirs: [] })),
    []
  );
  useEffect(() => { scan(); }, [scan]);

  async function take(f, platform) {
    setBusy(f.id);
    try {
      await api.importInbox(f.id, platform);
      onDone();
      /**
       * ⚠️ **重扫必须 `await`。** 不等的话 `finally` 立刻把「导入中…」收掉，
       * 而 `data` 还是导入前那一份——于是有那么一段时间，界面上写着
       * **「导入 2 条到小红书」而这 2 条已经导进去了**，点下去是重复导入一次。
       * 「界面和数据安静地分叉」在这个项目里出过好几次，每次都是没等那一步。
       */
      await scan();
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  }

  if (!data?.files?.length) return null;

  return (
    <section className="panel-block">
      <div className="panel-head">
        <div className="panel-head__main">
          <span className="eyebrow">下载文件夹里翻到的</span>
          <h2>这几份还没导进来</h2>
        </div>
        <button className="btn btn-sm" onClick={scan}>
          <IconRefresh aria-hidden="true" stroke={1.7} />
          重新扫描
        </button>
      </div>

      <div className="inbox">
        {data.files.map((f) => (
          <div key={f.id} className="inbox__row">
            <div className="inbox__main">
              <strong title={`${f.dir}\\${f.name}`}>{f.name}</strong>
              <span>
                {relTime(f.mtime)} · {f.rows} 条
                {f.added != null ? ` · 新增 ${f.added} / 更新 ${f.updated}` : ""}
                {f.warnings.length ? ` · ${f.warnings[0]}` : ""}
              </span>
            </div>
            {/* 认出平台的直接给一个按钮；认不出的**不猜**，让人点一下选——
                猜错了整批数据会挂到别的平台名下，而那是安静的错 */}
            {f.platform ? (
              <button
                className={f.added === 0 ? "btn btn-sm" : "btn btn-primary btn-sm"}
                disabled={!!busy}
                onClick={() => take(f, f.platform)}
              >
                {busy === f.id ? "导入中…" : f.added === 0 ? `已导过 · 更新 ${f.updated} 条` : `导入 ${f.added} 条到${f.platform}`}
              </button>
            ) : (
              <Select
                value="选平台"
                options={PLATFORM_OPTIONS}
                onChange={(p) => take(f, p)}
                ariaLabel="这份文件是哪个平台的"
                renderIcon={(p) => <span className="dot" style={{ background: platformColor(p, false) }} />}
              />
            )}
          </div>
        ))}
      </div>
      {/* 「改 .env 的 DOWNLOADS_DIR」原来是句死胡同：读完之后下一步是去开编辑器，
          而那一步机器完全可以替你走。拿不到 onSettings 时退回原来那句话 */}
      <p className="panel-note">
        只看这两个地方，只认 .xlsx / .csv：{data.dirs.join("　|　")}。
        {onSettings ? (
          <button className="sysrow__btn" onClick={onSettings} style={{ marginLeft: 8 }}>
            <IconSettings size={14} stroke={1.7} aria-hidden="true" />
            换个下载目录
          </button>
        ) : (
          <> 改 .env 的 DOWNLOADS_DIR 可以换第一个。</>
        )}
      </p>
    </section>
  );
}

const PLATFORM_OPTIONS = ["小红书", "公众号", "抖音", "视频号", "X", "B站", "YouTube"];

function Importer({ onDone }) {
  const [file, setFile] = useState(null);
  const [platform, setPlatform] = useState("小红书");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [drag, setDrag] = useState(false);
  const input = useRef(null);

  const take = useCallback(async (f, p) => {
    setFile(f);
    setError(null);
    setPreview(null);
    setBusy(true);
    try {
      setPreview(await api.importPosts(f, p, { dry: true }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, []);

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      await api.importPosts(file, platform);
      setFile(null);
      setPreview(null);
      if (input.current) input.current.value = "";
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-block">
      <div className="panel-head">
        <div className="panel-head__main">
          <span className="eyebrow">从平台后台导出的表格</span>
          <h2>导一份数据进来</h2>
        </div>
        <Select
          value={platform}
          options={PLATFORM_OPTIONS}
          onChange={(p) => {
            setPlatform(p);
            if (file) take(file, p);
          }}
          ariaLabel="这份文件是哪个平台的"
          title="这份文件是哪个平台的"
          // 平台不是状态，别给它配状态图标。用平台的系列色圆点——和图上那条柱同一个颜色
          renderIcon={(p) => <span className="dot" style={{ background: platformColor(p, false) }} />}
        />
      </div>

      <div
        className="dropzone"
        data-drag={drag ? "" : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) take(f, platform);
        }}
      >
        <IconCloudUpload aria-hidden="true" stroke={1.5} />
        <p>
          把 <strong>.xlsx</strong> 或 <strong>.csv</strong> 拖到这儿
        </p>
        <button className="btn btn-sm" onClick={() => input.current?.click()} disabled={busy}>
          选个文件
        </button>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xlsm,.csv"
          hidden
          onChange={(e) => e.target.files?.[0] && take(e.target.files[0], platform)}
        />
      </div>

      <ErrorNote error={error} what="解析文件" />

      {busy && !preview ? <Loading rows={2} /> : null}

      {preview ? (
        <div className="preview">
          <div className="preview__head">
            <strong>{file?.name}</strong>
            <span>
              读到 {preview.total} 条 · 新增 {preview.added} · 更新 {preview.updated}
              {preview.skippedCount ? ` · 跳过 ${preview.skippedCount}` : ""}
            </span>
          </div>

          {/* 「我把哪一列当成了什么」——这块是这两步流程存在的全部理由 */}
          <div className="preview__map">
            {/* 用 .tag 不用 .chip：chip 在这套界面里是「我圈中了」（打标、多选），
                而这里只是在陈述解析结果，没有任何东西被选中 */}
            {/* 按 FIELD_CN 的顺序铺，不按 mapping 的键序——后者是匹配规则的先后
                （收藏要排在阅读前面才不会被抢走），那是实现细节，读起来是乱的 */}
            {Object.keys(FIELD_CN)
              .filter((f) => preview.mapping[f])
              .map((field) => (
                <span key={field} className="tag">
                  {FIELD_CN[field]} ← {preview.mapping[field]}
                </span>
              ))}
          </div>
          {preview.unmapped?.length ? (
            <p className="panel-note">
              没用上的列（原样收进 extra，不会丢）：{preview.unmapped.slice(0, 8).join("、")}
              {preview.unmapped.length > 8 ? " …" : ""}
            </p>
          ) : null}
          {preview.warnings?.map((w) => (
            <Note key={w} title={w} />
          ))}

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>发布时间</th>
                  <th>标题</th>
                  <th className="num">阅读/播放</th>
                  <th className="num">点赞</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((r, i) => (
                  <tr key={i}>
                    <td className="muted">{r.date}</td>
                    <td className="cell-title"><span title={r.title}>{r.title || r.url}</span></td>
                    <td className="num">{fmtNum(r.views)}</td>
                    <td className="num">{fmtNum(r.likes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row-actions" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={commit} disabled={busy}>
              {busy ? "写入中…" : `确认导入 ${preview.total} 条`}
            </button>
            <button className="btn btn-sm" onClick={() => { setPreview(null); setFile(null); }} disabled={busy}>
              取消
            </button>
            <span className="page-sub" style={{ margin: 0 }}>对不上的话，换个平台再试一次——列名认错了这里就看得出来。</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const FIELD_CN = {
  date: "发布时间",
  title: "标题",
  url: "链接",
  views: "阅读/播放",
  likes: "点赞",
  comments: "评论",
  collects: "收藏",
  shares: "分享",
};

/* ---------- 手录一条 ------------------------------------------------------ */

function ManualPost({ platforms, onSaved }) {
  const [form, setForm] = useState({ date: todayStr(), platform: platforms[0], title: "", url: "", views: "", likes: "", comments: "", collects: "", shares: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.savePost(form));
      setForm((f) => ({ ...f, title: "", url: "", views: "", likes: "", comments: "", collects: "", shares: "" }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-block">
      <div className="panel-head">
        <div className="panel-head__main">
          <span className="eyebrow">导不出来的时候</span>
          <h2>手录一条</h2>
          <p className="page-sub">X 和视频号的导出能力很差，兜底得有。留空的格子就是「这个平台没有这个指标」，不会记成 0。</p>
        </div>
      </div>
      <form className="card entry" onSubmit={submit}>
        <div className="entry-row">
          <label className="field">
            <span>发布时间</span>
            <input type="date" value={form.date} onChange={set("date")} />
          </label>
          <label className="field">
            <span>平台</span>
            <select value={form.platform} onChange={set("platform")}>
              {platforms.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="field field-grow">
            <span>标题</span>
            <input value={form.title} onChange={set("title")} placeholder="发布时用的标题" />
          </label>
          <label className="field field-grow">
            <span>链接</span>
            <input value={form.url} onChange={set("url")} placeholder="选填，有链接就不会重复记" />
          </label>
        </div>
        <div className="entry-row">
          {["views", "likes", "comments", "collects", "shares"].map((k) => (
            <label key={k} className="field">
              <span>{metricLabel(form.platform, k)}</span>
              <input type="number" inputMode="numeric" value={form[k]} onChange={set(k)} placeholder="选填" />
            </label>
          ))}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "保存中…" : "记一条"}
          </button>
        </div>
        <ErrorNote error={error} what="保存" />
      </form>
    </section>
  );
}

/* ---------- 账号级周录（粉丝数）------------------------------------------- */

function FollowerEntry({ platforms, rows, onSaved }) {
  const [form, setForm] = useState({ date: todayStr(), platform: platforms[0], followers: "", views: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.saveMetric({
        date: form.date,
        platform: form.platform,
        followers: form.followers === "" ? null : Number(form.followers),
        views: form.views === "" ? null : Number(form.views),
        note: form.note,
      }));
      setForm((f) => ({ ...f, followers: "", views: "", note: "" }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="card entry" onSubmit={submit}>
        <div className="entry-row">
          <label className="field">
            <span>日期</span>
            <input type="date" value={form.date} onChange={set("date")} />
          </label>
          <label className="field">
            <span>平台</span>
            <select value={form.platform} onChange={set("platform")}>
              {platforms.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>粉丝数</span>
            <input type="number" inputMode="numeric" value={form.followers} onChange={set("followers")} placeholder="选填" />
          </label>
          <label className="field">
            <span>阅读 / 播放</span>
            <input type="number" inputMode="numeric" value={form.views} onChange={set("views")} placeholder="选填" />
          </label>
          <label className="field field-grow">
            <span>备注</span>
            <input value={form.note} onChange={set("note")} placeholder="选填，比如「发了长文」" />
          </label>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "保存中…" : "记一条"}
          </button>
        </div>
        <ErrorNote error={error} what="保存" />
      </form>

      {rows.length === 0 ? (
        <Note title="还没有粉丝数记录">上面录第一条。同一个平台录满两次才会出趋势线。</Note>
      ) : (
        <>
          <div className="charts">
            {/* 两张图而不是双轴：粉丝和阅读量量级差太多，同一张图上没法比较。
                **第二张只在真有数据时才画**——内容级的阅读量现在有更准的来源（上面那份
                一条内容一行），账号级这一栏多半是空的，摆一张写着「还没有数据」的空图
                白占半栏，和渠道分布里「空指标整格不出现」是同一条规矩。 */}
            <TrendChart title="粉丝数" rows={rows} metric="followers" />
            {rows.some((r) => r.views != null) ? <TrendChart title="阅读 / 播放量" rows={rows} metric="views" /> : null}
          </div>
          <div className="row-actions" style={{ marginTop: 14 }}>
            <button className="btn btn-sm" onClick={() => setShowTable((v) => !v)}>
              <IconDatabase aria-hidden="true" stroke={1.7} />
              {showTable ? "收起表格" : "看表格"}
            </button>
            <span className="page-sub" style={{ margin: 0 }}>共 {rows.length} 条记录</span>
          </div>
          {showTable && <FollowerTable rows={rows} />}
        </>
      )}
    </>
  );
}

// 表格视图：浅色下有几个系列色对比度低于 3:1，校验器要求必须配可见标签或表格。
// 顺带它本来就有用——趋势看走向，表格看确切数字。
function FollowerTable({ rows }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>平台</th>
            <th className="num">粉丝数</th>
            <th className="num">阅读 / 播放</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r, i) => (
            <tr key={`${r.date}-${r.platform}-${i}`}>
              <td>{r.date}</td>
              <td>
                <span className="dot" style={{ background: platformColor(r.platform, false) }} />
                {r.platform}
              </td>
              <td className="num">{r.followers ?? "—"}</td>
              <td className="num">{r.views ?? "—"}</td>
              <td className="muted">{r.note || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
