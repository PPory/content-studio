// 速览（2026-09-24）：AIhot 精选 / Follow Builders 按天原样列出，避免没进热点的内容被漏掉。
//
// 已进热点的条目标「在热点里」，点一下切回热点并打开那张卡；没进的可以看原文、加入选题。
// 数据是每次「更新情报」时已经取回的，这里只读、不触发任何采集或模型调用。
import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { SourceResearchPicker } from "./SourceResearchPicker.jsx";
import { Empty, ErrorNote, Loading } from "./ui.jsx";

const KINDS = [["selected", "AIhot 精选"], ["builders", "Follow Builders"]];
const storedKind = () => { try { return sessionStorage.getItem("intel-digest-kind") === "builders" ? "builders" : "selected"; } catch { return "selected"; } };
const dayLabel = (day) => {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
  const yesterday = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date(Date.now() - 86400000));
  if (day === today) return "今天";
  if (day === yesterday) return "昨天";
  const [, m, d] = day.split("-");
  return `${Number(m)}/${Number(d)}`;
};
const timeOf = (iso) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? "" : t.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); };

export function IntelligenceDigest({ query = "", onOpenCard, onGo, onUpdate, updating = false }) {
  const [kind, setKind] = useState(storedKind);
  const [data, setData] = useState(null), [error, setError] = useState(null), [nonce, setNonce] = useState(0);
  const [onlyMissed, setOnlyMissed] = useState(false), [picking, setPicking] = useState(null), [open, setOpen] = useState(() => new Set());
  useEffect(() => { try { sessionStorage.setItem("intel-digest-kind", kind); } catch {} }, [kind]);
  useEffect(() => {
    let stopped = false; setData(null); setError(null);
    api.intelligenceDigest(kind).then((r) => { if (!stopped) setData(r); }).catch((e) => { if (!stopped) setError(e); });
    return () => { stopped = true; };
  }, [kind, nonce]);
  const q = query.trim().toLowerCase();
  const keep = (item) => (!onlyMissed || !item.hot) && (!q || [item.title, item.summary, item.zh, item.text, item.author].filter(Boolean).join(" ").toLowerCase().includes(q));
  const days = (data?.days || []).map((d) => ({ ...d, items: d.items.filter(keep) })).filter((d) => d.items.length);
  const toggle = (id) => setOpen((s) => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const actions = (item) => item.hot
    ? <button type="button" className="intel-digest__hot" onClick={() => onOpenCard(item.hot.briefId)} title={item.hot.title}>在热点里 →</button>
    : <>
        {item.url && <a className="intel-digest__act" href={item.url} target="_blank" rel="noreferrer">原文 ↗</a>}
        <button type="button" className="intel-digest__act" onClick={() => setPicking(item)}>加入选题</button>
      </>;
  const selectedRow = (item) => (
    <li key={item.id} className="intel-digest__item">
      <div className="intel-digest__text">
        <p className="intel-digest__title">{item.title}</p>
        {item.summary && item.summary !== item.title && <p className="intel-digest__summary">{item.summary}</p>}
      </div>
      <div className="intel-digest__side"><span className="intel-digest__time">{timeOf(item.publishedAt)}</span><span className="intel-digest__acts">{actions(item)}</span></div>
    </li>
  );
  const builderRow = (item) => (
    <li key={item.id} className="intel-digest__item">
      <div className="intel-digest__text">
        <p className="intel-digest__title">{item.zh || <span className="intel-digest__pending">中文摘要还没生成，下次更新时补上</span>}</p>
        {/* 英文原文默认折成两行，点一下看全文。 */}
        <button type="button" className={`intel-digest__orig ${open.has(item.id) ? "is-open" : ""}`} aria-expanded={open.has(item.id)} onClick={() => toggle(item.id)}>{item.text || item.title}</button>
      </div>
      <div className="intel-digest__side"><span className="intel-digest__time">{item.kind === "podcast" ? "播客 · " : ""}{timeOf(item.publishedAt)}</span><span className="intel-digest__acts">{actions(item)}</span></div>
    </li>
  );
  const byAuthor = (items) => { const groups = []; for (const it of items) { let g = groups.find((x) => x.author === it.author); if (!g) groups.push(g = { author: it.author, items: [] }); g.items.push(it); } return groups; };
  const label = KINDS.find(([k]) => k === kind)[1];
  return (
    <div className="intel-digest">
      <div className="intel-digest__bar">
        <div className="intel-digest__kinds" role="group" aria-label="速览信源">
          {KINDS.map(([k, name]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{name}</button>)}
        </div>
        {kind === "selected" && <label className="intel-digest__missed"><input type="checkbox" checked={onlyMissed} onChange={(e) => setOnlyMissed(e.target.checked)} />只看没进热点的</label>}
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
        ) : days.map((d) => (
          <section key={d.day} className="intel-digest__day">
            <h3>{dayLabel(d.day)}<span>{d.items.length} 条</span></h3>
            {kind === "selected" ? <ul>{d.items.map(selectedRow)}</ul>
              : byAuthor(d.items).map((g) => <div key={g.author || "?"} className="intel-digest__author"><h4>{g.author ? `@${g.author.replace(/^@/, "")}` : "未知作者"}</h4><ul>{g.items.map(builderRow)}</ul></div>)}
          </section>
        ))}
      {picking && <SourceResearchPicker source={picking} onClose={() => setPicking(null)} onGo={onGo} />}
    </div>
  );
}
