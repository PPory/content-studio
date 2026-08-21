import { useEffect, useState } from "react";
import { IconCheck, IconChartBar, IconLoader2, IconTarget } from "./icons.jsx";
import { projectReviewForm, projectReviewPayload, reviewGoal } from "../lib/project-review.js";

const JUDGMENTS = [
  { value: "样本不足", label: "样本不足", hint: "记录事实，暂不判定成败" },
  { value: "普通", label: "表现普通", hint: "没有足够证据说明这次更好" },
  { value: "表现突出", label: "表现突出", hint: "有清晰的同平台或历史依据" },
];

const METRICS = [
  ["views", "阅读 / 播放"],
  ["likes", "点赞"],
  ["comments", "评论"],
  ["collects", "收藏"],
  ["shares", "分享"],
];

export function ProjectReviewStage({ project, busy, onSave }) {
  const [form, setForm] = useState(() => projectReviewForm(project));
  useEffect(() => setForm(projectReviewForm(project)), [project]);
  const captured = project.review?.status === "已沉淀";
  const candidates = project.review?.feedbackCandidates || [];
  const canCapture = form.status === "表现突出" && candidates.length > 0;
  const published = project.publication?.records?.find((item) => item.draftId === form.draftId) || project.publication?.latest;

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setMetric = (key, value) => setForm((current) => ({ ...current, metrics: { ...current.metrics, [key]: value } }));

  return (
    <div className="project-review-stage">
      <section className="review-step review-step--goal">
        <div className="review-step__number">01</div>
        <div className="review-step__body">
          <span className="eyebrow"><IconTarget aria-hidden="true" />目标</span>
          <h2>这篇原本想验证什么</h2>
          <blockquote>{reviewGoal(project)}</blockquote>
          <p>{published?.platform || "当前平台"} · {published?.publishedAt ? new Date(published.publishedAt).toLocaleDateString("zh-CN") : "发布时间已记录"}</p>
        </div>
      </section>

      <section className="review-step">
        <div className="review-step__number">02</div>
        <div className="review-step__body">
          <span className="eyebrow"><IconChartBar aria-hidden="true" />数据</span>
          <h2>先把事实补齐</h2>
          <p className="review-step__intro">没有的数字可以留空；留空不会被当成 0。</p>
          <div className="review-metrics">
            {METRICS.map(([key, label]) => (
              <label key={key}><span>{label}</span><input type="number" min="0" step="1" value={form.metrics[key]} onChange={(event) => setMetric(key, event.target.value)} placeholder="—" /></label>
            ))}
          </div>
        </div>
      </section>

      <section className="review-step">
        <div className="review-step__number">03</div>
        <div className="review-step__body">
          <span className="eyebrow">判断</span>
          <h2>数据说明了什么</h2>
          <div className="review-judgments" role="radiogroup" aria-label="表现判断">
            {JUDGMENTS.map((item) => (
              <button key={item.value} type="button" role="radio" aria-checked={form.status === item.value} data-active={form.status === item.value || undefined} disabled={captured} title={captured ? "有效经验已进入素材库，判断保持为表现突出" : undefined} onClick={() => setForm((current) => ({ ...current, status: item.value, captureFeedback: item.value === "表现突出" ? current.captureFeedback : false }))}>
                <b>{item.label}</b><span>{item.hint}</span>
              </button>
            ))}
          </div>
          <label className="review-text"><span>判断依据</span><textarea rows="3" value={form.basis} onChange={(event) => setField("basis", event.target.value)} placeholder="例如：同平台可比样本只有 3 篇，先记录，暂不归因" /></label>
          <label className="review-text"><span>复盘结论</span><textarea rows="3" value={form.conclusion} onChange={(event) => setField("conclusion", event.target.value)} placeholder="用一句话留下你确定的判断" /></label>
        </div>
      </section>

      <section className="review-step review-step--action">
        <div className="review-step__number">04</div>
        <div className="review-step__body">
          <span className="eyebrow"><IconCheck aria-hidden="true" />行动</span>
          <h2>下一篇具体改什么</h2>
          <label className="review-text"><span>下一次实验</span><textarea rows="3" value={form.nextExperiment} onChange={(event) => setField("nextExperiment", event.target.value)} placeholder="例如：同类选题下一篇改用真实案例开头，其他结构不变" /></label>

          {canCapture ? (
            <div className="review-feedback-plan">
              <div><b>可沉淀回素材库</b><span>先看清依据，再决定是否保留。</span></div>
              <div className="review-feedback-plan__cards">
                {candidates.map((item) => <article key={item.kind}><small>{item.label}</small><strong>{item.content}</strong><p>{form.basis || item.evidence}</p></article>)}
              </div>
              {project.review?.storyCandidateIds?.length ? <p>同时会给 {project.review.storyCandidateIds.length} 条本篇使用的故事素材标记“有效故事”。</p> : null}
              <label className="review-feedback-confirm"><input type="checkbox" checked={captured || form.captureFeedback} disabled={captured} onChange={(event) => setField("captureFeedback", event.target.checked)} /><span>{captured ? "已沉淀到素材库" : "我已核对依据，保留这些有效经验"}</span></label>
            </div>
          ) : null}

          <button className="btn btn-primary review-save" disabled={busy} onClick={() => onSave(projectReviewPayload(form))}>
            {busy ? <IconLoader2 className="spin" aria-hidden="true" /> : <IconCheck aria-hidden="true" />}{project.stage === "已完成" ? "更新复盘" : "完成复盘"}
          </button>
        </div>
      </section>
    </div>
  );
}
