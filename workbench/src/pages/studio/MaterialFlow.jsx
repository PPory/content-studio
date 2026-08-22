// 素材链路：待处理 → 已收纳 → 可用素材 → 已进入项目，外加一道证据闸门。
//
// ⚠️ **这一排本身就是状态筛选器，`FilterBar` 那排状态芯片在素材页不再画。**
// 上一版两者同时在屏幕上：链路里写着「已收纳 8 / 可用素材 14 / 已进入项目 18」，
// 下面一行芯片又写一遍「已收纳 8 / 可用素材 14 / 已使用 18」——**同一组数字一屏两份**，
// 而且点哪一份效果完全一样。留下这一份是因为它多说了一件芯片说不了的事：**顺序**。
//
// ⚠️ **左边那栏「一素材，只沿一条链往前走 + 一段说明」撤了。**
// 那句话和页头那句 `sub`（「收进来的内容、提炼出的观点……都沿着同一条链查看和处理」）
// 是同一个意思，等于把这一页的主张在一屏里印两遍，而它占的是整块最左边、最先被读到的
// 一栏。宣言不是数据——这一栏现在归数字。
//
// ⚠️ **闸门那格保持黄（`--mark-yellow`）。** 标记黄的意思是「我圈中的」，
// 闸门是「等你核对」，语义对得上；而它旁边四格是纯白的，黄一出现就知道这格不一样。

import { IconChevronRight, IconShieldCheck } from "../../components/icons.jsx";

const steps = [
  { key: "待处理", number: "01", label: "待处理来源", hint: "需要判断是否值得留下" },
  { key: "已收纳", number: "02", label: "已收纳", hint: "来源已保存，等待后续使用" },
  { key: "可用素材", number: "03", label: "可用素材", hint: "可以带进下一篇内容" },
  { key: "已使用", number: "04", label: "已进入项目", hint: "已经形成选题或稿件关系" },
];

const n = (v) => Number(v || 0);

export function MaterialFlow({ counts = {}, active = "", onPick }) {
  const toggle = (key) => onPick(active === key ? "" : key);
  const archived = n(counts.已归档);

  return (
    <section className="mflow" aria-label="素材链路">
      <div className="mflow__head">
        <h2 className="section-label">素材链路</h2>
        <div className="mflow__end">
          {/**
            * ⚠️ **「全部」这颗不能省。** 筛到某一段之后，退回全部的唯一办法本来是
            * **再点一次那一格**——那是个没人猜得到的动作，而屏幕上看不出正被过滤。
            */}
          <button type="button" className="mflow__all" aria-pressed={!active} onClick={() => onPick("")}>
            全部 {n(counts.total)}
          </button>
          {/**
            * ⚠️ **「已归档」只在真有东西时才画。** 它不在这条链上（是从链上撤下来的），
            * 常年是 0；给一个恒为 0 的落点，点进去只能看到一句空态。
            */}
          {archived ? (
            <button type="button" className="mflow__quiet" aria-pressed={active === "已归档"} onClick={() => toggle("已归档")}>
              已归档 {archived}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mflow__body">
        <ol className="mflow__steps">
          {steps.map((step, i) => (
            <li key={step.key}>
              <button type="button" aria-pressed={active === step.key} onClick={() => toggle(step.key)}>
                <span className="mflow__num">{step.number}</span>
                <b className="mflow__count">{n(counts[step.key])}</b>
                <strong>{step.label}</strong>
                <small>{step.hint}</small>
              </button>
              {/* 箭头落在两格中间的空隙里，不占格子自己的宽度 */}
              {i < steps.length - 1 ? <IconChevronRight className="mflow__arrow" size={16} stroke={2} aria-hidden="true" /> : null}
            </li>
          ))}
        </ol>

        <button
          type="button"
          className="mflow__gate"
          aria-pressed={active === "需核验"}
          onClick={() => toggle("需核验")}
        >
          <span className="mflow__num">
            <IconShieldCheck size={15} stroke={1.8} aria-hidden="true" />
            证据闸门
          </span>
          <b className="mflow__count">{n(counts.需核验)}</b>
          <strong>条待核验</strong>
          <small>金句与数据核对来源后才能进入成稿</small>
        </button>
      </div>
    </section>
  );
}
