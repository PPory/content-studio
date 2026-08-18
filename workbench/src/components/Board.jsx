// 看板：一列一个状态，拖一张卡换列 = 改库里那行的状态。
//
// 卡片墙回答「有什么」，看板回答「卡在哪一步」。后者是偶尔要问一次的问题，
// 所以看板**不是默认视图**，是一个开关。
//
// 三条设计约束，都是被截图打回来才定下的：
//
//  1. **看板要吃满屏**。它天生是横向的东西，塞进 1320 宽的正文栏里，五列就得被切一半。
//     `.main:has(.kanban)` 会把正文栏的宽度限制解掉（样式在 styles.css）。
//  2. **卡片上要有摘要**。只有标题的话，看板和一列列表没区别——那就白换一个视图了。
//  3. **空的异常列藏起来**（`quietStates`）。「搁置」是成稿全失败的落点，正常情况下
//     永远是空的，白占五分之一的宽度；但不能直接删，删了失败的选题就从看板上消失了。
//
// 危险的那一格要拦一道：选题拖进「撰写中」，Worker 五分钟内就会按勾选的平台
// 逐个跑 LLM 出稿。所以这一格不直接改，交给调用方弹平台选择——
// 误拖的代价从「烧掉五篇稿子的 token」降到「多按一次 Esc」。
//
// 用原生 HTML5 拖拽，不引库：三个事件（dragstart / dragover / drop）就够了。

import { useMemo, useState } from "react";
import { relTime } from "./ui.jsx";
import { IconGripVertical, IconSparkles } from "./icons.jsx";

export function Board({ states, quietStates = [], items, onOpen, onMove, groupOf, dangerState }) {
  const [dragging, setDragging] = useState(null); // 正在拖的 item.key
  const [over, setOver] = useState("");           // 悬停在哪一列

  const stateOf = (it) => (groupOf ? groupOf(it) : it.badge);

  const columns = useMemo(() => {
    const cols = states
      .map((s) => ({ state: s, items: items.filter((it) => stateOf(it) === s) }))
      // 异常落点空着就不占位置，有东西了自己冒出来
      .filter((c) => c.items.length || !quietStates.includes(c.state));
    const rest = items.filter((it) => !states.includes(stateOf(it)));
    if (rest.length) cols.push({ state: "", label: "未分类", items: rest });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states, quietStates, items, groupOf]);

  return (
    // 外面这层只负责「右边还有」那道渐隐。看板本身要横向滚，遮罩不能跟着一起滚，
    // 所以必须是两层——一层滚，一层不滚。
    <div className="kanban-wrap">
      <div className="kanban" role="list">
        {columns.map((col) => (
          <section
            key={col.state || "_"}
            className="kanban-col"
            aria-label={col.label || col.state}
            data-over={over === col.state && dragging ? "true" : undefined}
            data-danger={col.state === dangerState ? "true" : undefined}
            onDragOver={(e) => {
              if (!dragging || !col.state) return;
              e.preventDefault();          // 不 preventDefault 就不会触发 drop
              setOver(col.state);
            }}
            onDragLeave={() => setOver((o) => (o === col.state ? "" : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver("");
              const key = e.dataTransfer.getData("text/plain") || dragging;
              setDragging(null);
              const item = items.find((it) => it.key === key);
              if (item && col.state && stateOf(item) !== col.state) onMove(item, col.state);
            }}
          >
            <header className="kanban-col__head">
              <span className="kanban-col__name">
                {col.label || col.state}
                {/* 这一列会真的花钱，标出来。拖进去之前就该知道 */}
                {col.state === dangerState ? (
                  <IconSparkles size={13} stroke={1.8} aria-label="拖进来会开始成稿" />
                ) : null}
              </span>
              <span className="kanban-col__count">{col.items.length}</span>
            </header>

            <div className="kanban-col__body">
              {col.items.map((it) => (
                <article
                  key={it.key}
                  className="kanban-card"
                  draggable
                  data-dragging={dragging === it.key ? "true" : undefined}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", it.key);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(it.key);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver("");
                  }}
                >
                  <button className="kanban-card__open" onClick={() => onOpen(it)}>
                    <span className="kanban-card__grip" aria-hidden="true">
                      <IconGripVertical size={14} stroke={1.7} />
                    </span>
                    <h4>{it.title}</h4>
                    {/* 摘要是看板和列表的分界线。没有它，这一屏就只是竖着排的标题 */}
                    {it.preview ? <p className="kanban-card__note">{it.preview}</p> : null}
                    <span className="kanban-card__foot">
                      {it.tags?.slice(0, 3).map((t) => (
                        <span key={t} className="tag">{t}</span>
                      ))}
                      <time>{it.time ? relTime(it.time) : ""}</time>
                    </span>
                  </button>
                </article>
              ))}
              {!col.items.length ? (
                <p className="kanban-col__empty">{dragging ? "松手放这儿" : "空"}</p>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
