// 一张选题卡。**三条来源（洞察 / 素材 / 争点）共用这一张。**
//
// ⚠️ **卡上只有一个动作：「记成种子」。**
// 不给「直接建项目」那条捷径——种子要求你补一句 take，而那正是这个产品的核心：
// 「不知道自己能加什么」的答案只存在你脑子里，除非有人问你。
//
// ⚠️ **展开不发任何请求。** 卡片在「出候选的那一刻」就写好了——这正是那次
// 重做的全部意义。哪天这儿开始点开才去算，说明那个设计被绕回去了。

import { useState } from "react";
import { IconChevronDown, IconPlus } from "./icons.jsx";

/** 卡上那几项的显示顺序和名字。⚠️ 真源是 Worker 的 `CARD_FIELDS`，这儿只管怎么显示。 */
const ROWS = [
  ["audience", "给谁看"],
  ["pain", "他卡在哪"],
  ["why", "为什么值得你写"],
];

export function IdeaCard({ card, source, tags = [], onSeed, busy }) {
  const [open, setOpen] = useState(false);
  if (!card?.angle) return null;

  const mats = card.materials || [];
  // 展开后真有东西可看才画那颗按钮——否则点开是一片空白，比不给按钮更糟
  const hasMore = ROWS.some(([k]) => card[k]) || mats.length || card.form || card.effort;

  return (
    <article className="idea" data-open={open || undefined}>
      <h3 className="idea__angle">{card.angle}</h3>

      <div className="idea__foot">
        {source ? <span className="idea__src">{source}</span> : null}
        {/* 状态照实标出来（能写了 / 还要查资料 / 多少分），**不替你过滤** */}
        {tags.map((t) => <span key={t.label} className="idea__tag" data-tone={t.tone || undefined}>{t.label}</span>)}
        {/* 手上有几条素材是**判断能不能写的第一眼依据**，所以收起态就要看得见 */}
        {mats.length ? <span className="idea__tag">{mats.length} 条素材能用</span> : null}
        {card.effort ? <span className="idea__tag">{card.effort}</span> : null}

        {hasMore ? (
          <button type="button" className="idea__more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <IconChevronDown size={13} stroke={1.8} aria-hidden="true" />{open ? "收起" : "展开"}
          </button>
        ) : null}
        <button className="btn btn-sm idea__seed" onClick={onSeed} disabled={busy}>
          <IconPlus size={13} stroke={1.9} aria-hidden="true" />记成种子
        </button>
      </div>

      {open ? (
        <dl className="idea__detail">
          {ROWS.map(([key, label]) => (card[key] ? (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{card[key]}</dd>
            </div>
          ) : null))}

          {mats.length ? (
            <div>
              <dt>能用的素材</dt>
              <dd>
                {/* ⚠️ 这几条**都是库里真有的**（Worker 那侧过滤过编造的 id）——
                    「用在哪」是它们和这个角度的关系，不是复述素材内容 */}
                <ul className="idea__mats">
                  {mats.map((m) => (
                    <li key={m.id}>
                      <b>{m.title}</b>
                      {m.use ? <span>{m.use}</span> : null}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}

          {card.form ? (
            <div>
              <dt>写成什么</dt>
              <dd>{card.form}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </article>
  );
}
