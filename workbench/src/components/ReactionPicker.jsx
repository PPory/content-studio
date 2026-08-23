// 选一种反应 + 补半句话 = 一颗种子。
//
// ⚠️ **这个组件是热点页和种子页共用的一份，别写第二个。** 两处的动作完全一样
//（选一种反应、补上后半句），只有触发物不同。这个项目的事故清一色是
//「同一件事写在两个地方」。
//
// **它真正的价值不是分类，是把你脑子里的东西问出来。**「不知道自己能加什么」的答案
// 几乎总是你自己的经历和判断，而它只存在你脑子里，除非有人问你。
// 一旦补上「我不同意，因为___」，一篇短文的骨架当场就有了。

import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconX } from "./icons.jsx";
import { useDialog } from "../lib/use-dialog.js";

export function ReactionPicker({ open, groups = [], source, prefill = "", busy, error, onClose, onSave }) {
  /**
   * ⚠️ **十条分三个 tab，不再一长条平铺。**
   * 平铺那一版整屏被十个按钮占满，输入框被挤到屏幕最下面——而**要你打的那句话
   * 才是这一屏的主角**，反应清单只是帮你起头的提示。
   *
   * 分组本来就在（`SEED_REACTION_GROUPS`），tab 只是把它画成一次看一组：
   * 你对着一条新闻时，「对着一个观点」那五条根本不该占地方。
   */
  const [tab, setTab] = useState(0);
  /**
   * ⚠️ **扁平这份只用来算快捷键序号，画的是分组那份。**
   * 分组不是装饰：第一版七条**全都假设触发物是「一个观点」**，于是
   * 「DeepSeek 发布了 V4-Flash，我想写」一条都选不上——你没法「同意」一件事实。
   * 补上事件那一组之后有十条，平铺的话每次都得从头扫到尾；
   * 分了组，看到一条新闻只会看中间那三条。
   */
  const group = groups[Math.min(tab, Math.max(groups.length - 1, 0))] || { items: [] };
  const shown = group.items || [];
  const [reaction, setReaction] = useState("");
  const [take, setTake] = useState("");
  const areaRef = useRef(null);
  // 弹层的键盘规矩只有一份（焦点进来、Tab 循环、背景 inert、Esc 关闭、关掉焦点归位）。
  // ⚠️ 它**返回** ref，挂到弹层外壳上，不是接一个进去
  const ref = useDialog(open, busy ? undefined : onClose);

  useEffect(() => {
    if (!open) return;
    setReaction("");
    setTab(0);
    /**
     * ⚠️ **从候选进来时预填那条角度。**
     * 使用者说「暂时没想法但觉得可以写，应该可以直接记」——而候选卡的角度
     * **本身就是一句判断**，直接当 take 用。**规则一个字没松**
     *（种子仍然必须有一句话），只是不用你从零打字。
     * 手动「记一句」那条不传 `prefill`，仍然要自己写——那儿没有别的东西可用。
     */
    setTake(prefill || "");
  }, [open, source?.url, source?.title, prefill]);

  /**
   * ⚠️ **数字键只在没聚焦到输入框时才认。**
   * 和创作弹层那条同一个规矩：裸键在输入框里绝不能触发，否则你打「1」会跳去选反应。
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;
      // ⚠️ **数字键只认当前 tab 里的那几条**：分了 tab 之后「第 7 条」这个说法
      //    在屏幕上不存在了，而键号必须和你看得见的那个数字对上
      if (!/^[1-9]$/.test(event.key)) return;
      const index = Number(event.key) - 1;
      if (!shown[index]) return;
      event.preventDefault();
      setReaction(shown[index]);
      areaRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, shown.join("")]);

  if (!open) return null;

  const ready = take.trim().length > 0;

  return (
    <div className="scrim scrim--center" role="presentation">
      <div className="rpick" role="dialog" aria-modal="true" aria-label="记下你的看法" ref={ref}>
        <header className="rpick__head">
          <div className="rpick__source">
            {/* 触发物摆在最上面：你要对着它说话，它不能在你打字时消失 */}
            {source?.title ? <b title={source.title}>{source.title}</b> : <b>随手记一句</b>}
            {source?.url ? (
              <a href={source.url} target="_blank" rel="noreferrer">看原文</a>
            ) : (
              <span>没有触发物——干活时想到的那类，往往是你最有话说的</span>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><IconX size={16} stroke={1.8} /></button>
        </header>

        {/**
          * ⚠️ **组名和条目的文案全从 Worker 来，前端一个字都不写死。**
          * 抄一份的话，那边改了措辞这边还是老的，而且**不报错**。
          */}
        {/* 组名从标签变成 tab：一次只看一组，而不是让十条一起占屏 */}
        <div className="rpick__tabs" role="tablist" aria-label="这条是对着什么说的">
          {groups.map((g, i) => (
            <button
              key={g.label}
              type="button"
              role="tab"
              className="rpick__tab"
              aria-selected={i === tab}
              onClick={() => setTab(i)}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="rpick__list" role="group" aria-label="你对它是什么反应">
          {shown.map((item, index) => (
            <button
              key={item}
              type="button"
              className="rpick__opt"
              aria-pressed={reaction === item}
              onClick={() => { setReaction(reaction === item ? "" : item); areaRef.current?.focus(); }}
            >
              <kbd aria-hidden="true">{index + 1}</kbd>
              {item}
            </button>
          ))}
        </div>

        <textarea
          ref={areaRef}
          className="rpick__take"
          rows={3}
          value={take}
          onChange={(e) => setTake(e.target.value)}
          placeholder={reaction ? `${reaction.replace(/[…，]$/, "")}……接着说` : "你的看法。一句话就够"}
          aria-label="你的看法"
          data-autofocus=""
        />

        {error ? <p className="rpick__err" role="alert">{error}</p> : null}

        <footer className="rpick__foot">
          {/**
            * ⚠️ **`take` 空着时保存点不动，而且要写出原因。**
            * 一颗灰按钮自己说不了话；而这一条有明确的理由——没有那句话它就只是又一条收藏，
            * 而收藏那条路已经有了。
            */}
          <span className="rpick__hint">
            {ready ? "反应可以不选——有话说但不属于清单里那几种时，硬塞一个分类更糟" : "写一句你的看法才算一颗种子，只有链接的话用「收集」就够了"}
          </span>
          <button
            className="btn btn-primary"
            disabled={!ready || busy}
            title={ready ? undefined : "先写一句你的看法"}
            onClick={() => onSave({ reaction, take: take.trim() })}
          >
            {busy ? <IconLoader2 className="spin" aria-hidden="true" /> : null}记下来
          </button>
        </footer>
      </div>
    </div>
  );
}
