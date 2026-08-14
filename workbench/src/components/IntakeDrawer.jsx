// 统一入库抽屉。工作台各处的「存素材」最终都开这个，走 /api/pipe/intake，
// 和 Telegram 的 /金句 /素材 命令是同一份存储逻辑（Worker 侧 lib/store.js）。

import { useEffect, useRef, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { api } from "../lib/api.js";
import { INTAKE_TYPES } from "../lib/views.js";
import { ErrorNote, Note, Tags } from "./ui.jsx";
import { IconArchive, IconX } from "./icons.jsx";

export function IntakeDrawer({ open, onClose, preset, onStored }) {
  const [target, setTarget] = useState("material");
  const [cmd, setCmd] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const textRef = useRef(null);

  // 从阅读区划词进来时带着选中的原文和出处——用户不该再复制粘贴一遍
  useEffect(() => {
    if (!open || !preset) return;
    setContent(preset.content || "");
    setSource(preset.source || "");
// 从灵感库点「新增灵感」进来时，默认就该落在灵感库，不用用户再选一次
    if (preset.target) setTarget(preset.target);
    if (preset.cmd != null) setCmd(preset.cmd);
  }, [open, preset]);

  // Esc、焦点陷阱、背景 inert、关闭后焦点归位——全在 useDialog 里。
  // `data-autofocus` 标在正文上：点「入库」的意图只有一个，就是把手上这段东西存进去。
  const boxRef = useDialog(open, onClose);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDone(null);
  }, [open]);

  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    if (!content.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.intake({ target, cmd: target === "material" ? cmd : "", content, source });
      setDone(r);
      setContent("");
      onStored?.(r);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="drawer" ref={boxRef} onSubmit={submit} role="dialog" aria-modal="true" aria-label="入库">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">INTAKE</span>
            <div className="drawer-title">入库</div>
          </div>
          {/* 图标就够。「关闭 Esc」那种常驻的快捷键提示只有第一天有用，之后一直占着地方 */}
          <button type="button" className="icon-btn" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
            <IconX aria-hidden="true" stroke={1.8} />
          </button>
        </div>

        {/* **正文排在最上面。** 点「入库」的意图只有一个：把手上这段东西存进去。
            分流和打标是存之前顺手做的事，不该挡在正文前面（而且多数时候默认就是对的）。 */}
        <div className="field">
          <label>内容</label>
          <textarea
            ref={textRef}
            data-autofocus=""
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={"粘贴内容。行首或空格后的 #词 会自动消歧：\n能匹配到选题名就挂关联选题，否则当标签。"}
          />
        </div>

        <div className="field">
          <label>出处（可选）</label>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="链接进「出处」字段；书名 / 人名并进正文"
          />
        </div>

        {/* 分流是**互斥的去处**，所以仍然是黑块 seg：黑块的语言是「你现在在这儿」 */}
        <div className="field">
          <label>存到哪</label>
          <div className="seg">
            <button type="button" aria-pressed={target === "material"} onClick={() => setTarget("material")}>
              素材库
            </button>
            <button type="button" aria-pressed={target === "inbox"} onClick={() => setTarget("inbox")}>
                灵感库
            </button>
          </div>
          <div className="field-hint">
            {target === "material"
              ? "直接成为素材卡，成稿时按标签被检索到"
              : "走正常初筛流程（每 5 分钟一轮），由系统判断价值再分流"}
          </div>
        </div>

        {target === "material" && (
          /* 类型是**给这条内容打的标**，不是导航，所以选中态用标记黄——
             和划词高亮同一个颜色、同一个意思：「这个我圈定了」。 */
          <div className="field">
            <label>素材类型</label>
            <div className="chips">
              {INTAKE_TYPES.map((t) => (
                <button
                  key={t.cmd || "auto"}
                  type="button"
                  className="chip"
                  aria-pressed={cmd === t.cmd}
                  onClick={() => setCmd(t.cmd)}
                  title={t.desc}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="field-hint">{INTAKE_TYPES.find((t) => t.cmd === cmd)?.desc}</div>
          </div>
        )}

        <ErrorNote error={error} what="入库" />

        {done && (
          <Note tone="warn" title={`已存入${done.target === "inbox" ? "灵感库" : `素材库（${done.dbType}）`}`}>
            <div style={{ marginTop: 4 }}>{done.title}</div>
            <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Tags items={done.topicTitles || []} accent />
              <Tags items={done.tags || []} />
              {done.autoTagPending ? <span className="tag">标签自动补中…</span> : null}
            </div>
          </Note>
        )}

        {/* 底部一行：退路在左、主动作在右。只有一个整行按钮时，唯一的退路是右上角那个 ×，
            而人在填完表之后的目光在底部——退出的路不该要求他先把视线拉回顶上。 */}
        <div className="drawer-foot">
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={busy || !content.trim()}>
            <IconArchive aria-hidden="true" stroke={1.8} />
          {busy ? "存入中…" : target === "inbox" ? "存进灵感库" : "存进素材库"}
          </button>
        </div>
      </form>
    </div>
  );
}
