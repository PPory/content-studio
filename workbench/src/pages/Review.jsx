import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, PageHeader } from "../components/ui.jsx";
import { IconArrowRight, IconChartBar, IconCheck, IconRefresh } from "../components/icons.jsx";

export function Review({ onGo }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    setError(null);
    api.projects().then(setResult).catch(setError);
  }, []);
  useEffect(load, [load]);

  const projects = result?.projects || [];
  const pending = useMemo(() => projects.filter((item) => item.stage === "待复盘"), [projects]);
  const completed = useMemo(() => projects.filter((item) => item.stage === "已完成"), [projects]);

  return (
    <>
      <PageHeader eyebrow="AFTER PUBLISHING" title="复盘" desc="一篇一篇地留下判断和下一步，数字只是依据，不是结论。" aside={<button className="btn btn-sm" onClick={load}><IconRefresh aria-hidden="true" />重新读取</button>} />
      <ErrorNote error={error} what="读取复盘任务" />
      {!result && !error ? <Loading rows={4} /> : null}

      {result ? (
        <div className="review-home">
          <div className="review-home__summary">
            <div><strong>{pending.length}</strong><span>篇等待复盘</span></div>
            <div><strong>{completed.length}</strong><span>篇已留下行动</span></div>
            <button type="button" onClick={() => onGo("review-performance", "")}><IconChartBar aria-hidden="true" /><span><b>查看整体表现</b><small>月度发布量与渠道数据</small></span><IconArrowRight aria-hidden="true" /></button>
          </div>

          <section className="review-queue">
            <div className="review-queue__head"><div><span className="eyebrow">NEXT TO REVIEW</span><h2>现在该看哪些内容</h2></div><b>{pending.length}</b></div>
            {pending.length ? pending.map((project, index) => <ReviewCard key={project.id} project={project} index={index} onOpen={() => onGo("project", project.id)} />) : (
              <div className="review-empty"><IconCheck aria-hidden="true" /><h3>没有积压的复盘</h3><p>新内容记录发布后，会自动出现在这里。</p></div>
            )}
          </section>

          {completed.length ? <section className="review-archive"><div className="review-queue__head"><div><span className="eyebrow">DECISIONS KEPT</span><h2>已完成的判断</h2></div><b>{completed.length}</b></div><div>{completed.map((project, index) => <ReviewCard key={project.id} project={project} index={index} onOpen={() => onGo("project", project.id)} compact />)}</div></section> : null}
        </div>
      ) : null}
    </>
  );
}

function ReviewCard({ project, index, onOpen, compact = false }) {
  const record = project.publication?.latest;
  return (
    <article className="review-card" data-compact={compact || undefined}>
      <span className="review-card__index">{String(index + 1).padStart(2, "0")}</span>
      <div className="review-card__main"><div><span>{record?.platform || project.brief?.platform || "未知平台"}</span><small>{record?.publishedAt ? new Date(record.publishedAt).toLocaleDateString("zh-CN") : "已发布"}</small></div><h3>{project.title}</h3><p>{compact ? project.review?.nextExperiment : project.stageReason}</p></div>
      <div className="review-card__action"><span>{compact ? "下一步已留存" : project.nextAction}</span><button className="btn btn-primary btn-sm" onClick={onOpen}>{compact ? "查看" : "开始复盘"}<IconArrowRight aria-hidden="true" /></button></div>
    </article>
  );
}
