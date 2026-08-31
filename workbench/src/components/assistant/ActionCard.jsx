import { createAiResult } from "../../lib/ai/result-model.js";

const ACTION_LABELS = {
  create_content: ["新建到「创作」", "确认新建"],
  document_create: ["新建工作台文档", "确认写入"],
  document_update: ["更新工作台文档", "确认更新"],
  annotation_append: ["追加工作台批注", "确认追加"],
  reference_insert: ["插入来源引用", "确认插入"],
  project_write: ["写入项目文件", "确认写入"],
  project_edit: ["编辑项目文件", "确认编辑"],
  powershell: ["执行 PowerShell", "确认执行"],
  workspace_write: ["写入授权工作区", "确认写入"],
  workspace_edit: ["编辑授权工作区", "确认编辑"],
  workspace_powershell: ["在授权工作区执行命令", "确认执行"],
  save_knowledge_card: ["保存为 Markdown 知识卡", "确认保存"],
  knowledge_source_add: ["收进知识库", "抓取并入库"],
};

export function ActionCard({ action, onApply, onReject, onOpenRewrite, originalLength = 0 }) {
  if (!action || action.status === "superseded") return null;
  const result = createAiResult({ ...action, kind: "action", status: action.status === "pending" ? "proposed" : action.status });
  const applied = result.status === "applied";
  const rejected = result.status === "rejected";
  const [title, button] = ACTION_LABELS[result.type] || ["执行候选操作", "确认执行"];
  /**
   * 「整理全文」是这批卡里**唯一一张不在这儿落地的**。
   *
   * 别的动作点「确认执行」就由服务端做完了；这一张点下去只是**把候选送进正文区**，
   * 真正的决定发生在那边的全文审阅里（红绿 diff + 采纳 / 弃用）。所以：
   *  - 按钮写「看改动」，不写「确认执行」——后者是在说一件它不会做的事；
   *  - 卡片**不自己翻成「已执行」**。用户在审阅里还可能弃用，而那时卡上写着已执行，
   *    就是屏幕上唯一一处说了假话的地方。它保持可点：想再看一次就再点一次。
   */
  if (result.type === "rewrite_body") {
    const next = String(result.body || "").length;
    const size = originalLength ? `${originalLength} 字 → ${next} 字` : `${next} 字`;
    return <section className="assistant-action-card" data-status={rejected ? "rejected" : "proposed"}>
      <div><small>{rejected ? "已拒绝" : "等待你在正文里确认"}</small><b>整理全文</b><p>{[size, result.reason].filter(Boolean).join(" · ")}</p></div>
      {rejected ? <span>不会执行</span> : <div className="assistant-action-card__actions">
        <button type="button" onClick={() => onReject(result.id)}>拒绝</button>
        <button type="button" className="is-primary" onClick={() => onOpenRewrite?.(result)}>看改动</button>
      </div>}
    </section>;
  }
  const detail = result.type === "create_content" ? `${result.title} · ${result.platform}`
    // 收资料这张卡上最该看的是**地址和理由**：地址决定你信不信这个来源，
    // 理由决定它值不值得占知识库的位置。两者都比「已由服务端校验范围」有用。
    : result.type === "knowledge_source_add" ? [result.title, result.url, result.why].filter(Boolean).join(" · ")
    : result.path || result.command?.slice(0, 120) || "已由服务端校验范围";
  return <section className="assistant-action-card" data-status={result.status}>
    <div><small>{applied ? "已执行" : rejected ? "已拒绝" : "等待你确认"}</small><b>{title}</b><p>{detail}</p></div>
    {applied ? (result.result?.projectId ? <button type="button" onClick={() => { window.location.hash = `#/project/${result.result.projectId}`; }}>打开内容</button> : <span>已完成</span>)
      : rejected ? <span>不会执行</span>
        : <div className="assistant-action-card__actions"><button type="button" onClick={() => onReject(result.id)}>拒绝</button><button type="button" className="is-primary" onClick={() => onApply(result.id)}>{button}</button></div>}
  </section>;
}
