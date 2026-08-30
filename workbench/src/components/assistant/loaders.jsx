/**
 * 全站「还在跑」的动态记号，统一从这里出去（和 `icons.jsx` 同一条规矩）。
 *
 * 用 [`thinking-orbs`](https://www.npmjs.com/package/thinking-orbs) 的 `ThinkingOrb`。
 *
 * **三个记号各有明确分工，别混用**——同一个记号在两处表示不同的事，用户就学不会它；
 * 不同记号表示同一件事，也一样。
 *
 *   WaitingMark   composing @64→38  等模型开口。整段回复还没有一个字，是**纯等待**。
 *   RunningMark   working   @20  已经在出东西 / 这段还在跑（流式输出、后台运行中的会话）。
 *   DraftingMark  weaving   @20  正在生成候选。「三股绳编在一起」，对应无中生有一份新稿。
 *
 * ⚠️ **尺寸只有 64 和 20 两档，而且它们是两套独立设计、不是缩放。**
 * 每一档自带各自的点数、点径和速度（库的类型就写死成 `64 | 20`）。
 * 想要 14px 就传 14 的话，TypeScript 层面不合法、视觉上也拿不到它调好的那一版。
 *
 * ⚠️ **所以「要一个 38px 的球」的做法是：按 64 画，用 CSS 显示成 38，不是传 38。**
 * 缩小一块 canvas 是安全的（下采样只会更锐），放大才会糊——
 * 而 20 那一档拉到 38 就是放大，在两行文字旁边糊成一团。
 * 组件的 `style` 是在库自己那份之后展开的，所以外面传 `style.width/height` 压得住。
 * 量过 64 / 44 / 38 / 32 / 20 五档：38 和右边那两行文字差不多高，最稳。
 *
 * ⚠️ **`theme="auto"` 正好对上我们的主题方案**：它先找祖先上的
 * `data-theme="dark|light"`（用 `MutationObserver` 跟着变），找不到再退到
 * `prefers-color-scheme`。两层我们都用得上，所以**不要**手动传 theme 把它钉死。
 *
 * ⚠️ **这里不再依赖 `generative-loaders`。** 那个库带 framer-motion（约 5MB），
 * 而 `thinking-orbs` 零依赖、纯 2D canvas（92KB）。换过来之后两个包一起摘掉了。
 * 之前自绘的 `halo` / `dot-pulse`（`loaders.css`）也一并撤了。
 */
import { ThinkingOrb } from "thinking-orbs";

/**
 * 等模型开口：整段还没有一个字。
 *
 * `size` 是**显示尺寸**；内部一律按 64 那一档画再缩下去，理由见文件头。
 */
export function WaitingMark({ size = 38, style, ...rest }) {
  return <ThinkingOrb state="composing" size={64} style={{ width: size, height: size, ...style }} {...rest} />;
}

/** 已经在出东西，或这段仍在后台跑 */
export function RunningMark(props) {
  return <ThinkingOrb state="working" size={20} {...props} />;
}

/** 正在生成候选 */
export function DraftingMark(props) {
  return <ThinkingOrb state="weaving" size={20} {...props} />;
}
