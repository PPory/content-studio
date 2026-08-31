// 提炼审阅卡。
//
// ⚠️ **确认的粒度是「一份资料」，不是「一条事实」。**
//
// Karpathy 说人类的 wiki 都会死，是因为维护负担增长快于价值；而 AGENTS.md 第 4 条
// 要求 AI 只提候选、写入必须用户确认。两条同时成立的唯一办法，就是把确认放在
// **一次提炼**这个层面：你一眼看完这份资料读出了什么，一次手势全接受，
// 不同意就整张拒掉。逐条打勾的话，维护成本又回到人身上，这个知识库照样会死。
//
// ⚠️ **被丢弃的也要显示。** 那不是噪音，是判断这个模型能不能用的唯一硬指标——
// 丢弃率突然变高，说明该换模型或改规则了，而这件事只有在这里看得见。

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote } from "./ui.jsx";

export function IngestReview({ onDone }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [openId, setOpenId] = useState("");

  const load = useCallback(() => {
    api.knowledgeCandidates().then(setData).catch(setError);
  }, []);
  useEffect(load, [load]);

  const decide = useCallback(async (id, action) => {
    setBusy(id);
    try {
      await api.knowledgeCandidateDecide(id, action);
      setData((current) => current && { ...current, candidates: current.candidates.filter((item) => item.id !== id) });
      onDone?.();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy("");
    }
  }, [onDone]);

  const candidates = data?.candidates || [];
  if (error) return <ErrorNote error={error} what="提炼提案" onRetry={load} />;
  if (!candidates.length) return null;

  return (
    <section className="ing" aria-label="待审阅的提炼">
      <h3 className="ing__head">
        读完了 {candidates.length} 份资料，等你过目
        <em>接受之后才会写进词条</em>
      </h3>

      {candidates.map((item) => {
        const expanded = openId === item.id;
        const counts = [
          item.entries.length ? `${item.entries.length} 个新词条` : "",
          item.facts.length ? `${item.facts.length} 条事实` : "",
          item.relations.length ? `${item.relations.length} 条关系` : "",
          item.contradictions.length ? `${item.contradictions.length} 处矛盾` : "",
        ].filter(Boolean);
        return (
          <article key={item.id} className="ing__item">
            <div className="ing__row">
              <button type="button" className="ing__title" aria-expanded={expanded} onClick={() => setOpenId(expanded ? "" : item.id)}>
                <b>{item.sourceTitle || "未命名资料"}</b>
                <span>{item.bookTitle}</span>
              </button>
              <span className="ing__counts">{counts.join(" · ") || "没读出可沉淀的内容"}</span>
              <div className="ing__actions">
                <button type="button" disabled={!!busy} onClick={() => decide(item.id, "reject")}>拒绝</button>
                <button type="button" className="is-primary" disabled={!!busy} onClick={() => decide(item.id, "accept")}>
                  {busy === item.id ? "写入中…" : "全部接受"}
                </button>
              </div>
            </div>

            {expanded ? (
              <div className="ing__body">
                {item.entries.map((entry) => (
                  <p key={`e-${entry.name}`}><i>＋词条</i><b>{entry.name}</b>{entry.definition}</p>
                ))}
                {item.facts.map((fact, index) => (
                  <p key={`f-${index}`}><i>事实</i><b>{fact.entry}</b>{fact.statement}</p>
                ))}
                {item.relations.map((relation, index) => (
                  <p key={`r-${index}`}><i>关系</i>{relation.from} → {data.relationLabels?.[relation.type] || relation.type} → {relation.to}</p>
                ))}
                {item.contradictions.map((conflict, index) => (
                  <p key={`c-${index}`} className="is-warn"><i>矛盾</i><b>{conflict.entry}</b>{conflict.statement}</p>
                ))}
                {/* 丢弃率是判断模型能不能用的硬指标，不藏起来 */}
                {item.rejected.length ? (
                  <p className="ing__dropped">
                    逐字校验丢弃 {item.rejected.length} 条（原文依据对不上或挂在不存在的词条上）
                  </p>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
