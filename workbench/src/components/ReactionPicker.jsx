// 选一种反应 + 补半句话 = 一颗种子。
//
// ⚠️ **这个组件是热点页和种子页共用的一份，别写第二个。** 两处的动作完全一样
//（选一种反应、补上后半句），只有触发物不同。这个项目的事故清一色是
//「同一件事写在两个地方」。
//
// **它真正的价值不是分类，是把你脑子里的东西问出来。**「不知道自己能加什么」的答案
// 几乎总是你自己的经历和判断，而它只存在你脑子里，除非有人问你。
// 一旦补上「我不同意，因为___」，一篇短文的骨架当场就有了。

import { Fragment, useEffect, useRef, useState } from "react";
import { IconLoader2, IconX } from "./icons.jsx";
import { useDialog } from "../lib/use-dialog.js";

export function ReactionPicker({ open, groups = [], source, busy, error, onClose, onSave }) {
  /**
   * ⚠️ **扁平这份只用来算快捷键序号，画的是分组那份。**
   * 分组不是装饰：第一版七条**全都假设触发物是「一个观点」**，于是
   * 「DeepSeek 发布了 V4-Flash，我想写」一条都选不上——你没法「同意」一件事实。
   * 补上事件那一组之后有十条，平铺的话每次都得从头扫到尾；
   * 分了组，看到一条新闻只会看中间那三条。
   */
  const flat = groups.flatMap((g) => g.items || []);
  const [reaction, setReaction] = useState("");
  const [take, setTake] = useState("");
  const areaRef = useRef(null);
  // 弹层的键盘规矩只有一份（焦点进来、Tab 循环、背景 inert、Esc 关闭、关掉焦点归位）。
  // ⚠️ 它**返回** ref，挂到弹层外壳上，不是接一个进去
  const ref = useDialog(open, busy ? undefined : onClose);

  useEffect(() => {
    if (!open) return;
    setReaction("");
    setTake("");
  }, [open, source?.url, source?.title]);

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
      // 1–9 是前九条，`0` 给第十条——数字键盘上就这个顺序
      if (!/^[0-9]$/.test(event.key)) return;
      const index = event.key === "0" ? 9 : Number(event.key) - 1;
      if (!flat[index]) return;
      event.preventDefault();
      setReaction(flat[index]);
      areaRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, flat.join("")]);

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
        <div className="rpick__list" role="group" aria-label="你对它是什么反应">
          {groups.map((group) => (
            <Fragment key={group.label}>
              {/* 组名是**标签不是选项**：它告诉你「这一组是对着什么说的」，点不动 */}
              <p className="rpick__group">{group.label}</p>
              {(group.items || []).map((item) => {
                const index = flat.indexOf(item);
                return (
                  <button
                    key={item}
                    type="button"
                    className="rpick__opt"
                    aria-pressed={reaction === item}
                    onClick={() => { setReaction(reaction === item ? "" : item); areaRef.current?.focus(); }}
                  >
                    {/* 第十条的键是 `0`；超过十条就不给键了，硬编下去只会给出按不出的提示 */}
                    <kbd aria-hidden="true">{index < 9 ? index + 1 : index === 9 ? 0 : ""}</kbd>
                    {item}
                  </button>
                );
              })}
            </Fragment>
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
