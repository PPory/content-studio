// 右栏最上面：**这一篇是从哪句话来的**。
//
// 用户原话：「我要写这个，那这里只有我填的那句话，也没看到来源内容」。
// 种子 = 你看到的东西 + 你对它的一句话（`docs/工作流.md`），
// 而你之所以要写这一篇，理由全在那句话里——它不该在你点了「写这个」之后就消失。
//
// ⚠️ **没有种子的项目整块不画**，不是画一个写着「无来源」的空壳。
// 每一页上都重复一句零信息的话，等于把右栏最值钱的位置让给了噪音。
//
// ⚠️ **数据从 Worker 反查来（`seeds.draft_id`），不靠前端交接。**
// 交接条是一次性的，而你写到一半刷新是常事——刷完来源就没了，
// 而那正是你最需要再看它一眼的时候。

import { StatePill } from "../../components/ui.jsx";
import { IconArrowUpRight, IconQuote } from "../../components/icons.jsx";

export function ProjectSeed({ seed }) {
  if (!seed?.take) return null;
  const title = seed.source?.title || "";
  const url = seed.source?.url || "";

  return (
    <section className="pseed" aria-label="这一篇的来源">
      <div className="pmat__head">
        <h2 className="section-label">从这句话开始</h2>
      </div>

      {/* 你那句话是主角：写不下去的时候，回来读的就是它 */}
      <blockquote className="pseed__take">
        <IconQuote size={13} stroke={1.8} aria-hidden="true" />
        {seed.take}
      </blockquote>

      <div className="pseed__meta">
        {/* ⚠️ 反应可以为空——那时不画这颗 pill，而不是画一个「未分类」 */}
        {seed.reaction ? <StatePill state={seed.reaction} /> : null}
        {title ? (
          url ? (
            <a className="pseed__from" href={url} target="_blank" rel="noreferrer" title={title}>
              {title}
              <IconArrowUpRight size={12} stroke={1.8} aria-hidden="true" />
            </a>
          ) : <span className="pseed__from">{title}</span>
        ) : (
          // 「自己想到的」不是缺了来源，是**另一种来源**——那类往往是你最有话说的
          <span className="pseed__from pseed__from--own">自己想到的</span>
        )}
      </div>
    </section>
  );
}
