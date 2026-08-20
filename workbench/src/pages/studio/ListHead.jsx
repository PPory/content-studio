// 卡片墙 / 看板上方那一条：眉标 + 标题 + 条数 · 搜索 · 视图切换 · 新增。
// 从 `pages/Studio.jsx` 的 return 里原样外提，JSX 一字未动（只去掉了整体缩进）。
//
// **视图切换只在有状态的源上出现**（`canBoard`）：素材库在库里没有状态列，
// 给它一个「看板」按钮，点开是一列空的。**新增只在流水线四段上出现**——
// 书架和洞察的新增各有各的入口，混进来只会让这颗按钮的含义随页面变。
import { IconLayoutGrid, IconLayoutKanban, IconPlus, IconSearch } from "../../components/icons.jsx";

export function ListHead({ source, list, searchRef, query, setQuery, canBoard, layout, setLayout, isPipeline, sourceKey, onIntake, onCreate, onOrganize }) {
  return (
    <div className="panel-head">
      <div className="panel-head__main">
        <span className="eyebrow">{(source.eyebrow || source.key).toUpperCase()}</span>
        <h2>
          {source.panelLabel || source.label}
          {list ? <span className="panel-head__count">{list.total ?? `${list.items.length}${list.nextCursor ? "+" : ""}`} 条</span> : null}
        </h2>
      </div>
      <div className="panel-head__aside">
        <label className="search-box">
          <IconSearch aria-hidden="true" stroke={1.7} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={source.isMaterialWorkspace ? "搜索来源、素材或标签 /" : "搜索标题、内容或标签 /"}
            onKeyDown={(e) => e.key === "Escape" && (setQuery(""), e.currentTarget.blur())}
          />
        </label>
        {canBoard ? (
          <div className="seg" role="group" aria-label="视图">
            <button aria-pressed={layout === "board"} onClick={() => setLayout("board")} title="看板：看东西卡在哪一步">
              <IconLayoutKanban aria-hidden="true" stroke={1.7} />
              看板
            </button>
            <button aria-pressed={layout === "wall"} onClick={() => setLayout("wall")} title="卡片：看有哪些内容">
              <IconLayoutGrid aria-hidden="true" stroke={1.7} />
              卡片
            </button>
          </div>
        ) : null}
        {sourceKey === "collections" || source.isMaterialWorkspace ? <button className="btn btn-sm" onClick={onOrganize}>整理待处理来源</button> : null}
        {isPipeline && !source.isMaterialWorkspace ? (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => sourceKey === "topics"
              ? onCreate("topic")
              : sourceKey === "drafts"
                ? onCreate("choose")
                : onIntake({ target: sourceKey === "collections" ? "collection" : sourceKey === "inbox" ? "inbox" : "material" })}
          >
            <IconPlus aria-hidden="true" stroke={2} />
            {sourceKey === "topics" ? "选题" : sourceKey === "drafts" ? "新稿" : "入库"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
