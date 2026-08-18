import { useEffect, useRef, useState } from "react";
import { creationApi } from "../lib/creation-api.js";
import { STARTING_LINE_COUNT, startingLine } from "../lib/writing-prompts.js";
import { IconBulb, IconLoader2, IconX } from "./icons.jsx";
import "./writing-assist.css";

/**
 * 写作推动是一张临时卡片，不是聊天窗：一次只给一个结果，下一次必须由用户再点。
 * “想一想”是默认状态；“帮我写”只在明确切换后才会生成正文，而且生成结果不会自动落笔。
 */
export function WritingAssist({ title, body, platform, onInsert }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("think");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const turn = useRef(0);
  const abort = useRef(null);

  useEffect(() => () => abort.current?.abort(), []);

  function localStarter() {
    turn.current += 1;
    setResult({
      mode: "starter",
      kind: "起始句",
      text: startingLine({ topic: title, seed: `${title}-${Date.now()}-${turn.current}` }),
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
        platform,
      }, ac.signal);
      setResult({ mode: nextMode, kind: response.kind, text: response.text });
    } catch (e) {
      if (e.name !== "AbortError") setError(e);
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
    onInsert?.(result.text);
    setOpen(false);
  }

  return (
    <div className="writing-assist">
      <button className="writing-assist__trigger" onClick={show} aria-expanded={open} title="卡住时给我一个小推动">
        <IconBulb aria-hidden="true" />推动一下
      </button>
      {open ? (
        <section className="writing-assist__card" aria-label="写作推动" aria-live="polite">
          <header>
            <div className="writing-assist__modes" aria-label="推动方式">
              <button data-on={mode === "think"} onClick={() => pickMode("think")}>想一想</button>
              <button data-on={mode === "write"} onClick={() => pickMode("write")}>帮我写</button>
            </div>
            <button className="writing-assist__close" onClick={() => setOpen(false)} aria-label="关闭写作推动"><IconX aria-hidden="true" /></button>
          </header>

          {busy ? (
            <div className="writing-assist__wait"><IconLoader2 className="spin" aria-hidden="true" /><span>{mode === "think" ? "正在找最值得追问的一步…" : "正在顺着你的上文往下写…"}</span></div>
          ) : error ? (
            <div className="writing-assist__error"><strong>{error.message}</strong>{error.hint ? <small>{error.hint}</small> : null}<button onClick={() => mode === "think" ? ask("nudge") : setError(null)}>重试</button></div>
          ) : mode === "write" && !result ? (
            <div className="writing-assist__choice">
              <p>根据标题和已有上文生成候选，确认后才会插进正文。</p>
              <div>
                <button onClick={() => ask("paragraph")}>续写一段</button>
                <button onClick={() => ask("finish")}>完成全文</button>
              </div>
            </div>
          ) : result ? (
            <div className="writing-assist__result" data-long={result.mode === "finish" ? "true" : undefined}>
              <small>{result.kind}</small>
              <p>{result.text}</p>
              <footer>
                <span>{result.mode === "starter" ? `来自 ${STARTING_LINE_COUNT.toLocaleString("en-US")} 条内置起始句` : result.mode === "nudge" ? "只给一步，不替你下笔" : `候选 ${result.text.length} 字`}</span>
                <div>
                  <button onClick={() => result.mode === "starter" ? localStarter() : ask(result.mode)}>{result.mode === "starter" ? "换一句" : "再来一个"}</button>
                  {result.mode !== "nudge" ? <button className="is-primary" onClick={insert}>{result.mode === "starter" ? "用这句开头" : "插入光标处"}</button> : null}
                </div>
              </footer>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
