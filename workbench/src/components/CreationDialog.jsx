import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { cleanGeneratedDraft, creationApi, deriveDraftTitle, formatMaterialQuote, interviewStream, materialDraftStream } from "../lib/creation-api.js";
import { MarkdownEditor } from "./MarkdownEditor.jsx";
import { ErrorNote, Select, valueIcon } from "./ui.jsx";
import {
  IconArrowLeft,
  IconCheck,
  IconFileText,
  IconExternalLink,
  IconLoader2,
  IconMessageQuestion,
  IconNotebook,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSend,
  IconSparkles,
  IconStack2,
  IconWorld,
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
  const [materialWritingMode, setMaterialWritingMode] = useState("manual");
  const [insertRequest, setInsertRequest] = useState(null);
  const abortRef = useRef(null);
  const sessionRef = useRef("");

  const close = useCallback(() => {
    abortRef.current?.abort();
    onClose();
  }, [onClose]);
  const boxRef = useDialog(open, close, { autoFocus: screen !== "editor" });

  useEffect(() => {
    if (!open) return;
    abortRef.current?.abort();
    sessionRef.current = "";
    setScreen(firstScreen(preset));
    setDraftMode("blank");
    setTitle(""); setPlatform("公众号"); setViewpoint(""); setAudience("");
    setQuery(""); setMaterials([]); setSelected([]); setDraftTitle(""); setDraftBody("");
    setInterviewEvidence(""); setBusy(false); setError(null); setMessages([]); setMessage(""); setPhase("interviewing");
    setMaterialWritingMode("manual"); setInsertRequest(null);
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

  function openEditor(mode, body = "", suggestedTitle = "", writingMode = "manual") {
    setDraftMode(mode);
    setMaterialWritingMode(writingMode);
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
      title: title.trim() || deriveDraftTitle("", value),
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

  function startMaterialDraft() {
    if (busy || !selected.length || !viewpoint.trim()) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setDraftMode("material");
    setMaterialWritingMode("ai");
    setDraftTitle(title.trim());
    setDraftBody("");
    setScreen("editor");
    setBusy(true);
    setError(null);
    materialDraftStream({
      signal: ac.signal,
      title: title.trim(),
      platform,
      viewpoint: viewpoint.trim(),
      audience: audience.trim(),
      materials: selected,
      onChunk: setDraftBody,
    }).then((full) => {
      const body = cleanGeneratedDraft(full);
      setDraftBody(body);
      if (!title.trim()) setDraftTitle(deriveDraftTitle("", body));
    }).catch((err) => {
      if (err.name !== "AbortError") setError(err);
    }).finally(() => setBusy(false));
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
      : screen === "material" ? "从素材开始"
        : screen === "interview" ? "访谈起稿"
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
            viewpoint={viewpoint} setViewpoint={setViewpoint} audience={audience} setAudience={setAudience}
            query={query} setQuery={setQuery} materials={materials} selected={selected} setSelected={setSelected}
            busy={busy} onBack={() => setScreen("choose")}
            onWrite={() => openEditor("material", "", title.trim(), "manual")} onGenerate={startMaterialDraft} />
        ) : null}

        {screen === "interview" ? (
          <Interview title={title} setTitle={setTitle} platform={platform} setPlatform={setPlatform} messages={messages} message={message} setMessage={setMessage}
            phase={phase} busy={busy} answers={answers.length}
            onSend={() => sendInterview(message, { nextPhase: phase === "summary" ? "interviewing" : phase })}
            onSummarize={() => sendInterview("【工作台动作：整理共识】请只根据以上对话整理访谈共识，等待我确认，不要开始写文章。", { control: true, nextPhase: "summary" })}
            onConfirm={confirmDraft}
            onBack={() => { abortRef.current?.abort(); setScreen("choose"); }} />
        ) : null}

        {screen === "editor" ? (
          <DraftEditor mode={draftMode} title={draftTitle} setTitle={setDraftTitle} body={draftBody} setBody={setDraftBody}
            platform={platform} setPlatform={setPlatform} materials={selected} writingMode={materialWritingMode}
            insertRequest={insertRequest} onInsertHandled={() => setInsertRequest(null)}
            onInsertMaterial={(item) => setInsertRequest({ id: `${item.id}-${Date.now()}`, text: formatMaterialQuote(item) })}
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
    { key: "interview", icon: IconMessageQuestion, title: "访谈起稿", hint: "直接开聊，边聊边梳理。", mark: "有想法" },
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
  return (
    <span className="creation-platform">
      <Select
        value={value}
        options={PLATFORMS}
        onChange={onChange}
        ariaLabel="发布平台"
        title="选择发布平台"
        renderIcon={(item) => {
          const Icon = valueIcon(item, IconWorld);
          return <Icon size={15} stroke={1.8} aria-hidden="true" />;
        }}
      />
    </span>
  );
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

function MaterialSetup({ title, setTitle, platform, setPlatform, viewpoint, setViewpoint, audience, setAudience, query, setQuery, materials, selected, setSelected, busy, onBack, onWrite, onGenerate }) {
  const toggle = (item) => setSelected((items) => items.some((picked) => picked.id === item.id) ? items.filter((picked) => picked.id !== item.id) : [...items, item]);
  return (
    <div className="creation-material-workspace">
      <section className="creation-material-browser">
        <div className="creation-section-title"><div><span className="eyebrow">01 · EVIDENCE</span><h3>挑选真正会用到的素材</h3></div><small>已选 {selected.length}</small></div>
        <label className="creation-material-search"><IconSearch aria-hidden="true" /><input data-autofocus="" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索素材标题或正文" /></label>
        <div className="creation-material-list">
          {!query.trim() ? <div className="creation-material-empty"><IconSearch aria-hidden="true" /><strong>搜索你的素材库</strong><p>输入关键词，把这篇真正要用的依据收进右侧。</p></div> : null}
          {query.trim() && !materials.length ? <p>没有找到素材，换一个关键词试试。</p> : null}
          {materials.map((item) => {
            const on = selected.some((picked) => picked.id === item.id);
            return <button key={item.id} aria-pressed={on} onClick={() => toggle(item)}><span>{item.title}</span><small>{item.type}{item.verificationStatus ? ` · ${item.verificationStatus}` : ""}</small>{on ? <IconCheck aria-hidden="true" /> : <IconPlus aria-hidden="true" />}</button>;
          })}
        </div>
        <button className="btn btn-quiet creation-material-back" onClick={onBack}><IconArrowLeft aria-hidden="true" />返回起稿方式</button>
      </section>
      <aside className="creation-material-plan">
        <div className="creation-section-title"><div><span className="eyebrow">02 · BRIEF</span><h3>确定怎么写</h3></div><PlatformSelect value={platform} onChange={setPlatform} /></div>
        <div className="creation-selected-stack">
          {!selected.length ? <p>选中的素材会留在这里，进入编辑器后仍会持续显示。</p> : selected.map((item) => (
            <div key={item.id}><span><IconNotebook aria-hidden="true" />{item.title}</span><button className="icon-btn" onClick={() => toggle(item)} aria-label={`移除${item.title}`}><IconX aria-hidden="true" /></button></div>
          ))}
        </div>
        <label className="creation-brief-field"><span>文章方向 <em>AI 起稿时必填</em></span><textarea value={viewpoint} onChange={(e) => setViewpoint(e.target.value)} placeholder="这篇想说清什么？哪些判断不能偏离？" /></label>
        <div className="creation-brief-row">
          <label className="creation-brief-field"><span>暂定标题</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="可最后再写" /></label>
          <label className="creation-brief-field"><span>目标读者</span><input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="可选" /></label>
        </div>
        <div className="creation-writing-paths">
          <button onClick={onWrite} disabled={busy || !selected.length}>
            <IconPencil aria-hidden="true" /><span><strong>带着素材自己写</strong><small>打开空稿，素材留在右侧，需要时再插入。</small></span><IconArrowLeft className="creation-path-arrow" aria-hidden="true" />
          </button>
          <button className="is-primary" onClick={onGenerate} disabled={busy || !selected.length || !viewpoint.trim()}>
            <IconSparkles aria-hidden="true" /><span><strong>让 AI 生成初稿</strong><small>只使用上面的简报与已选素材。</small></span><IconArrowLeft className="creation-path-arrow" aria-hidden="true" />
          </button>
        </div>
      </aside>
    </div>
  );
}

function DraftEditor({ mode, title, setTitle, body, setBody, platform, setPlatform, materials, writingMode, insertRequest, onInsertHandled, onInsertMaterial, busy, onBack, onSave }) {
  const note = mode === "blank" ? "标题留空时，会用正文第一条标题或首句命名。" : mode === "material" ? `${materials.length} 条参考素材会与稿件保持关联。` : "已确认的访谈内容会作为真实素材随稿保存。";
  return (
    <div className={`creation-editor${mode === "material" ? " creation-editor--sources" : ""}`}>
      <main className="creation-editor__document">
        <div className="creation-editor__meta">
          <input className="creation-editor__title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题可以最后再写" aria-label="文章标题" />
          <PlatformSelect value={platform} onChange={setPlatform} />
        </div>
        {busy && mode === "material" && writingMode === "ai" && !body ? <div className="creation-generating"><IconSparkles className="spin-soft" aria-hidden="true" /><span><strong>正在根据简报和素材起稿</strong><small>不会调用素材库以外的内容</small></span></div> : null}
        <MarkdownEditor value={body} onChange={setBody} ariaLabel="新稿正文" insertRequest={insertRequest} onInsertHandled={onInsertHandled} />
        <div className="creation-editor__foot">
          <div>{onBack ? <button className="btn btn-quiet" onClick={onBack}><IconArrowLeft aria-hidden="true" />返回</button> : null}<span>{note}</span></div>
          <button className="btn btn-primary" onClick={onSave} disabled={busy || (!title.trim() && !body.trim())}>{busy ? <IconLoader2 className="spin" aria-hidden="true" /> : <IconCheck aria-hidden="true" />}保存到稿件库</button>
        </div>
      </main>
      {mode === "material" ? (
        <MaterialDock materials={materials} onInsert={onInsertMaterial} />
      ) : null}
    </div>
  );
}

function MaterialDock({ materials, onInsert }) {
  return (
    <aside className="creation-sources">
      <header><div><span className="eyebrow">REFERENCES</span><h3>参考素材</h3></div><b>{materials.length}</b></header>
      <p>它们不会自动进入正文。需要哪一条，再插到当前光标处。</p>
      <div className="creation-source-list">
        {materials.map((item, index) => (
          <article key={item.id}>
            <small>{String(index + 1).padStart(2, "0")} · {item.type || "素材"}{item.verificationStatus ? ` · ${item.verificationStatus}` : ""}</small>
            <h4>{item.title}</h4>
            <p>{item.note || "这条素材没有正文。"}</p>
            <footer>
              <button className="btn btn-sm" onClick={() => onInsert(item)} disabled={!item.note}><IconPlus aria-hidden="true" />插入引用</button>
              {item.link ? <a className="icon-btn" href={item.link} target="_blank" rel="noreferrer" aria-label="打开素材来源"><IconExternalLink aria-hidden="true" /></a> : null}
            </footer>
          </article>
        ))}
      </div>
    </aside>
  );
}

function Interview({ title, setTitle, platform, setPlatform, messages, message, setMessage, phase, busy, answers, onSend, onSummarize, onConfirm, onBack }) {
  return (
    <div className="creation-interview">
      <div className="creation-chat">
        <div className="creation-chat__log">
          {!messages.length ? (
            <div className="creation-interview-welcome">
              <span><IconMessageQuestion aria-hidden="true" /></span>
              <small>INTERVIEW FLOW</small>
              <h3>不用先想标题，我们直接聊。</h3>
              <p>写下一段经历、一个困惑，或刚冒出来的判断。访谈助手会一次只追问一个最值得展开的问题。</p>
              <div><button onClick={() => setMessage("最近有件事让我反复在想……")}>从一件事开始</button><button onClick={() => setMessage("我有个判断，但还不知道怎么说清楚……")}>从一个判断开始</button></div>
            </div>
          ) : messages.map((item, index) => item.control ? null : <div key={`${item.role}-${index}`} data-role={item.role}><span>{item.role === "user" ? "你" : "访谈助手"}</span><p>{item.text || (busy ? "正在整理…" : "")}</p></div>)}
        </div>
        <div className="creation-chat__composer">
          <textarea data-autofocus="" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={messages.length ? "回答这个问题，或补充你刚想到的内容" : "先随便说说，不用整理……"} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }} />
          <button className="btn btn-primary" onClick={onSend} disabled={busy || !message.trim()} aria-label="发送"><IconSend aria-hidden="true" /></button>
        </div>
      </div>
      <aside className="creation-brief">
        <div className="creation-brief__top"><span className="eyebrow">LIVE BRIEF</span><PlatformSelect value={platform} onChange={setPlatform} /></div>
        <label><span>暂定主题</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="可以最后再写" /></label>
        <ol><li data-on="true">梳理想法</li><li data-on={phase === "summary" || phase === "drafting"}>确认共识</li><li data-on={phase === "drafting"}>生成初稿</li></ol>
        <div className="creation-brief__actions">
          {phase === "summary" ? <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>确认起稿</button> : <button className="btn" onClick={onSummarize} disabled={busy || answers < 2}>整理共识</button>}
          <button className="btn btn-quiet" onClick={onBack} disabled={busy}><IconArrowLeft aria-hidden="true" />返回起稿方式</button>
        </div>
        {answers < 2 ? <small>至少完成两轮回答后，可以随时整理共识。</small> : <small>不设固定题数；感觉说清楚了就整理共识。</small>}
      </aside>
    </div>
  );
}
