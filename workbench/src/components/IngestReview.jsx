// 知识候选审阅：提炼和体检都只在这里等待用户确认。

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote } from "./ui.jsx";

const GROUPS = ["entries", "definitions", "facts", "relations", "contradictions", "tensions", "links"];

function keysOf(item) {
  return GROUPS.flatMap((group) => (item[group] || []).map((_, index) => `${group}:${index}`));
}

function Evidence({ quote }) {
  return quote ? <blockquote className="ing__quote">{quote}</blockquote> : null;
}

export function IngestReview({ onDone }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [openId, setOpenId] = useState("");
  const [selected, setSelected] = useState({});

  const load = useCallback(() => {
    api.knowledgeCandidates().then((result) => {
      setData(result);
      setSelected((current) => {
        const next = { ...current };
        for (const item of result.candidates || []) if (!next[item.id]) next[item.id] = new Set(keysOf(item));
        return next;
      });
    }).catch(setError);
  }, []);
  useEffect(load, [load]);

  const decide = useCallback(async (item, action) => {
    setBusy(item.id);
    try {
      await api.knowledgeCandidateDecide(item.id, action, action === "accept" ? [...(selected[item.id] || [])] : undefined);
      setData((current) => current && { ...current, candidates: current.candidates.filter((candidate) => candidate.id !== item.id) });
      onDone?.();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy("");
    }
  }, [onDone, selected]);

  const toggle = useCallback((id, key) => {
    setSelected((current) => {
      const next = new Set(current[id] || []);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...current, [id]: next };
    });
  }, []);

  const candidates = data?.candidates || [];
  const totalFindings = useMemo(() => candidates.reduce((sum, item) => sum + keysOf(item).length, 0), [candidates]);
  if (error) return <ErrorNote error={error} what="知识候选" onRetry={load} />;
  if (!candidates.length) return null;

  const line = (item, group, index, label, title, body, quote, extra = null) => {
    const key = `${group}:${index}`;
    const checked = selected[item.id]?.has(key) !== false;
    return (
      <label key={key} className={`ing__choice${checked ? "" : " is-off"}`}>
        <input type="checkbox" checked={checked} onChange={() => toggle(item.id, key)} />
        <span className="ing__choice-body">
          <span className="ing__choice-line"><i>{label}</i>{title ? <b>{title}</b> : null}{body}</span>
          {extra}
          <Evidence quote={quote} />
        </span>
      </label>
    );
  };

  return (
    <section className="ing" aria-label="待审阅的知识候选">
      <h3 className="ing__head">
        {candidates.length} 份候选等你过目
        <em>共 {totalFindings} 项，取消勾选即可排除个别误判</em>
      </h3>

      {candidates.map((item) => {
        const expanded = openId === item.id;
        const allKeys = keysOf(item);
        const kept = selected[item.id]?.size ?? allKeys.length;
        const counts = item.type === "lint"
          ? [item.tensions?.length ? `${item.tensions.length} 处张力` : "", item.links?.length ? `${item.links.length} 条补链` : ""].filter(Boolean)
          : [
              item.entries?.length ? `${item.entries.length} 个新词条` : "",
              item.definitions?.length ? `${item.definitions.length} 个定义更新` : "",
              item.facts?.length ? `${item.facts.length} 条事实` : "",
              item.relations?.length ? `${item.relations.length} 条关系` : "",
              item.contradictions?.length ? `${item.contradictions.length} 处矛盾` : "",
            ].filter(Boolean);
        return (
          <article key={item.id} className="ing__item">
            <div className="ing__row">
              <button type="button" className="ing__title" aria-expanded={expanded} onClick={() => setOpenId(expanded ? "" : item.id)}>
                <b>{item.type === "lint" ? `体检 · ${item.sourceTitle}` : item.sourceTitle || "未命名资料"}</b>
                <span>{item.type === "lint" ? (item.mode === "tension" ? "判断同题事实是否真正冲突" : "给孤立词条补关系") : item.bookTitle}</span>
              </button>
              <span className="ing__counts">{counts.join(" · ") || "没读出可沉淀的内容"}</span>
              <div className="ing__actions">
                <button type="button" disabled={!!busy} onClick={() => decide(item, "reject")}>整份拒绝</button>
                <button type="button" className="is-primary" disabled={!!busy || kept === 0} onClick={() => decide(item, "accept")}>
                  {busy === item.id ? "写入中…" : kept === allKeys.length ? "全部接受" : `接受所选（${kept}）`}
                </button>
              </div>
            </div>

            {expanded ? (
              <div className="ing__body">
                {(item.entries || []).map((entry, index) => line(item, "entries", index, "＋词条", entry.name, entry.definition, entry.quote))}
                {(item.definitions || []).map((entry, index) => line(item, "definitions", index, "更新定义", entry.entry, entry.definition, entry.quote,
                  entry.why ? <small className="ing__why">理由：{entry.why}</small> : null))}
                {(item.facts || []).map((fact, index) => line(item, "facts", index, "事实", fact.entry, fact.statement, fact.quote))}
                {(item.relations || []).map((relation, index) => line(item, "relations", index, "关系", "",
                  `${relation.from} → ${data.relationLabels?.[relation.type] || relation.type} → ${relation.to}`, relation.quote,
                  relation.why ? <small className="ing__why">理由：{relation.why}</small> : null))}
                {(item.contradictions || []).map((conflict, index) => line(item, "contradictions", index, "矛盾", conflict.entry, conflict.statement, conflict.quote,
                  <div className="ing__compare"><span>已有说法</span>{conflict.existingStatement || "未取到旧事实"}<small>{conflict.why}</small></div>))}
                {(item.tensions || []).map((tension, index) => line(item, "tensions", index,
                  tension.verdict === "supersede" ? "推翻" : "并存冲突", item.sourceTitle, tension.why, "",
                  <div className="ing__compare"><span>A</span>{tension.left}<span>B</span>{tension.right}</div>))}
                {(item.links || []).map((link, index) => line(item, "links", index, "补关系", item.sourceTitle,
                  `→ ${data.relationLabels?.[link.type] || link.type} → ${link.to}`, "", <small className="ing__why">{link.why}</small>))}
                {item.rejected?.length ? (
                  <p className="ing__dropped">逐字校验丢弃 {item.rejected.length} 条；这些内容不会进入正式知识。</p>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
