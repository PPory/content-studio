// 这篇的资料（2026-09-24）：工作区左栏，选题和写作共用。
//
// 上面是这篇背后研究记录里的资料，分三组：来源（情报和网页原文）、知识（Wiki）、补充资料。
// 下面是 children：原来右栏「资料」工具里的选母版、种子、个人参考（引用前确认发往哪个 AI 服务）和项目素材，
// 右栏只留协作后原样搬到这里，确认与写入规则仍在那几个组件里，不在这里另做一套。
// 每条只给三件事：引用（写正文时插到光标处）、详情、原文。补资料在这里一处完成：从资料库挑、或贴一个链接。
// 资料挂在这篇背后的研究记录上（`ensureProjectResearch`），起稿时 `projectCreativeContext` 会读到。
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { IconArrowUpRight, IconChevronLeft, IconChevronRight, IconPlus, IconX } from "./icons.jsx";
import { ErrorNote } from "./ui.jsx";
import "./piece-library.css";

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const groupOf = (ref) => ref.kind === "wiki" ? "知识" : ref.sourceUrl ? "来源" : "补充资料";

export function PieceLibrary({ projectId, materials = [], writing = false, onCite, onGo, onChanged, controlRef, children }) {
  const key = "piece-library-collapsed";
  // 写正文时默认收起，给编辑器让出空间；手动开过就记住。
  const [collapsed, setCollapsed] = useState(() => { const v = store.get(key); return v === null ? writing : v === "1"; });
  const [refs, setRefs] = useState(null), [assets, setAssets] = useState([]), [error, setError] = useState(null);
  const [adding, setAdding] = useState(false), [fresh, setFresh] = useState("");
  const researchId = useRef("");
  const toggle = (v) => { setCollapsed(v); store.set(key, v ? "1" : "0"); };

  const load = useCallback(async () => {
    try {
      const [{ researches }, personal] = await Promise.all([api.projectResearches(projectId), api.projectPersonalAssets(projectId).catch(() => ({ references: [] }))]);
      researchId.current = researches?.[0]?.id || "";
      setRefs((researches?.[0]?.references || []).filter((r) => !r.missing));
      setAssets(personal.references || []);
      setError(null);
    } catch (e) { setError(e); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  // 补齐那一步的「我自己放」从外面打开这里的添加面板，并说明是为哪一项补（挂上之后那一项才算补上）。
  useImperativeHandle(controlRef, () => ({ add: (forGap = "") => { toggle(false); setAdding(forGap || true); }, reload: load }), [load]);

  async function attach(item) {
    const id = researchId.current || (await api.projectResearch(projectId)).researchId;
    researchId.current = id;
    await api.researchReference(id, { kind: item.kind, id: item.id });
    setFresh(`${item.kind}:${item.id}`); setTimeout(() => setFresh(""), 2400);
    const forGap = typeof adding === "string" ? adding : "";
    setAdding(false); await load(); onChanged?.({ forGap });
  }

  const groups = { 来源: [], 知识: [], 补充资料: [] };
  for (const r of refs || []) groups[groupOf(r)].push(r);
  const count = (refs?.length || 0) + materials.length + assets.length;

  if (collapsed) return <aside className="piece-lib is-collapsed" aria-label="这篇的资料">
    <button type="button" className="piece-lib__rail" onClick={() => toggle(false)} title={`展开这篇的资料（${count} 份）`} aria-label={`展开资料（${count} 份）`}><IconChevronRight aria-hidden="true" /></button>
  </aside>;

  const item = (r) => {
    const id = `${r.kind}:${r.id}`;
    return <li key={id} className={fresh === id ? "is-fresh" : ""}>
      <span className="piece-lib__title">{r.title || "未命名资料"}</span>
      <span className="piece-lib__meta">{[r.nature, r.sourceUrl ? hostOf(r.sourceUrl) : ""].filter(Boolean).join(" · ")}</span>
      <span className="piece-lib__acts">
        {writing && onCite ? <button type="button" onClick={() => onCite(r)}>引用</button> : null}
        <button type="button" onClick={() => r.kind === "wiki" ? onGo?.("entries", r.id) : onGo?.("library", id)}>详情</button>
        {r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer">原文<IconArrowUpRight aria-hidden="true" /></a> : null}
      </span>
    </li>;
  };

  return <aside className="piece-lib" aria-label="这篇的资料">
    <header className="piece-lib__head">
      <strong>资料</strong><span>{count}</span>
      <button type="button" className="icon-btn" onClick={() => toggle(true)} aria-label="收起资料"><IconChevronLeft aria-hidden="true" /></button>
    </header>
    <ErrorNote error={error} what="读取这篇的资料" onRetry={load} />
    <div className="piece-lib__scroll">
      {Object.entries(groups).map(([name, list]) => list.length ? <section key={name}><h3>{name}</h3><ul>{list.map(item)}</ul></section> : null)}
      {refs && !refs.length ? <p className="piece-lib__empty">这篇背后还没有资料。</p> : null}
      {adding ? <AddPanel forGap={typeof adding === "string" ? adding : ""} onPick={attach} onClose={() => setAdding(false)} attached={new Set((refs || []).map((r) => `${r.kind}:${r.id}`))} /> : <button type="button" className="piece-lib__add" onClick={() => setAdding(true)}><IconPlus aria-hidden="true" />补资料</button>}
      {children ? <div className="piece-lib__more">{children}</div> : null}
    </div>
  </aside>;
}

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }

/**
 * 补资料：一个输入框。打关键词就搜资料库；贴的是链接就只给「把这个链接放进来」（先存成一条记一下，再挂上）。
 *
 * ⚠️ 没输入时不列东西（2026-09-24 用户反馈）：原来空搜索会列出资料库最近几条，和这篇毫无关系，看着像是
 * 「这篇已经有的资料」。窄栏里也放不下第二个输入框加按钮，按钮被挤成竖排。
 */
function AddPanel({ forGap = "", onPick, onClose, attached }) {
  const [q, setQ] = useState(""), [items, setItems] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const term = q.trim(), isLink = /^https?:\/\/\S+$/i.test(term);
  useEffect(() => {
    if (!term || isLink) { setItems(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => api.library(term, "").then((r) => { if (alive) setItems((r.items || []).slice(0, 8)); }).catch((e) => { if (alive) setError(e); }), 200);
    return () => { alive = false; clearTimeout(t); };
  }, [term, isLink]);
  async function pick(item) { setBusy(true); setError(null); try { await onPick(item); } catch (e) { setError(e); } finally { setBusy(false); } }
  async function addLink() {
    setBusy(true); setError(null);
    try { const note = await api.quickNote({ text: term, sourceUrl: term }); await onPick({ kind: "capture", id: note.item?.id || note.id }); }
    catch (err) { setError(err); } finally { setBusy(false); }
  }
  return <div className="piece-lib__panel" role="group" aria-label="补资料">
    <div className="piece-lib__panel-head"><strong>{forGap ? `为「${forGap}」补资料` : "补资料"}</strong><button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><IconX aria-hidden="true" /></button></div>
    <input id="piece-lib-search" aria-label="搜资料库或贴链接" placeholder="搜资料库，或贴一个链接" value={q} autoFocus
      onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && isLink && !busy) { e.preventDefault(); addLink(); } if (e.key === "Escape") onClose(); }} />
    {isLink ? <button type="button" className="piece-lib__link" disabled={busy} onClick={addLink}><IconPlus aria-hidden="true" /><span>把这个链接放进来<small>{hostOf(term)}</small></span></button>
      : !term ? <p className="piece-lib__hint">输入标题或正文里的词，从你的资料库、Wiki 和收藏里找；也可以直接贴一个网页链接。</p>
      : items && !items.length ? <p className="piece-lib__hint">资料库里没有含「{term}」的资料。换个词，或者贴原文链接。</p>
      : <ul className="piece-lib__results">{(items || []).map((it) => {
        const have = attached.has(`${it.kind}:${it.id}`);
        return <li key={`${it.kind}:${it.id}`}><button type="button" disabled={busy || have} onClick={() => pick(it)}>
          <span className="piece-lib__result-title">{it.title || "未命名"}</span><small>{have ? "已在这篇" : [it.nature || it.kind, it.sourceUrl ? hostOf(it.sourceUrl) : ""].filter(Boolean).join(" · ")}</small>
        </button></li>;
      })}</ul>}
    <ErrorNote error={error} what="补资料" />
  </div>;
}
