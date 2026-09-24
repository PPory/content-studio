// 第一步：读懂。把这篇选题的来龙去脉摊开读，用户在这一步只读，不做任何操作。
// 来自情报：深入解读（加入选题时已自动排队生成）；来自知识：读者的问题 × 你的知识；来自想法：你的原话。
// 能核对出处：解读里的 [引文N] 是可点的角标（原话 + 来源，点开原文），末尾还有一份完整的引文清单。
// 深读没生成出来要说清楚、能重来；知识来的选题问题是推导出来的，给「让 AI 找真实读者原话」。
import { Fragment, useState } from "react";
import { api } from "../../lib/api.js";

/** 深读正文是轻量 Markdown：段落、### 小标题、列表、**加粗**、[引文N]。这里只做这几样，不引入整套渲染。 */
function Body({ text, citations = [] }) {
  const byNumber = new Map(citations.map((c) => [String(c.number), c]));
  const inline = (line, k) => line.split(/(\*\*[^*]+\*\*|\[引文\d+\])/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong>;
    const cite = part.match(/^\[引文(\d+)\]$/);
    if (!cite) return <Fragment key={`${k}-${i}`}>{part}</Fragment>;
    const c = byNumber.get(cite[1]);
    const tip = c ? [c.quote && `「${c.quote}」`, c.title].filter(Boolean).join(" —— ") : "";
    return <sup key={`${k}-${i}`} className="tf-cite">{c?.url
      ? <a href={c.url} target="_blank" rel="noreferrer" title={tip} aria-label={`引文 ${cite[1]}：${tip}（打开原文）`}>{cite[1]}</a>
      : <a href={`#tf-cite-${cite[1]}`} title={tip || "引文"} aria-label={`引文 ${cite[1]}`}>{cite[1]}</a>}</sup>;
  });
  return String(text || "").split(/\n{2,}/).map((block, i) => {
    const b = block.trim();
    if (!b) return null;
    if (/^#{2,4}\s/.test(b)) return <h3 key={i} className="tf-subhead">{b.replace(/^#+\s*/, "")}</h3>;
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*>/.test(l))) return <blockquote key={i} className="tf-quote">{inline(lines.map((l) => l.replace(/^\s*>\s?/, "")).join(" "), i)}</blockquote>;
    if (lines.every((l) => /^\s*(?:[-*]|\d+\.)\s/.test(l))) return <ul key={i} className="tf-list">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*(?:[-*]|\d+\.)\s/, ""), `${i}-${j}`)}</li>)}</ul>;
    return <p key={i}>{inline(b.replace(/\n/g, " "), i)}</p>;
  });
}

export function StageRead({ projectId = "", view, title = "", busy, onNext, onGo, onAsk, onReload }) {
  const { read, wiki } = view;
  const b = read.brief;
  const deepening = read.kind === "intel" && ["queued", "running"].includes(read.deepen?.status);
  const deepFailed = read.kind === "intel" && read.deepen?.status === "failed" && b.depth !== "deep";
  const [retrying, setRetrying] = useState(false), [retryError, setRetryError] = useState("");
  async function retryDeepen() {
    setRetrying(true); setRetryError("");
    try { await api.intelligenceDeepen(b.id, { force: true }); await onReload?.(); } catch (e) { setRetryError(e.message || "没能重新开始"); } finally { setRetrying(false); }
  }
  // 看原情报卡：记下是从哪篇来的，情报详情的返回按钮就能写「回到这篇」并回到这里。
  const openCard = () => { try { sessionStorage.setItem("intel-return", JSON.stringify({ view: "project", id: projectId, title })); } catch {} onGo?.("intel-detail", b.id); };
  return <section className="tf-stage" aria-label="读懂">
    {read.kind === "intel" ? <>
      <p className="tf-lead">{b.summary}</p>
      {deepening ? <p className="tf-status" role="status"><span className="tf-pulse" aria-hidden="true" />深入解读生成中{read.deepen.stage ? `：${read.deepen.stage}` : ""}{read.deepen.estimateSec ? `，通常 ${Math.ceil(read.deepen.estimateSec / 60)} 分钟左右` : ""}。先看概要，生成完这里会自动换成完整内容。</p> : null}
      {deepFailed ? <div className="tf-note tf-note--warn" role="status">
        <p>深入解读没生成出来{read.deepen.error ? `：${read.deepen.error}` : ""}。下面是卡片上的概要，也可以先照着它往下走。</p>
        <button type="button" className="text-action" disabled={retrying} onClick={retryDeepen}>{retrying ? "正在重新开始…" : "重新生成深入解读"}</button>
        {retryError ? <span className="tf-note__err">{retryError}</span> : null}
      </div> : null}
      {b.depth === "deep" && b.body ? <div className="tf-prose"><Body text={b.body} citations={b.citations} /></div> : null}
      {b.keyFacts?.length ? <div className="tf-block"><h2>关键事实</h2><ol className="tf-facts">{b.keyFacts.map((f, i) => <li key={i}>{f}</li>)}</ol></div> : null}
      {b.whyItMatters || b.useFor || b.notFor ? <div className="tf-block"><h2>值不值得写</h2><dl className="tf-pairs">
        {b.whyItMatters ? <><dt>为什么值得写</dt><dd>{b.whyItMatters}</dd></> : null}
        {b.useFor ? <><dt>对谁有用</dt><dd>{b.useFor}</dd></> : null}
        {b.notFor ? <><dt>对谁没用</dt><dd>{b.notFor}</dd></> : null}
      </dl></div> : null}
      {b.uncertainties?.length ? <div className="tf-block"><h2>还不确定的</h2><ul className="tf-quiet">{b.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul></div> : null}
      {b.depth === "deep" && b.citations?.length ? <details className="tf-citations"><summary>解读引用的原话（{b.citations.length}）</summary><ol>
        {b.citations.map((c) => <li key={c.number} id={`tf-cite-${c.number}`}><span className="tf-citations__n">{c.number}</span><q>{c.quote}</q>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.title || "原文"}</a> : c.title ? <span>{c.title}</span> : null}</li>)}
      </ol></details> : null}
      <p className="tf-aside"><button type="button" className="text-action" onClick={openCard}>看原情报卡</button></p>
    </> : read.kind === "bridge" ? <>
      <div className="tf-block"><h2>读者在问什么</h2><p className="tf-question">{read.problem}</p>
        {read.hypothesis ? <div className="tf-note"><p>这个问题是从你的长期议程推导出来的，还没有真实读者这样问过。开写前最好找到几条真实的原话。</p>
          <button type="button" className="text-action" onClick={() => onAsk?.(`帮我找真实读者关于这个问题的原话：「${read.problem}」。去社区、问答和评论区里找（例如 Reddit、知乎、小红书评论、V2EX），每条给出原话、出处链接和一句说明它为什么相关；只给真实存在、能打开的出处，找不到就直说，不要编造，也不要改写正文。每找到一个能用的网页，就提出「放进这篇的资料」让我确认。`)}>让 AI 找真实读者原话</button>
        </div> : null}</div>
      {read.now ? <div className="tf-block"><h2>他们现在怎么想</h2><p>{read.now}</p></div> : null}
      {read.know ? <div className="tf-block"><h2>你的知识怎么解释</h2><p>{read.know}</p>{read.core ? <p className="tf-claim">{read.core}</p> : null}</div> : null}
      {read.counter?.length ? <div className="tf-block"><h2>反面意见</h2><ul className="tf-quiet">{read.counter.map((c, i) => <li key={i}>{c}</li>)}</ul></div> : null}
    </> : <>
      {/* 想讲的就是标题时不再抄一遍（记一下建的内容，标题就取自这句话）。 */}
      {read.thought?.trim() && read.thought.trim() === title.trim() ? null
        : <div className="tf-block"><h2>你想讲的</h2><p className="tf-question">{read.thought || "还没写下想讲什么。"}</p></div>}
      {read.notes ? <div className="tf-block"><h2>你之前记下的</h2><div className="tf-prose tf-prose--quiet"><Body text={read.notes} /></div></div> : null}
    </>}
    {wiki.length ? <div className="tf-block"><h2>可以借用的知识</h2><ul className="tf-wiki-list">{wiki.map((p) => <li key={p.id}><button type="button" className="text-action" onClick={() => onGo?.("entries", p.id)}>《{p.title}》</button>{p.summary ? <span>{p.summary}</span> : null}</li>)}</ul></div> : null}
    <div className="tf-next">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={onNext}>{busy ? "正在想角度…" : "看看可以从哪几个角度写"}</button>
      {busy ? <span className="tf-hint">大约 15 秒</span> : null}
    </div>
  </section>;
}
