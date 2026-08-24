// “新建内容”必须先在 Worker 建一行，项目页才有稳定地址；但这不代表一次误点
// 就该永久留下一篇“未命名”。sessionStorage 只标记本标签页刚建、尚未确认保存的空项目。
// 一旦用户保存、采用素材或推进阶段，就清掉标记，后续完全按普通项目处理。

const PREFIX = "workbench:temporary-project:v1:";
const safeId = (value) => String(value || "").trim();

export function markTemporaryProject(id) {
  const key = safeId(id);
  if (!key) return false;
  try {
    sessionStorage.setItem(`${PREFIX}${key}`, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}
export function isTemporaryProject(id) {
  const key = safeId(id);
  if (!key) return false;
  try {
    return sessionStorage.getItem(`${PREFIX}${key}`) != null;
  } catch {
    return false;
  }
}

export function clearTemporaryProject(id) {
  const key = safeId(id);
  if (!key) return;
  try { sessionStorage.removeItem(`${PREFIX}${key}`); } catch { /* 本次会话照常继续 */ }
}

export function isBlankTemporaryDraft({ temporary, title, body, materials = [] } = {}) {
  const cleanTitle = String(title || "").trim();
  return !!temporary
    && (!cleanTitle || cleanTitle === "未命名")
    && !String(body || "").trim()
    && !(materials || []).length;
}
