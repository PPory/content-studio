/**
 * 创作编辑器的**草稿缓冲**：正在写、还没「保存到稿件库」的那一篇。
 *
 * ⚠️ **这是「工作台不用 localStorage 存内容」那条红线的唯一一处有意例外，理由要说清楚。**
 *
 * 红线管的是**内容的家**：批注、笔记、稿子的归宿只能是 vault 或 D1，工作台不许另立一份
 * 数据源。而这里存的东西**还没有家**——它没进稿件库，vault 里也没有它的文件，
 * 关掉弹层的那一刻它在世界上就不存在了。所以它不是「第二真源」，它是**没有真源时的唯一副本**。
 *
 * 三条约束把它和「存内容」隔开，缺一条就真的越线了：
 *   1. **只存一篇**（正在写的那篇），不做草稿列表——一有列表它就成了第二个稿件库。
 *   2. **保存到稿件库成功的那一刻立刻清掉**。内容有家之后，这里必须是空的，
 *      否则同一篇稿子会有两份，而它们迟早不一样。
 *   3. **界面上永远说它是「没保存的草稿」**，不叫「本地草稿箱」。用户不该以为这儿能长期放东西。
 *
 * 写不进去（隐私模式、配额满）不抛异常，返回 0，由界面照实说一句——
 * 悄悄失败的自动保存比没有自动保存更糟。
 */

const KEY = "workbench:creation-draft:v1";

/** 有没有值得留的东西。标题和正文都空 = 没有。 */
export function draftHasContent(draft) {
  return !!(draft && (String(draft.title || "").trim() || String(draft.body || "").trim()));
}

export function loadCreationDraft() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    return draftHasContent(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 存一次，返回存下的时间戳（毫秒）；存不下返回 0。
 *
 * 配额满时**先脱掉素材再试一次**：素材是能重新挑的，正文不是。
 */
export function saveCreationDraft(draft) {
  if (!draftHasContent(draft)) return 0;
  const at = Date.now();
  const payload = { version: 1, savedAt: at, ...draft };
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
    return at;
  } catch {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...payload, materials: [] }));
      return at;
    } catch {
      return 0;
    }
  }
}

export function clearCreationDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 隐私模式下删不了；下次打开顶多多问一句「要不要接着写」 */
  }
}
