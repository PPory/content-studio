import { useCallback, useState } from "react";

/**
 * 「这一页我要看卡片还是列表」。
 *
 * ⚠️ **它是显示偏好，不是筛选。** 筛选回答「这一页现在看哪一部分」（那颗胶囊，
 * `ui.jsx` 的 `ViewTabs`）；这个回答「同样这些东西怎么摆」。两件事不能长成一个样，
 * 也不该混进同一排控件里——判据和 `docs/design-system.md`「筛选器不借用状态的语义色」同一类。
 *
 * ⚠️ **存 localStorage，而且每页各存一份。** 这是「这台机器上这个人怎么用」的偏好，
 * 和侧栏收起状态同一类，不是知识，不进工作区数据库（那条红线管的是内容）。
 * 分页存是因为这两页的任务不一样：今日精选是**逐条判断**，卡片好扫；
 * 选题空间十几条时**列表**更快找到那一条。它们不该被同一个开关绑住。
 *
 * ⚠️ **不进备份**（`api.js` 的 `BACKED_UP_LOCAL_KEYS` 不动）：它是可再生的偏好，
 * 丢了最多是下次打开回到卡片。
 *
 * 读写都包 try/catch：隐私模式下 `localStorage` 直接抛，而这颗开关坏掉不该让整页白屏。
 */
const KEY = (page) => `workbench:layout:${page}`;

export function useLayoutMode(page, fallback = "card") {
  const [mode, setMode] = useState(() => {
    try {
      const saved = localStorage.getItem(KEY(page));
      return saved === "list" || saved === "card" ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  const choose = useCallback((next) => {
    setMode(next);
    try {
      localStorage.setItem(KEY(page), next);
    } catch {
      /* 记不住就算了，这一次的选择仍然生效 */
    }
  }, [page]);
  return [mode, choose];
}
