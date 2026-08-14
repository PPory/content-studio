// 列表区：加载中 / 目录不存在 / 看板或卡片墙 / 加载更多 / 空态。
// 从 `pages/Studio.jsx` 的 return 里原样外提，JSX 一字未动（只去掉了整体缩进）。
//
// **四种状态是一串三元而不是提前 return**：搬出来时一个字符都没改，
// 想改写成 if/else 也行，但那就不是「搬」而是「改」了，得单独一个提交。
import { Board } from "../../components/Board.jsx";
import { Empty, ErrorNote, Loading } from "../../components/ui.jsx";
import { IconBulb } from "../../components/icons.jsx";
import { DocCard } from "./DocCard.jsx";
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
          <div className="wall">
            {shown.map((item) => (
              <DocCard
                key={item.key}
                item={item}
                onOpen={() => openItem(item)}
                onDelete={source.remove ? () => removeItem(item) : null}
                removeLabel={source.removeLabel}
              />
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
