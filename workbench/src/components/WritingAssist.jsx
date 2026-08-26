import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { EXPERT_KINDS, normalizeExpertKind } from "../lib/expert-kinds.js";
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
  IconShieldCheck,
  IconSparkles,
  IconX,
} from "./icons.jsx";
import { ExpertTaskPanel } from "./ExpertTaskPanel.jsx";
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

const CHECK_DESCRIPTIONS = Object.freeze({
  "material-research": "逐个观点对照项目素材，指出缺口和下一步检索方向",
  "quality-review": "检查读者、结构、逻辑、论据和可能误读，不替你重写",
  "fact-check": "提取数字、日期、引语等可核查项；没有依据的一律标待核",
});

const CHECKS = Object.freeze(EXPERT_KINDS.map((item) => Object.freeze({
  id: item.id,
  expertId: item.expertId,
  label: item.displayName,
  description: CHECK_DESCRIPTIONS[item.id],
})));

const styleStorageKey = (scopeId) => scopeId ? `workbench:draft-style:v1:${scopeId}` : "";
const storedStyle = (scopeId) => {
  try { return localStorage.getItem(styleStorageKey(scopeId)) || ""; } catch { return ""; }
};

export function WritingAssist({ title, body, platform, profile, materials = [], scopeId = "", getCursor, getSelection, onInsert }) {
  const [open, setOpen] = useState(false);
  const [checkMenu, setCheckMenu] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [activeCheck, setActiveCheck] = useState("");
  const [expertRun, setExpertRun] = useState(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [mode, setMode] = useState("think");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [styles, setStyles] = useState([]);
  const [styleId, setStyleId] = useState("");
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStream, setChatStream] = useState("");
  const [chatSession, setChatSession] = useState("");
  const [summary, setSummary] = useState("");
  const turn = useRef(0);
  const abort = useRef(null);
  const chatEnd = useRef(null);
  const styleInitialized = useRef(false);
  const rootRef = useRef(null);

  const experts = (profile?.experts || []).filter((item) => item.enabled);
  const writer = experts.find((item) => item.id === "writing-coach") || null;
  const style = styles.find((item) => item.id === styleId) || null;
  const audience = profile?.profile?.audience || "";
  const materialContext = attachedMaterialContext(materials);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest" }); }, [chat, chatStream]);
  useEffect(() => {
    const nextStyles = (profile?.styles || []).filter((item) => item.enabled);
    setStyles(nextStyles);
    if (!profile || styleInitialized.current) return;
    const savedId = storedStyle(scopeId);
    const fallback = profile.profile?.styleId || "";
    const nextId = nextStyles.some((item) => item.id === savedId) ? savedId : fallback;
    const nextStyle = nextStyles.find((item) => item.id === nextId);
    setStyleId(nextStyle?.id || "");
    styleInitialized.current = true;
  }, [profile, scopeId]);

  useEffect(() => {
    const dismiss = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && rootRef.current?.contains(event.target)) return;
      setOpen(false);
      setCheckMenu(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", dismiss, true);
    };
  }, []);

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
        expert: writer ? `${writer.name}\n${writer.instructions}` : "",
        style: ["paragraph", "finish"].includes(nextMode) && style ? `${style.name}\n${style.instructions}` : "",
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
        expert: writer,
        style: null,
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
    setCheckMenu(false);
    setOpen(true);
    setMode("think");
    if (!body.trim()) localStarter();
    else ask("nudge");
  }

  function chooseStyle(nextId) {
    const next = styles.find((item) => item.id === nextId) || null;
    setStyleId(next?.id || "");
    try {
      const key = styleStorageKey(scopeId);
      if (key) {
        if (next?.id) localStorage.setItem(key, next.id);
        else localStorage.removeItem(key);
      }
    } catch {
      /* 浏览器禁用本地存储时，本次编辑仍然生效。 */
    }
  }

  async function runCheck(checkId) {
    const kind = normalizeExpertKind(checkId);
    const spec = CHECKS.find((item) => item.id === kind);
    const expert = experts.find((item) => item.id === spec?.expertId);
    if (!spec || !expert || !body.trim() || checkBusy) return;
    setOpen(false);
    setCheckMenu(false);
    setCheckOpen(true);
    setActiveCheck(kind);
    setCheckBusy(true);
    setExpertRun({ kind, status: "queued", stageLabel: "准备专家任务", percent: 2 });
    try {
      const response = await api.startExpertRun({
        kind,
        scopeId,
        document: { title, body, platform, audience, selection: getSelection?.() || null },
      });
      setExpertRun(response.run);
    } catch (cause) {
      setExpertRun((run) => ({ ...run, status: "failed", error: cause.message, hint: cause.hint }));
    } finally {
      setCheckBusy(false);
    }
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
    <div className="writing-assist" ref={rootRef}>
      <button className="writing-assist__trigger" onClick={show} aria-expanded={open} aria-busy={busy && open} title="由写作教练推动一步、聊清想法，或生成候选">
        {busy && open ? <IconLoader2 aria-hidden="true" /> : <IconSparkles aria-hidden="true" />}AI 协作
      </button>

      <div className="writing-checks">
        <button
          className="writing-tool-btn"
          onClick={() => { setCheckMenu((value) => !value); setOpen(false); setError(null); }}
          aria-expanded={checkMenu || checkOpen}
          title="对正文做素材、质量或事实检查"
        ><IconShieldCheck aria-hidden="true" />检查</button>
        {checkMenu ? (
          <div className="writing-checks__menu" role="menu" aria-label="检查正文">
            {CHECKS.map((item) => (
              <button key={item.id} role="menuitem" disabled={!body.trim()} onClick={() => runCheck(item.id)}>
                <b>{item.label}</b><span>{item.description}</span>
              </button>
            ))}
            {!body.trim() ? <small>先写一点正文，检查才有对象。</small> : null}
          </div>
        ) : null}
      </div>

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

          <div className="writing-assist__context">
            <span>写作教练</span>{mode === "write" ? <span>风格顾问 · {style?.name || "原本语气"}</span> : null}
            <small>这里负责推动和生成候选；素材查缺、审稿和核查在编辑器的“检查”里。</small>
          </div>

          {mode === "write" ? <label className="writing-assist__style-select">
            <span>这次用什么语气写</span>
            <select value={styleId} onChange={(event) => chooseStyle(event.target.value)}>
              <option value="">原本语气</option>
              {styles.map((item) => <option value={item.id} key={item.id}>{item.name}{item.customized ? " · 已校准" : ""}</option>)}
            </select>
            <small>{style?.description || "只沿用当前正文已有的语气和节奏。提示词在设置里修改。"}</small>
          </label> : null}

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
                      <span>{item.role === "user" ? "我" : item.summary ? "写作线索" : writer?.name || "AI"}</span>
                      <p>{item.text}</p>
                    </div>
                  ))}
                  {chatStream ? <div data-role="agent"><span>{writer?.name || "AI"}</span><p>{chatStream}</p></div> : null}
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
            <div className="writing-assist__wait"><IconLoader2 aria-hidden="true" /><span>{mode === "think" ? "写作教练正在找最值得追问的一步…" : "写作教练正在围绕光标接着写…"}</span></div>
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

      {checkOpen ? <ExpertTaskPanel run={expertRun} onRunChange={setExpertRun} onClose={() => setCheckOpen(false)} onRetry={() => runCheck(activeCheck)} /> : null}
    </div>
  );
}
