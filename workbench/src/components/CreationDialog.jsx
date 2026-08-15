import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { cleanGeneratedDraft, creationApi, interviewStream } from "../lib/creation-api.js";
import { MarkdownEditor } from "./MarkdownEditor.jsx";
import { ErrorNote } from "./ui.jsx";
import {
  IconArrowLeft,
  IconCheck,
  IconFileText,
  IconLoader2,
  IconMessageQuestion,
  IconSearch,
  IconSend,
  IconStack2,
  IconX,
} from "./icons.jsx";
import "./creation.css";

const PLATFORMS = ["公众号", "X", "小红书", "视频号", "YouTube"];
const modeOf = (preset) => preset === "topic" ? "topic" : preset === "blank" ? "blank" : "choose";

export function CreationDialog({ open, preset, onClose, onCreated, onTopicCreated }) {
  const [screen, setScreen] = useState(modeOf(preset));
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState("公众号");
  const [viewpoint, setViewpoint] = useState("");
  const [audience, setAudience] = useState("");
  const [seed, setSeed] = useState("");
  const [query, setQuery] = useState("");
  const [materials, setMaterials] = useState([]);
  const [selected, setSelected] = useState([]);
  const [created, setCreated] = useState(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState("interviewing");
  const abortRef = useRef(null);
  const sessionRef = useRef("");

  const close = useCallback(() => {
    abortRef.current?.abort();
    onClose();
  }, [onClose]);
  const boxRef = useDialog(open, close, { autoFocus: screen !== "interview" });

  useEffect(() => {
    if (!open) return;
    abortRef.current?.abort();
    sessionRef.current = "";
    setScreen(modeOf(preset));
    setTitle(""); setPlatform("公众号"); setViewpoint(""); setAudience(""); setSeed("");
    setQuery(""); setMaterials([]); setSelected([]); setCreated(null); setDraftTitle(""); setDraftBody("");
    setBusy(false); setError(null); setMessages([]); setMessage(""); setPhase("interviewing");
  }, [open, preset]);

  useEffect(() => {
    if (!open || screen !== "material") return;
    const q = query.trim();
    if (!q) return setMaterials([]);
    let cancelled = false;
    const timer = setTimeout(() => creationApi.searchMaterials(q)
      .then((result) => !cancelled && setMaterials(result.items || []))
      .catch((err) => !cancelled && setError(err)), 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, screen, query]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const answers = useMemo(() => messages.filter((item) => item.role === "user" && !item.control), [messages]);
  const summary = useMemo(() => {
    if (phase !== "summary" && phase !== "drafting") return "";
    return [...messages].reverse().find((item) => item.role === "agent")?.text || "";
  }, [messages, phase]);

  if (!open) return null;

  async function create(kind, mode, extra = {}) {
    setBusy(true); setError(null);
    try {
      const result = await creationApi.create({ kind, mode, title, platform, viewpoint, audience, materialIds: selected, ...extra });
      if (kind === "topic") {
        onTopicCreated?.(result.topic);
        close();
        return;
      }
      setCreated(result);
      setDraftTitle(result.draft.title);
      setDraftBody(extra.body || (mode === "material" ? "" : ""));
      if (mode === "material") {
        const detail = await fetch(`/api/pipe/page/${result.draft.id}?view=drafts`).then((r) => r.json());
        setDraftBody(detail.text || "");
      }
      setScreen("editor");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveAndFinish() {
    if (!created?.draft || busy) return;
    setBusy(true); setError(null);
    try {
      await creationApi.saveDraft(created.draft.id, draftTitle.trim() || created.draft.title, draftBody);
      onCreated?.({ ...created.draft, title: draftTitle.trim() || created.draft.title });
      close();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function sendInterview(text, { control = false, nextPhase = phase, after } = {}) {
    const value = String(text || "").trim();
    if (!value || busy) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const token = `${Date.now()}-${Math.random()}`;
    setMessages((items) => [...items, { role: "user", text: value, control }, { role: "agent", text: "", token }]);
    setMessage(""); setBusy(true); setError(null);
    interviewStream({
      signal: ac.signal,
      sessionId: sessionRef.current,
      message: value,
      title,
      platform,
      phase,
      onSession: (id) => { if (id) sessionRef.current = id; },
      onChunk: (full) => setMessages((items) => items.map((item) => item.token === token ? { ...item, text: full } : item)),
    }).then(async (full) => {
      setMessages((items) => items.map((item) => item.token === token ? { ...item, text: full } : item));
      setPhase(nextPhase);
      await after?.(full);
    }).catch((err) => {
      if (err.name !== "AbortError") setError(err);
    }).finally(() => setBusy(false));
  }

  function startInterview() {
    if (!title.trim() || !seed.trim()) return;
    setScreen("interview");
    sendInterview(seed, { nextPhase: "interviewing" });
  }

  function confirmDraft() {
    const evidence = [
      ...answers.map((item) => `用户：${item.text}`),
      summary ? `\n用户已确认的访谈共识：\n${summary}` : "",
    ].filter(Boolean).join("\n\n");
    setPhase("drafting");
    sendInterview("【工作台动作：生成初稿】我确认上一轮访谈共识准确。请按已确认内容生成初稿。", {
      control: true,
      nextPhase: "drafting",
      after: (full) => create("draft", "interview", { body: cleanGeneratedDraft(full), interviewEvidence: evidence }),
    });
  }

  const canCreate = title.trim() && platform;

  return (
    <div className="scrim scrim--center creation-scrim" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="creation" ref={boxRef} role="dialog" aria-modal="true" aria-label="开始创作">
        <header className="creation__head">
          <div>
            <span className="eyebrow">CREATE</span>
            <h2>{screen === "editor" ? "继续写" : screen === "topic" ? "新建选题" : "开始创作"}</h2>
          </div>
          <button className="icon-btn" onClick={close} aria-label="关闭" title="关闭（Esc）"><IconX aria-hidden="true" /></button>
        </header>

        {screen === "choose" ? <ModeChooser onPick={setScreen} /> : null}

        {["topic", "blank", "material", "interview-setup"].includes(screen) ? (
          <CreationForm
            screen={screen}
            title={title} setTitle={setTitle}
            platform={platform} setPlatform={setPlatform}
            viewpoint={viewpoint} setViewpoint={setViewpoint}
            audience={audience} setAudience={setAudience}
            seed={seed} setSeed={setSeed}
            query={query} setQuery={setQuery}
            materials={materials} selected={selected} setSelected={setSelected}
            busy={busy} canCreate={canCreate}
            onBack={() => setScreen("choose")}
            onSubmit={() => screen === "topic" ? create("topic", "blank")
              : screen === "blank" ? create("draft", "blank", { body: "" })
              : screen === "material" ? create("draft", "material")
              : startInterview()}
          />
        ) : null}

        {screen === "interview" ? (
          <Interview
            title={title} platform={platform} messages={messages} message={message} setMessage={setMessage}
            phase={phase} busy={busy} answers={answers.length}
            onSend={() => sendInterview(message, { nextPhase: phase === "summary" ? "interviewing" : phase })}
            onSummarize={() => sendInterview("【工作台动作：整理共识】请只根据以上对话整理访谈共识，等待我确认，不要开始写文章。", { control: true, nextPhase: "summary" })}
            onConfirm={confirmDraft}
            onBack={() => { abortRef.current?.abort(); setScreen("interview-setup"); }}
          />
        ) : null}

        {screen === "editor" ? (
          <div className="creation-editor">
            <input className="creation-editor__title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} aria-label="文章标题" />
            <MarkdownEditor value={draftBody} onChange={setDraftBody} ariaLabel="新稿正文" />
            <div className="creation-editor__foot">
              <span>已建立选题并挂上来源，保存后会进入稿件库。</span>
              <button className="btn btn-primary" onClick={saveAndFinish} disabled={busy || !draftTitle.trim()}>
                {busy ? <IconLoader2 className="spin" aria-hidden="true" /> : <IconCheck aria-hidden="true" />}完成
              </button>
            </div>
          </div>
        ) : null}

        <ErrorNote error={error} what="创建" />
      </section>
    </div>
  );
}

function ModeChooser({ onPick }) {
  const modes = [
    { key: "blank", icon: IconFileText, title: "空白", hint: "先建一篇空稿，直接进入编辑器。" },
    { key: "material", icon: IconStack2, title: "素材", hint: "从素材库挑选依据，带着内容开始写。" },
    { key: "interview-setup", icon: IconMessageQuestion, title: "访谈", hint: "让 AI 一次问一个问题，把想法挖成文章。" },
  ];
  return (
    <div className="creation-choose">
      <p>你想从哪里开始？三条路最终都会成为一篇可编辑、可发布、可复盘的正式稿件。</p>
      <div className="creation-modes">
        {modes.map(({ key, icon: Icon, title, hint }) => (
          <button key={key} onClick={() => onPick(key)}>
            <span className="creation-mode__icon"><Icon aria-hidden="true" /></span>
            <strong>{title}</strong><small>{hint}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function CreationForm(props) {
  const { screen, title, setTitle, platform, setPlatform, viewpoint, setViewpoint, audience, setAudience,
    seed, setSeed, query, setQuery, materials, selected, setSelected, busy, canCreate, onBack, onSubmit } = props;
  const isTopic = screen === "topic";
  const valid = canCreate && (screen !== "material" || selected.length) && (screen !== "interview-setup" || seed.trim());
  return (
    <div className="creation-form">
      <div className="creation-form__grid">
        <label className="field creation-form__wide"><span>{isTopic ? "选题标题" : "暂定标题"}</span><input data-autofocus="" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="先写一个能认出来的名字，之后可以改" /></label>
        <label className="field"><span>发布平台</span><select value={platform} onChange={(e) => setPlatform(e.target.value)}>{PLATFORMS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span>目标读者（可选）</span><input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="这篇主要写给谁" /></label>
        <label className="field creation-form__wide"><span>核心观点（可选）</span><textarea value={viewpoint} onChange={(e) => setViewpoint(e.target.value)} placeholder="你希望读者最终记住什么" /></label>
        {screen === "interview-setup" ? <label className="field creation-form__wide"><span>先说说你的想法</span><textarea value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="不用整理，想到哪写到哪。访谈会从这里继续追问。" /></label> : null}
        {screen === "material" ? (
          <div className="creation-materials creation-form__wide">
            <label className="creation-material-search"><IconSearch aria-hidden="true" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索素材标题或正文" /></label>
            <div className="creation-material-list">
              {!query.trim() ? <p>输入关键词，从素材库挑选这篇文章要用的依据。</p> : null}
              {materials.map((item) => {
                const on = selected.includes(item.id);
                return <button key={item.id} aria-pressed={on} onClick={() => setSelected((ids) => on ? ids.filter((id) => id !== item.id) : [...ids, item.id])}>
                  <span>{item.title}</span><small>{item.type}{item.verificationStatus ? ` · ${item.verificationStatus}` : ""}</small>
                </button>;
              })}
            </div>
            {selected.length ? <div className="creation-selected">已选 {selected.length} 条素材</div> : null}
          </div>
        ) : null}
      </div>
      <div className="creation-form__foot">
        {!isTopic ? <button className="btn" onClick={onBack}><IconArrowLeft aria-hidden="true" />返回</button> : <span />}
        <button className="btn btn-primary" onClick={onSubmit} disabled={busy || !valid}>{busy ? "创建中…" : isTopic ? "建立选题" : screen === "interview-setup" ? "开始访谈" : "开始写作"}</button>
      </div>
    </div>
  );
}

function Interview({ title, platform, messages, message, setMessage, phase, busy, answers, onSend, onSummarize, onConfirm, onBack }) {
  return (
    <div className="creation-interview">
      <div className="creation-chat">
        <div className="creation-chat__log">
          {messages.map((item, index) => item.control ? null : <div key={`${item.role}-${index}`} data-role={item.role}><span>{item.role === "user" ? "你" : "访谈助手"}</span><p>{item.text || (busy ? "正在整理…" : "")}</p></div>)}
        </div>
        <div className="creation-chat__composer">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="回答这个问题，或补充你刚想到的内容" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }} />
          <button className="btn btn-primary" onClick={onSend} disabled={busy || !message.trim()} aria-label="发送"><IconSend aria-hidden="true" /></button>
        </div>
      </div>
      <aside className="creation-brief">
        <span className="eyebrow">INTERVIEW</span><h3>{title}</h3><p>{platform}</p>
        <ol><li data-on="true">梳理想法</li><li data-on={phase === "summary" || phase === "drafting"}>确认共识</li><li data-on={phase === "drafting"}>生成初稿</li></ol>
        <div className="creation-brief__actions">
          {phase === "summary" ? <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>确认起稿</button>
            : <button className="btn" onClick={onSummarize} disabled={busy || answers < 2}>整理共识</button>}
          <button className="btn" onClick={onBack} disabled={busy}>返回设置</button>
        </div>
        {answers < 2 ? <small>再回答一轮，就可以随时整理共识。</small> : <small>不设固定题数；信息够了就整理共识。</small>}
      </aside>
    </div>
  );
}
