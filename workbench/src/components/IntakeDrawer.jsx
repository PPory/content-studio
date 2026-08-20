// 统一入库抽屉。工作台各处的「存素材」最终都开这个，走 /api/pipe/intake，
// 和 Telegram 的 /金句 /素材 命令是同一份存储逻辑（Worker 侧 lib/store.js）。

import { useEffect, useRef, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { api } from "../lib/api.js";
import { INTAKE_TYPES } from "../lib/views.js";
import { ErrorNote, Note, Tags } from "./ui.jsx";
import { IconArchive, IconX } from "./icons.jsx";

export function IntakeDrawer({ open, onClose, preset, onStored, collectionsEnabled }) {
  const [target, setTarget] = useState("collection");
  const [cmd, setCmd] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const textRef = useRef(null);

  // 从阅读区划词进来时带着选中的原文和出处——用户不该再复制粘贴一遍
  useEffect(() => {
    if (!open || !preset) return;
    setContent(preset.content || "");
    setSource(preset.source || "");
    setSaveNote(preset.saveNote || "");
    setTarget(preset.target || "collection");
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

  async function store(saveDuplicate = false) {
    if (!content.trim() || busy || (target === "collection" && !collectionsEnabled)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.intake({ target, cmd: target === "material" ? cmd : "", content, source, saveNote, selection: preset?.selection || "", saveDuplicate });
      setDone(r);
      if (!r.duplicate) {
        setContent("");
        setSaveNote("");
        onStored?.(r);
      }
      // 调用方自己的后续动作（稿件补录经历要重取正文，好让那条告警自己消失）。
      // 走 preset 而不是再加一个 prop：这是**这一次入库**的事，不是抽屉的属性。
      if (!r.duplicate) preset?.onStored?.(r);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    await store(false);
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
          {/* 带着上下文进来的（补录经历、划词入库）要说清「这段为什么已经填好了」，
              否则用户会以为是残留，顺手清掉——而清掉之后这条素材就不管用了 */}
          {preset?.hint ? <div className="field-hint">{preset.hint}</div> : null}
        </div>

        {target === "collection" ? (
          <div className="field">
            <label>为什么收藏（可选）</label>
            <input value={saveNote} onChange={(e) => setSaveNote(e.target.value)} placeholder="一句话记下它对你有什么价值" />
          </div>
        ) : null}

        <div className="field">
          <label>出处（可选）</label>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="链接进「出处」字段；书名 / 人名并进正文"
          />
        </div>

        {/* 用户选择的是“这条内容现在需要怎样处理”，底层仍复用三种存储目标，
            但不再把数据库对象冒充成三个并列的产品入口。 */}
        <div className="field">
          <label>先怎么处理</label>
          <div className="seg">
            <button type="button" aria-pressed={target === "collection"} onClick={() => setTarget("collection")}>
              稍后整理
            </button>
            <button type="button" aria-pressed={target === "inbox"} onClick={() => setTarget("inbox")}>
              记下想法
            </button>
            <button type="button" aria-pressed={target === "material"} onClick={() => setTarget("material")}>
              直接作为素材
            </button>
          </div>
          <div className="field-hint">
            {target === "collection"
              ? collectionsEnabled ? "先保留原文和出处，之后再决定是否提炼成素材" : "当前收藏能力不可用；为防止误存，暂时不能选择这一项"
              : target === "material"
              ? "直接成为可复用素材，写作时可按标签检索"
              : "记录为一个待整理的想法，由系统辅助判断价值和去向"}
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
          <Note tone="success" title={done.duplicate ? "这条已经收藏过" : done.target === "material" ? `已加入素材工作区（${done.dbType}）` : "已加入素材工作区"}>
            <div style={{ marginTop: 4 }}>{done.title || done.existing?.title}</div>
            {done.duplicate ? <div className="row-actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => { window.location.hash = "#/materials/待处理"; onClose(); }}>打开已有收藏</button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => store(true)}>仍然保存副本</button>
            </div> : null}
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
          <button className="btn btn-primary" disabled={busy || !content.trim() || (target === "collection" && !collectionsEnabled)}>
            <IconArchive aria-hidden="true" stroke={1.8} />
          {busy ? "存入中…" : target === "collection" ? "先收下" : target === "inbox" ? "记下想法" : "加入素材"}
          </button>
        </div>
      </form>
    </div>
  );
}
