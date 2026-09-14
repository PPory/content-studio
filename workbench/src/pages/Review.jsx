import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, ViewTabs, Empty } from "../components/ui.jsx";
import { PositioningNote } from "../components/PositioningNote.jsx";
import { platformColor } from "../components/TrendChart.jsx";
import { fmtNum, metricLabel, METRIC_KEYS } from "../lib/posts.js";
import { IconArrowRight, IconCheck, IconChartBar, IconLink } from "../components/icons.jsx";
import "./review.css";

const LANES = [
  { key: "待复盘", label: "待复盘" },
  { key: "没对上", label: "待关联稿件" },
  { key: "已完成", label: "已完成" },
];
const LANE_NOTES = {
  待复盘: "回到已发布的文章，记录反馈、判断和下一次尝试。",
  没对上: "这些发布记录尚未关联工作台稿件。打开对应文章，在发布记录中手动关联后再复盘。",
  已完成: "回看已经留下的结论，继续验证下一次尝试。",
};

function useDark() {
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return undefined;
    const on = (event) => setDark(event.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

export function Review({ onGo }) {
  const [result, setResult] = useState(null);
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);
  const [postsError, setPostsError] = useState(null);
  const [lane, setLane] = useState("待复盘");
  const [observationsOpen, setObservationsOpen] = useState(false);
  const dark = useDark();
  const load = useCallback(() => {
    setError(null);
    setPostsError(null);
    api.projects().then(setResult).catch(setError);
    // 两类来源独立读取：平台数据失败不能阻断已发布文章的复盘。
    api.posts().then(setPosts).catch(setPostsError);
  }, []);
  useEffect(load, [load]);

  const pending = useMemo(() => (result?.projects || []).filter((p) => p.stage === "待复盘"), [result]);
  const completed = useMemo(() => (result?.projects || []).filter((p) => p.stage === "已完成"), [result]);
  // doc 是用户明确关联的稿件标识，不使用标题猜测关系。
  const loose = useMemo(() => (posts?.rows || []).filter((r) => !String(r.doc || "").trim()).sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))), [posts]);
  const counts = { 待复盘: result ? pending.length : "—", 没对上: posts ? loose.length : "—", 已完成: result ? completed.length : "—" };
  const shown = lane === "待复盘" ? pending : completed;
  const activeError = lane === "没对上" ? postsError : error;
  const loaded = lane === "没对上" ? posts : result;

  return (
    <section className="review-page" aria-labelledby="review-page-title">
      <header className="review-page__head">
        <div><h1 id="review-page-title">复盘</h1><p>从发布后的反馈中，找到下一篇可以改进的事。</p></div>
        <button type="button" className="btn btn-sm" onClick={() => onGo("review-performance")}><IconChartBar aria-hidden="true" />查看发布数据</button>
      </header>
      <section className="review-page__queue" aria-label="文章复盘">
        <div className="review-page__tabs">
          <ViewTabs items={LANES.map((item) => ({ ...item, count: counts[item.key] }))} value={lane} onChange={setLane} label="按状态筛选" />
        </div>
        <div className="review-page__intro">
          <p>{LANE_NOTES[lane]}</p>
          {lane === "没对上" && loose.length ? <button type="button" className="btn btn-sm" onClick={() => onGo("content")}>打开创作<IconArrowRight aria-hidden="true" /></button> : null}
        </div>
        <ErrorNote error={activeError} what={lane === "没对上" ? "读取发布记录" : "读取复盘任务"} />
        {activeError ? <button type="button" className="btn btn-sm review-page__retry" onClick={load}>重新加载</button> : null}
        {!loaded && !activeError ? <Loading rows={3} /> : loaded ? (
          <div className="review-home">
            {lane === "没对上" ? (
              loose.length ? <div className="loose-list">
                {loose.map((row, index) => <article key={`${row.platform}-${row.date}-${index}`} className="loose">
                  <div className="loose__head"><span className="tag tag--state"><span className="dot" style={{ background: platformColor(row.platform, dark) }} />{row.platform || "未知平台"}</span><span className="loose__date">{row.date || "日期未记录"}</span></div>
                  <h3>{row.title || "（无标题）"}</h3>
                  <div className="loose__metrics">{METRIC_KEYS.filter((key) => row[key] != null).map((key) => <span key={key}>{metricLabel(row.platform, key)} <strong>{fmtNum(row[key])}</strong></span>)}</div>
                </article>)}
              </div> : <Empty icon={IconLink}>没有待关联的发布记录。</Empty>
            ) : shown.length ? <div className="review-list">
              {shown.map((project, index) => <ReviewCard key={project.id} project={project} index={index} compact={lane === "已完成"} onOpen={() => onGo("project", project.id)} />)}
            </div> : lane === "待复盘" ? <div className="review-empty">
              <IconCheck aria-hidden="true" /><h3>暂无待复盘文章</h3><p>在工作台记录文章发布后，就可以在这里复盘。</p>
              {loose.length ? <button type="button" className="btn btn-sm" onClick={() => setLane("没对上")}>查看 {loose.length} 条待关联记录<IconArrowRight aria-hidden="true" /></button> : null}
            </div> : <Empty icon={IconChartBar}>完成第一篇复盘后，结论和下一步会留在这里。</Empty>}
          </div>
        ) : null}
      </section>
      <details className="review-page__observations" onToggle={(event) => setObservationsOpen(event.currentTarget.open)}>
        <summary><span>长期观察<small>从已发布内容与实验中回看创作方向</small></span></summary>
        {observationsOpen ? <PositioningNote /> : null}
      </details>
    </section>
  );
}

function ReviewCard({ project, index, onOpen, compact = false }) {
  const record = project.publication?.latest;
  return <article className="review-card" data-compact={compact || undefined}>
    <span className="review-card__index">{String(index + 1).padStart(2, "0")}</span>
    <div className="review-card__main">
      <div><span>{record?.platform || project.brief?.platform || "未知平台"}</span><small>{record?.publishedAt ? new Date(record.publishedAt).toLocaleDateString("zh-CN") : "发布时间未记录"}</small></div>
      <h3>{project.title}</h3>
      {compact ? <dl className="review-card__learning"><div><dt>结论</dt><dd>{project.review?.conclusion || "尚未记录结论"}</dd></div><div><dt>下一步</dt><dd>{project.review?.nextExperiment || "尚未记录下一步"}</dd></div></dl> : <p>{project.stageReason || "已发布，等待记录反馈与判断"}</p>}
    </div>
    <div className="review-card__action"><button type="button" className={`btn btn-sm${!compact && index === 0 ? " btn-primary" : ""}`} onClick={onOpen}>{compact ? "查看复盘" : "开始复盘"}<IconArrowRight aria-hidden="true" /></button></div>
  </article>;
}
