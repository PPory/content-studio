import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Empty, Loading, Note, FilterHeader, ViewTabs, Toast, relTime } from "../components/ui.jsx";
import "./hotspot-bridge.css";
import { ArticleOverlay } from "../components/ArticleOverlay.jsx";
import { ReactionPicker } from "../components/ReactionPicker.jsx";
import {
  IconArrowUpRight,
  IconBook,
  IconChartLine,
  IconBookmark,
  IconBookmarkFilled,



  IconClock,
  IconExternalLink,




  IconRefresh,
  IconSeedling,
  IconShieldCheck,
  IconSparkles,
} from "../components/icons.jsx";

const TABS = [
  { key: "ai", label: "AI 热点", icon: IconSparkles },
  { key: "models", label: "模型榜", icon: IconChartLine },
];

export function Hotspots({ onIntake, onGo }) {
  const [tab, setTab] = useState("ai");
  /**
   * 种子：这条链的新起点（`docs/工作流.md`）。
   * ⚠️ **反应清单从 Worker 来**（`api.seeds()` 的响应里带 `reactionGroups`），前端不写死。
   * ⚠️ **`seeded` 是已经反应过的那些 url**——不标出来的话你每天扫这一批会重复反应同一条。
   */
  const [seedInfo, setSeedInfo] = useState({ groups: [], seeded: new Set() });
  const [seeding, setSeeding] = useState(null);   // 正在对哪一条说话
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedError, setSeedError] = useState("");

  const loadSeeds = useCallback(async () => {
    try {
      const data = await api.seeds();
      setSeedInfo({
        groups: data.reactionGroups || [],
        seeded: new Set((data.seeds || []).map((s) => s.source?.url).filter(Boolean)),
      });
    } catch {
      // 种子读不到不该让整页热点跟着挂——这一页的主业是看热点
      setSeedInfo({ groups: [], seeded: new Set() });
    }
  }, []);
  useEffect(() => { loadSeeds(); }, [loadSeeds]);

  const seeded = seedInfo.seeded;
  // 收录状态提到这里：切 tab 不该把「已收录」的勾丢掉
  const [stored, setStored] = useState({});
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /**
   * 一条热点后来怎么样了（未处理 → 已收藏 → 已形成选题 → 已成稿 → 已发布）。
   *
   * **状态从真实关联关系算，工作台自己不存一份映射**——手工状态一定会失真：
   * 你在别处把稿子改成已发布，工作台那份记录不会跟着动，而这种错不报警。
   *
   * 放在顶层而不是各面板各拉一次：两个面板的条目合起来一次问完，
   * 服务端那边四个库的列表也是复用全局检索的缓存，零额外网络调用。
   */
  const [trace, setTrace] = useState({ items: {}, degraded: false, why: "" });
  const askTrace = useCallback((links) => {
    const list = [...new Set((links || []).filter(Boolean))];
    if (!list.length) return;
    api.traceHot(list).then(setTrace).catch(() => {});
  }, []);

  // `link` 只给本地用（存完重算这一条的转化链），**不进入库请求体**——
  // 往服务端塞一个它不认识的字段，是那种今天没事、以后加校验时才炸的写法
  const collect = useCallback(async (key, { link, ...payload }) => {
    setStored((s) => ({ ...s, [key]: "sending" }));
    try {
      await api.intake(payload);
      setStored((s) => ({ ...s, [key]: "done" }));
      // 刚收进去的那条现在是「已收藏」了。**重算而不是本地改一个字段**——
      // 算出来的状态才不会和真相分家，这一条整个设计就建立在这上面
      if (link) askTrace([link]);
    } catch (e) {
      setStored((s) => ({ ...s, [key]: e.message }));
    }
  }, [askTrace]);

  return (
    <>
      <FilterHeader
        title="AI 热点"
        desc="刷新、看原文、收进灵感库。这一页不做分析，也不会替你写。"
        chips={
          <ViewTabs items={TABS} value={tab} onChange={setTab} label="看哪个视角" />
        }
      />

      {tab === "models" ? <ModelsPanel /> : <AiPanel stored={stored} onCollect={collect} onIntake={onIntake} onToast={setToast} trace={trace} onTrace={askTrace} seeds={seeded} onSeed={setSeeding} />}

      <ReactionPicker
        open={!!seeding}
        groups={seedInfo.groups}
        source={seeding ? { title: seeding.title, url: seeding.link } : null}
        busy={seedBusy}
        error={seedError}
        onClose={() => { setSeeding(null); setSeedError(""); }}
        onSave={async ({ reaction, take }) => {
          setSeedBusy(true);
          setSeedError("");
          try {
            // ⚠️ **标题和链接一起存**：热点不在库里（快照会过期），
            // 只存 id 的话几天后这颗种子说不清自己从哪来
            await api.createSeed({
              take, reaction,
              sourceKind: "hot",
              sourceTitle: seeding.title,
              sourceUrl: seeding.link || "",
            });
            setSeeding(null);
            await loadSeeds();
            setToast("已记下这条反应。需要时可从搜索打开旧版种子继续处理。");
          } catch (e) {
            setSeedError(e.message || "记不下来");
          } finally {
            setSeedBusy(false);
          }
        }}
      />

      <Toast text={toast} onClose={() => setToast(null)} />
    </>
  );
}

/**
 * 「这不是现在的数据」那条提示。
 *
 * ⚠️ **标题和正文必须各说各的一半**：标题说「这是什么」（一份多久以前的快照），
 * 正文说「为什么 + 下一步」。上一版标题写死「显示的是上一次成功的快照」，而服务端
 * 给的 `staleHint` 结尾又是同一句话，屏幕上那句话原样印了两遍。
 *
 * 快照的时间也必须写出来：一份 23 小时前的快照和一份 3 分钟前的快照，值不值得当真
 * 完全是两回事，而它们在没有时间戳的界面上长得一模一样。
 */
function StaleNote({ data }) {
  if (!data?.stale) return null;
  const age = relTime(data.fetchedAt);
  return (
    <Note title={age ? `下面是 ${age}的快照，不是现在的数据` : "下面是上一次成功的快照，不是现在的数据"}>
      {data.staleHint}
      {data.checkedAt ? `（${relTime(data.checkedAt)}试过一次）` : ""}
    </Note>
  );
}

// 卡片头：眉标 + 标题 + 条数 + 说明，右边是「检查于」和刷新。
// 两个 tab 长一样，所以刷新按钮永远在同一个位置。
//
// ⚠️ **`stale` 时那一行不能再写「检查于」**：检查是刚刚做的、而且失败了，
// 那个时间戳说的是快照有多老。同一个数字配错动词，读出来正好是反的意思。
function PanelHead({ eyebrow, title, count, desc, fetchedAt, stale, busy, onRefresh, extra }) {
  return (
    <div className="panel-head">
      <div className="panel-head__main">
        <span className="eyebrow">{eyebrow}</span>
        <h2>
          {title}
          {count != null ? (
            <span className="panel-head__count">
              <span className="micro__v">{count}</span> 条
            </span>
          ) : null}
        </h2>
        <p>{desc}</p>
      </div>
      <div className="panel-head__aside">
        {extra}
        <span className="panel-head__time" title={stale ? "刚才检查过，没读到新的" : undefined}>
          <IconClock aria-hidden="true" stroke={1.7} />
          {fetchedAt ? (
            <>
              {stale ? "快照来自" : "检查于"} <span className="micro__v">{relTime(fetchedAt)}</span>
            </>
          ) : (
            "尚未抓取"
          )}
        </span>
        <button className="btn btn-sm" onClick={onRefresh} disabled={busy}>
          <IconRefresh aria-hidden="true" stroke={1.7} className={busy ? "spinning" : ""} />
          {busy ? "刷新中" : "刷新"}
        </button>
      </div>
    </div>
  );
}

// 收录按钮：图标态，收进去后变实心 + 打勾。它是这一页唯一的写动作，
// 所以要有明确反馈——点完没反应的话用户会一直点。
/**
 * 这条热点走到哪一步了。
 *
 * **只在「已经动过」的时候才画。** 一屏几十条里绝大多数是「未处理」——那是默认，
 * 给每条都挂一个「未处理」的灰标签，等于在整页铺一层没有信息量的噪音，
 * 真正走出去了的那几条反而淹在里面。
 *
 * 用**芯片 + 文字**而不是颜色：这套界面里颜色已经有主人了（黑块=你在这儿，
 * 标记黄=我圈中的），再开一档状态色会把那两条界线搅浑；而且状态本来就该
 * 「不只依赖颜色」。
 */
function StageChip({ info }) {
  if (!info || info.stage === "未处理") return null;
  const tail =
    info.stage === "已发布"
      ? info.drafts.filter((d) => d.status === "已发布").map((d) => d.platform).filter(Boolean).join("/")
      : info.topic?.title || "";
  return (
    <span className="tag tag--state" title={tail ? `${info.stage} · ${tail}` : info.stage}>
      {info.stage}
      {tail ? ` · ${tail.slice(0, 12)}` : ""}
    </span>
  );
}

function CollectButton({ state, onClick, label = "收进灵感库" }) {
  const done = state === "done";
  return (
    <button
      className={`collect${done ? " collect--done" : ""}`}
      onClick={onClick}
      disabled={state === "sending" || done}
      title={done ? "已收进灵感库" : label}
      aria-label={done ? "已收进灵感库" : label}
    >
      {done ? <IconBookmarkFilled aria-hidden="true" /> : <IconBookmark aria-hidden="true" stroke={1.7} />}
    </button>
  );
}

// ---- AI 情报 ---------------------------------------------------------------

function AiPanel({ stored, onCollect, onIntake, onToast, trace, onTrace, seeds, onSeed }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const all = true;
  const [search, setSearch] = useState("");
  const [reading, setReading] = useState(null); // 正在工作台里读的那一条

  const load = useCallback(
    (refresh, showAll) => {
      setBusy(true);
      setError(null);
      api.hotAi({ refresh, all: showAll }).then(setData).catch(setError).finally(() => setBusy(false));
    },
    []
  );
  useEffect(() => load(false, all), [load, all]);

  // 列表回来之后问一次转化链。**在这儿问而不是在 load 里**：`all` 一切换就是另一批条目
  useEffect(() => {
    if (!data?.groups) return;
    onTrace(data.groups.flatMap((g) => g.items.map((it) => it.link)));
  }, [data, onTrace]);

  const groups=(data?.groups || []).map(group=>({...group,items:group.items.filter(item=>`${item.title} ${item.summary || ""}`.toLowerCase().includes(search.trim().toLowerCase()))})).filter(group=>group.items.length);

  return (
    <section className="panel-block">
      <PanelHead
        title="AI HOT 精选"
        count={data ? groups.reduce((sum,group)=>sum+group.items.length,0) : undefined}
        desc="按 AI Hot 收录日期分组，新的在上；收录时间不代表原文发布时间。"
        fetchedAt={data?.fetchedAt}
        stale={data?.stale}
        busy={busy}
        onRefresh={() => load(true, all)}
        extra={<input type="search" aria-label="搜索 AI 热点" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索标题与摘要" className="ai-hot-search"/>}
      />

      <ErrorNote error={error} what="加载 AI 情报" />
      {/* 转化链算不全时**照实说、并给下一步**，不是悄悄少几个芯片：
          少几个芯片看起来就是「这些热点都没被用过」，那是句假话 */}
      {trace.degraded ? <Note title="转化链只能算到「已收藏」">{trace.why}</Note> : null}
      <StaleNote data={data} />

      {!data && !error ? (
        <Loading rows={5} />
      ) : data && !groups.length ? (
        <Empty icon={IconShieldCheck}>
          <p>{search ? "没有匹配的 AI 热点" : "AI HOT 这次没有返回内容"}</p>
          <div className="page-sub" style={{ margin: "8px auto 0" }}>{search ? "试试其他关键词，或清空搜索查看全部。" : data.error || "稍后可以再刷新。"}</div>
        </Empty>
      ) : data ? (
        groups.map((g) => (
          <div className="day-group" key={g.day}>
            <div className="day-group__head">
              <span>{formatDay(g.day)}</span>
              <em>
                <span className="micro__v">{g.items.length}</span> 条
              </em>
            </div>
            {g.items.map((it) => {
              const key = `a:${it.title}`;
              return (
                <article className="ai-item" key={it.title}>
                  <time className="ai-item__time" title="AI Hot 收录时间，不代表原文发布时间">{formatTime(it.at)}</time>
                  <div className="ai-item__body">
                    <div className="ai-item__meta">
                      {it.category ? <span className="tag">{it.category}</span> : null}
                      <span>{it.sources.slice(0, 2).join(" · ")}</span>
                      {it.sourceCount > 1 ? <span className="strong">{it.sourceCount} 个独立信源</span> : null}
                      <StageChip info={trace.items[it.link]} />
                    </div>
                    <h3>{it.title}</h3>
                    {it.summary ? <p className="ai-item__summary">{it.summary}</p> : null}
                    {it.latest ? (
                      <p className="ai-item__latest">
                        <b>最新进展</b>
                        {it.latest}
                      </p>
                    ) : null}
                    <div className="ai-item__acts">
                      {/* **在这儿读完，不用跳出去。** 这一页的动线是「扫一眼 → 觉得有用 → 入库」，
                          中间那步跳去浏览器新标签，回来时滚到哪儿全丢了。
                          抓不到的站点会明确报错并把原网页的入口给回来，所以外链一直留着。 */}
                      {it.link ? (
                        <button className="btn btn-sm btn-primary" onClick={() => setReading(it)}>
                          <IconBook aria-hidden="true" stroke={1.8} />
                          在这里读
                        </button>
                      ) : null}
                      {it.link ? (
                        <a className="btn btn-sm" href={it.link} target="_blank" rel="noreferrer">
                          <IconArrowUpRight aria-hidden="true" stroke={1.8} />
                          原网页
                        </a>
                      ) : null}
                      {it.aihot ? (
                        <a className="btn btn-sm" href={it.aihot} target="_blank" rel="noreferrer">
                          <IconExternalLink aria-hidden="true" stroke={1.7} />
                          AI HOT 详情
                        </a>
                      ) : null}
                      {/**
                        * ⚠️ **「聊一聊」和「收录」不是一回事，别合并。**
                        * 收录 = 这东西以后可能有用（进灵感库，等 AI 拆素材）；
                        * 有反应 = **我此刻有话说**，那句话本身就是一篇的起点。
                        * 前者是资料，后者是种子——判据是「你有没有话说」，
                        * 而这两条出口在 `docs/工作流.md` 里是并列的。
                        *
                        * ⚠️ **反应过的要看得出来**：不然你每天扫这一批时会重复反应同一条。
                        * 判据按 `link` 比对（热点不在库里，url 是它唯一稳定的身份）。
                        */}
                      {seeds.has(it.link) ? (
                        <span className="ai-item__seeded" title="你已经对它说过一句了">
                          <IconSeedling aria-hidden="true" size={14} stroke={1.8} />说过了
                        </span>
                      ) : (
                        <button className="btn btn-sm" onClick={() => onSeed(it)}>
                          <IconSeedling aria-hidden="true" size={14} stroke={1.8} />
                          聊一聊
                        </button>
                      )}
                      {stored[key] && !["sending", "done"].includes(stored[key]) ? (
                        <span className="board__err">收录失败：{stored[key]}</span>
                      ) : null}
                    </div>
                  </div>
                  <CollectButton
                    state={stored[key]}
                    onClick={() =>
                      onCollect(key, {
                        target: "inbox",
                        content: [it.title, it.link, it.summary].filter(Boolean).join("\n"),
                        source: `工作台·AI HOT·${it.sources.join("/")}`,
                      })
                    }
                  />
                </article>
              );
            })}
          </div>
        ))
      ) : null}

      <div className="hot-footnote">
        <span>来源：AI HOT</span>
        <span>摘要可能由 AI 生成；数字、政策与原话请点进原文核对。</span>
      </div>

      {reading ? (
        <ArticleOverlay
          item={reading}
          onClose={() => setReading(null)}
          onIntake={(p) => onIntake?.(p)}
          onToast={onToast}
        />
      ) : null}
    </section>
  );
}

// ---- 模型榜 ----------------------------------------------------------------

/**
 * AIHOT 大模型共识分。
 *
 * **它和另外两个 tab 不是一类东西**：热榜和情报是「今天发生了什么」，看完就过；
 * 模型榜是「现在的牌面是什么」，几周才动一次。所以这一栏没有收藏、没有入库——
 * 它不是素材，是背景知识。给的动作只有一个：点进去看那个模型的详情。
 *
 * ⚠️ 数据是**解析 AI HOT 的页面**来的（他们的公开 API 里没有这个端点），
 * 所以会随对方改版失效。失效时整块不显示、如实说一句、留一个去官网的出口。
 */
function ModelsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback((refresh) => {
    setBusy(true);
    setError(null);
    api.hotModels(refresh).then(setData).catch(setError).finally(() => setBusy(false));
  }, []);
  useEffect(() => load(false), [load]);

  return (
    <section className="panel-block">
      <PanelHead
        title="大模型共识分"
        count={data?.count}
        desc="汇总多家公开评测榜单算出的综合分。几周才动一次，看的是牌面而不是新闻。"
        fetchedAt={data?.fetchedAt}
        stale={data?.stale}
        busy={busy}
        onRefresh={() => load(true)}
      />

      <ErrorNote error={error} what="加载模型榜" />
      <StaleNote data={data} />

      {!data && !error ? (
        <Loading rows={5} />
      ) : data?.items?.length ? (
        <>
          <div className="lb">
            <div className="lb__head">
              <span>排名</span>
              <span>模型</span>
              <span>上线</span>
              <span>评测完整度</span>
              <span>输入 / 输出</span>
              <span>共识分</span>
            </div>
            {data.items.map((m) => (
              <a className="lb__row" key={`${m.rank}-${m.name}`} href={m.link} target="_blank" rel="noreferrer">
                <span className="lb__rank">{String(m.rank).padStart(2, "0")}</span>
                <span className="lb__model">
                  {/* 图标是**服务端内联好的 data URI**（见 aihot.mjs），不引对方的图片地址。
                      没抓到时那一格仍然占位——图标缺几个是小事，一列模型名参差不齐是大事 */}
                  <span
                    className="lb__logo"
                    data-invert={m.logoInvert ? "1" : undefined}
                    data-tile={m.logoTile ? "1" : undefined}
                  >
                    {m.logo ? <img src={m.logo} alt="" loading="lazy" /> : null}
                  </span>
                  <span className="lb__model-copy">
                    <strong>{m.name}</strong>
                    <small>{m.vendor}</small>
                  </span>
                </span>
                <span className="lb__date">{m.released}</span>
                {/* 完整度是**这个分靠不靠谱**的注脚：只跑了七成评测的分和跑满的分不能平着看 */}
                <span className="lb__pct">{m.completeness}</span>
                {/* 有些模型上游没给价（自建/未公开），空着比显示一个孤零零的斜杠强 */}
                <span className="lb__price">
                  {m.inPrice || m.outPrice ? (
                    <>
                      {m.inPrice || "—"} <em>/</em> {m.outPrice || "—"}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="lb__score">{m.score}</span>
              </a>
            ))}
          </div>
          <div className="hot-footnote">
            <span>数据来自 AIHOT 大模型排行榜（解析其页面，非公开 API，可能随对方改版失效）</span>
            <a href="https://aihot.virxact.com/leaderboard" target="_blank" rel="noreferrer">
              去官网看完整榜单
              <IconArrowUpRight size={13} stroke={1.8} aria-hidden="true" />
            </a>
          </div>
        </>
      ) : (
        <Empty icon={IconChartLine}>
          模型榜这次没读到
          <div className="page-sub" style={{ margin: "8px auto 0" }}>
            它是从 AI HOT 的页面解析出来的，对方改版就会失效。
            <a href="https://aihot.virxact.com/leaderboard" target="_blank" rel="noreferrer"> 直接去官网看 </a>
            也一样。
          </div>
        </Empty>
      )}
    </section>
  );
}

function formatDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const d = new Date(`${day}T00:00:00`);
  const today = new Date().toLocaleDateString("sv-SE");
  const week = "日一二三四五六"[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日周${week}${day === today ? " · 今天" : ""}`;
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
