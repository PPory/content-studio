// 完整 Wiki 页面编译和全库体检修订都只在这里等待用户确认。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote } from "./ui.jsx";

const FINDING_TYPES = {
  contradiction: { level: "高风险", label: "观点冲突", tone: "risk" },
  stale: { level: "建议修改", label: "陈旧认识", tone: "suggest" },
  source_gap: { level: "建议修改", label: "来源不足", tone: "suggest" },
  missing_page: { level: "可选优化", label: "缺少页面", tone: "optional" },
  missing_link: { level: "可选优化", label: "缺少连接", tone: "optional" },
  synthesis_gap: { level: "可选优化", label: "缺少综合", tone: "optional" },
};

const liveRepair = (item) => ["queued", "retry", "running"].includes(item.repairStatus);

function keysOf(item) {
  if (item.type === "wiki-lint") {
    return (item.findings || []).flatMap((finding, index) => finding.repairable ? [`findings:${index}`] : []);
  }
  return (item.pages || []).map((_, index) => `pages:${index}`);
}

function Evidence({ quote }) {
  return quote ? <blockquote className="ing__quote">{quote}</blockquote> : null;
}

export function IngestReview({ onDone, focusSourceId = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [openId, setOpenId] = useState("");
  const [selected, setSelected] = useState({});
  const focused = useRef("");

  const load = useCallback(async () => {
    try {
      const result = await api.knowledgeCandidates();
      setData(result);
      setError(null);
      setSelected((current) => {
        const next = { ...current };
        for (const item of result.candidates || []) if (!next[item.id]) next[item.id] = new Set(keysOf(item));
        return next;
      });
      return result;
    } catch (failure) {
      setError(failure);
      return null;
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!focusSourceId || focused.current === focusSourceId || !data) return;
    const item = (data.candidates || []).find((candidate) => candidate.sourceId === focusSourceId || candidate.sourceBookId === focusSourceId);
    if (!item) return;
    focused.current = focusSourceId;
    setOpenId(item.id);
    window.requestAnimationFrame(() => document.getElementById(`knowledge-candidate-${item.id}`)?.scrollIntoView({ block: "center" }));
  }, [data, focusSourceId]);

  const hasLiveRepair = (data?.candidates || []).some(liveRepair);
  useEffect(() => {
    if (!hasLiveRepair) return undefined;
    const timer = window.setInterval(load, 2_000);
    return () => window.clearInterval(timer);
  }, [hasLiveRepair, load]);

  const decide = useCallback(async (item, action) => {
    setBusy(item.id);
    try {
      const include = action === "accept" && ["compile", "repair"].includes(item.type)
        ? [...(selected[item.id] || [])] : undefined;
      await api.knowledgeCandidateDecide(item.id, action, include);
      setData((current) => current && { ...current, candidates: current.candidates.filter((candidate) => candidate.id !== item.id) });
      onDone?.();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy("");
    }
  }, [onDone, selected]);

  const generateRepair = useCallback(async (item) => {
    setBusy(`repair:${item.id}`);
    try {
      await api.knowledgeCandidateRepair(item.id, [...(selected[item.id] || [])]);
      setData((current) => current && {
        ...current,
        candidates: current.candidates.map((candidate) => candidate.id === item.id
          ? { ...candidate, repairStatus: "queued", repairError: "" } : candidate),
      });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy("");
    }
  }, [selected]);

  const toggle = useCallback((id, key) => {
    setSelected((current) => {
      const next = new Set(current[id] || []);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...current, [id]: next };
    });
  }, []);

  const candidates = data?.candidates || [];
  const totalFindings = useMemo(() => candidates.reduce((sum, item) => sum
    + (item.type === "wiki-lint" ? item.findings?.length || 0 : item.pages?.length || 0), 0), [candidates]);
  const reportsOnly = candidates.length > 0 && candidates.every((item) => item.type === "wiki-lint");
  if (error) return <ErrorNote error={error} what="知识候选" onRetry={load} />;
  if (!candidates.length) return null;

  const pageLine = (item, page, index) => {
    const key = `pages:${index}`;
    const checked = selected[item.id]?.has(key) !== false;
    return (
      <label key={key} className={`ing__choice${checked ? "" : " is-off"}`}>
        <input type="checkbox" checked={checked} onChange={() => toggle(item.id, key)} />
        <span className="ing__choice-body">
          <span className="ing__choice-line"><i>{page.action === "update" ? "更新页面" : "新建页面"}</i><b>{page.title}</b>{page.summary}</span>
          <div className="ing__page-change">
            <small className="ing__why">{page.changeSummary}</small>
            <details>
              <summary>对照完整内容</summary>
              {page.beforeBodyMarkdown ? <><b>修改前</b><pre>{page.beforeBodyMarkdown}</pre></> : null}
              <b>修改后</b><pre>{page.bodyMarkdown}</pre>
            </details>
            <span>{page.citations?.length || 0} 处来源引用 · {page.links?.length || 0} 个页面连接</span>
          </div>
          <Evidence quote={page.citations?.[0]?.quote} />
        </span>
      </label>
    );
  };

  return (
    <section className="ing" aria-label="待审阅的知识候选">
      <h3 className="ing__head">
        {reportsOnly ? `${candidates.length} 份体检报告待处理` : `${candidates.length} 份知识候选待审阅`}
        <em>{reportsOnly ? `共 ${totalFindings} 项诊断；先生成修订，确认后才会改 Wiki` : `共 ${totalFindings} 项；逐页对照后决定是否写入`}</em>
      </h3>

      {candidates.map((item) => {
        const expanded = openId === item.id;
        const allKeys = keysOf(item);
        const kept = selected[item.id]?.size ?? allKeys.length;
        const isLint = item.type === "wiki-lint";
        const isRepair = item.type === "repair";
        const repairing = liveRepair(item) || busy === `repair:${item.id}`;
        const counts = isLint
          ? [item.findings?.length ? `${item.findings.length} 项语义问题` : "", item.deterministic?.orphans ? `${item.deterministic.orphans} 个孤页` : ""].filter(Boolean)
          : [item.pages?.filter((page) => page.action === "create").length ? `${item.pages.filter((page) => page.action === "create").length} 个新页面` : "", item.pages?.filter((page) => page.action === "update").length ? `${item.pages.filter((page) => page.action === "update").length} 个页面更新` : ""].filter(Boolean);
        return (
          <article id={`knowledge-candidate-${item.id}`} key={item.id} className={`ing__item${isLint ? " ing__item--lint" : ""}${isRepair ? " ing__item--repair" : ""}`}>
            <div className="ing__row">
              <button type="button" className="ing__title" aria-expanded={expanded} onClick={() => setOpenId(expanded ? "" : item.id)}>
                <b>{isLint ? "全库体检报告" : isRepair ? "体检修订候选" : item.sourceTitle || "未命名资料"}</b>
                <span>{isLint
                  ? "选择值得处理的问题，让 AI 生成可核验的页面修订"
                  : isRepair ? item.repairSummary || "根据所选体检问题生成，尚未写入 Wiki"
                  : `已阅读全文（${item.chunksRead || 1} 段） · ${item.compilationSummary || item.bookTitle}`}</span>
              </button>
              <span className="ing__counts">{counts.join(" · ") || "没有可应用的修改"}</span>
              <div className="ing__actions">
                <button type="button" disabled={!!busy || repairing} onClick={() => decide(item, "reject")}>{isLint ? "暂不处理" : isRepair ? "放弃修订" : "整份拒绝"}</button>
                {isLint ? (
                  <button type="button" className="is-primary" disabled={!!busy || repairing || kept === 0} onClick={() => generateRepair(item)}>
                    {repairing ? "正在生成修订…" : item.repairStatus === "failed" ? `重新生成修订（${kept}）` : `生成所选修订（${kept}）`}
                  </button>
                ) : (
                  <button type="button" className="is-primary" disabled={!!busy || kept === 0} onClick={() => decide(item, "accept")}>{busy === item.id ? "处理中…" : isRepair ? `应用所选修改（${kept}）` : kept === allKeys.length ? "全部接受" : `接受所选（${kept}）`}</button>
                )}
              </div>
            </div>

            {isLint && (repairing || item.repairStatus === "failed") ? (
              <p className={`ing__repair-status${item.repairStatus === "failed" ? " is-error" : ""}`} role="status">
                {item.repairStatus === "failed" ? `上次生成失败：${item.repairError || "可重新尝试"}` : "AI 正在对照现有页面和来源生成完整修订，完成后这里会出现可逐页确认的候选。"}
              </p>
            ) : null}

            {expanded ? (
              <div className="ing__body">
                {(item.pages || []).map((page, index) => pageLine(item, page, index))}
                {isLint ? (
                  <ol className="ing__findings">
                    {(item.findings || []).map((finding, index) => {
                      const meta = FINDING_TYPES[finding.type] || { level: "建议修改", label: "知识问题", tone: "suggest" };
                      const key = `findings:${index}`;
                      const checked = selected[item.id]?.has(key) === true;
                      const content = <>
                        <div className="ing__finding-head">
                          <span className={`ing__finding-level is-${meta.tone}`}>{meta.level}</span>
                          <b>{meta.label}</b>
                          <span className="ing__finding-pages">{(finding.pages || []).join("、") || "全库"}</span>
                          {!finding.repairable ? <span className="ing__finding-blocked">需补来源</span> : null}
                        </div>
                        <p>{finding.problem}</p>
                        <p className="ing__finding-suggestion"><span>建议</span>{finding.suggestion}</p>
                        {!finding.repairable ? <p className="ing__finding-reason">{finding.reason}</p> : null}
                      </>;
                      return finding.repairable ? (
                        <li key={key} className={`ing__finding${checked ? "" : " is-off"}`}>
                          <label><input type="checkbox" checked={checked} onChange={() => toggle(item.id, key)} /><span>{content}</span></label>
                        </li>
                      ) : <li key={key} className="ing__finding is-blocked"><div className="ing__finding-static">{content}</div></li>;
                    })}
                  </ol>
                ) : null}
                {item.rejected?.length ? <p className="ing__dropped">证据校验已拦下 {item.rejected.length} 条不可靠修改，这些内容不会进入正式知识。</p> : null}
                {item.unresolved?.length ? <p className="ing__dropped">另有 {item.unresolved.length} 项建议未生成可用修订，仍保留为待处理问题。</p> : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
