/**
 * 值班台：四条链此刻各自的下一步。
 *
 * ⚠️ **这一页原来只读 projects**，也就是只覆盖内容和运营两条链。
 * 知识和情报完全不在里面——于是每天早上还是得挨个点进七栏，看哪儿有活。
 *
 * ⚠️ **顺序固定，不按紧急程度重排。** 每天在同一个位置看同一条链，
 * 眼睛才不用重新找；按紧急度跳来跳去的话，「知识那条今天怎么样」这个问题
 * 每次都要重新扫一遍整块屏幕。
 *
 * ⚠️ **算不出来就说这条链没事。** 和长期议程阈值同一条规矩：
 * 为了填满屏幕硬凑一件待办，比空着更糟——它会让人不再相信这块屏幕。
 */

import { IconArrowRight } from "../../components/icons.jsx";

export function LaneBoard({ data, onGo }) {
  if (!data?.lanes?.length) return null;

  return (
    <section className="lane-board" aria-label="四条链的下一步">
      {data.lanes.map((lane) => {
        const next = lane.next;
        return (
          <div key={lane.key} className={`lane${lane.quiet ? " lane--quiet" : ""}`}>
            <span className={`lane__mark lane__mark--${lane.key}`} aria-hidden="true" />
            <span className="lane__name">{lane.label}</span>

            <span className="lane__body">
              {next ? (
                <>
                  <span className="lane__next">
                    <b>{next.count}</b> {next.text}
                  </span>
                  {/* 具体是哪几件。没有它，那个数字没法判断值不值得现在动 */}
                  {next.detail ? <span className="lane__detail">{next.detail}</span> : null}
                </>
              ) : (
                <>
                  <span className="lane__next">这条链现在没事</span>
                  <span className="lane__detail">{lane.goal}</span>
                </>
              )}
            </span>

            {/* ⚠️ 点进去落到**那件事**上，不是那个库 */}
            <button
              type="button"
              className="lane__do"
              onClick={() => onGo(next ? next.view : laneHome(lane.key), next?.state || "")}
            >
              {next ? next.action : "去翻翻"}
              <IconArrowRight aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </section>
  );
}

/** 没事的时候点进去落在哪儿：这条链的主页面。 */
function laneHome(key) {
  return { knowledge: "entries", content: "bridge", intel: "hot", ops: "review" }[key] || "today";
}
