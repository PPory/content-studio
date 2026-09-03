/**
 * 值班台：四条链此刻各自的下一步。
 *
 * ⚠️ **这四张卡就是原来那排 KPI 卡的位置。**
 * 那四个数（本月发布 / 等你动手 / 可用素材 / 粉丝）本来就分属四条链——
 * `TodayStats` 的注释自己写着这件事。但它们给的是**不动的数字**：
 * 「等你动手 6 件」看完之后，你还是得自己想「那我现在点哪儿」。
 * 同一批东西显示两遍（一遍状态、一遍动作）是在让人读两次再自己合并。
 * 所以这四张卡取代它们，而不是叠在它们上面。
 *
 * ⚠️ **顺序固定，不按紧急程度重排。** 每天在同一个位置看同一条链，
 * 眼睛才不用重新找；按紧急度跳来跳去的话，「知识那条今天怎么样」
 * 每次都要重新扫一遍整块屏幕。
 *
 * ⚠️ **算不出来就说这条链没事。** 和长期议程阈值同一条规矩：
 * 为了填满屏幕硬凑一件待办，比空着更糟——它会让人不再相信这块屏幕。
 */

import { useState } from "react";
import { api } from "../../lib/api.js";
import { IconArrowRight } from "../../components/icons.jsx";

const LANE_ICON_KEY = {
  knowledge: "knowledge", content: "content", intel: "intel", ops: "ops",
};

export function LaneBoard({ data, onGo, onChanged }) {
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState({});
  const [failed, setFailed] = useState({});
  if (!data?.lanes?.length) return null;

  /**
   * 就地做完的那几种。
   *
   * ⚠️ **点一下就办，不是跳过去再找一遍。** 「沉淀成词条」原来只长在
   * 内容 → 创作 → 某个项目 → 发布栏 → 结算卡上，五层深；而这件事本来
   * 只有一个动作、也不需要再挑什么，那就该在你看见它的地方办掉。
   *
   * ⚠️ **它只是排队，不产生词条。** 读出来的词条仍然要在知识那一栏过审核。
   */
  const run = async (lane) => {
    const kind = lane.next?.act;
    if (!kind || busy) return;
    setBusy(lane.key);
    setFailed((current) => ({ ...current, [lane.key]: "" }));
    try {
      if (kind === "distill-learnings") await api.distillLearnings();
      setDone((current) => ({ ...current, [lane.key]: true }));
      onChanged?.();
    } catch (error) {
      setFailed((current) => ({ ...current, [lane.key]: error?.message || "没成功" }));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="lanes" role="region" aria-label="四条链的下一步">
      {data.lanes.map((lane) => {
        const next = lane.next;
        const acts = Boolean(next?.act) && !done[lane.key];
        const go = () => {
          // 排完队之后这张卡改成通往审核那一屏，而不是变成一颗按不动的按钮
          if (next?.act && !done[lane.key]) { run(lane); return; }
          if (next?.act) { onGo("entries", "review"); return; }
          onGo(next ? next.view : laneHome(lane.key), next?.state || "");
        };
        return (
          <button
            key={lane.key}
            type="button"
            className={`lane${lane.quiet ? " lane--quiet" : ""}`}
            onClick={go}
          >
            <span className="lane__head">
              <span className={`lane__mark lane__mark--${LANE_ICON_KEY[lane.key]}`} aria-hidden="true" />
              <span className="lane__label">{lane.label}</span>
            </span>

            {next ? (
              <span className="lane__row">
                <b className="lane__count">{next.count}</b>
                <span className="lane__text">{next.text}</span>
              </span>
            ) : (
              <span className="lane__row lane__row--quiet">现在没事</span>
            )}

            {/* 具体是哪几件。没有它，那个数字没法判断值不值得现在动 */}
            <span className="lane__detail">
              {failed[lane.key] || (done[lane.key] ? "已排进提炼队列，读出来的词条要你过一眼才落库" : "")
                || (next ? next.detail || lane.goal : lane.goal)}
            </span>

            <span className="lane__do">
              {done[lane.key] ? "去审一眼" : busy === lane.key ? "正在排队…" : next ? next.action : "去翻翻"}
              {acts && busy !== lane.key ? null : <IconArrowRight aria-hidden="true" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 没事的时候点进去落在哪儿：这条链的主页面。 */
function laneHome(key) {
  return { knowledge: "entries", content: "bridge", intel: "hot", ops: "review" }[key] || "today";
}
