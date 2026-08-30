/**
 * 备份与恢复抽屉。
 *
 * 完整备份用于原样恢复；便携导出同时提供 Markdown/frontmatter、CSV、JSONL 和资源。
 * 选择文件时只校验和预览，确认精确 SHA-256 后才建立恢复点并暂存，重启时原子切换。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { api, downloadBackup } from "../lib/api.js";
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
  const [includeBookAssets, setIncludeBookAssets] = useState(false);
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

  const onExport = (kind) =>
    run(`export-${kind}`, async () => {
      const r = await downloadBackup({ kind, includeBookAssets });
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
      const r = await api.applyBackup(file, preview.confirmationSha256);
      setDone(`已建立完整恢复点并暂存恢复。关闭并重新打开工作台后切换；恢复点：${r.restorePoint}`);
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
          <Note tone="success" title="完成">
            {done}
          </Note>
        ) : null}

        {/* 1. 现在有什么 ---------------------------------------------------- */}
        <div className="field">
          <label>工作台数据</label>
          {status ? (
            <div className="bk-list">
              <div className="bk-row">
                <div className="bk-row__main"><IconDatabase size={15} stroke={1.7} aria-hidden="true" /><span className="bk-row__label">SQLite 工作区</span><span className="bk-row__meta mono">{status.workspaceId}</span></div>
                <div className="bk-row__side"><span className="bk-row__meta">{fmtBytes(status.database?.bytes)} · {status.database?.tables?.entities?.count ?? 0} 条实体</span></div>
              </div>
              <div className="bk-row">
                <div className="bk-row__main"><IconHistory size={15} stroke={1.7} aria-hidden="true" /><span className="bk-row__label">自动完整备份</span></div>
                <div className="bk-row__side"><span className="bk-row__meta">日备份 {status.automatic?.daily?.length || 0} 份 · 周备份 {status.automatic?.weekly?.length || 0} 份</span></div>
              </div>
            </div>
          ) : <div className="field-hint">读取中…</div>}
          <div className="field-hint">
            完整备份包含 SQLite、图片、图书原件和附件；不包含 .env、密钥、旧 vault 或远程资源。
          </div>
        </div>

        {/* 2. 带走一份 ------------------------------------------------------ */}
        <div className="field">
          <label>导出</label>
          <div className="bk-acts">
            <button className="btn btn-primary" onClick={() => onExport("portable")} disabled={!!busy}>
              <IconDownload aria-hidden="true" stroke={1.8} />
              {busy === "export-portable" ? "打包中…" : "便携导出"}
            </button>
            <button className="btn" onClick={() => onExport("full")} disabled={!!busy}>
              <IconArchive aria-hidden="true" stroke={1.8} />
              {busy === "export-full" ? "打包中…" : "完整备份"}
            </button>
          </div>
          <label className="field-hint"><input type="checkbox" checked={includeBookAssets} onChange={(event) => setIncludeBookAssets(event.target.checked)} /> 便携导出也包含图书原件</label>
          <div className="field-hint">
            便携导出包含 Markdown/frontmatter、CSV、JSONL 和资源，默认只带图书笔记与元数据；完整备份始终包含图书原件。
          </div>
        </div>

        {/* 3. 带回来 -------------------------------------------------------- */}
        <div className="field">
          <label>从备份文件恢复</label>
          <div className="bk-acts">
            <input
              ref={fileRef}
              type="file"
              accept=".xenho-backup,.zip"
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

/**
 * 恢复预览。**每一行都要给出「从几条变成几条」**——这才是用户点确认前真正在判断的事。
 */
function RestorePreview({ preview, busy, onApply }) {
  const changed = preview.tables.filter((table) => !table.same);
  return (
    <div className="bk-preview">
      <div className="bk-preview__head">
        <b>{preview.kind === "full" ? "完整备份" : "便携导出"} · {fmtTime(preview.createdAt)}</b>
        <span className="bk-row__meta mono">确认 SHA-256：{preview.confirmationSha256}</span>
      </div>

      {preview.portableConflict ? (
        <Note tone="danger" title="便携导出不能覆盖当前工作区">
          当前工作区已有数据。请导入新的空工作区，或改用完整备份恢复。
        </Note>
      ) : null}

      <ul className="bk-diff">
        {preview.tables.filter((table) => !table.same).map((table) => (
          <li key={table.name}>
            <span className="bk-diff__label mono">{table.name}</span>
            <span className="bk-diff__num mono">{table.current} 条 → {table.incoming} 条</span>
          </li>
        ))}
        <li><span className="bk-diff__label">资源文件</span><span className="bk-diff__num mono">{preview.assets.included} 个 · {fmtBytes(preview.assets.bytes)}</span></li>
        {preview.assets.excludedBookAssets ? <li><span className="bk-diff__label">未包含图书原件</span><span className="bk-diff__num mono">{preview.assets.excludedBookAssets} 个</span></li> : null}
      </ul>

      <div className="bk-acts">
        <button className="btn btn-primary" onClick={onApply} disabled={!!busy || preview.portableConflict}>
          <IconArchive aria-hidden="true" stroke={1.8} />
          {busy === "apply" ? "建立恢复点…" : `确认并在重启时恢复${changed.length ? `（${changed.length} 张表变化）` : ""}`}
        </button>
        <span className="field-hint" style={{ margin: 0 }}>
          <IconCheck size={13} stroke={2} aria-hidden="true" /> 先建立完整恢复点；当前进程不覆盖正在使用的 SQLite。
        </span>
      </div>
    </div>
  );
}
