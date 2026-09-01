// 完整 Wiki 页面编译和全库体检都只在这里等待用户确认。

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote } from "./ui.jsx";

const GROUPS = ["pages", "findings"];

const FINDING_TYPES = {
  contradiction: { level: "高风险", label: "观点冲突", tone: "risk" },
  stale: { level: "建议修改", label: "陈旧认识", tone: "suggest" },
  source_gap: { level: "建议修改", label: "来源不足", tone: "suggest" },
  missing_page: { level: "可选优化", label: "缺少页面", tone: "optional" },
  missing_link: { level: "可选优化", label: "缺少连接", tone: "optional" },
  synthesis_gap: { level: "可选优化", label: "缺少综合", tone: "optional" },
};

function keysOf(item) {
  const keys = GROUPS.flatMap((group) => (item[group] || []).map((_, index) => `${group}:${index}`));
  return item.type === "wiki-lint" && !keys.length ? ["report:0"] : keys;
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
      await api.knowledgeCandidateDecide(item.id, action, action === "accept" && item.type === "compile" ? [...(selected[item.id] || [])] : undefined);
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
  const reportsOnly = candidates.every((item) => item.type === "wiki-lint");
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
        {reportsOnly ? `${candidates.length} 份体检报告待查看` : `${candidates.length} 份候选等你过目`}
        <em>{reportsOnly ? `共 ${totalFindings} 项诊断；报告不会自动修改 Wiki` : `共 ${totalFindings} 项，取消勾选即可排除个别误判`}</em>
      </h3>

      {candidates.map((item) => {
        const expanded = openId === item.id;
        const allKeys = keysOf(item);
        const kept = selected[item.id]?.size ?? allKeys.length;
        const counts = item.type === "compile"
          ? [
              item.pages?.filter((page) => page.action === "create").length ? `${item.pages.filter((page) => page.action === "create").length} 个新页面` : "",
              item.pages?.filter((page) => page.action === "update").length ? `${item.pages.filter((page) => page.action === "update").length} 个页面更新` : "",
            ].filter(Boolean)
          : [item.findings?.length ? `${item.findings.length} 项语义问题` : "", item.deterministic?.orphans ? `${item.deterministic.orphans} 个孤页` : "", item.deterministic?.missingCitations ? `${item.deterministic.missingCitations} 页缺来源` : ""].filter(Boolean);
        return (
          <article key={item.id} className={`ing__item${item.type === "wiki-lint" ? " ing__item--lint" : ""}`}>
            <div className="ing__row">
              <button type="button" className="ing__title" aria-expanded={expanded} onClick={() => setOpenId(expanded ? "" : item.id)}>
                <b>{item.type === "wiki-lint" ? "全库体检报告" : item.sourceTitle || "未命名资料"}</b>
                <span>{item.type === "compile"
                  ? `已阅读全文（${item.chunksRead || 1} 段） · ${item.compilationSummary || item.bookTitle}`
                  : "检查跨页矛盾、陈旧认识、缺页、缺链和知识空白"}</span>
              </button>
              <span className="ing__counts">{counts.join(" · ") || "没读出可沉淀的内容"}</span>
              <div className="ing__actions">
                <button type="button" disabled={!!busy} onClick={() => decide(item, "reject")}>{item.type === "wiki-lint" ? "忽略本次报告" : "整份拒绝"}</button>
                <button type="button" className={item.type === "compile" ? "is-primary" : ""} disabled={!!busy || (item.type === "compile" && kept === 0)} onClick={() => decide(item, "accept")}>
                  {busy === item.id ? "处理中…" : item.type === "wiki-lint" ? "标记已阅" : kept === allKeys.length ? "全部接受" : `接受所选（${kept}）`}
                </button>
              </div>
            </div>

            {expanded ? (
              <div className="ing__body">
                {(item.pages || []).map((page, index) => line(item, "pages", index,
                  page.action === "update" ? "更新页面" : "新建页面", page.title, page.summary, page.citations?.[0]?.quote,
                  <div className="ing__page-change">
                    <small className="ing__why">{page.changeSummary}</small>
                    <details>
                      <summary>查看完整新版本{page.beforeBodyMarkdown ? "与原版本" : ""}</summary>
                      {page.beforeBodyMarkdown ? <><b>原版本</b><pre>{page.beforeBodyMarkdown}</pre></> : null}
                      <b>新版本</b><pre>{page.bodyMarkdown}</pre>
                    </details>
                    <span>{page.citations?.length || 0} 处来源引用 · {page.links?.length || 0} 个页面连接</span>
                  </div>))}
                {item.type === "wiki-lint" ? (
                  <ol className="ing__findings">
                    {(item.findings || []).map((finding, index) => {
                      const meta = FINDING_TYPES[finding.type] || { level: "建议修改", label: "知识问题", tone: "suggest" };
                      return (
                        <li key={`finding:${index}`} className="ing__finding">
                          <div className="ing__finding-head">
                            <span className={`ing__finding-level is-${meta.tone}`}>{meta.level}</span>
                            <b>{meta.label}</b>
                            <span className="ing__finding-pages">{(finding.pages || []).join("、") || "全库"}</span>
                          </div>
                          <p>{finding.problem}</p>
                          <p className="ing__finding-suggestion"><span>建议</span>{finding.suggestion}</p>
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
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
