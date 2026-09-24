// 速览（2026-09-24）：AIhot 精选 / Follow Builders 按天原样列出，避免没进热点的内容被漏掉。
//
// 呈现沿用最早 AIhot 热点页（fc04934 `Hotspots.jsx` 的 AiPanel）的卡片流：按天分组，左边一列时间，
// 右边信源 → 标题 → 摘要 → 操作，一条一条往下读。样式直接用还留在 styles.css 里的 `.day-group` / `.ai-item`。
// Follow Builders 用同一套骨架：中文摘要当标题，英文原文放成引文，默认显示四行、点开看全文。
//
// 已进热点的条目标「在热点里」，点「打开热点卡」切回热点并打开那张卡；没进的可以加入选题。
// 数据是每次「更新情报」时已经取回的，这里只读、不触发任何采集或模型调用。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { SourceResearchPicker } from "./SourceResearchPicker.jsx";
import { IconArrowUpRight, IconExternalLink, IconPlus } from "./icons.jsx";
import { Empty, ErrorNote, Loading } from "./ui.jsx";

const KINDS = [["selected", "AIhot 精选"], ["builders", "Follow Builders"]];
const storedKind = () => { try { return sessionStorage.getItem("intel-digest-kind") === "builders" ? "builders" : "selected"; } catch { return "selected"; } };
const beijingDay = (ms) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date(ms));
/** 「9月24日周四 · 今天」：和最早热点页的日期头一样，另外补上「昨天」。 */
const formatDay = (day) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const d = new Date(`${day}T00:00:00Z`);
  const tail = day === beijingDay(Date.now()) ? " · 今天" : day === beijingDay(Date.now() - 86400000) ? " · 昨天" : "";
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日周${"日一二三四五六"[d.getUTCDay()]}${tail}`;
};
const formatTime = (iso) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? "" : t.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }); };
/** 中文摘要当标题用，句末的句号去掉。 */
const headline = (zh) => zh.replace(/[。.]$/, "");

/** 推文原文：默认四行，真的被截断了才给「展开原文」（按实际排版量，不按字数猜）。 */
function Quote({ text }) {
  const ref = useRef(null), [open, setOpen] = useState(false), [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current; if (!el || open) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 2);
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [text, open]);
  return (
    <>
      <blockquote ref={ref} className={`intel-digest__quote ${open ? "is-open" : ""}`} lang="en">{text}</blockquote>
      {(clipped || open) && <button type="button" className="intel-digest__more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "收起原文" : "展开原文"}</button>}
    </>
  );
}

export function IntelligenceDigest({ query = "", onOpenCard, onGo, onUpdate, updating = false }) {
  const [kind, setKind] = useState(storedKind);
  const [data, setData] = useState(null), [error, setError] = useState(null), [nonce, setNonce] = useState(0);
  const [onlyMissed, setOnlyMissed] = useState(false), [picking, setPicking] = useState(null);
  useEffect(() => { try { sessionStorage.setItem("intel-digest-kind", kind); } catch {} }, [kind]);
  useEffect(() => {
    let stopped = false; setData(null); setError(null);
    api.intelligenceDigest(kind).then((r) => { if (!stopped) setData(r); }).catch((e) => { if (!stopped) setError(e); });
    return () => { stopped = true; };
  }, [kind, nonce]);
  const q = query.trim().toLowerCase();
  const keep = (item) => (!onlyMissed || !item.hot) && (!q || [item.title, item.summary, item.source, item.zh, item.text, item.author, item.name].filter(Boolean).join(" ").toLowerCase().includes(q));
  const days = (data?.days || []).map((d) => ({ ...d, items: d.items.filter(keep) })).filter((d) => d.items.length);

  const acts = (item, links) => (
    <div className="ai-item__acts">
      {item.hot
        ? <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenCard(item.hot.briefId)} title={item.hot.title}>打开热点卡</button>
        : <button type="button" className="btn btn-sm btn-primary" onClick={() => setPicking(item)}><IconPlus aria-hidden="true" stroke={1.8} />加入选题</button>}
      {links.filter(([, href]) => href).map(([label, href, Icon]) => (
        <a key={label} className="btn btn-sm" href={href} target="_blank" rel="noreferrer"><Icon aria-hidden="true" stroke={1.8} />{label}</a>
      ))}
    </div>
  );
  const inHot = (item) => item.hot ? <span className="intel-digest__in-hot">在热点里</span> : null;

  const selectedItem = (item) => (
    <article key={item.id} className="ai-item" data-digest={item.id}>
      <time className="ai-item__time" dateTime={item.publishedAt}>{formatTime(item.publishedAt)}</time>
      <div className="ai-item__body">
        <div className="ai-item__meta">{item.source && <span>{item.source}</span>}{inHot(item)}</div>
        <h3>{item.title}</h3>
        {item.summary && item.summary !== item.title && <p className="ai-item__summary">{item.summary}</p>}
        {acts(item, [["原网页", item.url, IconArrowUpRight], ["AI HOT 详情", item.aihotUrl, IconExternalLink]])}
      </div>
    </article>
  );
  const builderItem = (item) => {
    const podcast = item.kind === "podcast";
    const handle = item.author ? `@${item.author.replace(/^@/, "")}` : "";
    const engagement = [["赞", item.likes], ["回复", item.replies], ["转发", item.retweets]].filter(([, n]) => n != null && n > 0).map(([k, n]) => `${k} ${n}`).join(" · ");
    return (
      <article key={item.id} className="ai-item" data-digest={item.id}>
        <time className="ai-item__time" dateTime={item.publishedAt}>{formatTime(item.publishedAt)}</time>
        <div className="ai-item__body">
          <div className="ai-item__meta">
            {podcast && <span className="tag">播客</span>}
            {podcast ? <span className="strong">{item.author || "未知节目"}</span>
              : <>{item.name && <span className="strong">{item.name}</span>}{handle && <span className={item.name ? "" : "strong"}>{handle}</span>}</>}
            {engagement && <span>{engagement}</span>}
            {inHot(item)}
          </div>
          {item.zh ? <h3>{headline(item.zh)}</h3> : podcast ? <h3>{item.title}</h3> : <p className="intel-digest__pending">中文摘要还没生成，下次更新时补上</p>}
          {podcast ? (item.zh && <p className="ai-item__summary" lang="en">{item.title}</p>) : item.text && <Quote text={item.text} />}
          {acts(item, [[podcast ? "打开播客" : "原推文", item.url, IconArrowUpRight]])}
        </div>
      </article>
    );
  };

  const label = KINDS.find(([k]) => k === kind)[1];
  return (
    <div className="intel-digest">
      <div className="intel-digest__bar">
        <div className="intel-digest__kinds" role="group" aria-label="速览信源">
          {KINDS.map(([k, name]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{name}</button>)}
        </div>
        <label className="intel-digest__missed"><input type="checkbox" checked={onlyMissed} onChange={(e) => setOnlyMissed(e.target.checked)} />只看没进热点的</label>
        {data && <span className="intel-digest__count">近 7 天 {data.total} 条{data.inHot ? `，${data.inHot} 条已在热点里` : ""}{data.hiddenOffTopic ? `；另有 ${data.hiddenOffTopic} 条与 AI 无关，未列出` : ""}</span>}
      </div>
      {error ? <ErrorNote error={error} what={`读取${label}`} onRetry={() => setNonce((n) => n + 1)} />
        : !data ? <Loading rows={5} />
        : !days.length ? (
          <Empty>
            <h2>{q || onlyMissed ? "没有符合条件的内容" : `这 7 天 ${label}没有新内容`}</h2>
            <p>{q || onlyMissed ? "换个关键词，或关掉「只看没进热点的」。" : "内容会在每次「更新情报」时取回。"}</p>
            {!q && !onlyMissed && onUpdate && <button className="btn" disabled={updating} onClick={onUpdate}>{updating ? "正在更新…" : "更新情报"}</button>}
          </Empty>
        ) : (
          <div className="intel-digest__flow">
            {days.map((d) => (
              <section key={d.day} className="day-group">
                <div className="day-group__head"><span>{formatDay(d.day)}</span><em><span className="micro__v">{d.items.length}</span> 条</em></div>
                {d.items.map(kind === "selected" ? selectedItem : builderItem)}
              </section>
            ))}
          </div>
        )}
      {picking && <SourceResearchPicker source={picking} onClose={() => setPicking(null)} onGo={onGo} />}
    </div>
  );
}
