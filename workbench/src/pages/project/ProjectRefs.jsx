// 右栏下半：项目素材。**一条一行，不是一张张卡**。
//
// ⚠️ **这里的每一条都要能被插进正文**，所以它必须又短又密：右栏 320px 宽，
// 上一版一条素材是「小标题 + 标题 + 四行摘要 + 一颗按钮」，一屏放不下三条——
// 而这一栏的用处是「扫一眼挑一条」。现在摘要收成两行，按钮跟着 hover 出现。
//
// ⚠️ **「插到光标处」在正文只读时必须禁用而不是消失。**
// 消失的话，待发布那一档打开这一栏会看到一列点不动的素材、而屏幕上没有任何地方
// 说得清为什么——禁用 + `title` 至少把原因摆在那儿。

import { IconFileText, IconPlus, IconRefresh } from "../../components/icons.jsx";
import { valueIcon, fieldIcon } from "../../components/ui.jsx";

export function ProjectRefs({ materials = [], canInsert, onInsert, onReload, loading, onOpenSource }) {
  return (
    <section className="pmat" aria-label="项目素材">
      <div className="pmat__head">
        <h2 className="section-label">项目素材</h2>
        <span className="pmat__count">{materials.length}</span>
      </div>
      {/* ⚠️ 这句不能删：它是屏幕上唯一说明「插入不会自动改写正文」的地方 */}
      <p className="pmat__note">素材不会自动改写正文。需要哪条，插到当前光标处。</p>

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
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="pmat__empty">这个项目还没有关联素材。</div>
      )}

      <button type="button" className="pmat__reload" onClick={onReload} disabled={loading}>
        <IconRefresh size={13} stroke={1.7} aria-hidden="true" />重新读取项目
      </button>
    </section>
  );
}
