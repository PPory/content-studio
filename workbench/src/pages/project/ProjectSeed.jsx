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

import { useState } from "react";
import { renderMarkdown } from "../../lib/markdown.js";
import { StatePill } from "../../components/ui.jsx";
import { IconArrowUpRight, IconChevronDown, IconLoader2, IconQuote, IconRefresh } from "../../components/icons.jsx";

export function ProjectSeed({ seed, fetching = false, failedWhy = "", onRetry }) {
  const [open, setOpen] = useState(false);
  if (!seed?.take) return null;
  const title = seed.source?.title || "";
  const url = seed.source?.url || "";
  const excerpt = seed.sourceExcerpt || "";
  // ⚠️ 「抓过但抓不到」和「还没抓过」是两回事，判据是时间戳不是正文空不空
  const tried = !!seed.sourceFetchedAt;

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

      {/**
        * 来源正文**就地展开，不开弹层**。
        *
        * 判据和旁边那一栏是同一条（`ProjectRefs`）：右栏的活儿是「对着正文说话」，
        * **弹层会盖住正文，等于没看**。而一个只有链接的来源意味着跳出去、读完、
        * 再跳回来——跳出去那一刻你就离开写作了。
        */}
      {excerpt ? (
        <div className="pseed__src">
          <button type="button" className="pseed__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <IconChevronDown size={13} stroke={1.8} aria-hidden="true" />
            {open ? "收起原文" : "读原文"}
            <em>{excerpt.replace(/\s/g, "").length} 字</em>
          </button>
          {/* ⚠️ 外来内容只有 `renderMarkdown` 一个出口（消毒在那儿），别在这儿自己 parse */}
          {open ? <div className="pseed__body prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(excerpt) }} /> : null}
        </div>
      ) : fetching ? (
        <p className="pseed__wait"><IconLoader2 size={13} className="spin" aria-hidden="true" />正在把原文取回来…</p>
      ) : tried ? (
        /**
         * ⚠️ **抓不到要照实说，绝不能装作抓到了。**
         * 公众号 / 知乎 / 小红书 / 抖音 / B站都要浏览器（`whyNot` 那份名单），
         * 这类占的比例不小。`junkReason` 那条教训：让用户读一屏由界面文案拼成的
         * 「正文」，比直接说抓不到糟得多。原链接一直留着。
         */
        <p className="pseed__wait pseed__wait--bad">
          没取到原文。
          {failedWhy ? <span>{failedWhy}</span> : null}
          {onRetry ? (
            <button type="button" className="link-btn" onClick={onRetry}>
              <IconRefresh size={12} stroke={1.7} aria-hidden="true" />再试一次
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
