// 列表 / 看板上方那一条**右端的工具**：搜索 · 视图切换 · 新增。
//
// ⚠️ **这里原来还有一个「眉标 + 库名 + 条数」的标题块，撤掉了。**
// 页头刚说完「选题库」，正下方那个框里又写一遍「TOPICS / 选题库 1 条」——
// 同一个名字一屏出现两次，中间只隔了一行描述；而 `TOPICS` 正是设计系统里
// 早就否决过的那种眉标（标题的英文转写，正下方就是同一个词）。
// 条数搬去了页标题旁边（`PageHeader` 的 `count`），那儿才是它该在的地方。
//
// 它和筛选条现在**并排在同一行**（`.list-bar`）：左边是「筛哪些」，右边是「怎么看、加一条」。
// 两件事本来就分居一行的两端，各占一行是白白多出一条空行。
//
// **视图切换只在有状态的源上出现**（`canBoard`）：素材库在库里没有状态列，
// 给它一个「看板」按钮，点开是一列空的。**新增只在流水线四段上出现**——
// 书架和洞察的新增各有各的入口，混进来只会让这颗按钮的含义随页面变。
import { IconLayoutGrid, IconLayoutKanban, IconPlus, IconSearch } from "../../components/icons.jsx";

export function ListHead({ source, list, searchRef, query, setQuery, canBoard, layout, setLayout, isPipeline, sourceKey, onIntake, onCreate, onOrganize }) {
  return (
    <div className="list-tools">
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
        <button aria-pressed={layout === "wall"} onClick={() => setLayout("wall")} title="列表：看有哪些内容">
          <IconLayoutGrid aria-hidden="true" stroke={1.7} />
          列表
        </button>
      </div>
    ) : null}
    {sourceKey === "collections" || source.isMaterialWorkspace ? <button className="btn btn-sm" onClick={onOrganize}>整理待处理来源</button> : null}
    {/**
      * ⚠️ **稿件库这儿不画新增按钮。** 它原来写着「新稿」，点下去是
      * `onCreate("choose")`——**和页头右上那颗「新建」是同一个调用**。
      * 一屏两颗实心黑、字还不一样，而这套界面的规矩是**实心黑只留给主操作一颗**：
      * 看到两颗的人第一反应是去猜它们有什么区别，而答案是没有区别。
      *
      * 另外两种留着，因为它们和「新建」**不是**一件事：
      *   - 选题库的「选题」直接建一条选题（页头那颗走的是起点选择那一屏）
      *   - 素材 / 灵感 / 收件箱的「入库」是**存一条已经有的东西**，新建是开一篇还不存在的
      */}
    {isPipeline && !source.isMaterialWorkspace && sourceKey !== "drafts" ? (
      <button
        /**
         * ⚠️ **这颗不是实心黑。** 实心黑一屏只留给**主操作一颗**，而那一颗是页头右上的
         * 「新建」。这儿的「选题 / 入库」是次一级的动作（往当前这个库里加一条），
         * 两颗都涂实心的话，一屏上「这一页要我做什么」就得靠读字来判断。
         */
        className="btn btn-sm"
        onClick={() => sourceKey === "topics"
          ? onCreate("topic")
          : onIntake({ target: sourceKey === "collections" ? "collection" : sourceKey === "inbox" ? "inbox" : "material" })}
      >
        <IconPlus aria-hidden="true" stroke={2} />
        {sourceKey === "topics" ? "选题" : "入库"}
      </button>
  ) : null}
    </div>
  );
}
