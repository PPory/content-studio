// 书详情的主栏：「我在这本书里留下了什么」，按章排的高亮和批注。
//
// ⚠️ **为什么它是主栏，而章节目录退到右边那条 300px 上。**
// 章节目录只在**第一次**打开一本书时是主角；此后每一次回到这一页，要找的都是
// 「我上次划的那句在哪」。把一列文件名摆在最显眼的位置，等于让这一页永远停在
// 第一次打开时的样子。
//
// ⚠️ **但没有标记的书不走这条路**（判据在 `BookDetail.jsx`）：还没读过的书，
// 章节就是它的全部内容。给它画一个空的「我的标记」大栏 + 一条挤在旁边的章节，
// 是把版面让给了一句「这里什么都没有」。**版面跟着内容走，不跟着页面名字走。**
//
// 数据来自 `GET /api/workspace/book-marks`，聚合规则（高亮怎么按章分、批注怎么反查
// 属于哪一章、定位不到的怎么办）全在 `server/lib/marks.mjs`。这里一条都不重算。

import { IconChevronRight } from "../../components/icons.jsx";

/**
 * @param chapters  [{ file, path, label, items }]，`path` 为空 = 这一组定位不到章节
 * @param onJump    (chapterPath) => void，跳到那一章的正文
 * @param onIntake  ({ content, source }) => void，摘成素材
 */
export function BookMarks({ chapters, onJump, onIntake, bookName }) {
  return (
    <div className="marks">
      {chapters.map((ch) => (
        <section key={ch.path || ch.label} className="marks__grp">
          {/**
            * 章名这一行本身就是「去这一章」的入口——标记读到一半想看上下文是常事，
            * 而下面每条标记上那个「跳到原文」跳的是**同一个地方**。
            * ⚠️ 定位不到章节的那一组没有落点（`path` 为空），所以它是一行**静态文字**，
            * 不是一颗点了不动的按钮。和「最近标注」那一栏同一条规矩。
            */}
          {ch.path ? (
            <button className="marks__ch" onClick={() => onJump(ch.path)}>
              {ch.label}
              <IconChevronRight size={13} stroke={1.8} aria-hidden="true" />
            </button>
          ) : (
            <div className="marks__ch marks__ch--dead" title="这几条批注引的原文在任何一章里都找不到——书可能重新导入过，或者原文被改动了">
              {ch.label}
            </div>
          )}

          {ch.items.map((m) => {
            // 高亮是「这句话我圈中了」，批注是「我对它说了什么」。
            // 两者合成一份是因为回想起一句话时没人记得自己当时按的是哪个按钮。
            const text = m.quote || m.note;
            return (
              /**
               * ⚠️ **高亮和批注不靠颜色区分**（撤掉过一版按标记色涂竖线的，理由写在
               * `styles.css` 的 `.mark` 上）。分得开它们的是**内容**：批注底下有一段
               * 自己写的字，脚注那行也照实说是「只划了线」还是一个时间。
               */
              <article key={m.id} className="mark">
                {m.quote ? <blockquote className="mark__q">{m.quote}</blockquote> : null}
                {m.note ? <p className="mark__n">{m.note}</p> : null}
                <footer className="mark__f">
                  {/**
                    * ⚠️ **高亮没有时间就照实说「只划了线」，不许编一个「刚刚」。**
                    * 高亮文件的格式里不记时间。这句话说的是**这条是什么**，不是**什么时候**，
                    * 所以不会被误读成一个时间戳。
                    */}
                  <time>{m.at || (m.kind === "highlight" ? "只划了线" : "")}</time>
                  {ch.path ? (
                    <button className="btn-link" onClick={() => onJump(ch.path)}>跳到原文</button>
                  ) : null}
                  {onIntake && text ? (
                    <button
                      className="btn-link"
                      onClick={() => onIntake({ content: text, source: `《${bookName}》${ch.label}`.trim() })}
                    >
                      摘成素材
                    </button>
                  ) : null}
                </footer>
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
