import { useEffect, useState } from "react";

/**
 * 带撤销的回执条状态。
 *
 * ⚠️ **删除一律要给这条。** 这个工作台的删除全是软删除（`entities.deleted_at`），
 * 而界面上**没有回收站页面**——所以「点错了怎么办」的唯一答案就是这条回执上的
 *「撤销」。书架那句话说得最准：**点错一下的成本应该是再点一下，不是打开备份翻废纸篓。**
 *
 * ⚠️ **带撤销的多留一会儿：8 秒。** 2 秒只够看见有东西闪过；8 秒是「读完一句话再决定」
 * 需要的时间。不带撤销的纯回执 5 秒就够。这两个数原来写在 `Shelf.jsx` 里，
 * 现在四个地方都要用同一套——抄四份的话某一处改了别处不会跟着变，而且不会报错。
 *
 * 用法：
 * ```js
 * const [toast, setToast] = useUndoToast();
 * setToast({ text: "《书名》已移入回收站", undo: async () => { await api.restoreX(id); reload(); } });
 * // 渲染：<Toast text={toast?.text} onUndo={toast?.undo} onClose={() => setToast(null)} />
 * ```
 */
/**
 * 跨一次跳转交接这条回执。
 *
 * 在**详情页**删掉一条之后，界面会把你送回列表——而回执该出现在你被送到的
 * 那一页上，不是在正在卸载的这一页上。走一个一次性的交接变量，和
 * `lib/open-target.js`（「跳过去，并且把这一条打开」）同一套办法，约束也一样：
 * **一次性**（取完即清，否则那一页每次刷新列表都会把它再弹一遍）、
 * **不进 localStorage**（它的寿命就是这一次跳转）。
 */
let handoff = null;
export function handOffUndo(notice) { handoff = notice; }

export function useUndoToast() {
  const [toast, setToast] = useState(null); // { text, detail?, undo? }
  // 挂载时取一次上一页交接过来的回执。取完即清。
  useEffect(() => {
    if (!handoff) return;
    setToast(handoff);
    handoff = null;
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), toast.undo ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  return [toast, setToast];
}
