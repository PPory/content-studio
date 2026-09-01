import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { useDialog } from "../lib/use-dialog.js";
import { ErrorNote, Note } from "./ui.jsx";
import { IconArchive, IconX } from "./icons.jsx";

const PAGE_TYPES = [["synthesis", "综合"], ["concept", "概念"], ["method", "方法"], ["topic", "主题"], ["comparison", "比较"], ["overview", "概览"], ["stance", "立场"]];
const plain = (value = "") => String(value).replace(/^#+\s*/gm, "").replace(/[>*_`~-]/g, "").replace(/\s+/g, " ").trim();

function draftFrom(messages, source) {
  const answer = [...(messages || [])].reverse().find((item) => ["agent", "assistant"].includes(item.role) && item.text)?.text || "";
  const firstLine = plain(answer.split(/\n+/).find((line) => plain(line)) || "").slice(0, 80);
  const title = plain(source?.title && source.title !== "AI 助手对话" ? source.title : firstLine) || "对话中的新理解";
  const summary = plain(answer.split(/\n\s*\n/).find((part) => plain(part)) || answer).slice(0, 300);
  return { title, pageType: "synthesis", summary, bodyMarkdown: `# ${title}\n\n${answer}`.trim(), why: "把本轮对话中形成的可复用理解沉淀为持续维护的 Wiki 页面。" };
}

export function KnowledgeCardDialog({ open, onClose, messages, source, scopeId, conversationId, onConversation }) {
  const signature = useMemo(() => JSON.stringify((messages || []).map((m) => [m.role, m.text])), [messages]);
  const sourceTitle = source?.title || "";
  // 候选挂回对话会让父组件换一份 messages 数组，但正文并没有变；按内容签名记忆，避免成功后立刻重置对话框。
  const initial = useMemo(() => draftFrom(messages, source), [signature, sourceTitle]);
  const [draft, setDraft] = useState(initial);
  const [pages, setPages] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [queued, setQueued] = useState(false);
  const previousSignature = useRef("");
  const boxRef = useDialog(open, onClose);

  useEffect(() => {
    if (!open) return;
    setDraft(initial); setError(null); setQueued(false); setLoading(true);
    const query = plain(`${initial.title} ${initial.summary}`).slice(0, 120);
    api.wiki(query).then(async (result) => {
      let items = (result.pages || []).filter((item) => Number(item.sourceCount || 0) > 0);
      if (!items.length) items = ((await api.wiki("")).pages || []).filter((item) => Number(item.sourceCount || 0) > 0);
      setPages(items.slice(0, 12));
      setSelected(items.slice(0, 3).map((item) => item.id));
    }).catch(setError).finally(() => setLoading(false));
    previousSignature.current = signature;
  }, [open, initial, signature]);

  useEffect(() => {
    if (!open && previousSignature.current && previousSignature.current !== signature) {
      setPages([]); setSelected([]); setError(null); setQueued(false);
    }
  }, [open, signature]);

  if (!open) return null;
  const patch = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-6));

  async function propose() {
    if (saving || queued) return;
    setSaving(true); setError(null);
    try {
      const result = await api.proposeAssistantWikiPage({ scopeId, conversationId, ...draft, basedOnPageIds: selected });
      onConversation?.(result.conversation);
      setQueued(true);
    } catch (next) { setError(next); }
    finally { setSaving(false); }
  }

  const valid = draft.title.trim() && draft.summary.trim() && draft.bodyMarkdown.trim().length >= 80 && selected.length && conversationId;
  return <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="drawer drawer--wide" ref={boxRef} role="dialog" aria-modal="true" aria-label="存入 Wiki 预览">
      <div className="drawer-head"><div><span className="eyebrow">WIKI CANDIDATE</span><div className="drawer-title">存入 Wiki</div></div><button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭"><IconX /></button></div>
      <Note title="先生成候选，再由你确认写入">这一步不会修改正式 Wiki。候选会回到当前对话，只有点击“确认归档”后才会写入。</Note>
      <div className="field"><label>页面标题</label><input data-autofocus="" value={draft.title} onChange={(event) => patch("title", event.target.value)} /></div>
      <div className="field"><label>页面类型</label><select value={draft.pageType} onChange={(event) => patch("pageType", event.target.value)}>{PAGE_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <div className="field"><label>摘要</label><textarea value={draft.summary} onChange={(event) => patch("summary", event.target.value)} /></div>
      <div className="field"><label>完整页面</label><textarea className="wiki-candidate-body" value={draft.bodyMarkdown} onChange={(event) => patch("bodyMarkdown", event.target.value)} /></div>
      <div className="field"><label>依据哪些现有 Wiki 页面</label>{loading ? <p className="wiki-basis-empty">正在查找相关页面…</p> : pages.length ? <div className="wiki-basis-list">{pages.map((page) => <label key={page.id}><input type="checkbox" checked={selected.includes(page.id)} onChange={() => toggle(page.id)} /><span><b>{page.title}</b><small>{page.summary || `${page.sourceCount} 个来源`}</small></span></label>)}</div> : <p className="wiki-basis-empty">还没有可回溯来源的相关页面。先在对话中使用 @知识库 检索，再形成新的综合结论。</p>}</div>
      <ErrorNote error={error} what="生成 Wiki 候选" />
      {queued ? <Note tone="success" title="候选已放回当前对话">关闭此窗口后，在回答下方检查内容并决定是否确认归档。</Note> : null}
      <div className="drawer-foot"><button className="btn" onClick={onClose}>{queued ? "查看待确认候选" : "取消"}</button><button className="btn btn-primary" onClick={propose} disabled={!valid || loading || saving || queued}><IconArchive />{saving ? "生成中…" : queued ? "已生成候选" : "生成待确认候选"}</button></div>
    </section>
  </div>;
}
