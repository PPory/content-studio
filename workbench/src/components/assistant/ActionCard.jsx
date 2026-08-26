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
};

export function ActionCard({ action, onApply }) {
  if (!action || action.status === "superseded") return null;
  const applied = action.status === "applied";
  const [title, button] = ACTION_LABELS[action.type] || ["执行候选操作", "确认执行"];
  const detail = action.type === "create_content" ? `${action.title} · ${action.platform}` : action.path || action.command?.slice(0, 120) || "已由服务端校验范围";
  return <section className="assistant-action-card">
    <div><small>{applied ? "已执行" : "等待你确认"}</small><b>{title}</b><p>{detail}</p></div>
    {applied ? (action.result?.projectId ? <button type="button" onClick={() => { window.location.hash = `#/project/${action.result.projectId}`; }}>打开内容</button> : <span>已完成</span>) : <button type="button" onClick={() => onApply(action.id)}>{button}</button>}
  </section>;
}
