import { useEffect, useRef, useState } from "react";
import { brainstormStream, creationApi } from "../lib/creation-api.js";
import { STARTING_LINE_COUNT, startingLine } from "../lib/writing-prompts.js";
import {
  IconBulb,
  IconFileImport,
  IconLoader2,
  IconMessageCircle,
  IconPencil,
  IconRefresh,
  IconSend,
  IconSparkles,
  IconX,
} from "./icons.jsx";
import "./writing-assist.css";

/**
 * AI 协作始终给候选，不直接改正文。
 * - 想一想：一次只推动一步。
 * - 聊一聊：逐问挖出用户已有的经历和判断，最后只整理线索，不生成成稿。
 * - 帮我写：明确选择后才生成候选段落，由用户再决定是否插入。
 */
function attachedMaterialContext(materials = []) {
  return materials.slice(0, 12).map((item, index) => {
    const text = String(item.content || item.note || item.summary || "").trim().slice(0, 900);
    const source = String(item.sourceUrl || item.source || "").trim().slice(0, 300);
    return [`${index + 1}. ${item.title || "未命名素材"}`, text, source ? `来源：${source}` : ""].filter(Boolean).join("\n");
  }).join("\n\n").slice(0, 8_000);
}

export function WritingAssist({ title, body, platform, profile, materials = [], getCursor, onInsert }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("think");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [expertId, setExpertId] = useState("");
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStream, setChatStream] = useState("");
  const [chatSession, setChatSession] = useState("");
  const [summary, setSummary] = useState("");
  const turn = useRef(0);
  const abort = useRef(null);
  const chatEnd = useRef(null);

  const experts = (profile?.experts || []).filter((item) => item.enabled);
  const expert = experts.find((item) => item.id === expertId) || null;
  const style = profile?.style || null;
  const audience = profile?.profile?.audience || "";
  const materialContext = attachedMaterialContext(materials);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest" }); }, [chat, chatStream]);

  function localStarter() {
    setResult((current) => {
      let text = "";
      // 组合库是确定性取样，相邻 seed 仍可能落到同一句；“换一句”必须保证肉眼真的换。
      for (let attempt = 0; attempt < 8; attempt += 1) {
        turn.current += 1;
        text = startingLine({ topic: title, seed: `${title}-${Date.now()}-${turn.current}` });
        if (text !== current?.text) break;
      }
      return { mode: "starter", kind: "起始句", text };
    });
    setError(null);
  }

  async function ask(nextMode = "nudge") {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await creationApi.writingAssist({
        mode: nextMode,
        title,
        content: body,
        cursor: Math.max(0, Math.min(body.length, Number(getCursor?.()) || 0)),
        platform,
        materials: materialContext,
        expert: expert ? `${expert.name}\n${expert.instructions}` : "",
        style: style ? `${style.name}\n${style.instructions}` : "",
      }, ac.signal);
      setResult({ mode: nextMode, kind: response.kind, text: response.text });
    } catch (cause) {
      // 切换协作方式时会取消上一种请求；旧请求晚到的错误不能串进新面板。
      if (abort.current === ac && !ac.signal.aborted && cause.name !== "AbortError") setError(cause);
    } finally {
      if (abort.current === ac) setBusy(false);
    }
  }

  async function sendBrainstorm(text, phase = "questioning") {
    const message = String(text || "").trim();
    if (!message || busy) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError(null);
    setSummary(phase === "summary" ? "" : summary);
    setChatInput("");
    setChat((items) => [...items, { role: "user", text: message, quiet: phase === "summary" }]);
    setChatStream("");
    try {
      const full = await brainstormStream({
        signal: ac.signal,
        sessionId: chatSession,
        message,
        title,
        platform,
        content: body,
        audience,
        materials: materialContext,
        phase,
        expert,
        style,
        onSession: (id) => { if (id) setChatSession(id); },
        onChunk: setChatStream,
      });
      setChat((items) => [...items, { role: "agent", text: full, summary: phase === "summary" }]);
      if (phase === "summary") setSummary(full);
      setChatStream("");
    } catch (cause) {
      if (abort.current === ac && !ac.signal.aborted && cause.name !== "AbortError") setError(cause);
    } finally {
      if (abort.current === ac) setBusy(false);
    }
  }

  function show() {
    if (open) return setOpen(false);
    setOpen(true);
    setMode("think");
    if (!body.trim()) localStarter();
    else ask("nudge");
  }

  function pickMode(next) {
    abort.current?.abort();
    abort.current = null;
    setBusy(false);
    setMode(next);
    setError(null);
    setResult(null);
    if (next === "think") {
      if (!body.trim()) localStarter();
      else ask("nudge");
    }
  }

  function changeExpert(next) {
    setExpertId(next);
    // 专家是这段对话的角色，半途换人就开一段新的，避免旧会话继续按前一位回答。
    setChat([]);
    setChatSession("");
    setChatStream("");
    setSummary("");
    setError(null);
    setResult(null);
  }

  function insert() {
    if (!result?.text) return;
    onInsert?.(result.text, {
      ai: result.mode === "paragraph" || result.mode === "finish",
      kind: result.kind,
    });
    setOpen(false);
  }

  function insertSummary() {
    if (!summary) return;
    onInsert?.(`## 写作线索\n\n${summary}`, { ai: true, kind: "想法梳理" });
    setOpen(false);
  }

  return (
    <div className="writing-assist">
      <button className="writing-assist__trigger" onClick={show} aria-expanded={open} aria-busy={busy} title="给一个推动、聊清想法，或生成一段候选">
        {busy ? <IconLoader2 aria-hidden="true" /> : <IconSparkles aria-hidden="true" />}AI 协作
      </button>
      {open ? (
        <section className="writing-assist__card" data-mode={mode} aria-label="AI 协作" aria-live="polite">
          <header>
            <div className="writing-assist__modes" aria-label="协作方式">
              <button data-on={mode === "think"} onClick={() => pickMode("think")}><IconBulb aria-hidden="true" />想一想</button>
              <button data-on={mode === "chat"} onClick={() => pickMode("chat")}><IconMessageCircle aria-hidden="true" />聊一聊</button>
              <button data-on={mode === "write"} onClick={() => pickMode("write")}><IconPencil aria-hidden="true" />帮我写</button>
            </div>
            <button className="writing-assist__close" onClick={() => setOpen(false)} aria-label="关闭 AI 协作"><IconX aria-hidden="true" /></button>
          </header>

          {(style || experts.length) ? (
            <div className="writing-assist__context">
              {style ? <span>风格 · {style.name}</span> : <span>风格 · 原本语气</span>}
              {experts.length ? (
                <label>本轮专家
                  <select value={expertId} onChange={(event) => changeExpert(event.target.value)}>
                    <option value="">不调用</option>
                    {experts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
              ) : null}
              {expert ? <small>{expert.description}</small> : null}
            </div>
          ) : null}

          {mode === "chat" ? (
            <div className="writing-assist__chat">
              {!chat.length && !chatStream ? (
                <div className="writing-assist__welcome">
                  <IconMessageCircle aria-hidden="true" />
                  <strong>先把脑子里的东西说出来</strong>
                  <p>我一次只问一个问题，帮你找出判断、经历和例子；最后只整理写作线索，不会替你生成成稿。</p>
                  <button onClick={() => sendBrainstorm("请从我现在的标题和正文开始，先问我一个最值得回答的问题。")}>开始梳理</button>
                </div>
              ) : (
                <div className="writing-assist__log">
                  {chat.map((item, index) => item.quiet ? null : (
                    <div key={`${item.role}-${index}`} data-role={item.role} data-summary={item.summary || undefined}>
                      <span>{item.role === "user" ? "我" : item.summary ? "写作线索" : expert?.name || "AI"}</span>
                      <p>{item.text}</p>
                    </div>
                  ))}
                  {chatStream ? <div data-role="agent"><span>{expert?.name || "AI"}</span><p>{chatStream}</p></div> : null}
                  <i ref={chatEnd} />
                </div>
              )}

              {error ? <div className="writing-assist__error"><strong>{error.message}</strong>{error.hint ? <small>{error.hint}</small> : null}</div> : null}

              {chat.length || chatStream ? (
                <div className="writing-assist__composer">
                  <textarea
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendBrainstorm(chatInput);
                      }
                    }}
                    placeholder="回答刚才的问题…"
                    disabled={busy}
                    rows={2}
                  />
                  <button onClick={() => sendBrainstorm(chatInput)} disabled={busy || !chatInput.trim()} aria-label="发送"><IconSend aria-hidden="true" /></button>
                </div>
              ) : null}

              {chat.length ? (
                <footer className="writing-assist__chat-actions">
                  <button onClick={() => sendBrainstorm("请停止追问，把到目前为止的内容整理成写作线索。", "summary")} disabled={busy}>整理线索</button>
                  {summary ? <button className="is-primary" onClick={insertSummary}><IconFileImport aria-hidden="true" />插入正文</button> : null}
                </footer>
              ) : null}
            </div>
          ) : busy ? (
            <div className="writing-assist__wait"><IconLoader2 aria-hidden="true" /><span>{mode === "think" ? "正在围绕当前光标找最值得追问的一步…" : "正在围绕当前光标接着写…"}</span></div>
          ) : error ? (
            <div className="writing-assist__error"><strong>{error.message}</strong>{error.hint ? <small>{error.hint}</small> : null}<button onClick={() => mode === "think" ? ask("nudge") : setError(null)}>重试</button></div>
          ) : mode === "write" && !result ? (
            <div className="writing-assist__choice">
              <p>结合全文理解主题，围绕当前光标生成候选；只有你确认后才会插进正文。</p>
              <div><button onClick={() => ask("paragraph")}>续写一段</button><button onClick={() => ask("finish")}>完成全文</button></div>
            </div>
          ) : result ? (
            <div className="writing-assist__result" data-long={result.mode === "finish" ? "true" : undefined}>
              <small>{result.kind}</small>
              <p>{result.text}</p>
              <footer>
                <span>{result.mode === "starter" ? `内置组合库 · ${STARTING_LINE_COUNT.toLocaleString("en-US")} 种` : result.mode === "nudge" ? "围绕光标，只给一步" : `候选 ${result.text.length} 字`}</span>
                <div>
                  <button className="writing-assist__icon-action" onClick={() => result.mode === "starter" ? localStarter() : ask(result.mode)} aria-label={result.mode === "starter" ? "换一句起始句" : "再生成一个"} title={result.mode === "starter" ? "换一句起始句" : "再生成一个"}><IconRefresh aria-hidden="true" /></button>
                  {result.mode !== "nudge" ? <button className="writing-assist__icon-action is-primary" onClick={insert} aria-label={result.mode === "starter" ? "用这句开头" : "插入光标处"} title={result.mode === "starter" ? "用这句开头" : "插入光标处"}><IconFileImport aria-hidden="true" /></button> : null}
                </div>
              </footer>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
