// 「撰写中」这一步的闸门。
//
// 流水线的真实行为：选题一进「撰写中」，Worker 的成稿任务五分钟内领走它，
// 只选择一个主平台、只生成一个版本。其他平台需要时再从主稿做适配，不在这一步烧多份 token。
//
// 这个对话框做两件事：先把平台写回「适配平台」，再把状态改成「撰写中」。
// 顺序不能反：先改状态的话，Worker 可能在你还没勾完平台时就把选题领走了。
//
// 补写也走这里：已经写过公众号，再勾上 X 并把状态改回「撰写中」，Worker 会跳过
// 已有草稿的平台、只补缺的那个（防重逻辑在 draft.js 里）。

import { useEffect, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { PLATFORMS } from "../lib/sources.js";
import { ErrorNote } from "./ui.jsx";
import { IconSparkles, IconX } from "./icons.jsx";

export function PlatformGate({ item, initial = [], done = [], onCancel, onConfirm }) {
  const [picked, setPicked] = useState(() => initial.find((p) => PLATFORMS.includes(p)) || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // 跑起来之后 Esc 不生效：这一步已经在往 Notion 写了，半路撤不回来。
  // 传 undefined 而不是一个空函数——那样 useDialog 会以为「有人管 Esc」。
  const boxRef = useDialog(true, busy ? undefined : onCancel);

  async function go() {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm([picked]);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const already = done.includes(picked);

  return (
    <div className="scrim scrim--center">
      <div className="modal" ref={boxRef} role="dialog" aria-modal="true" aria-label="选择成稿平台">
        <header className="modal__head">
          <div>
            <span className="eyebrow">START DRAFTING</span>
            <h3>先写哪个主平台？</h3>
          </div>
          <button className="icon-btn" onClick={onCancel} disabled={busy} aria-label="取消">
            <IconX aria-hidden="true" stroke={1.8} />
          </button>
        </header>

        <p className="modal__lead">
          《{item.title}》改成「撰写中」后，只会为你选择的主平台生成一篇完整稿件。
          先把主版本做好、发布和复盘，再决定是否适配其他平台。
        </p>

        <div className="pick-grid">
          {PLATFORMS.map((p) => {
            const hasDraft = done.includes(p);
            return (
              <button
                key={p}
                type="button"
                className="pick"
                aria-pressed={picked === p}
                onClick={() => setPicked(p)}
                disabled={busy}
              >
                <span className="pick__name">{p}</span>
                <span className="pick__note">{hasDraft ? "已有稿，会直接复用" : "生成主平台稿"}</span>
              </button>
            );
          })}
        </div>

        <ErrorNote error={error} what="开始撰写" />

        <div className="modal__foot">
          <span className="modal__hint">
            {!picked ? "请选择一个主平台" : already ? `${picked} 已有稿，不会重复生成` : `这次只生成：${picked}`}
          </span>
          <div className="row-actions">
            <button className="btn btn-sm" onClick={onCancel} disabled={busy}>取消</button>
            <button className="btn btn-primary btn-sm" onClick={go} disabled={busy || !picked}>
              <IconSparkles aria-hidden="true" stroke={1.8} />
              {busy ? "提交中…" : "开始撰写"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
