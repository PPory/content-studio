/**
 * 记录用户声音：把现实里的原话原样收下来。
 *
 * ⚠️ **这里只有一个输入框。** 上一版这个入口落在「内容机会」概览的手记表单上，
 * 而那张表要先填问题、再填「为什么值得关注」——也就是要求用户**先替系统把观察
 * 整理成结论**。真实的顺序是反过来的：你先看见有人这么说，之后才知道那是什么问题。
 * 提炼是 AI 的活，这一屏只负责不让原话丢失、不让它被改写。
 *
 * ⚠️ **来源种类是猜出来的，不是问出来的**（Infer before Ask）。
 * 粘进来的东西长什么样，基本已经说明它是群聊还是一条评论；猜错了改一下就是一次点击，
 * 而每多问一个必填项，这个入口就少被用一次。
 */

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { useDialog } from "../lib/use-dialog.js";
import { ErrorNote, Note } from "./ui.jsx";
import { IconMessageQuestion, IconX } from "./icons.jsx";

const KINDS = [
  { key: "group_chat", label: "群聊" },
  { key: "comment", label: "评论" },
  { key: "direct_message", label: "私信" },
  { key: "interview", label: "访谈" },
  { key: "feedback", label: "反馈" },
  { key: "post", label: "帖子" },
  { key: "other", label: "其他" },
];

/**
 * 从粘贴的形状猜来源种类。
 *
 * 判据只用**排版**，不看内容：`昵称：说的话` 连着好几行就是聊天记录，
 * 带链接的多半是从帖子里抄的。猜不出来就老实回落 `other`，不硬猜。
 */
export function guessVoiceKind(text) {
  const body = String(text || "").trim();
  if (!body) return "other";
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const speaker = lines.filter((line) => /^.{1,24}[:：]\s*\S/.test(line)).length;
  if (speaker >= 3 || (speaker >= 2 && speaker / lines.length > 0.6)) return "group_chat";
  if (/https?:\/\/\S+/.test(body)) return "post";
  if (lines.length >= 3 && body.length / lines.length < 60) return "comment";
  return "other";
}

export function VoiceCapture({ open, onClose, onStored, onGo, preset = null }) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("other");
  const [kindTouched, setKindTouched] = useState(false);
  const [details, setDetails] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const textRef = useRef(null);

  const boxRef = useDialog(open, onClose);

  useEffect(() => {
    if (!open) return;
    // 从 Ctrl+K 带进来的那行字先落进正文，不让人再打一遍；
    // 它多半只是个检索词，所以正文框里就等着被替换掉。
    const seed = String(preset?.term || "");
    setBody(seed);
    setKind(guessVoiceKind(seed));
    setKindTouched(false);
    setDetails(false);
    setSourceName("");
    setSourceUrl("");
    setObservedAt("");
    setError(null);
    setDone(null);
  }, [open, preset]);

  if (!open) return null;

  const changeBody = (value) => {
    setBody(value);
    // 用户自己点过种类之后就不再改他的选择——猜测让位于明确表达。
    if (!kindTouched) setKind(guessVoiceKind(value));
  };

  const save = async (event) => {
    event.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.recordAudienceVoice({
        kind,
        body,
        sourceName,
        sourceUrl,
        observedAt: observedAt ? new Date(observedAt).toISOString() : "",
        confirmed: true,
      });
      setDone(result);
      if (!result.duplicate) {
        setBody("");
        onStored?.(result);
      }
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="drawer" ref={boxRef} onSubmit={save} role="dialog" aria-modal="true" aria-label="记录用户声音">
        <div className="drawer-head">
          <div className="drawer-title">记录用户声音</div>
          <button type="button" className="icon-btn" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
            <IconX aria-hidden="true" stroke={1.8} />
          </button>
        </div>

        <div className="drawer-body">
          <div className="field field--grow">
            <label htmlFor="voice-body">原话</label>
            <textarea
              id="voice-body"
              ref={textRef}
              data-autofocus=""
              value={body}
              onChange={(event) => changeBody(event.target.value)}
              placeholder={"把群聊、评论、私信或访谈原话整段粘进来。\n不用整理，也不用先想它是什么问题——保持原样才有用。"}
            />
            <div className="field-hint">保存后这段原话不可修改。它是「有人真的这样说过」的唯一凭据；录错了就再记一条。</div>
          </div>

          <div className="field">
            <label>这是哪来的</label>
            <div className="chips" role="group" aria-label="来源种类">
              {KINDS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="chip"
                  aria-pressed={kind === item.key}
                  onClick={() => { setKind(item.key); setKindTouched(true); }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {!kindTouched && body.trim() ? <div className="field-hint">按粘进来的样子先替你选了一个，不对就改。</div> : null}
          </div>

          {/* 名称 / 链接 / 时间全是可选的，所以默认收起来——展开一次要点一下，
              而不填才是常态。 */}
          <div className="field">
            <button type="button" className="btn btn-sm" aria-expanded={details} onClick={() => setDetails((value) => !value)}>
              {details ? "收起来源信息" : "补充来源信息（可选）"}
            </button>
          </div>

          {details ? (
            <>
              <div className="field">
                <label htmlFor="voice-source-name">来源名称（可选）</label>
                <input id="voice-source-name" value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="例如：读者群、某条视频下的评论区" />
              </div>
              <div className="field">
                <label htmlFor="voice-source-url">链接（可选）</label>
                <input id="voice-source-url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://" />
              </div>
              <div className="field">
                <label htmlFor="voice-observed-at">什么时候说的（可选）</label>
                <input id="voice-observed-at" type="date" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} />
                <div className="field-hint">不填就记成今天导入，不去猜。</div>
              </div>
            </>
          ) : null}

          <ErrorNote error={error} what="记录用户声音" />

          {done ? (
            <Note tone="success" title={done.duplicate ? "这段之前已经记过了" : "已经记下来了"}>
              <div style={{ marginTop: 4 }}>
                {done.duplicate
                  ? "同样的原话工作台里已经有一条，没有重复保存。"
                  : "下次在内容里扫描时，它会被一起读进去。你不用先把它整理成用户问题。"}
              </div>
              {onGo ? (
                <div className="row-actions" style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-sm" onClick={() => { onGo("bridge", ""); onClose(); }}>去内容看看</button>
                </div>
              ) : null}
            </Note>
          ) : null}
        </div>

        <div className="drawer-foot">
          {/* 存完之后这颗不再是「取消」——已经存进去了，取消不掉。
              右上角那颗 icon 按钮的无障碍名就是「关闭」，这里再叫一次会撞名。 */}
          <button type="button" className="btn" onClick={onClose}>{done && !done.duplicate ? "完成" : "取消"}</button>
          <button className="btn btn-primary" disabled={busy || !body.trim()}>
            <IconMessageQuestion aria-hidden="true" stroke={1.8} />
            {busy ? "正在记下…" : "记下这段原话"}
          </button>
        </div>
      </form>
    </div>
  );
}
