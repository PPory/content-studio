import { IconAlertTriangle, IconCheck, IconUserStar } from "../icons.jsx";
import { RunningMark } from "./loaders.jsx";

export function ExpertActivity({ items = [], live = false }) {
  if (!items.length) return null;
  const completed = items.filter((item) => item.status === "done").length;
  const failed = items.filter((item) => ["failed", "cancelled"].includes(item.status)).length;
  const active = items.length - completed - failed;
  const summary = active
    ? `${completed}/${items.length} 完成`
    : failed ? `${completed} 完成，${failed} 未完成` : `${completed}/${items.length} 已完成`;
  return <section className="assistant-experts" aria-label="专家协作运行状态" aria-live={live ? "polite" : "off"}>
    <header><span><IconUserStar aria-hidden="true" /><b>专家协作</b></span><small>{summary}</small></header>
    <ul>{items.map((item) => {
      const running = ["queued", "running"].includes(item.status);
      const done = item.status === "done";
      return <li key={item.id || item.kind} data-status={item.status}>
        <span aria-hidden="true">{running ? <RunningMark /> : done ? <IconCheck /> : <IconAlertTriangle />}</span>
        <b>{item.expertName || item.kind}</b>
        <small>{item.stageLabel || (done ? "检查完成" : running ? "正在检查" : "检查未完成")}{running && item.percent ? ` · ${item.percent}%` : ""}</small>
      </li>;
    })}</ul>
    {!live && !active ? <p>以上状态来自服务端子 Agent 运行记录。</p> : null}
  </section>;
}
