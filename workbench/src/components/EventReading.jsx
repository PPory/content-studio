// 热点事件卡的详情（2026-09-23）：先给 AI 概要和来源清单，深度解读在第一次打开时生成。
//
// ⚠️ **来源清单是原样照搬，概要是 AI 写的——两者在界面上必须分得开。**
// 热点层不做逐字引文校验，可信度来自「每条来源都能点开核对」；所以概要旁边标「AI 概要」，
// 来源行只放发布方、原标题、时间，不做改写。严格校验只在深度解读那一层。
import { BriefReading, platformName, sourceDate } from "./BriefReading.jsx";

export const eventKindLabel = { event: "热点事件", discussion: "社区热议", practice: "实践" };
const isTalk = (m) => ["reddit", "hacker_news"].includes(m.platform);

function SourceList({ items, talk }) {
  return (
    <ul className="event-reading__sources">
      {items.map((m) => (
        <li key={m.sourceId}>
          {m.url ? <a href={m.url} target="_blank" rel="noreferrer">{m.title || "查看原文"}</a> : <span>{m.title || "原文已按保留期清除"}</span>}
          <span className="event-reading__src-meta">
            {talk ? platformName(m.platform) : m.publisher || platformName(m.platform)}
            {m.score ? ` · ${m.score} 赞` : ""}
            {m.comments ? ` · ${m.comments} 评论` : ""}
            {sourceDate(m.publishedAt) ? ` · ${sourceDate(m.publishedAt)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function EventReading({ brief, onGo, onBlock, onRetryDeep, dense = false }) {
  const event = brief.event || {};
  const members = event.members || [];
  const news = members.filter((m) => !isTalk(m) && m.kind !== "comment");
  const talk = members.filter(isTalk);
  const deep = brief.depth === "deep";
  const state = brief.deepen?.status;
  return (
    <div className={`event-reading ${dense ? "is-dense" : ""}`}>
      <p className="event-reading__labels">
        <span>{eventKindLabel[event.kind] || "热点事件"}</span>
        <span>{event.sourceCount || news.length} 个来源{event.discussionCount ? ` · ${event.discussionCount} 条讨论` : ""}</span>
        {!deep && <span>AI 概要</span>}
      </p>
      {deep ? (
        <>
          {brief.deepStale && <p className="event-reading__note">这个事件之后又有新来源，下面的解读基于较早的资料。</p>}
          <BriefReading brief={brief} onGo={onGo} onBlock={onBlock} dense={dense} />
        </>
      ) : (
        <>
          <h2 className="event-reading__title">{brief.title}</h2>
          <p className="event-reading__summary">{brief.summary}</p>
          {brief.whyItMatters && <p className="event-reading__why"><strong>为什么值得关注：</strong>{brief.whyItMatters}</p>}
          <div className="event-reading__deep" role="status">
            {state === "failed" ? (
              <>
                <span>深度解读没有生成：{brief.deepen?.error || "原因未知"}。可以先看下面的来源。</span>
                {onRetryDeep && <button type="button" className="text-action" onClick={onRetryDeep}>重新生成</button>}
              </>
            ) : (
              <span>正在生成深度解读：抓取原文、核对引文，大约 30–60 秒。可以先看下面的来源。</span>
            )}
          </div>
        </>
      )}
      <section className="event-reading__section">
        <h3>来源（{news.length}）</h3>
        <SourceList items={news} />
      </section>
      {talk.length > 0 && (
        <section className="event-reading__section">
          <h3>大家怎么说（{talk.length}）</h3>
          <SourceList items={talk} talk />
        </section>
      )}
    </div>
  );
}
