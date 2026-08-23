// 右栏下半：项目素材。**一条一行，不是一张张卡**。
//
// ⚠️ **这里的每一条都要能被插进正文**，所以它必须又短又密：右栏 320px 宽，
// 上一版一条素材是「小标题 + 标题 + 四行摘要 + 一颗按钮」，一屏放不下三条——
// 而这一栏的用处是「扫一眼挑一条」。现在摘要收成两行，按钮跟着 hover 出现。
//
// ⚠️ **「插到光标处」在正文只读时必须禁用而不是消失。**
// 消失的话，待发布那一档打开这一栏会看到一列点不动的素材、而屏幕上没有任何地方
// 说得清为什么——禁用 + `title` 至少把原因摆在那儿。

import { useState } from "react";
import { creationApi } from "../../lib/creation-api.js";
import { IconFileText, IconLoader2, IconPlus, IconSearch, IconSparkles, IconX } from "../../components/icons.jsx";
import { valueIcon, fieldIcon } from "../../components/ui.jsx";

export function ProjectRefs({ materials = [], canInsert, onInsert, onOpenSource, query = "", onAttach, onDetach, busy = false }) {
  /**
   * 「按意思找」的候选。**它们不在库里的关联表上**——只有点过「用这条」的才写进去。
   *
   * ⚠️ **`topic_materials` 的语义是「这篇真的用了它」。** 右栏的计数、归档时的
   * 证据链、复盘时的「有效故事」标记全建立在这个意思上。找到就自动挂等于把
   * 「我用了」偷偷换成「系统猜它相关」——那几处从此都在说假话。
   */
  const [pick, setPick] = useState({ items: [], busy: false, error: null, ran: false, scanned: 0 });

  const attached = new Set(materials.map((m) => m.id));
  const candidates = pick.items.filter((item) => !attached.has(item.id));

  function findRelated() {
    const q = String(query || "").trim();
    if (pick.busy || !q) return;
    setPick((prev) => ({ ...prev, busy: true, error: null }));
    // ⚠️ 字段名照 Worker 那侧的 `pickMaterials`：`want` 不是 `query`。
    //    `exclude` 传已挂上的，省得它把已经在栏里的又挑一遍
    creationApi.pickMaterials({ want: q, exclude: [...attached] })
      .then((r) => setPick({ items: r.items || [], busy: false, error: null, ran: true, scanned: r.scanned || 0 }))
      .catch((err) => setPick((prev) => ({ ...prev, busy: false, error: err, ran: true })));
  }
  return (
    <section className="pmat" aria-label="项目素材">
      <div className="pmat__head">
        <h2 className="section-label">项目素材</h2>
        <span className="pmat__count">{materials.length}</span>
        {/**
          * ⚠️ **「找相关素材」是这一栏的次要动作，收成标题行右上角一枚图标。**
          * 它原来是一颗铺满整栏的按钮，和下面那列素材抢同一份视觉重量——
          * 而你打开这一页十次里有九次是来插素材的，不是来找的。
          */}
        {onAttach ? (
          <button
            type="button"
            className="icon-btn pmat__find-btn"
            onClick={findRelated}
            disabled={pick.busy || !String(query || "").trim()}
            aria-label="找相关素材"
            title={String(query || "").trim() ? "让 AI 通读整库，按意思挑几条" : "还没有可用来找的线索（先写一句核心观点）"}
          >
            {pick.busy ? <IconLoader2 size={14} className="spin" aria-hidden="true" /> : <IconSearch size={14} stroke={1.8} aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      {/**
        * ⚠️ **这句话的意思不能删**（屏幕上只有这一处说明「插入不会自动改写正文」），
        * 但**没必要一直占两行**：一条素材都没有的时候压根没东西可插，
        * 那时它就是纯占位。所以只在真有素材时画，而且收成半句。
        */}
      {materials.length ? <p className="pmat__note">需要哪条，插到光标处——不会自动改写正文。</p> : null}

      {materials.length ? (
        <ul className="pmat__list">
          {materials.map((item) => {
            const Icon = valueIcon(item.type || "", fieldIcon("类型"));
            return (
              <li key={item.id}>
                <span className="pmat__kind"><Icon size={13} stroke={1.8} aria-hidden="true" />{item.type || "素材"}</span>
                <h3 title={item.title}>{item.title}</h3>
                <p>{item.content || "这条素材没有正文。"}</p>
                <div className="pmat__acts">
                  <button
                    type="button"
                    className="pmat__insert"
                    onClick={() => onInsert(item)}
                    disabled={!canInsert || !item.content}
                    title={canInsert ? "插到当前光标处" : "正文此刻是只读的，先退回写作"}
                  >
                    <IconPlus size={13} stroke={1.9} aria-hidden="true" />插到光标处
                  </button>
                  {/**
                    * ⚠️ **「看原文」只在真有来源时才画。**
                    * 初筛把一篇文章拆成原子素材，好处是可复用可核验，代价是**每条素材
                    * 都不带它成立的前提**——而你正在照着它写，最需要前提的就是此刻。
                    * 但手动入库的素材（`/金句` 那类）**本来就没有来源**，
                    * 给它画一个点了没反应的入口，比不给更糟。
                    */}
                  {item.inspirationId && onOpenSource ? (
                    <button
                      type="button"
                      className="pmat__insert"
                      onClick={() => onOpenSource(item.inspirationId)}
                      title="看它是从哪一篇里拆出来的"
                    >
                      <IconFileText size={13} stroke={1.8} aria-hidden="true" />看原文
                    </button>
                  ) : null}
                  {/* ⚠️ **摘掉靠右，离那两个常用动作远一点。**
                      它是破坏性的，夹在「插到光标处」和「看原文」中间等于把它放在最顺手的位置。
                      和种子页那颗删除按钮同一条规矩。 */}
                  {onDetach ? (
                    <button
                      type="button"
                      className="pmat__insert pmat__drop"
                      onClick={() => onDetach(item.id)}
                      disabled={busy}
                      title="从这个项目上摘掉（素材本身还在库里）"
                    >
                      <IconX size={13} stroke={1.8} aria-hidden="true" />摘掉
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/**
        * 「按意思找」补的是关键词搜不到的那一块：搜「成长」时，
        * 那条「复利不是利滚利」正是想要的，只是它一个字都没提「成长」。
        * 整件事在 Worker 那侧做（候选清单是整库素材、LLM 代理也在那儿）。
        *
        * ⚠️ **查询串取的是那句话本身**（种子的 take，没有种子时退回核心观点/标题）——
        * 你要找的是「支持这个判断的依据」，不是「和这个标题字面像的东西」。
        */}
      {/* ⚠️ **没东西可说时整块不画。** 只留一个带上边框的空 div，
          屏幕上就是一条没有内容的分隔线——看着像有什么没加载出来 */}
      {onAttach && (pick.error || pick.ran || candidates.length) ? (
        <div className="pmat__find">
          {pick.error ? <p className="pmat__finderr">{pick.error.message || "没找成"}</p> : null}

          {/* 挑不出来是正常结果，照实说，不要留一个转完圈什么都没有的空白 */}
          {pick.ran && !pick.busy && !pick.error && !candidates.length ? (
            <p className="pmat__findnote">通读完了，库里确实没有更多相关的。</p>
          ) : null}

          {candidates.length ? (
            <ul className="pmat__cands">
              {candidates.map((item) => (
                <li key={item.id}>
                  {/* ⚠️ **AI 挑的要能看出是 AI 挑的**：多一行「为什么是它」。
                      推荐可能牵强，混进已挂上的那批里，人就没法判断该不该信 */}
                  <h3 title={item.title}><IconSparkles size={12} stroke={1.8} aria-hidden="true" />{item.title}</h3>
                  {item.why ? <p className="pmat__why">{item.why}</p> : null}
                  <div className="pmat__acts">
                    <button type="button" className="pmat__insert" disabled={busy} onClick={() => onAttach(item.id)}>
                      <IconPlus size={13} stroke={1.9} aria-hidden="true" />用这条
                    </button>
                    <button type="button" className="pmat__insert" onClick={() => setPick((p) => ({ ...p, items: p.items.filter((x) => x.id !== item.id) }))}>
                      <IconX size={13} stroke={1.8} aria-hidden="true" />不用
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
