import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import "./content-intent-panel.css";

const ACTION_LABELS = {
  knowledge: "知识型",
  judgment: "判断型",
  experience: "经历型",
  demonstration: "展示型",
};

const ASSISTANT_ACTIONS = [
  { label: "挑战核心判断", prompt: (intent) => `挑战这条内容的核心判断，并指出它最可能错在哪里：${intent.opportunity.coreClaim}` },
  { label: "找反例", prompt: (intent) => `为这条核心判断找真正有力的反例，不要只给表面异议：${intent.opportunity.coreClaim}` },
  { label: "找证据", prompt: (intent) => `检查这条内容目前缺哪些证据，并优先处理已有证据缺口：${intent.evidenceGaps.map((item) => item.claim).join("；") || "请从核心判断开始检查"}` },
  { label: "换大众入口", prompt: (intent) => `保持支撑知识和核心判断不变，为用户问题换一个正文真正能回答的大众入口：${intent.problem.statement}` },
  { label: "换表达方式", prompt: (intent) => `保持事实和来源不变，为这条内容比较知识型、判断型、经历型和展示型表达；没有真实经历时不得编造第一人称经历。当前是${ACTION_LABELS[intent.opportunity.dominantAction] || intent.opportunity.dominantAction}。` },
  { label: "检查是否偏离议程", prompt: (intent) => `检查当前内容是否偏离长期议程。核心判断：${intent.opportunity.coreClaim}；议程：${intent.agenda?.desiredJudgment || "未关联议程"}` },
];

export function ContentIntentPanel({ projectId, onGo, onAsk }) {
  const [intent, setIntent] = useState(undefined);

  useEffect(() => {
    let active = true;
    api.projectContentIntent(projectId)
      .then((result) => { if (active) setIntent(result.intent || null); })
      .catch(() => { if (active) setIntent(null); });
    return () => { active = false; };
  }, [projectId]);

  if (!intent) return null;
  const { opportunity, wiki, problem, agenda, evidenceGaps } = intent;

  return (
    <section className="content-intent" aria-labelledby="content-intent-title">
      <header>
        <div>
          <span>创作意图</span>
          <h2 id="content-intent-title">先守住这条内容为什么值得写</h2>
        </div>
        <button type="button" onClick={() => onGo?.("bridge", `opportunity:${opportunity.id}`)}>回到内容机会</button>
      </header>

      <div className="content-intent__facts">
        <div><span>用户问题</span><strong>{problem.statement}</strong><button type="button" onClick={() => onGo?.("bridge", `problem:${problem.id}`)}>查看来源</button></div>
        <div><span>核心判断</span><strong>{opportunity.coreClaim}</strong></div>
        <div><span>支撑知识</span><strong>{wiki?.title || "Wiki 页面"}</strong>{wiki ? <button type="button" onClick={() => onGo?.("entries", wiki.id)}>回到 Wiki</button> : null}</div>
        <div><span>长期议程</span><strong>{agenda?.title || "暂未关联"}</strong>{agenda ? <small>{agenda.desiredJudgment}</small> : null}</div>
        <div><span>主要表达动作</span><strong>{ACTION_LABELS[opportunity.dominantAction] || opportunity.dominantAction}</strong></div>
        <div><span>当前证据缺口</span><strong>{evidenceGaps.length ? evidenceGaps.map((item) => item.claim).join("；") : "当前没有明确缺口"}</strong></div>
      </div>

      <div className="content-intent__actions" aria-label="围绕创作意图询问助手">
        {ASSISTANT_ACTIONS.map((action) => (
          <button key={action.label} type="button" onClick={() => onAsk?.(action.prompt(intent))}>{action.label}</button>
        ))}
      </div>
    </section>
  );
}
