// 热点事件的详情（2026-09-23）：热点层和深读层共用一个骨架，深读只是把「深度解读」那一段填满。
//
//   头部        标记 · 标题 · 来源数与最新时间
//   ① 发生了什么  概要（热点层标「AI 概要」）
//   ② 创作判断    价值非低时出现：理由当结论，切入角度是下一步，按钮就是那个动作
//   ③ 为什么重要
//   ④ 深度解读    生成中 / 失败原因与重试 / 解读正文与还不确定的部分
//   ⑤ 来源与讨论  默认折叠——它是用来核对的，不是用来先读的
//
// ⚠️ **来源清单是原样照搬，概要是 AI 写的——两者在界面上必须分得开。**
// 热点层不做逐字引文校验，可信度来自「每条来源都能点开核对」；所以概要旁边标「AI 概要」，
// 来源行只放发布方、原标题、时间，不做改写。严格校验只在深度解读那一层。
//
// 不再套通用的 `BriefReading`：那边的「已通过精选校验 / 近期更新」、出处行、
// 「可以如何使用」（和切入角度重复）是给旧流程的卡准备的，放在事件详情里全是噪音。
import { markdown, platformName, safeUrl, sourceDate } from "./BriefReading.jsx";
import { IconClock, IconCode, IconMessageCircle, IconSparkles } from "./icons.jsx";

export const eventKindLabel = { event: "热点事件", discussion: "社区热议", practice: "实践" };
/**
 * 选题上的一行。时效只是建议（「建议 24 小时内」）；2026-09-24 之前加入的选题带着截止时间，照旧显示「截止 9/24」。
 */
export const windowLabel = { "24h": "24 小时内", week: "本周", evergreen: "长青" };
export const creationLine = (c) => {
  if (!c) return "";
  if (c.deadline) return [c.window === "24h" ? "抢时效" : c.window === "week" ? "本周内" : "", `截止 ${new Date(c.deadline).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}`].filter(Boolean).join(" · ");
  return windowLabel[c.window] ? `建议${c.window === "evergreen" ? "：" : " "}${windowLabel[c.window]}` : "";
};
const isTalk = (m) => ["reddit", "hacker_news"].includes(m.platform);
const talkName = (key) => ({ reddit: "Reddit", hacker_news: "Hacker News" }[key] || platformName(key));
const worthIt = (c) => c && c.value !== "low";

/**
 * 卡片、目录和详情头部共用的标记。只给会改变判断的东西上色：
 * 「值得做」（价值为高）赭色带淡底，整屏唯一带底色的标；「抢时效」橙字；类型是中性字。
 * 价值为中的不上标——否则大半张卡都有标，等于没标。
 */
export function EventMarks({ brief, withDepth = false }) {
  const event = brief.event || {};
  const c = event.creation;
  const marks = [];
  if (c?.value === "high") marks.push(<span key="worth" className="intel-mark is-worth"><IconSparkles aria-hidden="true" stroke={1.8} />值得做</span>);
  if (worthIt(c) && c.window === "24h") marks.push(<span key="urgent" className="intel-mark is-urgent"><IconClock aria-hidden="true" stroke={1.8} />抢时效</span>);
  if (event.kind === "discussion") marks.push(<span key="kind" className="intel-mark"><IconMessageCircle aria-hidden="true" stroke={1.8} />社区热议</span>);
  if (event.kind === "practice") marks.push(<span key="kind" className="intel-mark"><IconCode aria-hidden="true" stroke={1.8} />实践</span>);
  // 卡片和目录上提示「点开就有完整解读」；详情页头部不需要（解读就在下面）。
  if (withDepth && brief.depth === "deep") marks.push(<span key="deep" className="intel-mark is-quiet">已深读</span>);
  return marks.length ? <span className="intel-marks">{marks}</span> : null;
}

function SourceList({ items, talk, quotes }) {
  return (
    <ul className="event-reading__sources">
      {items.map((m) => {
        const cited = quotes.get(m.sourceId) || [];
        return (
          <li key={m.sourceId}>
            {safeUrl(m.url) ? <a href={safeUrl(m.url)} target="_blank" rel="noreferrer">{m.title || "查看原文"}</a> : <span>{m.title || "原文已按保留期清除"}</span>}
            <span className="event-reading__src-meta">
              {talk ? talkName(m.platform) : m.publisher || platformName(m.platform)}
              {m.score ? ` · ${m.score} 赞` : ""}
              {m.comments ? ` · ${m.comments} 评论` : ""}
              {sourceDate(m.publishedAt) ? ` · ${sourceDate(m.publishedAt)}` : ""}
            </span>
            {cited.map((q) => <blockquote key={q.number}><span>[引文{q.number}]</span> {q.quote}</blockquote>)}
          </li>
        );
      })}
    </ul>
  );
}

export function EventReading({ brief, onRetryDeep, onAddAngle, dense = false }) {
  const event = brief.event || {};
  const members = event.members || [];
  const news = members.filter((m) => !isTalk(m) && m.kind !== "comment");
  const talk = members.filter(isTalk);
  const deep = brief.depth === "deep";
  const state = brief.deepen?.status;
  const c = event.creation;
  const latest = event.latestAt ? new Date(event.latestAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  // 深读时，每条来源下面附上解读引用的原文段落。
  const quotes = new Map((deep ? brief.sourceDocuments || brief.sources || [] : []).filter((s) => s.quotes?.length).map((s) => [s.id, s.quotes]));
  const publishers = [...new Set(news.map((m) => m.publisher || platformName(m.platform)).filter(Boolean))];
  const takeaway = brief.audienceTakeaway || brief.audience_takeaway;
  const uncertain = Array.isArray(brief.uncertainties) ? brief.uncertainties.filter(Boolean) : [];
  return (
    <article className={`event-reading ${dense ? "is-dense" : ""}`}>
      <header className="event-reading__head">
        <EventMarks brief={brief} />
        <h2 className="event-reading__title">{brief.title}</h2>
        <p className="event-reading__stats">
          {event.sourceCount || news.length} 个来源{event.discussionCount ? ` · ${event.discussionCount} 条讨论` : ""}{latest ? ` · 最新 ${latest}` : ""}
        </p>
      </header>

      <section className="event-reading__part">
        <h3>发生了什么{!deep && <span className="event-reading__ai">AI 概要</span>}</h3>
        <p className="event-reading__lead">{brief.summary}</p>
      </section>

      {worthIt(c) && (
        <section className="event-reading__creation" aria-label="创作判断">
          <p className="event-reading__verdict">{c.reason || "值得做一条内容"}</p>
          {c.angle && <p className="event-reading__angle"><span>切入：</span>{c.angle}</p>}
          {onAddAngle && <button type="button" className="btn btn-sm" onClick={onAddAngle}>按这个角度加入选题</button>}
        </section>
      )}

      {(brief.whyItMatters || takeaway) && (
        <section className="event-reading__part">
          <h3>为什么重要</h3>
          {brief.whyItMatters && <p>{brief.whyItMatters}</p>}
          {deep && takeaway && <p><span className="event-reading__muted">读者能带走：</span>{takeaway}</p>}
        </section>
      )}

      <section className="event-reading__part">
        <h3>深度解读</h3>
        {deep ? (
          <>
            {brief.deepStale && <p className="event-reading__note">这个事件之后又有新来源，下面的解读基于较早的资料。</p>}
            <div className="event-reading__body">{markdown(brief.body || brief.reason)}</div>
            {uncertain.length > 0 && (
              <details className="event-reading__fold">
                <summary>还不确定的部分（{uncertain.length}）</summary>
                <ul>{uncertain.map((u, i) => <li key={i}>{typeof u === "string" ? u : u.description || u.title || ""}</li>)}</ul>
              </details>
            )}
          </>
        ) : (
          <div className="event-reading__deep" role="status">
            {state === "failed" ? (
              <>
                <span>这次没能生成：{brief.deepen?.error || "原因未知"}。上面的概要和下面的来源仍可用。</span>
                {onRetryDeep && <button type="button" className="text-action" onClick={onRetryDeep}>重新生成</button>}
              </>
            ) : (
              <span>正在生成：抓取原文、核对引文，大约 30–60 秒。生成好会自动出现在这里。</span>
            )}
          </div>
        )}
      </section>

      <details className="event-reading__fold event-reading__sources-fold">
        <summary>
          <span>来源与讨论</span>
          <span className="event-reading__muted">
            {/* 头部的「N 个来源」含 AIhot 聚合的来源数；这里数的是手上能点开核对的链接，换个量词免得两个数打架。 */}
            {[news.length ? `${news.length} 篇报道` : "", talk.length ? `${talk.length} 个讨论帖` : ""].filter(Boolean).join(" · ")}
            {publishers.length ? ` · ${publishers.slice(0, 3).join("、")}${publishers.length > 3 ? " 等" : ""}` : ""}
          </span>
        </summary>
        {news.length > 0 && (
          <section className="event-reading__group">
            <h4>报道（{news.length}）</h4>
            <SourceList items={news} quotes={quotes} />
          </section>
        )}
        {talk.length > 0 && (
          <section className="event-reading__group">
            <h4>大家怎么说（{talk.length}）</h4>
            <SourceList items={talk} talk quotes={quotes} />
          </section>
        )}
      </details>
    </article>
  );
}
