/**
 * 备份与恢复抽屉。
 *
 * 这一屏要回答的问题只有三个，所以它就分三段：
 *   1. 现在有什么可以回退的？    —— 每份数据的大小、时间、快照条数
 *   2. 怎么带走一份？            —— 一个「导出备份」按钮
 *   3. 怎么带回来？              —— 选文件 → **先看预览** → 确认
 *
 * 恢复是覆盖式的，所以**预览这一步不能跳过**。「即将恢复 3 份数据」这种说法把
 * 「42 条变 43 条」和「42 条变 7 条」显示成同一句话，而这是两个完全不同的决定。
 * 预览里直接写清每份数据从几条变成几条。
 *
 * 「快照」和「备份文件」是两个不同的东西，界面上不能混：
 *   - 快照是**工作台自己在每次改数据之前留的**，只在这台机器上，用来「退回上一版」；
 *   - 备份文件是**你主动导出、可以带走的一个 zip**，用来「换台机器 / 硬盘挂了」。
 * 混成一个列表的话，用户不知道点下去的东西会不会随着这台机器一起没。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { api, applyLocalData, downloadBackup } from "../lib/api.js";
import { ErrorNote, Note } from "./ui.jsx";
import { IconArchive, IconCheck, IconDatabase, IconDownload, IconHistory, IconUpload, IconX } from "./icons.jsx";

const fmtBytes = (n) =>
  n == null ? "—" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function BackupDrawer({ open, onClose }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);
  const boxRef = useDialog(open, onClose);

  const load = useCallback(() => {
    api.backupStatus().then(setStatus).catch(setError);
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDone("");
    setFile(null);
    setPreview(null);
    load();
  }, [open, load]);

  if (!open) return null;

  async function run(tag, fn) {
    setBusy(tag);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }

  const onExport = () =>
    run("export", async () => {
      const r = await downloadBackup();
      setDone(`已导出 ${r.name}（${fmtBytes(r.bytes)}）`);
    });

  const onPick = (f) => {
    if (!f) return;
    setFile(f);
    setPreview(null);
    setDone("");
    run("preview", async () => setPreview(await api.previewBackup(f)));
  };

  const onApply = () =>
    run("apply", async () => {
      const r = await api.applyBackup(file);
      const n = applyLocalData(r.browser);
      setDone(`已恢复 ${r.restored.length} 份数据${n ? `，浏览器本地数据 ${n} 项` : ""}。刷新页面后生效。`);
      setPreview(null);
      setFile(null);
      load();
    });

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer drawer--wide" ref={boxRef} role="dialog" aria-modal="true" aria-label="备份与恢复">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">BACKUP</span>
            <div className="drawer-title">备份与恢复</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
            <IconX aria-hidden="true" stroke={1.8} />
          </button>
        </div>

        <ErrorNote error={error} what="备份" />
        {done ? (
          <Note tone="warn" title="完成">
            {done}
          </Note>
        ) : null}

        {/* 1. 现在有什么 ---------------------------------------------------- */}
        <div className="field">
          <label>工作台数据</label>
          <div className="bk-list">
            {(status?.items || []).map((it) => (
              <DataRow key={it.key} item={it} onRestored={(msg) => { setDone(msg); load(); }} onError={setError} />
            ))}
            {!status ? <div className="field-hint">读取中…</div> : null}
          </div>
          <div className="field-hint">
            每次改动之前工作台会自动留一份快照，保留 {status?.keepDays ?? 30} 天（最近 5 份永远保留）。
            快照只在这台机器上——硬盘挂了就一起没，所以还要定期导出一份带走。
          </div>
        </div>

        {/* 2. 带走一份 ------------------------------------------------------ */}
        <div className="field">
          <label>导出</label>
          <div className="bk-acts">
            <button className="btn btn-primary" onClick={onExport} disabled={!!busy}>
              <IconDownload aria-hidden="true" stroke={1.8} />
              {busy === "export" ? "打包中…" : "导出备份（.zip）"}
            </button>
          </div>
          <div className="field-hint">
            包含上面这几份数据，加上阅读进度、书签、阅读设置和排版草稿，还有一份写给「不看代码的人」的恢复说明。
            <b> 不包含</b> Obsidian 正文（太大，用你自己的文件级备份；包里只记路径）、源代码（在 git 里）和 .env 里的密钥。
          </div>
        </div>

        {/* 3. 带回来 -------------------------------------------------------- */}
        <div className="field">
          <label>从备份文件恢复</label>
          <div className="bk-acts">
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              hidden
              onChange={(e) => onPick(e.target.files?.[0])}
            />
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>
              <IconUpload aria-hidden="true" stroke={1.8} />
              {file ? file.name : "选择备份文件…"}
            </button>
            {busy === "preview" ? <span className="field-hint">检查中…</span> : null}
          </div>

          {preview ? <RestorePreview preview={preview} busy={busy} onApply={onApply} /> : null}
        </div>
      </div>
    </div>
  );
}

/** 一份数据 + 它的快照。快照收在一个折叠里——平时没人看，出事时才要。 */
function DataRow({ item, onRestored, onError }) {
  const [openSnaps, setOpenSnaps] = useState(false);
  const [pending, setPending] = useState("");

  async function restore(snap) {
    setPending(snap.name);
    try {
      await api.restoreSnapshot(item.key, snap.name);
      onRestored(`${item.label} 已退回到 ${fmtTime(snap.at)} 那一版。刷新页面后生效。`);
      setOpenSnaps(false);
    } catch (e) {
      onError(e);
    } finally {
      setPending("");
    }
  }

  return (
    <div className="bk-row">
      <div className="bk-row__main">
        <IconDatabase size={15} stroke={1.7} aria-hidden="true" />
        <span className="bk-row__label">{item.label}</span>
        <span className="bk-row__meta mono">{item.rel}</span>
      </div>
      <div className="bk-row__side">
        <span className="bk-row__meta">
          {item.bytes == null ? "还没有这份数据" : `${fmtBytes(item.bytes)} · ${fmtTime(item.at)}`}
        </span>
        <button
          className="sysrow__btn"
          onClick={() => setOpenSnaps((v) => !v)}
          disabled={!item.snapshots.length}
          title={item.snapshots.length ? "看看能退回到哪一版" : "还没有快照——改过一次之后才会有"}
        >
          <IconHistory size={14} stroke={1.7} aria-hidden="true" />
          {item.snapshots.length} 份快照
        </button>
      </div>
      {openSnaps ? (
        <ul className="bk-snaps">
          {item.snapshots.map((s) => (
            <li key={s.name}>
              <span className="mono">{fmtTime(s.at)}</span>
              <span className="bk-row__meta">{fmtBytes(s.bytes)}</span>
              <button className="sysrow__btn" onClick={() => restore(s)} disabled={!!pending}>
                {pending === s.name ? "回退中…" : "回到这一版"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * 恢复预览。**每一行都要给出「从几条变成几条」**——这才是用户点确认前真正在判断的事。
 */
function RestorePreview({ preview, busy, onApply }) {
  const changed = preview.items.filter((i) => i.action !== "skip");
  return (
    <div className="bk-preview">
      <div className="bk-preview__head">
        <b>这份备份生成于 {fmtTime(preview.generatedAt)}</b>
        {preview.vault?.path ? (
          <span className="bk-row__meta">当时的 vault：{preview.vault.path}（正文不在包里）</span>
        ) : null}
      </div>

      {preview.blocked ? (
        <Note tone="danger" title="这份备份里有读不通的数据，不能恢复">
          当前数据一个字节都没有被改动。换一个备份文件试试。
        </Note>
      ) : null}

      <ul className="bk-diff">
        {preview.items.map((i) => (
          <li key={i.key}>
            <span className="bk-diff__label">{i.label}</span>
            {i.action === "skip" ? (
              <span className="bk-row__meta">{i.reason}</span>
            ) : i.action === "blocked" ? (
              <span className="bk-diff__bad">{i.reason}</span>
            ) : i.isCsv ? (
              <span className="bk-diff__num mono">
                {i.currentRows == null ? "（还没有）" : `${i.currentRows} 条`} → {i.backupRows} 条
              </span>
            ) : (
              <span className="bk-diff__num mono">
                {i.currentBytes == null ? "（还没有）" : fmtBytes(i.currentBytes)} → {fmtBytes(i.backupBytes)}
              </span>
            )}
          </li>
        ))}
        {preview.browserKeys.length ? (
          <li>
            <span className="bk-diff__label">浏览器本地数据</span>
            <span className="bk-diff__num mono">{preview.browserKeys.length} 项（阅读进度 / 书签 / 阅读设置 / 排版草稿）</span>
          </li>
        ) : null}
      </ul>

      <div className="bk-acts">
        <button className="btn btn-primary" onClick={onApply} disabled={!!busy || preview.blocked || !changed.length}>
          <IconArchive aria-hidden="true" stroke={1.8} />
          {busy === "apply" ? "恢复中…" : `覆盖当前数据，恢复这 ${changed.length} 份`}
        </button>
        <span className="field-hint" style={{ margin: 0 }}>
          <IconCheck size={13} stroke={2} aria-hidden="true" /> 恢复前会先把当前数据存成快照，退得回来。
        </span>
      </div>
    </div>
  );
}
