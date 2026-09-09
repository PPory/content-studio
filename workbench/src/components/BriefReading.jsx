// 一条情报的「读」那一层：标题、出处、综合理解、连接、原始资料。
//
// ⚠️ **右侧 peek 面板和整页详情共用这一份，别各写一遍。**
// 这两处渲染的是同一条情报的同一段内容，差别只在外面那层壳（宽度、动作条、要不要挂讨论栏）。
// 分成两份的后果这个项目吃过：改了一处的「原文发布时间未知」，另一处还在说别的话，
// 而两边都不会报错。
//
// `dense` 只影响标题字号：peek 是一条 400px 的窄栏，整页有 760px 的正文宽。
// 结构、类名和文案在两处完全一致，所以截图和测试对得上。

import { renderMarkdown } from "../lib/markdown.js";

export const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

export const briefDate = (value) =>
  value ? new Date(value).toLocaleDateString("zh-CN", { month: "long", day: "numeric" }) : "";

// 原文发布日和收集日都按北京时间算：这两个日期是**给人核对来源用的**，
// 跟着浏览器时区跑的话，同一条情报在不同机器上会显示不同的「原文日期」。
export const sourceDate = (value) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" })
    : "";

export const platformName = (key) =>
  ({ x: "X", reddit: "Reddit", xiaohongshu: "小红书", douyin: "抖音", aihot: "AI Hot", web: "公开网页", local: "已有资料", manual: "我的灵感" }[key] || key);

export const confidenceLabel = (value) => (value === "reliable" ? "可靠信息" : "值得观察");

export const markdown = (body) => (
  <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(String(body || "")) }} />
);

/**
 * 来源、原文日期、收集日期。
 *
 * ⚠️ **原文发布日和「我们什么时候收到的」必须分开写。** 合成一个日期的话，
 * 一条三个月前的旧闻会因为今天才收到而显示成今天——那是句假话，而真实性是这个产品的硬闸。
 */
export function BriefProvenance({ item }) {
  const meta = item.sourceMeta || [];
  const range = item.publicationRange || {};
  const platforms = [...new Set(meta.map((s) => platformName(s.provider)).filter(Boolean))];
  const collected = meta.map((s) => s.collectedAt).filter((v) => v && Number.isFinite(Date.parse(v))).sort();
  const first = sourceDate(range.from);
  const last = sourceDate(range.to);
  const collectedFirst = sourceDate(collected[0]);
  const collectedLast = sourceDate(collected.at(-1));
  return (
    <div className="brief-provenance">
      <span>{platforms.join(" · ") || "来源见详情"}</span>
      <span>
        原文：
        {first ? `${first}${last && last !== first ? ` — ${last}` : ""}${range.unknownCount ? " · 部分日期未知" : ""}` : "发布时间未知"}
      </span>
      <span>
        首次收集：
        {collectedFirst ? `${collectedFirst}${collectedLast !== collectedFirst ? ` — ${collectedLast}` : ""}` : "时间未知"}
      </span>
    </div>
  );
}

/** 卡片上那一行：只有平台和原文日期。收集日期是读完才需要的注解，留给 `BriefProvenance`。 */
export function briefCardMeta(item) {
  const platforms = [...new Set((item.sourceMeta || []).map((s) => platformName(s.provider)).filter(Boolean))];
  const published = sourceDate(item.publicationRange?.from);
  return [platforms.join(" · "), published || "日期未知"].filter(Boolean).join(" · ");
}

export function BriefReading({ brief, onGo, onBlock, dense = false }) {
  return (
    <>
      <div className="brief-meta">{confidenceLabel(brief.confidence)}</div>
      {dense ? <h2 className="brief-reading-title">{brief.title}</h2> : <h1>{brief.title}</h1>}
      <p className="brief-lead">{brief.summary}</p>
      <BriefProvenance item={brief} />
      {brief.reason ? <p className="brief-reading-reason">{brief.reason}</p> : null}
      {brief.changeNote ? <p className="brief-change">本次更新：{brief.changeNote}</p> : null}

      <section className="brief-interpretation">
        <h2 className="brief-interpretation-label">综合理解</h2>
        {markdown(brief.body || brief.reason)}
      </section>

      {brief.wiki?.length > 0 ? (
        <section className="brief-wiki">
          <h2>与你已有理解的连接</h2>
          {brief.wiki.map((w) => (
            <div key={w.id}>
              <button type="button" className="brief-text-action" onClick={() => onGo("entries", w.id)}>
                {w.title} →
              </button>
              {w.reason ? <p>{w.reason}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      {brief.technical ? (
        <details className="brief-technical">
          <summary>技术细节</summary>
          {markdown(brief.technical)}
        </details>
      ) : null}

      <section className="brief-originals">
        <h2>原始资料</h2>
        {(brief.sourceDocuments || brief.sources || []).map((source, index) => (
          <details key={`${source.id || source.url}-${index}`}>
            <summary>
              资料 {index + 1} · {source.title || "查看来源"}
            </summary>
            <p className="brief-meta">{source.publishedAt ? `原文发布于 ${briefDate(source.publishedAt)}` : "原文发布时间未知"}</p>
            {source.quotes?.length > 0 ? (
              <div className="brief-source-quotes">
                <strong>解读引用的段落</strong>
                {source.quotes.map((q) => (
                  <blockquote key={q.number}>
                    <span>[引文{q.number}]</span> {q.quote}
                  </blockquote>
                ))}
              </div>
            ) : null}
            {source.records
              ? source.records.map((record) => (
                  <section className="brief-source-record" key={record.id}>
                    {source.records.length > 1 ? (
                      <h3>
                        {record.contentKind === "comment" ? "评论" : "原文"}
                        {record.author ? ` · ${record.author}` : ""}
                      </h3>
                    ) : null}
                    {markdown(record.body || "暂无可展示的正文")}
                  </section>
                ))
              : markdown(source.body || source.bodyMarkdown || source.excerpt || "暂无可展示的正文")}
            {safeUrl(source.url) ? (
              <div className="brief-source-actions">
                <a href={safeUrl(source.url)} target="_blank" rel="noreferrer">
                  打开原文 ↗
                </a>
                <button type="button" className="brief-text-action" onClick={() => onBlock(new URL(source.url).hostname)}>
                  屏蔽 {new URL(source.url).hostname} 网站
                </button>
              </div>
            ) : null}
          </details>
        ))}
      </section>
    </>
  );
}
