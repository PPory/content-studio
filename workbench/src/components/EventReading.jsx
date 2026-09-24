// 热点事件的详情（2026-09-24 质量收口）：热点层和深读层共用一个骨架，深读只是把各段填得更完整。
//
//   头部        标记 · 标题 · 信息日期 · 阅读范围（线索 / 取得的材料 / 独立来源分开写）
//   ① 发生了什么      一句结论 + 关键事实（带引文编号）
//   ② 具体怎么回事    深读正文；热点层这里是「深入解读」入口和真实状态
//   ③ 依据与边界      来源明确说明 / 来源自己的判断 / 系统的解释 / 仍缺的证据 / 大家怎么说；全部来源折叠在最后
//   ④ 与你已有知识的连接  有才出现
//   ⑤ 有什么用，可以怎么继续
//
// ⚠️ **先让人看懂、知道能信到哪一步，再引导创作。** 重要的依据和限制默认可见，
// 只有全部原文和全部讨论折叠——它们是用来核对的，不是用来先读的。
//
// ⚠️ **来源清单是原样照搬，概要是 AI 写的——两者在界面上必须分得开。**
// 热点层标「AI 概要」；深读层的每条事实都能点开看到出处和读取范围（全文或摘要）。
import { useState } from "react";
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
const shortTime = (value) => { const t = new Date(value || ""); return Number.isNaN(t.getTime()) ? "" : t.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
const relationLabel = { explain: "解释", apply: "应用", extend: "补充", challenge: "质疑或修正" };
const stanceLabel = { support: "看重", doubt: "担心", experience: "用过的人说" };
const claimGroups = [
  ["observation", "来源明确说明"],
  ["author_report", "来源自己的判断"],
  ["interpretation", "系统的解释"],
];

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

/** 引文编号：点开在原处看到这句依据来自哪里、原话是什么、系统读的是全文还是摘要。 */
function Cite({ ids, brief }) {
  const [open, setOpen] = useState(null);
  const evidence = brief.evidence || [];
  const numbers = (ids || []).map((id) => Number(String(id).slice(1))).filter((n) => n >= 1 && n <= evidence.length);
  if (!numbers.length) return null;
  const source = (n) => (brief.sources || []).find((s) => (s.quotes || []).some((q) => q.number === n));
  const card = (n) => {
    const s = source(n);
    if (!s) return "来源已不可用";
    const url = safeUrl(s.url);
    return <>{url ? <a href={url} target="_blank" rel="noreferrer">{s.title || "查看原文"}</a> : s.title}{` · ${s.author || platformName(s.provider)}`}{sourceDate(s.publishedAt) ? ` · ${sourceDate(s.publishedAt)}` : ""}{` · ${s.readLevel === "original" ? "读取了全文" : "只取得摘要"}`}</>;
  };
  return (
    <>
      {numbers.map((n) => (
        <button key={n} type="button" className="event-cite" aria-expanded={open === n} aria-label={`查看引文 ${n}`} onClick={() => setOpen(open === n ? null : n)}>[{n}]</button>
      ))}
      {open && (
        <span className="event-cite__card" role="note">
          <q>{evidence[open - 1]?.quote}</q>
          <span className="event-cite__src">{card(open)}</span>
        </span>
      )}
    </>
  );
}

/** 「移出这件事」在原处确认：确认按钮就出现在被点的那一行，不跑到页面顶上。 */
function SourceList({ items, talk, onSplit, canSplit }) {
  const [pending, setPending] = useState(null);
  return (
    <ul className="event-reading__sources">
      {items.map((m) => (
        <li key={m.sourceId}>
          {safeUrl(m.url) ? <a href={safeUrl(m.url)} target="_blank" rel="noreferrer">{m.title || "查看原文"}</a> : <span>{m.title || "原文已按保留期清除"}</span>}
          <span className="event-reading__src-meta">
            {talk ? talkName(m.platform) : m.publisher || platformName(m.platform)}
            {m.score ? ` · ${m.score} 赞` : ""}
            {m.comments ? ` · ${m.comments} 评论` : ""}
            {sourceDate(m.publishedAt) ? ` · ${sourceDate(m.publishedAt)}` : ""}
            {canSplit && onSplit && m.kind !== "comment" && (pending === m.sourceId
              ? <span className="event-reading__confirm">它会单独成卡，之后不会再被合回来。<button type="button" className="text-action" onClick={() => { setPending(null); onSplit(m); }}>确认移出</button><button type="button" className="text-action" onClick={() => setPending(null)}>取消</button></span>
              : <button type="button" className="event-reading__split" onClick={() => setPending(m.sourceId)}>移出这件事</button>)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** ② 里的深读入口：说清楚深读会多给什么；状态只写真实发生的（排队、补原文、写解读、失败原因）。 */
function DeepControl({ brief, onDeep }) {
  const d = brief.deepen || {};
  const busy = ["queued", "running"].includes(d.status);
  if (busy) return <div className="event-reading__deep" role="status"><span className="event-reading__pulse" aria-hidden="true" />{d.status === "queued" ? "已排队，马上开始" : d.stage || "正在生成"}{d.estimateSec ? `（上次大约用了 ${d.estimateSec} 秒）` : ""}。完成后会自动出现在这里。</div>;
  return (
    <div className="event-reading__deep">
      {d.status === "failed" && <p className="event-reading__fail">上次没能生成：{d.error || "原因未知"}。</p>}
      <p>深入解读会补全原文、核对每条事实的出处，整理证据与分歧{d.wikiCandidates ? `，并在你的 ${d.wikiCandidates} 篇知识笔记里找能用来解释它的视角` : ""}。{d.estimateSec ? `上次大约用了 ${d.estimateSec} 秒。` : ""}</p>
      {onDeep && <button type="button" className="btn btn-sm" onClick={() => onDeep(d.status === "failed")}>{d.status === "failed" ? "重新生成" : "深入解读"}</button>}
    </div>
  );
}

export function EventReading({ brief, onDeep, onAddAngle, onSplit, onOpenRelated, onGo, dense = false }) {
  const event = brief.event || {};
  const members = event.members || [];
  const news = members.filter((m) => !isTalk(m) && m.kind !== "comment");
  const talk = members.filter(isTalk);
  const deep = brief.depth === "deep";
  const c = event.creation;
  const busy = ["queued", "running"].includes(brief.deepen?.status);
  const publishers = new Set(news.map((m) => m.publisher || m.platform));
  const scope = [
    event.sourceCount > news.length ? `聚合到 ${event.sourceCount} 条线索` : "",
    `取得 ${news.length} 份材料`,
    publishers.size > 1 ? `${publishers.size} 个独立来源` : news.length ? "单一来源" : "",
    talk.length ? `${talk.length} 条讨论` : "",
  ].filter(Boolean).join(" · ");
  const state = [
    !deep && brief.readScope === "summary" ? "概要基于订阅摘要" : "",
    deep && (brief.evidence || []).length && (brief.sources || []).length && (brief.sources || []).every((s) => s.readLevel !== "original") ? "解读只取得了摘要，没有读到全文" : "",
    deep && brief.deepStale ? `解读截至 ${shortTime(brief.deepAt) || "上一版"}，之后新增 ${brief.deepNewSources || "若干"} 个来源` : "",
  ].filter(Boolean);
  const claims = Array.isArray(brief.claims) ? brief.claims : [];
  const limits = [...new Set([...(brief.uncertainties || []), ...claims.flatMap((x) => x.limitations || [])])].filter(Boolean);
  const voices = Array.isArray(brief.voices) ? brief.voices : [];
  // 只显示引了笔记原话的连接；上一代深读留下的「关联某某」式连接不再显示（有「按新结构重新生成」的入口）。
  const wiki = deep ? (brief.wiki || []).filter((k) => k.quote && (k.application || k.reason)) : [];
  const angle = deep && brief.angle ? brief.angle : c && worthIt(c) ? { direction: c.angle || "", readerValue: "", needs: [] } : null;
  // 2026-09-24 之前生成的深读是一篇四段式长文，没有关键事实；如实说明，并给一个按新结构重新生成的入口。
  const legacyDeep = deep && !brief.keyFacts;
  const useFor = brief.useFor || (deep ? brief.audienceTakeaway : "");
  const related = event.related || [];
  return (
    <article className={`event-reading ${dense ? "is-dense" : ""}`}>
      <header className="event-reading__head">
        <EventMarks brief={brief} />
        <h2 className="event-reading__title">{brief.title}</h2>
        <p className="event-reading__stats">
          {shortTime(event.progressAt || event.latestAt) && <span>信息日期 {shortTime(event.progressAt || event.latestAt)}</span>}
          <span>{scope}</span>
        </p>
        {state.map((s) => <p key={s} className="event-reading__state">{s}</p>)}
      </header>

      <section className="event-reading__part">
        <h3>发生了什么{!deep && <span className="event-reading__ai">AI 概要</span>}</h3>
        {deep && /^这次新增/.test(brief.changeNote || "") && <p className="event-reading__new">{brief.changeNote}</p>}
        <p className="event-reading__lead">{brief.summary}</p>
        {deep && brief.keyFacts?.length > 0 && (
          <ul className="event-reading__facts">{brief.keyFacts.map((f, i) => <li key={i}>{f.text}<Cite ids={f.evidenceIds} brief={brief} /></li>)}</ul>
        )}
        {!deep && brief.changeNote && <p className="event-reading__note">{brief.changeNote}</p>}
      </section>

      <section className="event-reading__part">
        <h3>具体怎么回事</h3>
        {deep ? (
          <>
            {brief.deepStale && (
              <div className="event-reading__stale" role="status">
                <span>之后新增 {brief.deepNewSources || "若干"} 个来源{brief.deepDevelopment ? `，其中有新进展：${brief.deepDevelopment}` : "，目前看只是更多报道"}。</span>
                {busy ? <span>{brief.deepen.stage || "正在更新"}…</span> : onDeep && <button type="button" className="text-action" onClick={() => onDeep(true)}>更新解读</button>}
              </div>
            )}
            {legacyDeep && !brief.deepStale && <p className="event-reading__note">这是旧版解读（一篇长文，还没有按「事实 / 依据 / 用途」整理）。{onDeep && !busy && <button type="button" className="text-action" onClick={() => onDeep(true)}>按新结构重新生成</button>}{busy && `${brief.deepen.stage || "正在生成"}…`}</p>}
            <div className="event-reading__body">{markdown(brief.body || "")}</div>
          </>
        ) : <DeepControl brief={brief} onDeep={onDeep} />}
      </section>

      <section className="event-reading__part">
        <h3>依据与边界</h3>
        {deep ? (
          <>
            {claimGroups.map(([kind, label]) => {
              const items = claims.filter((x) => (kind === "interpretation" ? ["interpretation", "hypothesis"].includes(x.kind) : x.kind === kind));
              return items.length ? (
                <div key={kind} className="event-reading__claims">
                  <h4>{label}</h4>
                  <ul>{items.map((x) => <li key={x.id || x.text}>{x.text}{kind === "author_report" && x.attribution ? <span className="event-reading__muted">（{x.attribution}）</span> : null}<Cite ids={x.evidenceIds} brief={brief} /></li>)}</ul>
                </div>
              ) : null;
            })}
            {limits.length > 0 && <div className="event-reading__claims is-limit"><h4>仍缺的证据</h4><ul>{limits.slice(0, 6).map((x) => <li key={x}>{x}</li>)}</ul></div>}
            {voices.length > 0 && (
              <div className="event-reading__claims">
                <h4>大家怎么说</h4>
                <ul>{voices.map((v, i) => { const m = members.find((x) => x.sourceId === v.sourceId); return <li key={i}><span className="event-reading__stance">{stanceLabel[v.stance]}</span>{v.text}{m && safeUrl(m.url) ? <a className="event-reading__muted" href={safeUrl(m.url)} target="_blank" rel="noreferrer"> · {talkName(m.platform)}</a> : null}</li>; })}</ul>
              </div>
            )}
          </>
        ) : (
          news.length > 0 && <SourceList items={news.slice(0, 3)} />
        )}
        {related.length > 0 && (
          <p className="event-reading__related"><span className="event-reading__muted">同一型号的其它事件：</span>{related.map((r, i) => <span key={r.storyKey}>{i ? "、" : ""}{onOpenRelated ? <button type="button" className="text-action" onClick={() => onOpenRelated(r.storyKey)}>{r.title}</button> : r.title}</span>)}</p>
        )}
        <details className="event-reading__fold event-reading__sources-fold">
          <summary>
            <span>全部来源与讨论</span>
            {/* 头部的线索数含 AIhot 聚合的上游来源；这里数的是手上能点开核对的链接。 */}
            <span className="event-reading__muted">{[news.length ? `${news.length} 篇报道` : "", talk.length ? `${talk.length} 个讨论帖` : ""].filter(Boolean).join(" · ")}</span>
          </summary>
          {news.length > 0 && <section className="event-reading__group"><h4>报道（{news.length}）</h4><SourceList items={news} onSplit={onSplit} canSplit={news.length > 1} /></section>}
          {talk.length > 0 && <section className="event-reading__group"><h4>大家怎么说（{talk.length}）</h4><SourceList items={talk} talk /></section>}
          {news.length > 1 && onSplit && <p className="event-reading__muted event-reading__split-hint">有来源说的不是同一件事？点它旁边的「移出这件事」，它会单独成卡，之后也不会再被合回来。</p>}
        </details>
      </section>

      {wiki.length > 0 && (
        // 你的笔记是看这件事的视角：每条写清「用哪个观点 × 这件事的哪个事实 → 能讲出什么」，并附笔记原话；
        // 切入方向建立在这些连接上，所以放在这一段的末尾，而不是另起一段各说各话。
        <section className="event-reading__part">
          <h3>与你已有知识的连接</h3>
          <ul className="event-reading__wiki">
            {wiki.map((k) => (
              <li key={k.id}>
                <p className="event-reading__wiki-head">
                  {onGo ? <button type="button" className="text-action" onClick={() => onGo("entries", k.id)}>《{k.title}》</button> : <strong>《{k.title}》</strong>}
                  {k.relation && <span className={`event-reading__rel is-${k.relation}`}>{relationLabel[k.relation]}</span>}
                  {k.updatedSince && <span className="event-reading__muted">这篇笔记之后有更新</span>}
                </p>
                <p>{k.application || k.reason}</p>
                <p className="event-reading__wiki-quote"><span>你的笔记：</span>「{k.quote}」</p>
              </li>
            ))}
          </ul>
          {angle?.direction && (
            <div className="event-reading__lens">
              <p className="event-reading__lens-label">由此形成的切入方向</p>
              <p>{angle.direction}{angle.readerValue ? <span className="event-reading__muted">（{angle.readerValue}）</span> : null}</p>
              {angle.needs?.length > 0 && <><p className="event-reading__lens-label">还需要补充</p><p>{angle.needs.join("；")}</p></>}
            </div>
          )}
          <p className="event-reading__note">知识库只说明你整理过相关内容，不代表已经验证；它也不是这件事的外部证据。</p>
        </section>
      )}

      <section className="event-reading__part">
        <h3>有什么用，可以怎么继续</h3>
        {deep && (useFor || brief.notFor) ? (
          <>
            {useFor && <p><span className="event-reading__muted">适合：</span>{useFor}</p>}
            {brief.notFor && <p><span className="event-reading__muted">暂时不需要关注：</span>{brief.notFor}</p>}
          </>
        ) : brief.whyItMatters ? <p>{brief.whyItMatters}</p> : null}
        {deep && !legacyDeep && !wiki.length && <p className="event-reading__note">你的知识库里暂未找到能直接用上的视角。</p>}
        {angle && (angle.direction || c?.reason) && (
          <div className="event-reading__creation" aria-label="创作建议">
            {c?.reason && worthIt(c) && <p className="event-reading__verdict">{c.reason}</p>}
            {/* 有知识连接时，切入方向已经写在连接那一段的末尾，这里不再重复。 */}
            {!wiki.length && angle.direction && <p className="event-reading__angle"><span>切入方向：</span>{angle.direction}</p>}
            {!wiki.length && angle.readerValue && <p className="event-reading__angle"><span>读者价值：</span>{angle.readerValue}</p>}
            {!wiki.length && angle.needs?.length > 0 && <p className="event-reading__angle"><span>还需补充：</span>{angle.needs.join("；")}</p>}
            {c?.window && worthIt(c) && <p className="event-reading__muted">{creationLine({ window: c.window })}（这是建议，要不要做、什么时候做由你决定）</p>}
            {onAddAngle && <button type="button" className="btn btn-sm" onClick={onAddAngle}>按这个方向加入选题</button>}
          </div>
        )}
      </section>
    </article>
  );
}
