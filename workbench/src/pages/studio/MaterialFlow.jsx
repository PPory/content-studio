// 素材页的状态筛选：待处理 → 已收纳 → 可用素材 → 已进入项目，外加一道证据闸门。
//
// ⚠️ **这一排本身就是状态筛选器，`FilterBar` 那排状态芯片在素材页不再画。**
// 上一版两者同时在屏幕上：链路里写着「已收纳 8 / 可用素材 14 / 已进入项目 18」，
// 下面一行芯片又写一遍——**同一组数字一屏两份**，而且点哪一份效果完全一样。
//
// ⚠️ **五张大卡撤了，改成一行芯片。别再摆回去。**
//
// 那一版是四格 01/02/03/04 的白卡加一格黄色闸门，每格一个 28px 的大数字，
// 整块吃掉首屏约 150px。它留下来的理由曾经是「芯片说不了**顺序**」——
// 那条理由本身成立，但**真实数据里这条链只有两段活着**：
// 待处理 0、已收纳 0、需核验 0、已归档 0，可用素材 20、已使用 10。
// 也就是**五格里四格常年是 0**，用一张五段流程图去画一条两段的链，画的不是现状是愿景。
//
// 顺序没有丢：芯片**按 `MATERIAL_STAGES` 的先后排**，从左到右读仍然是链的方向；
// 箭头本来就是装饰，而空格子不是。等这条链真的填起来（初筛队列有货、有东西待核验），
// 那几档会自己出现在这一行里——**只画有东西的那几档**，这一条比大卡那版更诚实。
//
// 语汇也跟着统一了：创作页按阶段筛、Wiki 按类型筛、这里按环节筛，
// 现在是同一颗 `.chips-sm` 控件。同一个问题在这个工作台里只有一套长相。

import { MATERIAL_STAGES } from "../../lib/material-workspace.js";

const n = (v) => Number(v || 0);

/** 闸门单拎出来说：它不是链上的一段，是横在链中间的一道闸 */
const GATE = "需核验";

export function MaterialFlow({ counts = {}, active = "", onPick }) {
  const toggle = (key) => onPick(active === key ? "" : key);
  /**
   * ⚠️ **只画有东西的那几档，外加当前选中的那一档。**
   * 选中的必须留着——筛到某一档之后它可能正好是 0 条（搜索词叠加上去时），
   * 这时把那颗芯片抽掉，屏幕上就没有任何东西显示「你正被过滤着」，
   * 而退回全部的路也跟着消失了。
   */
  const stages = MATERIAL_STAGES.filter((stage) => stage !== GATE && (n(counts[stage]) > 0 || active === stage));
  const gate = n(counts[GATE]);

  return (
    <div className="chips chips-sm" aria-label="按素材环节筛选">
      <button className="chip" aria-pressed={!active} onClick={() => onPick("")}>全部 {n(counts.total)}</button>
      {stages.map((stage) => (
        <button key={stage} className="chip" aria-pressed={active === stage} onClick={() => toggle(stage)}>
          {stage} {n(counts[stage])}
        </button>
      ))}
      {/**
        * ⚠️ **闸门只在真有待核验时才画。** 它常年是 0（这个库里核验状态全是「不适用」），
        * 而一颗常年 0 的筛选钮点进去只有一句空态。真有东西要核时它才值得占一个位置。
        */}
      {gate || active === GATE ? (
        <button className="chip" aria-pressed={active === GATE} onClick={() => toggle(GATE)}
          title="金句与数据核对来源后才能进入成稿">
          {GATE} {gate}
        </button>
      ) : null}
    </div>
  );
}
