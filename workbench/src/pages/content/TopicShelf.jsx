// 写作列表的「选题」一档（2026-09-24）：按来源分三个页签——来自情报 / 来自我的知识 / 我的想法（和情报页同一套 ViewTabs）。
//
// ⚠️ **卡片和「在写」那一档是同一套**（`.content-card`，见 ProjectCards.jsx）：同一页换个页签，
// 卡片的大小、字号、操作条位置不该变。一张卡只回答挑题时要看的三件事：走到哪一步了（左上）、
// 多久以前（右上）、建议什么时候之前写 / 从哪条情报来（标题下）。
// 「来自我的知识」页签里还放 AI 最近一次扫描找到、还没加入的「知识 × 读者问题」（虚线卡），一键加入就建成这篇内容；
// 这个页签的右侧是「重新扫描」「自己搭一个」。原来单独的「从我的知识里找」页面不再作为入口（选题方法见 docs/工作流.md）。
import { useState } from "react";
import { RowDelete, ViewTabs, relTime } from "../../components/ui.jsx";
import { IconBooks, IconBulb, IconLoader2, IconPlus, IconRadar2, IconRefresh, IconSparkles } from "../../components/icons.jsx";

const WINDOW = { "24h": "建议 24 小时内写", week: "建议本周内写" };
const SECTIONS = [
  ["intel", "来自情报", "外面发生了什么", IconRadar2],
  ["bridge", "来自我的知识", "我搞懂了什么 × 读者在问什么", IconBooks],
  ["own", "我的想法", "随手记下的", IconBulb],
];
const EMPTY = {
  intel: "在情报里点「加入选题」，会出现在这里。",
  bridge: "点「重新扫描」，从你的 Wiki 和读者问题里找题；或者自己搭一个。",
  own: "新建一篇、或在「记一下」里记下的想法，会出现在这里。",
};
const sectionOf = (item) => item.origin?.kind === "intel" ? "intel" : item.origin?.kind === "bridge" ? "bridge" : "own";

function TopicCard({ item, onOpen, onPark, onRemove }) {
  const o = item.origin || {};
  const stage = item.stage || { key: "new", label: "还没选角度" };
  return <article className="content-card topic-card" data-topic={item.id}>
    <button className="content-card__open topic-card__open" onClick={() => onOpen(item)} aria-label={`打开选题「${item.title}」`}>
      <span className="content-card__meta">
        <span className={`topic-stage is-${stage.key}`}>{stage.label}</span>
        <time>{relTime(item.updatedAt)}</time>
      </span>
      <h2 title={item.title}>{item.title}</h2>
      <span className="content-card__details">
        {o.window ? <span className={o.window === "24h" ? "is-urgent" : ""}>{WINDOW[o.window]}</span> : null}
        {o.kind === "legacy" ? <span>以前的选题</span> : null}
        {o.title && o.title !== item.title ? <span className="topic-card__from" title={o.title}>{o.title}</span> : null}
      </span>
    </button>
    <footer className="content-card__actions">
      {onPark && item.kind === "project" ? <button className="btn btn-sm" onClick={() => onPark(item)}>先放着</button> : <span />}
      <span className="content-card__remove"><RowDelete onDelete={() => onRemove(item)} label="删掉" title={`删掉选题「${item.title}」——移入回收站，可以撤销`} /></span>
    </footer>
  </article>;
}

/** AI 扫描找到、还没加入的一条「知识 × 读者问题」。加入之前它只是候选，所以是虚线卡。 */
function FoundCard({ found, scanning, onAdd }) {
  const [busy, setBusy] = useState(false);
  const anchors = (found.knowledgeAnchors || []).map((a) => a.title).filter(Boolean);
  const add = async () => { setBusy(true); try { await onAdd(found); } finally { setBusy(false); } };
  return <article className="content-card topic-card is-found" aria-busy={scanning || undefined}>
    <div className="content-card__open topic-card__body">
      <span className="content-card__meta"><span className="topic-stage is-found"><IconSparkles aria-hidden="true" />AI 找到的</span></span>
      <h2 title={found.problem?.statement || found.coreClaim}>{found.problem?.statement || found.coreClaim}</h2>
      <span className="content-card__details">{anchors.length ? <span className="topic-card__from">知识：{anchors.join("、")}</span> : null}</span>
    </div>
    <footer className="content-card__actions">
      <button className="btn btn-sm" disabled={busy || scanning} onClick={add}>{busy ? <IconLoader2 className="spin" aria-hidden="true" /> : <IconPlus aria-hidden="true" />}加入选题</button>
    </footer>
  </article>;
}

const store = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };

export function TopicShelf({ items, found = [], scanning = false, onOpen, onPark, onRemove, onAddFound, onScan, onBuild }) {
  const lists = Object.fromEntries(SECTIONS.map(([key]) => [key, items.filter((item) => sectionOf(item) === key)]));
  // 三个来源切着看（2026-09-24 用户反馈：和情报页一样用页签）。没选过就停在第一个有东西的来源。
  const [picked, setPicked] = useState(() => store.get("topic-source"));
  const firstFull = SECTIONS.find(([key]) => lists[key].length || (key === "bridge" && found.length))?.[0] || "intel";
  const tab = SECTIONS.some(([key]) => key === picked) ? picked : firstFull;
  const choose = (key) => { setPicked(key); store.set("topic-source", key); };
  const [, name, hint] = SECTIONS.find(([key]) => key === tab);
  const list = lists[tab], extra = tab === "bridge" ? found : [];
  return <div className="topic-shelf">
    <div className="topic-shelf__bar">
      <ViewTabs label="选题来源" value={tab} onChange={choose}
        items={SECTIONS.map(([key, label, tip, Icon]) => ({ key, label, icon: Icon, hint: tip, count: lists[key].length + (key === "bridge" ? found.length : 0) || null }))} />
      <span className="topic-shelf__hint">{hint}</span>
      {tab === "bridge" ? <span className="topic-sec__acts">
        <button className="btn btn-sm" disabled={scanning} onClick={onScan}><IconRefresh aria-hidden="true" className={scanning ? "spinning" : ""} />{scanning ? "正在扫描" : "重新扫描"}</button>
        <button className="btn btn-sm" onClick={onBuild}>自己搭一个</button>
      </span> : null}
    </div>
    <section className="topic-sec" role="tabpanel" aria-label={name}>
      {tab === "bridge" && scanning ? <p className="topic-sec__status" role="status"><IconLoader2 className="spin" aria-hidden="true" />正在读你的 Wiki 和读者问题找题，大约半分钟。找到的会出现在下面，可以先看别的。</p> : null}
      {list.length || extra.length ? <div className="content-card-grid">
        {list.map((item) => <TopicCard key={item.key} item={item} onOpen={onOpen} onPark={onPark} onRemove={onRemove} />)}
        {extra.map((c) => <FoundCard key={c.directionId} found={c} scanning={scanning} onAdd={onAddFound} />)}
      </div> : <p className="topic-sec__empty">{EMPTY[tab]}</p>}
    </section>
  </div>;
}
