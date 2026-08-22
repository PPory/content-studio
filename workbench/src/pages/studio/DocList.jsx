// 列表区：加载中 / 目录不存在 / 看板或卡片墙 / 加载更多 / 空态。
// 从 `pages/Studio.jsx` 的 return 里原样外提，JSX 一字未动（只去掉了整体缩进）。
//
// **四种状态是一串三元而不是提前 return**：搬出来时一个字符都没改，
// 想改写成 if/else 也行，但那就不是「搬」而是「改」了，得单独一个提交。
import { Board } from "../../components/Board.jsx";
import { Empty, ErrorNote, Loading } from "../../components/ui.jsx";
import { IconBulb } from "../../components/icons.jsx";
import { DocRow, isSpec } from "./DocRow.jsx";
import { stateIcon, stateTone } from "../../components/ui.jsx";
import { SourceSetup } from "./SourceSetup.jsx";

/**
 * props **沿用页面里原来的变量名**（`openItem` / `changeStatus` / `removeItem` /
 * `loadMore`），不改成 `onOpen` / `onMove` 那套更像组件 API 的名字。
 * 理由是这一步的性质：**搬，不改。** 名字一改，JSX body 就得跟着动，
 * 「和搬之前一字不差」这个可以机械验证的保证就没了。要改名另开一个提交。
 */
export function DocList({ list, listError, source, shown, layout, canBoard, query, state, loadingMore, openItem, changeStatus, removeItem, loadMore }) {
  return (
    <>
    <ErrorNote error={listError} what="加载列表" />

    {!list && !listError ? (
      <Loading rows={4} />
    ) : list && list.exists === false ? (
      <SourceSetup source={source} dir={list.dir} />
    ) : shown.length ? (
      <>
        {layout === "board" && canBoard ? (
          <Board
            states={source.states}
            quietStates={source.quietStates}
            items={shown}
            onOpen={openItem}
            onMove={changeStatus}
            dangerState={source.askPlatformsOn}
          />
        ) : (
          /**
            * ⚠️ **右侧那几列的宽度按整份列表算一次，不按每行各算各的。**
            * 上一版右端是个右对齐的 flex 簇（去向 / 类别 / 标签 / 时间），
            * 每行内容长短不同，于是同一列的东西在每行落在不同的横坐标——
            * 素材页那一列尤其明显（「来源 → 尚未拆成素材」比「来源 1」宽一倍）。
            * 一列扫下去看着是锯齿，而这一层的全部价值就是「一眼扫十几条」。
            *
            * ⚠️ **判据是「这份列表里有没有」，不是「这一行有没有」。** 按行判的话，
            * 没有去向的那几行会把类别挪进去向那一列——那正是要治的锯齿。
            * 按列表判的话，选题库、稿件库这些压根没有去向的源也不会白占一列。
            */
          <div className="doc-rows" data-cols={metaCols(shown)}>
            {groupByState(shown, source.states).map((g) => (
              <section key={g.state || "__none"}>
                {g.state ? <StateBand state={g.state} count={g.items.length} /> : null}
                {g.items.map((item) => (
                  <DocRow
                    key={item.key}
                    item={item}
                    onOpen={() => openItem(item)}
                    onDelete={source.remove ? () => removeItem(item) : null}
                    removeLabel={source.removeLabel}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
        {list.nextCursor ? (
          <button className="btn btn-sm btn-block" style={{ marginTop: 16 }} onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "加载中…" : "加载更多"}
          </button>
        ) : null}
      </>
    ) : list ? (
      <Empty icon={IconBulb}>
        {query ? `没有匹配「${query}」的条目` : state ? `没有「${state}」的条目` : source.emptyHint}
      </Empty>
    ) : null}
    </>
  );
}

/**
 * 右侧那几列画哪些。**按整份列表算一次**，理由见调用处那段注释。
 * 时间列永远在，所以不进这个串——它是唯一一个每条都有的。
 */
function metaCols(items = []) {
  const has = (fn) => (items.some(fn) ? 1 : 0);
  return [
    has((i) => i.trace) && "trace",
    has((i) => i.kindLabel) && "kind",
    has((i) => (i.tags || []).some((t) => !isSpec(t))) && "tag",
  ].filter(Boolean).join(" ") || "none";
}

/**
 * 按状态分组。⚠️ **只在真有两组以上时才分**——已经筛到单一状态时（进选题库默认落在
 * 「待写」就是这种情况），全列同一个状态，加一条色带等于在屏幕上重复一遍筛选条已经说过的话。
 *
 * **顺序跟适配器的 `states`，不跟数据里出现的先后。** 那份数组就是状态机的顺序
 *（待写 → 撰写中 → 已成稿 → 已发布 → 搁置），照它排，列表从上往下读就是「东西往前走」的方向；
 * 按出现顺序排的话，同一个库每次刷新分组次序都可能不一样。
 * `states` 里没有的值兜到最后，不丢条目。
 */
function groupByState(items, states = []) {
  const seen = new Map();
  for (const it of items) {
    const k = it.badge || "";
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(it);
  }
  if (seen.size <= 1) return [{ state: "", items }];
  const order = [...states, ...[...seen.keys()].filter((k) => !states.includes(k))];
  return order.filter((k) => seen.has(k)).map((k) => ({ state: k, items: seen.get(k) }));
}

/**
 * 分组头。⚠️ **底色是这个状态自己的颜色 @8%**，不是一个统一的灰条——
 * 颜色在这里不装饰任何东西，它**就是状态本身**，和行首那枚图标同一个色调。
 * 形状（图标）仍然把话说完了，色带只是让一列扫得更快。
 */
function StateBand({ state, count }) {
  const Icon = stateIcon(state);
  const tone = stateTone(state);
  return (
    <div className="doc-band" data-tone={tone}>
      <Icon aria-hidden="true" size={15} stroke={1.8} data-tone={tone} />
      <span className="doc-band__name">{state}</span>
      <span className="doc-band__count">{count}</span>
    </div>
  );
}
