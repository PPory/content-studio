// 阅读区右栏 = 批注台：我留下的东西（高亮/批注）· 让 AI 看这段 · 和 Pi 深聊。
//
// **每个页签都是同一套三段结构：固定的上下文 → 滚动的内容 → 固定的动作条。**
// 这不是排版洁癖。上一版是「所有东西排成一列一起滚」，三个具体后果：
//   - 「理解」里那段引用会跟着往上滚出屏幕，读到一半忘了 AI 在解释哪句话；
//   - 「存为笔记」按钮沉在内容底下，输出长一点就得先滚到底才能点；
//   - 对话的输入框跟着消息跑，聊两轮就得先滚到底才能打字。
// 动作条固定之后，按钮永远在同一个位置，肌肉记忆才立得住。
//
// 页签只有三个可见项，「写批注」不是页签——它由动作触发：在正文里划一段点「批注」
// 就直接进编辑器。用户不需要先想「我该切到哪个页签」。

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown } from "../lib/markdown.js";
import { ErrorNote } from "./ui.jsx";
import { CHAT_PERMISSION_MODES, chatModeInfo, piAgentName } from "../lib/chat-agent.js";
import { KnowledgeCardDialog } from "./KnowledgeCardDialog.jsx";
import {
  IconArchive,
  IconCheck,
  IconChevronsRight,
  IconCopy,
  IconHighlight,
  IconMessageCircle,
  IconNotes,
  IconPencil,
  IconPlus,
  IconSend,
  IconSparkles,
  IconTrash,
  IconWand,
} from "./icons.jsx";

const TABS = [
  { key: "notes", label: "标记", icon: IconNotes },
  // 叫「衍生」不叫「理解」：这一栏里五个模式只有前三个算理解，翻译不是、
  // 选题更不是。它们的共同点是**都从选中那段派生出一个新产出，且都不落盘除非你存**——
  // 「衍生」说的是这个，「理解」把其中两个排除在外了。
  { key: "ai", label: "衍生", icon: IconSparkles },
  { key: "chat", label: "AI 助手", icon: IconMessageCircle },
];

/**
 * 页签是**可以只给一部分**的（`tabs` prop）。热点原文那条路只给「理解」：
 * 那篇文章不在 vault 里——没有 notes.md 可写、没有 .highlights.md 可锚，
 * 「标记」在那儿是个永远空的页签。**禁用比隐藏更糟，画一个点了没落点的页签更糟。**
 */
const pickTabs = (keys) => (keys?.length ? TABS.filter((t) => keys.includes(t.key)) : TABS);

/**
 * 把这一段拷走。**图标按钮 + 就地回执**，不弹 toast。
 *
 * 为什么和划词工具条那个「复制」不一样：那个点完工具条自己就消失了，没地方显示回执，
 * 只能弹 toast；这个按钮点完还在原地，回执就该出现在你刚看的地方——横跨半屏去右下角
 * 找一条提示，是多走一趟。
 *
 * **失败必须说话。** 剪贴板在没授权或非安全上下文时会抛，静默失败的表现是「点了没反应」，
 * 而人的下一步是去粘贴——粘出来的是上一次的东西，比直接报错难查得多。所以失败时
 * 按钮**变成一个带字的按钮**：图标按钮上只改 title 等于没提示。
 *
 * 复制的是 **Markdown 原文**不是渲染后的纯文本：这段东西的去处基本都是 Obsidian、
 * 排版工具或另一个对话框，标题和列表要留着。
 */
function CopyButton({ text, label = "复制这段" }) {
  const [state, setState] = useState(""); // "" | "ok" | "fail"
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(() => {
    const done = (s) => {
      setState(s);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState(""), 1800);
    };
    const p = navigator.clipboard?.writeText(String(text ?? ""));
    // `?.` 在没有 clipboard 时返回 undefined，直接 .then 会抛——那正好是最该报出来的一种失败
    if (p?.then) p.then(() => done("ok"), () => done("fail"));
    else done("fail");
  }, [text]);

  const Icon = state === "ok" ? IconCheck : IconCopy;
  return (
    <button
      className={`btn btn-sm${state === "fail" ? "" : " btn-icon"}`}
      onClick={copy}
      aria-label={label}
      title={state === "ok" ? "已复制" : state === "fail" ? "复制失败，手动选中拷一下" : label}
    >
      <Icon aria-hidden="true" />
      {state === "fail" ? "复制失败" : null}
    </button>
  );
}

export function SideRail({
  mode, // "notes" | "annotate" | "ai" | "chat"
  onMode,
  onCollapse,
  annotateLabel,
  notes,
  highlights,
  onRemoveHighlight,
  quote,
  onSaveNote,
  ai, // { mode, text, running, error }
  onSaveAiAsNote,
  onStopAi,
  onRunAi,
  chat, // { messages, running, error, agent }
  onSend,
  onStopChat,
  onSaveChatAsNote,
  onChatMode,
  onNewChat,
  noteItems,
  onEditNote,
  onDeleteNote,
  onRailSelect, // ({ action, text }) => void，在右栏里划词的三个去处
  tabs,         // 可选：只显示这几个页签（热点原文只给「理解」）
  /**
   * 可选：把「存为笔记」换个说法和去处。
 * **按钮上的字必须说实话**——热点原文不在 vault 里，那儿的「存」落进的是素材库，
   * 还写「存为笔记」就是骗人。同理 `railActions` 用来去掉在当前源上没有落点的动作。
   */
  saveLabel = "存为笔记",
  railActions,
  knowledgeSource,
}) {
  // 写批注时页签停在「标记」上——它是批注流程的一步，不是第四个地方
  const activeTab = mode === "annotate" ? "notes" : mode;
  const railRef = useRef(null);
  const sel = useRailSelection(railRef, onRailSelect);
  const shown = pickTabs(tabs);
  const acts = railActions?.length ? RAIL_ACTIONS.filter((a) => railActions.includes(a.key)) : RAIL_ACTIONS;

  return (
    <aside className="rail" ref={railRef}>
      <header className="rail-head">
        <div className="rail-tabs seg">
          {shown.map((t) => (
            <button key={t.key} aria-pressed={activeTab === t.key} onClick={() => onMode(t.key)}>
              <t.icon aria-hidden="true" stroke={1.7} />
              {t.label}
            </button>
          ))}
        </div>
        {onCollapse ? (
          <button className="icon-btn rail-collapse" onClick={onCollapse} title="收起批注台" aria-label="收起批注台">
            <IconChevronsRight aria-hidden="true" stroke={1.8} />
          </button>
        ) : null}
      </header>

      {mode === "annotate" ? (
        <AnnotateForm quote={quote} label={annotateLabel} onSave={onSaveNote} onCancel={() => onMode("notes")} />
      ) : mode === "ai" ? (
        <AiPanel ai={ai} onSave={onSaveAiAsNote} onStop={onStopAi} onRun={onRunAi} saveLabel={saveLabel} />
      ) : mode === "chat" ? (
        <ChatPanel
          chat={chat}
          onSend={onSend}
          onStop={onStopChat}
          onSave={onSaveChatAsNote}
          onMode={onChatMode}
          onNewChat={onNewChat}
          knowledgeSource={knowledgeSource}
        />
      ) : (
        <MarksPanel
          notes={notes}
          noteItems={noteItems}
          onEditNote={onEditNote}
          onDeleteNote={onDeleteNote}
          highlights={highlights}
          onRemove={onRemoveHighlight}
          label={annotateLabel}
        />
      )}

      {/* **和正文里那条是同一个工具条**：同一套类名、同一套自绘 tooltip、同一种分组竖线。
          划词这个动作在哪儿做都是一回事，长两个样子只会让人以为它们功能不同。 */}
      {sel.at ? (
        <div className="sel-bar sel-bar--fixed" style={{ left: sel.at.x, top: sel.at.y }}>
          {acts.map((a, i) => (
            <Fragment key={a.key}>
              {i > 0 && acts[i - 1].group !== a.group ? <span className="sel-bar__sep" aria-hidden="true" /> : null}
              <button
                aria-label={a.label}
                onClick={() => (onRailSelect({ action: a.key, text: sel.at.text }), sel.clear())}
              >
                <a.icon aria-hidden="true" stroke={1.7} />
                <span className="sel-bar__tip">
                  <b>{a.label}</b>
                  {a.hint}
                </span>
              </button>
            </Fragment>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

/**
 * 右栏里划词的三个去处。
 *
 * **AI 答出来的东西里最常有的就是能直接用的句子**——上一版只能整条「存为笔记」，
 * 想要其中一段就得手动复制再去别处粘。给的是三个，不是正文那八个：解释/展开/反驳
 * 在 AI 自己的输出上再来一遍是套娃，高亮更没有落点（这段话不在书里）。
 */
const RAIL_ACTIONS = [
  { key: "note", label: "存为笔记", icon: IconNotes, hint: "只把选中的这段写进 notes.md", group: 1 },
  { key: "intake", label: "存素材", icon: IconArchive, hint: "存成素材卡，离开这本书进流水线", group: 1 },
  // 选题在这儿**不算套娃**：解释/展开/反驳是「再理解一遍」，套在自己的输出上确实是套娃；
  // 而选题是「把这段变成能发的东西」，是另一种变换。AI 答出来的话里最常有的就是
  // 能直接成稿的那一两句，只能整条存走的话，那一句就得手动复制出去。
  { key: "选题", label: "选题", icon: IconWand, hint: "把这段变成能发的标题（4A 四个角度）", group: 1 },
  { key: "copy", label: "复制", icon: IconCopy, hint: "拷进剪贴板，带去工作台外面用", group: 2 },
];

/**
 * 在右栏里划词。和正文那套是两码事，所以不复用 Reader 的实现：
 * 这里的落点只有三个，而且要**挡掉工具条自己的 mouseup**——不挡的话点按钮会
 * 冒泡回来重算一次选区，工具条重渲染，那一下 click 落到已经被换掉的节点上，
 * 按钮看着能点但没反应（正文那边踩过一次）。
 */
function useRailSelection(ref, enabled) {
  const [at, setAt] = useState(null);
  const clear = useCallback(() => {
    setAt(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const onUp = (e) => {
      if (e.target.closest?.(".sel-bar")) return;
      // 等一帧：mouseup 当下选区还没落定
      setTimeout(() => {
        const s = window.getSelection();
        const text = s?.toString().trim() || "";
        if (text.length < 4 || !s.anchorNode || !el.contains(s.anchorNode)) return setAt(null);
        const r = s.getRangeAt(0).getBoundingClientRect();
        const box = el.getBoundingClientRect();
        // 夹在右栏里：贴着边选中的话，工具条会有一半飘到屏幕外
        setAt({ text, x: Math.min(Math.max(r.left + r.width / 2, box.left + 78), box.right - 78), y: Math.max(r.top - 8, 56) });
      }, 0);
    };
    const onDown = (e) => !e.target.closest?.(".sel-bar") && setAt(null);
    el.addEventListener("mouseup", onUp);
    el.addEventListener("mousedown", onDown);
    return () => {
      el.removeEventListener("mouseup", onUp);
      el.removeEventListener("mousedown", onDown);
    };
  }, [ref, enabled]);

  return { at, clear };
}

/**
 * 右栏里所有 Markdown 都走这一个组件，**而且它必须是 memo 的**。
 *
 * 这条是从正文那边搬过来的教训，代价一模一样：`dangerouslySetInnerHTML` 一旦重跑，
 * DOM 节点全换新的，**浏览器选区当场消失**。而右栏里随便一次 setState（划词弹出工具条
 * 就是一次）都会让父组件重渲染——不 memo 的话，你刚选中的那段话在工具条弹出的同一帧
 * 就已经不在选区里了。现象是「弹出菜单了，但看不出自己选中了哪几句，点按钮也没反应」。
 *
 * memo + useMemo 两个都要：memo 挡住父组件的重渲染，useMemo 保证 text 没变时
 * 连 HTML 字符串都不重新生成（marked.parse 每次返回新字符串，会让 innerHTML 重写）。
 */
const Md = memo(function Md({ text }) {
  // 和正文同一个入口（`lib/markdown.js`）：右栏放的是模型流式吐回来的字，
  // 它一样可能带着 `<img onerror=…>`——**消毒规则只准有一份**。
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="prose prose-sm" dangerouslySetInnerHTML={{ __html: html }} />;
});

/** 页签内容的骨架：固定头 / 滚动身 / 固定脚。三个页签都走这一个，省得各长各的样子。 */
function Panel({ head, foot, children }) {
  return (
    <div className="rail-panel">
      {head ? <div className="rail-panel__head">{head}</div> : null}
      <div className="rail-panel__body">{children}</div>
      {foot ? <div className="rail-panel__foot">{foot}</div> : null}
    </div>
  );
}

/**
 * 引用的原文。默认只露三行——它是「在说哪句话」的提示，不是要在这儿重读一遍。
 *
 * **「展开」按钮必须在 blockquote 外面。** 上一版把它写在里面，而 blockquote 上挂着
 * `-webkit-line-clamp: 3`——clamp 是按行裁的，第四行开始整个裁掉，按钮跟着被裁成半截，
 * 现象就是「内容显示不全，底下还挂着个残缺的方块」。
 *
 * 展开之后**不给它自己的滚动条**，跟着右栏一起滚：右栏本来就窄，套一个内滚区
 * 等于把一栏切成两半，鼠标在哪滚的是哪，手感直接碎掉。
 */
function Quote({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="rail-quote">
      {/* clamp 挂在**里层的 span** 上，不挂在有内边距的 blockquote 上：
          `-webkit-line-clamp` 按 content box 裁行，而 `overflow: hidden` 裁的是 padding box——
          两者不重合，于是 padding-bottom 那 8px 会把第四行的上半截露出来，看着就像没裁干净。 */}
      <blockquote className="rail-quote__text">
        <span data-open={open || undefined}>{text}</span>
      </blockquote>
      {text.length > 60 ? (
        <button className="rail-quote__more" onClick={() => setOpen((o) => !o)}>
          {open ? "收起" : `展开全部 ${text.length} 字`}
        </button>
      ) : null}
    </div>
  );
}

// ---- 标记：高亮 + 批注 ------------------------------------------------------

/**
 * 「我在这篇上留下了什么」。高亮和批注放在同一个页签里，因为它们回答的是同一个问题——
 * 分成两个页签的话，你得先想「我当时是划的还是写的」才知道该点哪个。
 */
function MarksPanel({ notes, noteItems, onEditNote, onDeleteNote, highlights, onRemove, label }) {
  const marks = highlights || [];
  const items = noteItems || [];
  const hasNotes = !!notes?.trim();
  // 切得出条目才给「改 / 删」。切不出来说明这份文件不是工作台写的格式
  // （多半是自己在 Obsidian 里重排过），那就老实只读——不能自作主张重排一遍别人的文件。
  const editable = !!onEditNote && items.length > 0;

  return (
    <Panel foot={<span className="rail-foot__note">{label}</span>}>
      {marks.length ? (
        <section className="rail-section">
          <span className="rail-label">
            <IconHighlight size={12} stroke={1.8} aria-hidden="true" />
            高亮 {marks.length}
          </span>
          <div className="mark-list">
            {marks.map((h) => (
              <div key={h.id} className="mark-item" data-color={h.color}>
                <button className="mark-item__text" onClick={() => h.onJump?.()} title="跳到正文里这一处">
                  {h.text}
                </button>
                {onRemove ? (
                  <button className="icon-btn mark-item__del" onClick={() => onRemove(h)} title="取消这处高亮" aria-label="取消高亮">
                    <IconTrash size={13} stroke={1.7} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rail-section">
        <span className="rail-label">
          <IconNotes size={12} stroke={1.8} aria-hidden="true" />
          批注 {items.length || ""}
        </span>
        {editable ? (
          items.map((it) => (
            <NoteItem key={`${it.stamp}-${it.index}`} note={it} onEdit={onEditNote} onDelete={onDeleteNote} />
          ))
        ) : hasNotes ? (
          <>
            <Md text={notes} />
            {onEditNote ? (
              <span className="rail-foot__note">这份 notes.md 不是工作台写的格式，改它请去 Obsidian</span>
            ) : null}
          </>
        ) : (
          <div className="rail-empty">
            <IconNotes aria-hidden="true" stroke={1.5} />
            <strong>还没有批注</strong>
            在正文里选中一段话，点工具条上的批注图标
          </div>
        )}
      </section>
    </Panel>
  );
}

/**
 * 一条批注：平时是渲染好的样子，点「改」就地变成输入框。
 *
 * **不跳到别的地方去改。** 批注短、改动小，跳一趟再回来的代价比改本身还大；
 * 就地编辑还能看着上下文改。删除要点两下，而且第二下写清「这条从 notes.md 里去掉」——
 * 它落在你的 vault 里，不是随手可弃的临时状态。
 */
function NoteItem({ note, onEdit, onDelete }) {
  const [mode, setMode] = useState("");   // "" | "edit" | "confirm"
  const [draft, setDraft] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode("");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="note-item">
      <header className="note-item__head">
        <time className="note-item__time">{note.stamp}</time>
        {mode === "" ? (
          <span className="note-item__acts">
            <button className="icon-btn" title="改这条批注" aria-label="改这条批注"
              onClick={() => (setDraft(note.body), setMode("edit"))}>
              <IconPencil size={13} stroke={1.7} aria-hidden="true" />
            </button>
            <button className="icon-btn" title="删掉这条批注" aria-label="删掉这条批注" onClick={() => setMode("confirm")}>
              <IconTrash size={13} stroke={1.7} aria-hidden="true" />
            </button>
          </span>
        ) : null}
      </header>

      {note.quote ? <blockquote className="note-item__quote">{note.quote}</blockquote> : null}

      {mode === "edit" ? (
        <>
          <textarea
            className="rail-editor rail-editor--inline"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(() => onEdit(note, draft));
              if (e.key === "Escape") (e.stopPropagation(), setMode(""));
            }}
          />
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" disabled={busy || !draft.trim()} onClick={() => run(() => onEdit(note, draft))}>
              {busy ? "保存中…" : "保存"}
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => setMode("")}>取消</button>
          </div>
        </>
      ) : mode === "confirm" ? (
        <div className="row-actions">
          <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => run(() => onDelete(note))}>
            {busy ? "处理中…" : "从 notes.md 里删掉"}
          </button>
          <button className="btn btn-sm" disabled={busy} onClick={() => setMode("")}>取消</button>
        </div>
      ) : (
        <Md text={note.body} />
      )}
      <ErrorNote error={error} what="改批注" />
    </article>
  );
}

// ---- 写批注 ----------------------------------------------------------------

function AnnotateForm({ quote, label, onSave, onCancel }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  async function save() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ quote, body });
      setBody("");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      head={
        <>
          <span className="rail-label">写批注</span>
          <Quote text={quote} />
        </>
      }
      foot={
        <>
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !body.trim()}>
              {busy ? "保存中…" : "保存批注"}
            </button>
            <button className="btn btn-sm" onClick={onCancel}>取消</button>
            <span className="rail-foot__key"><kbd>Ctrl</kbd>+<kbd>Enter</kbd></span>
          </div>
          <span className="rail-foot__note">{label}</span>
        </>
      }
    >
      <textarea
        className="rail-editor"
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="写下你的想法"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
        }}
      />
      <ErrorNote error={error} what="保存批注" />
    </Panel>
  );
}

// ---- 衍生：从选中这段派生出点什么 --------------------------------------------

/**
 * **翻译不在这一行里。**
 *
 * 这一行的机制是「问过的点回去是回读，不重跑」，它存在的唯一理由是**重跑要再花一次钱**。
 * 翻译走 DeepL：确定性、同样的文本给同样的结果、便宜——这套机制对它一点价值都没有，
 * 而它占的那一格会把五个按钮挤成两行（窄栏里实测就是这样）。
 *
 * 它仍然在划词工具条上（A 字图标），一键就能再翻一次；结果照样渲染在这个面板里，
 * 只是没有可以切回去的页签。**以后加新模式照这条判断：要花 LLM 钱、且结果不确定的才进这一行。**
 *
 * 顺序上「选题」排最后，因为它离原文最远——产出的已经是能发的标题，不再是关于这段话本身。
 */
const AI_MODES = ["解释", "展开", "反驳", "选题"];

/**
 * **四个模式各存各的，点回去是回读，不是重跑。**
 *
 * 这里改过两版，两版都错在同一个地方——把「问过了」和「正在看」混成了一件事：
 *   v1 后一次结果覆盖前一次 → 想对比就得重跑，重跑还要再花一次 token；
 *   v2 四段全叠着排在同一栏里 → 结果一长，右栏成了一条几千字的长卷，找不着自己在读哪段。
 *
 * 现在四个模式**就是四个页签**：没问过的点了才跑（花 token 的动作只发生在这一次），
 * 问过的点了直接切回去看（不发请求）。一次只显示一段，要重跑得在那一段的头上明确点
 * 「重新生成」——**花钱的动作不能藏在「再点一次」这种手滑就会触发的手势里。**
 */
function AiPanel({ ai, onSave, onStop, onRun, saveLabel }) {
  // 空态不是「什么都不显示」。这个页签以前在没划词时是禁用的灰按钮——
  // 点不动又不说为什么，看着就像「AI 功能坏了」。现在它永远能点，进来先告诉你怎么用。
  if (!ai) {
    return (
      <Panel>
        <div className="rail-empty">
          <IconSparkles aria-hidden="true" stroke={1.5} />
          <strong>还没有让 AI 看过</strong>
          在正文里选中一段话，工具条上点灯泡（解释）、箭头（展开）、天平（反驳）、A 字（翻译）
          或魔杖（选题，把这段变成能发的标题）。
          <span className="rail-empty__hint">
            要问它整篇文档、或者要它翻你以前写过的东西，用旁边的「AI 助手」——那条通道能读你整个 vault。
          </span>
        </div>
      </Panel>
    );
  }

  const results = ai.results || [];
  const answered = (m) => results.some((r) => r.mode === m && r.text);
  return <AiBody ai={ai} results={results} answered={answered} onSave={onSave} onStop={onStop} onRun={onRun} saveLabel={saveLabel} />;
}

function AiBody({ ai, results, answered, onSave, onStop, onRun, saveLabel }) {
  /**
   * 「在看哪一段」是**纯视图状态**，所以留在这个组件里，不往页面上传。
   * 跑新的一轮时跟着走（`ai.mode` 一变就同步过去），点已经问过的模式则只改这里——
   * 一次请求都不会发出去。
   */
  const [view, setView] = useState(ai.mode);
  useEffect(() => setView(ai.mode), [ai.mode, ai.quote]);

  const shown = results.find((r) => r.mode === view && r.text);
  const done = results.filter((r) => r.text);

  return (
    <Panel
      /**
       * 四个模式**就是四个页签**：没问过的点了才跑，问过的点了直接切回去看。
       * 三态：没问过（描边）· 问过了（打勾 + 黄底）· 当前在看的（黄底 + 黑边）。
       * 黄色不是装饰——它和划词高亮同一个颜色，含义也一样：「这个我圈过了」。
       */
      head={
        <>
          <div className="ai-modes">
            {AI_MODES.map((m) => {
              const has = answered(m);
              const running = ai.running && ai.mode === m;
              return (
                <button
                  key={m}
                  className="ai-mode"
                  data-done={has || undefined}
                  data-running={running || undefined}
                  aria-pressed={view === m && has}
                  // 已经问过的永远能点（点了是回读）；没问过的在跑别的时不给点，免得并发两个请求
                  disabled={!ai.quote || (ai.running && !has)}
                  onClick={() => (has ? setView(m) : onRun(m, ai.quote))}
                  title={has ? `回到「${m}」那一段（不重新生成）` : `让 AI ${m}这一段`}
                >
                  {has ? <IconCheck size={12} stroke={2.4} aria-hidden="true" /> : null}
                  {m}
                </button>
              );
            })}
          </div>
          <Quote text={ai.quote} />
        </>
      }
      foot={
        ai.running ? (
          <div className="row-actions">
            <Waiting label={ai.mode === "翻译" ? "正在翻译" : "正在读这段话"} />
            <button className="btn btn-sm" onClick={onStop}>停止</button>
          </div>
        ) : done.length ? (
          // 一行小字就够，不用整块警告框——它讲的是默认行为，不是出了问题。
          // **不写分母**：翻译不在 AI_MODES 里但同样会产生一段结果，写成
          // `{done.length}/{AI_MODES.length}` 的话翻译完就成了「已问过 5/4」。
          <span className="rail-foot__note">
            这 {done.length} 段都不会自动保存，要留下就点「存为笔记」
          </span>
        ) : null
      }
    >
      <ErrorNote error={ai.error} what={ai.mode === "翻译" ? "翻译" : "AI 调用"} />
      {shown ? (
        <section className="ai-result">
          <div className="ai-result__head">
            <span className="rail-label">
              <IconSparkles size={12} stroke={1.8} aria-hidden="true" />
              {shown.mode}
            </span>
            <div className="row-actions">
              {/* **重跑要明确点这里。** 让「再点一次那个模式」等于重跑的话，
                  一次手滑就是一次 token——花钱的动作不该藏在这种手势里。 */}
              <button className="btn btn-sm" onClick={() => onRun(shown.mode, ai.quote)} disabled={ai.running}>
                重新生成
              </button>
              <button className="btn btn-sm" onClick={() => onSave(shown)}>{saveLabel}</button>
              <CopyButton text={shown.text} label="复制这段结果" />
            </div>
          </div>
          <Md text={shown.text} />
        </section>
      ) : !ai.running && !ai.error ? (
        <div className="rail-empty">
          <IconSparkles aria-hidden="true" stroke={1.5} />
          <strong>还没问过「{view}」</strong>
          点上面那个按钮，它才会跑。已经问过的（带勾的）点回去是回读，不会重新花一次 token。
        </div>
      ) : null}
    </Panel>
  );
}

// ---- 对话 ------------------------------------------------------------------

/**
 * 和一个**本机 agent** 深聊当前这篇。它跑在 vault 里、能读你的全部笔记——
 * 所以问「这个观点我以前在哪写过」这种问题才有意义，贴一段文字给模型是做不到的。
 *
 * 权限模式放在对话头部，随时可按任务切换；运行期间锁定，真正的能力边界由服务端工具层执行。
 *
 * 流式回复没到字之前**不画空气泡**：流式是先插一条 `text: ""` 的占位再往里灌字，
 * 照着渲染的话屏幕上会挂一个灰色空条，旁边同时还有个「正在想」——两个东西说同一件事，
 * 其中一个还是空的，所以用 Waiting 明确说明正在处理。
 */
function ChatPanel({ chat, onSend, onStop, onSave, onMode, onNewChat, knowledgeSource }) {
  const [text, setText] = useState("");
  const [cardOpen, setCardOpen] = useState(false);
  const endRef = useRef(null);
  const boxRef = useRef(null);
  const msgs = chat?.messages || [];
  const mode = chatModeInfo(chat?.permissionMode);
  const canCard = !chat?.running && msgs.some((m) => m.role === "user" && m.text) && msgs.some((m) => ["assistant", "agent"].includes(m.role) && m.text);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [msgs]);

  // 输入框跟着内容长，一行起、六行封顶。写死 rows 的话：短问题占着两行空白，
  // 长问题又只能在两行的小窗口里滚——两头都不合适。
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  function submit(e) {
    e?.preventDefault();
    if (!text.trim() || chat?.running) return;
    onSend(text.trim());
    setText("");
  }

  return (
    <>
    <Panel
      /**
       * 头上放「权限模式」和「重开一轮」：这两件事都是**关于这场对话本身**的，
       * 而不是关于正在打的这句话。上一版把切换开关塞在发送按钮旁边，结果输入区
       * 挤成三层（输入框 + 一排按钮 + 一行快捷键提示），最该干净的地方最乱。
       */
      head={
        <div className="chat-head">
          <label className="chat-permission-mode" title={mode.note}>
            <span>权限</span>
            <select
              value={mode.id}
              disabled={chat?.running || !onMode}
              onChange={(event) => {
                const next = chatModeInfo(event.target.value);
                if (next.id === "developer" && !window.confirm(next.warning)) return;
                onMode?.(next.id);
              }}
            >
              {CHAT_PERMISSION_MODES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-sm" onClick={() => setCardOpen(true)} disabled={!canCard} title={canCard ? "把整轮对话整理成知识卡" : "至少完成一轮提问和回答后可用"}>沉淀卡片</button>
          {/* 一直聊下去上下文会越滚越长、也越跑越偏。**换个话题就该重开一轮**，
              而且不能只靠刷新页面——那会把整个阅读区一起关掉。 */}
          <button
            type="button"
            className="icon-btn"
            onClick={onNewChat}
            disabled={!msgs.length || chat?.running || !onNewChat}
            title="重开一轮（当前这轮不保留，要留的先「存为笔记」）"
            aria-label="新对话"
          >
            <IconPlus size={15} stroke={2} aria-hidden="true" />
          </button>
        </div>
      }
      foot={
        /* 一个盒子，不是三层。聚焦时整块高亮，底下一行只放「发送」和快捷键 */
        <form className="composer" onSubmit={submit}>
          <textarea
            ref={boxRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="问这篇文档，或让它翻你以前写过的东西"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e);
            }}
          />
          <div className="composer__foot">
            <span className="composer__key"><kbd>Ctrl</kbd>+<kbd>Enter</kbd></span>
            {chat?.running ? (
              <button type="button" className="btn btn-sm" onClick={onStop}>停止</button>
            ) : null}
            <button className="btn btn-primary btn-sm" disabled={!text.trim() || chat?.running}>
              <IconSend size={14} stroke={1.8} aria-hidden="true" />
              发送
            </button>
          </div>
        </form>
      }
    >
      <div className="chat-log">
        {msgs.length === 0 && !chat?.error ? (
          <div className="rail-empty">
            <IconMessageCircle aria-hidden="true" stroke={1.5} />
            <strong>问点什么</strong>
            它能读你整个 vault——「这个观点我以前写过吗」这类问题问它最合适
            <span className="rail-empty__hint">当前是 {mode.name}模式：{mode.note}。Pi 是唯一运行时，能力由服务端限制。</span>
          </div>
        ) : null}

        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="msg msg-user">{m.text}</div>
          ) : m.role === "sys" ? (
            // 权限模式变化要留一条痕迹：不然回头看不出上下文为什么重新开始
            <div key={i} className="msg msg-sys">{m.text}</div>
          ) : m.text ? (
            <div key={i} className="msg msg-agent">
              <span className="msg-agent__who">{piAgentName()}</span>
              <Md text={m.text} />
              {!chat.running ? (
                <div className="row-actions msg-agent__acts">
                  <button className="btn btn-sm" onClick={() => onSave(m.text)}>存为笔记</button>
                  <CopyButton text={m.text} label="复制这条回复" />
                </div>
              ) : null}
            </div>
          ) : null
        )}

        {chat?.running ? <Waiting label="Pi 正在处理" slow="Pi 正在按当前权限模式读取上下文并生成回答" slowAt={8} /> : null}
        <ErrorNote error={chat?.error} what="AI 助手" />
        <div ref={endRef} />
      </div>
    </Panel>
    <KnowledgeCardDialog open={cardOpen} onClose={() => setCardOpen(false)} messages={msgs} source={{ ...(knowledgeSource || {}), engine: piAgentName() }} />
    </>
  );
}

/**
 * 等待态要**说明白在等什么、等了多久**。一条光秃秃的骨架屏挂在那儿，
 * 十几秒之后用户只会以为它卡死了。
 *
 * `slow` 那句话要讲**为什么**慢，不能只说「慢一点正常」：对话会先读取当前文档、
 * vault 上下文和权限模式，再开始生成；划词的「理解」只处理当前片段，通常快得多。
 */
function Waiting({ label, slow, slowAt = 12 }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="waiting">
      <span className="pulse-dot" />
      <span>{label}…</span>
      <em>{secs}s</em>
      {slow && secs > slowAt ? <span className="waiting__slow">{slow}</span> : null}
    </div>
  );
}
