/**
 * 「正在读取上下文 → 正在组织回答 → 正在等待模型返回」那一行。
 *
 * 取自 transitions.dev 的 *Thinking states*：字上扫过一道微光，换阶段时旧的一行
 * 往上飘走 + 模糊，新的一行从下面进来。
 *
 * ⚠️ **为什么这里值得有动效**（`AGENTS.md`：说不清目的就不加）：
 * 等模型返回是这个界面里**唯一一段用户什么都做不了、又不知道要多久**的时间。
 * 上一版是一行静止的字加一个秒数，十几秒之后它和「卡死了」在屏幕上长得一模一样——
 * 你得盯着秒数变才能确认它还活着。微光让「还在动」这件事不用盯着数字看。
 *
 * ⚠️ **阶段文案和秒数一个字都没改**，它们仍然由 `Working` 按 `startedAt` 真实算出来。
 * 动效只负责表现，不负责编内容——转着圈假装在思考的进度提示是这个项目明确要避免的。
 *
 * ⚠️ **用 keyframes + `key` 重挂，不用原版那套 `classList` 切换。**
 * 原版是命令式加类再撤类；而这一行的父组件**每秒都会重渲染一次**（秒数在跳），
 * React 一重渲染就把 `className` 写回去，手加的 `.is-exit` 当场被抹掉——
 * 现象是「偶尔不动、偶尔动一半」，而且完全不报错。换 `key` 让浏览器重新播一遍动画，
 * 重渲染多少次都不影响。
 */
import { memo, useEffect, useRef, useState } from "react";

export const ThinkingLine = memo(function ThinkingLine({ text, sizer }) {
  const [current, setCurrent] = useState(text);
  const [outgoing, setOutgoing] = useState("");
  const timer = useRef(null);

  useEffect(() => {
    if (text === current) return;
    setOutgoing(current);
    setCurrent(text);
  }, [text, current]);

  // 旧的一行飘完就撤掉。**留着的话它会一直压在新的一行上面**（两者都是绝对定位）
  useEffect(() => {
    if (!outgoing) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOutgoing(""), 400);
    return () => clearTimeout(timer.current);
  }, [outgoing]);

  useEffect(() => () => clearTimeout(timer.current), []);

  /**
   * ⚠️ **定宽那一行必须是「此刻可能显示的所有文本里最长的那句」，不是一句固定文案。**
   *
   * 两行都是绝对定位的，盒子的宽度**只由这个隐藏行撑**。给一句写死的文案时，
   * 只要真实文案比它长——而 `detail` 是模型流里回来的实时阶段，长度不受控——
   * 那一行就会从盒子右边溢出去，**直接压在后面的「· 12s」上**。那就是文字重叠。
   *
   * 所以取三者最长：外面给的基准句、当前这句、正在飞走的那句。
   * 取上「正在飞走的那句」是为了换行的那 150ms 里盒子不抖。
   */
  const sizerText = [sizer, current, outgoing].filter(Boolean).sort((a, b) => b.length - a.length)[0] || "";

  return (
    <span className="t-think" role="status">
      {/* 定宽用的隐藏行。没有它的话，「正在读取上下文」→「正在等待模型返回」
          会把右边的秒数推一下；而它比真实文案短的话，真实文案会压到秒数上。 */}
      <span className="t-think-sizer" aria-hidden="true">{sizerText}</span>
      {outgoing ? (
        <span className="t-think-text t-think-text--out" key={`out:${outgoing}`} data-text={outgoing}>{outgoing}</span>
      ) : null}
      <span className="t-think-text" key={`in:${current}`} data-text={current}>{current}</span>
    </span>
  );
});
