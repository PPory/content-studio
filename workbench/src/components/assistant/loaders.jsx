/**
 * 全站「还在跑」的动态记号，统一从这里出去（和 `icons.jsx` 同一条规矩）。
 *
 * **三个记号各有明确分工，别混用**——同一个记号在两处表示不同的事，用户就学不会它；
 * 不同记号表示同一件事，也一样。
 *
 *   WaitingMark   halo       等模型开口。整段回复还没有一个字，是**纯等待**。
 *   RunningMark   dot-pulse  已经在出东西 / 这段还在跑（流式输出、后台运行中的会话）。
 *   DraftingMark  spark      正在生成候选。对应「无中生有一份新稿」，不是「等一个回答」。
 *
 * ⚠️ **`halo` 和 `dot-pulse` 是自己画的**（`loaders.css`），不是库里的变体。
 * `generative-loaders` 已发布的两个版本（0.1.0 / 0.1.1）InlineLoader 变体完全一样，
 * 只有这 14 个，两个都不在里面：
 *   glyph · matrix · orbit · ripple · signal · spark · rotor · pixel-drift ·
 *   chomp · snake · fold · gravity · domino · aperture
 * 换库版本之前先核对这份清单，别照着别处看到的名字直接写。
 *
 * ⚠️ **目前只剩 `DraftingMark` 还用那个库**，而它带着 framer-motion（约 5MB）。
 * 要再省一个依赖的话，从这里下手。
 */
import { InlineLoader } from "generative-loaders";
import "generative-loaders/styles.css";
import "./loaders.css";

/**
 * 等模型开口：整段还没有一个字。
 *
 * 一圈淡底环 + 一段绕着转的亮弧 + 一层呼吸的光晕。形状的取舍写在 `loaders.css` 里。
 * ⚠️ 尺寸只走 `--m-size` 一个入口——内部全是百分比，12px 和 24px 是同一个形状。
 */
export function WaitingMark({ size = 24, ...rest }) {
  return (
    <span
      className="m-mark m-mark--halo"
      style={{ "--m-size": `${size}px`, "--m-ring": `${Math.max(1, Math.round(size * 0.075))}px` }}
      {...rest}
    >
      <span className="m-halo__ring" />
      <span className="m-halo__glow" />
      <span className="m-halo__arc" />
    </span>
  );
}

/** 已经在出东西，或这段仍在后台跑 */
export function RunningMark({ size = 14, ...rest }) {
  return (
    <span className="m-mark m-mark--dots" style={{ "--m-size": `${size}px` }} {...rest}>
      <i /><i /><i />
    </span>
  );
}

/** 正在生成候选 */
export function DraftingMark({ size = 16, ...rest }) {
  return <InlineLoader variant="spark" size={size} {...rest} />;
}
