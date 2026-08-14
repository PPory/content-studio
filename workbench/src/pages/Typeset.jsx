// 公众号排版：把 wechat-typeset 嵌进工作台，不再另开浏览器标签。
//
// **typeset 项目本身一行没改**——它由本地服务静态托管在 `/tools/typeset/`
// （server/routes/tools.mjs），这里只是一个 iframe。它仍然可以双击 index.html 独立使用。
//
// **这一页没有页头。** 别的页面都有「眉标 + 大标题 + 一句说明」的三段式页头，
// 那是给「一屏内容 + 一段解释」的页面设计的；而这一页整个就是一个工具，
// 页头吃掉的 130px 全是工具的操作空间。工具自己的标题栏已经说清了这是什么。
//
// 正文怎么进去：阅读区的「去排版」先把 Markdown 放进剪贴板，跳到这里粘贴。

import { useEffect, useRef, useState } from "react";
import { IconExternalLink, IconRefresh } from "../components/icons.jsx";

/**
 * 排版工具把所有草稿存在**同源 localStorage 的这一个键**里。
 *
 * 所以「重置」不能只是重挂 iframe——重挂之后它照样从这个键里把上次的草稿读回来，
 * 现象就是「点了没反应」。要真的清空，得把这个键删掉再重挂。
 *
 * ⚠️ 只删这一个键，**绝不能 `localStorage.clear()`**：iframe 和工作台同源，
 * 共用一份 localStorage，清全部会把阅读进度、阅读设置、书签一起抹掉。
 */
const TYPESET_KEY = "wechat-typeset";

export function Typeset() {
  const [nonce, setNonce] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [ready, setReady] = useState(false);
  const timer = useRef(null);

  /**
   * **iframe 加载完之前不显示它。**
   *
   * 排版工具的 index.html 里，编辑器（`<main data-view="split">`）是**静态写在 HTML 里**的，
   * 起始页（`<section class="start" hidden>`）默认藏着；它的 JS 跑起来之后才决定给谁看。
   * 于是浏览器会先画一帧编辑器、再被 JS 换成起始页——现象就是「先闪一下排版页面，
   * 再出现这个页面」。这是 iframe 里的 FOUC，不是工作台这边的布局问题。
   *
   * 修法只能在工作台这边：**typeset 项目一行不改**是这个接法的前提（改了它就不再能
   * 双击 index.html 独立使用）。等 `load` 事件——那时它的启动脚本已经跑完、视图已经定了——
   * 再淡入。兜一个 1.2 秒的超时：`load` 万一不来（图片挂了之类），也不能把界面一直藏着。
   */
  useEffect(() => {
    setReady(false);
    const t = setTimeout(() => setReady(true), 1200);
    return () => clearTimeout(t);
  }, [nonce]);

  function reset() {
    try {
      localStorage.removeItem(TYPESET_KEY);
    } catch {
      /* 隐私模式下删不了，重挂 iframe 至少还能刷新 */
    }
    setNonce((n) => n + 1);
    setConfirm(false);
  }

  // 要点两下：这一下会把排版工具里所有草稿删掉，不是刷新页面那么轻
  function ask() {
    setConfirm(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setConfirm(false), 4000);
  }

  return (
    <div className="embed-page">
      {/* 两个动作悬浮在右下角——右上角是工具自己的主操作区（「复制到公众号」在那儿） */}
      <div className="embed-page__acts">
        {confirm ? (
          <button className="btn btn-sm btn-danger" onClick={reset}>清空所有草稿？</button>
        ) : (
          <button className="icon-btn" onClick={ask} title="清空排版工具里的所有草稿并重新加载" aria-label="清空草稿">
            <IconRefresh aria-hidden="true" stroke={1.7} />
          </button>
        )}
        <a className="icon-btn" href="/tools/typeset/" target="_blank" rel="noreferrer" title="在新标签页单独打开" aria-label="在新标签页单独打开">
          <IconExternalLink aria-hidden="true" stroke={1.7} />
        </a>
      </div>

      <div className="embed" data-ready={ready || undefined}>
        <iframe
          key={nonce}
          src="/tools/typeset/"
          title="公众号排版工具"
          onLoad={() => setReady(true)}
          /* 同源，所以不加 sandbox——加了反而会挡掉它自己的剪贴板复制 */
        />
      </div>
    </div>
  );
}
