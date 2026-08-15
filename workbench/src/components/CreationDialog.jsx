import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { buildMaterialDraft, cleanGeneratedDraft, creationApi, deriveDraftTitle, interviewStream } from "../lib/creation-api.js";
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
const firstScreen = (preset) => preset === "topic" ? "topic" : preset === "blank" ? "editor" : "choose";

export function CreationDialog({ open, preset, onClose, onCreated, onTopicCreated }) {
  const [screen, setScreen] = useState(firstScreen(preset));
  const [draftMode, setDraftMode] = useState("blank");
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState("公众号");
  const [viewpoint, setViewpoint] = useState("");
  const [audience, setAudience] = useState("");
  const [seed, setSeed] = useState("");
  const [query, setQuery] = useState("");
  const [materials, setMaterials] = useState([]);
  const [selected, setSelected] = useState([]);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [interviewEvidence, setInterviewEvidence] = useState("");
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
  const boxRef = useDialog(open, close, { autoFocus: screen !== "interview" && screen !== "editor" });

  useEffect(() => {
    if (!open) return;
    abortRef.current?.abort();
    sessionRef.current = "";
    setScreen(firstScreen(preset));
    setDraftMode("blank");
    setTitle(""); setPlatform("公众号"); setViewpoint(""); setAudience(""); setSeed("");
    setQuery(""); setMaterials([]); setSelected([]); setDraftTitle(""); setDraftBody("");
    setInterviewEvidence(""); setBusy(false); setError(null); setMessages([]); setMessage(""); setPhase("interviewing");
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

  function openEditor(mode, body = "", suggestedTitle = "") {
    setDraftMode(mode);
    setDraftTitle(suggestedTitle);
    setDraftBody(body);
    setError(null);
    setScreen("editor");
  }

  async function createTopic() {
    if (!title.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await creationApi.create({ kind: "topic", mode: "blank", title, platform, viewpoint, audience });
      onTopicCreated?.(result.topic);
      close();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveAndFinish() {
    if (busy || (!draftTitle.trim() && !draftBody.trim())) return;
    setBusy(true); setError(null);
    try {
      const finalTitle = deriveDraftTitle(draftTitle, draftBody);
      const result = await creationApi.create({
        kind: "draft",
        mode: draftMode,
        title: finalTitle,
        platform,
        viewpoint,
        audience,
        materialIds: selected.map((item) => item.id),
        body: draftBody,
        interviewEvidence,
      });
      onCreated?.(result.draft);
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
      title: title.trim() || deriveDraftTitle("", seed),
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
    if (!seed.trim()) return;
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
      after: (full) => {
        const body = cleanGeneratedDraft(full);
        setInterviewEvidence(evidence);
        openEditor("interview", body, deriveDraftTitle("", body));
      },
    });
  }

  const heading = screen === "editor" ? draftMode === "blank" ? "空白文章" : draftMode === "material" ? "素材起稿" : "访谈初稿"
    : screen === "topic" ? "新建选题"
      : screen === "material" ? "选择素材"
        : screen === "interview-setup" ? "开始访谈"
          : "开始创作";

  return (
    <div className="scrim scrim--center creation-scrim" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="creation" data-screen={screen} data-mode={draftMode} ref={boxRef} role="dialog" aria-modal="true" aria-label={heading}>
        <header className="creation__head">
          <div><span className="eyebrow">CREATE</span><h2>{heading}</h2></div>
          <button className="icon-btn" onClick={close} aria-label="关闭" title="关闭（Esc）"><IconX aria-hidden="true" /></button>
        </header>

        {screen === "choose" ? <ModeChooser onPick={(mode) => mode === "blank" ? openEditor("blank") : setScreen(mode)} /> : null}

        {screen === "topic" ? (
          <TopicForm title={title} setTitle={setTitle} platform={platform} setPlatform={setPlatform}
            viewpoint={viewpoint} setViewpoint={setViewpoint} audience={audience} setAudience={setAudience}
            busy={busy} onSubmit={createTopic} />
        ) : null}

        {screen === "material" ? (
          <MaterialSetup title={title} setTitle={setTitle} platform={platform} setPlatform={setPlatform}
            query={query} setQuery={setQuery} materials={materials} selected={selected} setSelected={setSelected}
            busy={busy} onBack={() => setScreen("choose")}
            onContinue={() => openEditor("material", buildMaterialDraft(title, selected), title.trim())} />
        ) : null}

        {screen === "interview-setup" ? (
          <InterviewSetup title={title} setTitle={setTitle} platform={platform} setPlatform={setPlatform}
            seed={seed} setSeed={setSeed} busy={busy} onBack={() => setScreen("choose")} onSubmit={startInterview} />
        ) : null}

        {screen === "interview" ? (
          <Interview title={title.trim() || deriveDraftTitle("", seed)} platform={platform} messages={messages} message={message} setMessage={setMessage}
            phase={phase} busy={busy} answers={answers.length}
            onSend={() => sendInterview(message, { nextPhase: phase === "summary" ? "interviewing" : phase })}
            onSummarize={() => sendInterview("【工作台动作：整理共识】请只根据以上对话整理访谈共识，等待我确认，不要开始写文章。", { control: true, nextPhase: "summary" })}
            onConfirm={confirmDraft}
            onBack={() => { abortRef.current?.abort(); setScreen("interview-setup"); }} />
        ) : null}

        {screen === "editor" ? (
          <DraftEditor mode={draftMode} title={draftTitle} setTitle={setDraftTitle} body={draftBody} setBody={setDraftBody}
            platform={platform} setPlatform={setPlatform} materialCount={selected.length}
            busy={busy} onBack={preset === "blank" ? null : () => setScreen(draftMode === "material" ? "material" : draftMode === "interview" ? "interview" : "choose")}
            onSave={saveAndFinish} />
        ) : null}

        <ErrorNote error={error} what="创建" />
      </section>
    </div>
  );
}

function ModeChooser({ onPick }) {
  const modes = [
    { key: "blank", icon: IconFileText, title: "空白文章", hint: "打开编辑器，标题最后再想。", mark: "最快" },
    { key: "material", icon: IconStack2, title: "从素材开始", hint: "先选依据，再进入编辑器。", mark: "有内容" },
    { key: "interview-setup", icon: IconMessageQuestion, title: "访谈起稿", hint: "边聊边梳理，确认后成稿。", mark: "有想法" },
  ];
  return (
    <div className="creation-choose">
      <p>选择最接近你此刻状态的起点。</p>
      <div className="creation-modes">
        {modes.map(({ key, icon: Icon, title, hint, mark }) => (
          <button key={key} onClick={() => onPick(key)}>
            <span className="creation-mode__icon"><Icon aria-hidden="true" /></span>
            <span className="creation-mode__copy"><small>{mark}</small><strong>{title}</strong><em>{hint}</em></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PlatformSelect({ value, onChange }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)}>{PLATFORMS.map((item) => <option key={item}>{item}</option>)}</select>;
}

function TopicForm({ title, setTitle, platform, setPlatform, viewpoint, setViewpoint, audience, setAudience, busy, onSubmit }) {
  return (
    <div className="creation-form creation-form--topic">
      <div className="creation-form__grid">
        <label className="field creation-form__wide"><span>选题标题</span><input data-autofocus="" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="这篇准备讨论什么" /></label>
        <label className="field"><span>发布平台</span><PlatformSelect value={platform} onChange={setPlatform} /></label>
        <label className="field"><span>目标读者（可选）</span><input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="主要写给谁" /></label>
        <label className="field creation-form__wide"><span>核心观点（可选）</span><textarea value={viewpoint} onChange={(e) => setViewpoint(e.target.value)} placeholder="希望读者最终记住什么" /></label>
      </div>
      <div className="creation-form__foot creation-form__foot--end"><button className="btn btn-primary" onClick={onSubmit} disabled={busy || !title.trim()}>{busy ? "建立中…" : "建立选题"}</button></div>
    </div>
  );
}

function MaterialSetup({ title, setTitle, platform, setPlatform, query, setQuery, materials, selected, setSelected, busy, onBack, onContinue }) {
  const toggle = (item) => setSelected((items) => items.some((picked) => picked.id === item.id) ? items.filter((picked) => picked.id !== item.id) : [...items, item]);
  return (
    <div className="creation-form creation-form--material">
      <div className="creation-meta-row">
        <label className="field"><span>暂定标题（可最后再写）</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="可以留空" /></label>
        <label className="field creation-meta-row__platform"><span>发布平台</span><PlatformSelect value={platform} onChange={setPlatform} /></label>
      </div>
      <div className="creation-materials">
        <label className="creation-material-search"><IconSearch aria-hidden="true" /><input data-autofocus="" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索素材标题或正文" /></label>
        <div className="creation-material-list">
          {!query.trim() ? <p>输入关键词，挑选这篇文章真正要使用的依据。</p> : null}
          {query.trim() && !materials.length ? <p>没有找到素材，换一个关键词试试。</p> : null}
          {materials.map((item) => {
            const on = selected.some((picked) => picked.id === item.id);
            return <button key={item.id} aria-pressed={on} onClick={() => toggle(item)}><span>{item.title}</span><small>{item.type}{item.verificationStatus ? ` · ${item.verificationStatus}` : ""}</small></button>;
          })}
        </div>
        <div className="creation-selected">{selected.length ? `已选 ${selected.length} 条素材，进入编辑器后仍可自由删改。` : "还没有选择素材"}</div>
      </div>
      <div className="creation-form__foot">
        <button className="btn" onClick={onBack}><IconArrowLeft aria-hidden="true" />返回</button>
        <button className="btn btn-primary" onClick={onContinue} disabled={busy || !selected.length}>带入编辑器</button>
      </div>
    </div>
  );
}

function InterviewSetup({ title, setTitle, platform, setPlatform, seed, setSeed, busy, onBack, onSubmit }) {
  return (
    <div className="creation-form creation-form--interview">
      <div className="creation-meta-row">
        <label className="field"><span>暂定主题（可选）</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="不用先想标题" /></label>
        <label className="field creation-meta-row__platform"><span>发布平台</span><PlatformSelect value={platform} onChange={setPlatform} /></label>
      </div>
      <label className="field creation-seed"><span>先随便说说</span><textarea data-autofocus="" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="不用整理。写下你想讲的经历、困惑或一个模糊判断，访谈会从最值得追问的地方开始。" /></label>
      <p className="creation-form__note">接下来一次只问一个问题；确认访谈共识后才会生成初稿。</p>
      <div className="creation-form__foot">
        <button className="btn" onClick={onBack}><IconArrowLeft aria-hidden="true" />返回</button>
        <button className="btn btn-primary" onClick={onSubmit} disabled={busy || !seed.trim()}>开始对话</button>
      </div>
    </div>
  );
}

function DraftEditor({ mode, title, setTitle, body, setBody, platform, setPlatform, materialCount, busy, onBack, onSave }) {
  const note = mode === "blank" ? "直接写。标题留空时，会用正文第一条标题或首句命名。" : mode === "material" ? `${materialCount} 条素材会与这篇稿件保持关联。` : "已确认的访谈内容会作为真实素材随稿保存。";
  return (
    <div className="creation-editor">
      <div className="creation-editor__meta">
        <input className="creation-editor__title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题可以最后再写" aria-label="文章标题" />
        <PlatformSelect value={platform} onChange={setPlatform} />
      </div>
      <MarkdownEditor value={body} onChange={setBody} ariaLabel="新稿正文" />
      <div className="creation-editor__foot">
        <div>{onBack ? <button className="btn btn-quiet" onClick={onBack}><IconArrowLeft aria-hidden="true" />返回</button> : null}<span>{note}</span></div>
        <button className="btn btn-primary" onClick={onSave} disabled={busy || (!title.trim() && !body.trim())}>{busy ? <IconLoader2 className="spin" aria-hidden="true" /> : <IconCheck aria-hidden="true" />}保存到稿件库</button>
      </div>
    </div>
  );
}

function Interview({ title, platform, messages, message, setMessage, phase, busy, answers, onSend, onSummarize, onConfirm, onBack }) {
  return (
    <div className="creation-interview">
      <div className="creation-chat">
        <div className="creation-chat__log">{messages.map((item, index) => item.control ? null : <div key={`${item.role}-${index}`} data-role={item.role}><span>{item.role === "user" ? "你" : "访谈助手"}</span><p>{item.text || (busy ? "正在整理…" : "")}</p></div>)}</div>
        <div className="creation-chat__composer">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="回答这个问题，或补充你刚想到的内容" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }} />
          <button className="btn btn-primary" onClick={onSend} disabled={busy || !message.trim()} aria-label="发送"><IconSend aria-hidden="true" /></button>
        </div>
      </div>
      <aside className="creation-brief">
        <span className="eyebrow">INTERVIEW</span><h3>{title}</h3><p>{platform}</p>
        <ol><li data-on="true">梳理想法</li><li data-on={phase === "summary" || phase === "drafting"}>确认共识</li><li data-on={phase === "drafting"}>生成初稿</li></ol>
        <div className="creation-brief__actions">
          {phase === "summary" ? <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>确认起稿</button> : <button className="btn" onClick={onSummarize} disabled={busy || answers < 2}>整理共识</button>}
          <button className="btn" onClick={onBack} disabled={busy}>返回设置</button>
        </div>
        {answers < 2 ? <small>再回答一轮，就可以随时整理共识。</small> : <small>不设固定题数；信息够了就整理共识。</small>}
      </aside>
    </div>
  );
}
