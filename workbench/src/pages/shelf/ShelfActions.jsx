// 书架页头右上角那两个动作：导入书籍 / 建空书。
// 从 `pages/Shelf.jsx` 搬出来，函数体一字未动。

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import { SUPPORTED_BOOKS } from "../../lib/sources.js";
import { ErrorNote } from "../../components/ui.jsx";
import { IconFileImport, IconPlus } from "../../components/icons.jsx";

/**
 * 导入 / 新建。
 *
 * 导入收 md / txt / epub / pdf：**解析全在服务端**，浏览器只负责把字节发过去。
 * epub 会按目录拆章、抽封面、抽插图；pdf 会把被排版切断的行拼回段落；
 * md 里有三个以上一级标题也会拆章。这些规则在 server/lib/books.mjs 里，
 * 界面这边不重复实现，也不预判——用户选完文件直接传，结果回来再显示拆了几章。
 */
export function ShelfActions({ onDone }) {
  const [mode, setMode] = useState("");   // "" | "new"
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // 正在导入的文件名
  const [ok, setOk] = useState(null);
  const fileRef = useRef(null);
  const boxRef = useRef(null);

  /**
   * 点外面 / Esc 都能收起输入框。
   *
   * 只给 Esc 是不够的：一个输入框凭空出现在页面上，人的第一反应是点别处让它消失——
   * 那是所有浮层的默认预期。少了这一条，用户会以为界面卡住了。
   */
  useEffect(() => {
    if (mode !== "new") return;
    const onDown = (e) => !boxRef.current?.contains(e.target) && setMode("");
    const onKey = (e) => e.key === "Escape" && setMode("");
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [mode]);

  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = "";  // 清掉，否则同一个文件选第二次不触发 change
    if (!f) return;
    setError(null);
    setOk(null);
    setBusy(f.name);
    try {
      const r = await api.importBook(f);
      setOk(r.book);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function createEmpty() {
    if (!name.trim() || busy) return;
    setBusy("new");
    setError(null);
    try {
      await api.createBook(name.trim());
      setName("");
      setMode("");
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="shelf-actions">
      <div className="row-actions">
        <input
          ref={fileRef}
          type="file"
          accept={SUPPORTED_BOOKS.join(",")}
          onChange={pick}
          style={{ display: "none" }}
        />
        <button className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()} disabled={!!busy}>
          <IconFileImport aria-hidden="true" stroke={1.8} />
          {busy && busy !== "new" ? `解析《${busy}》…` : "导入书籍"}
        </button>
        <button className="btn btn-sm" onClick={() => setMode(mode ? "" : "new")} disabled={!!busy}>
          <IconPlus aria-hidden="true" stroke={2} />
          建空书
        </button>
      </div>
      <span className="field-hint">支持 {SUPPORTED_BOOKS.join(" / ")}；EPUB 会按目录拆章并带上封面</span>

      {mode === "new" ? (
        <div className="row-actions" ref={boxRef}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="书名（之后在 Obsidian 里慢慢填）"
            onKeyDown={(e) => {
              if (e.key === "Enter") createEmpty();
              if (e.key === "Escape") setMode("");
            }}
          />
          <button className="btn btn-primary btn-sm" onClick={createEmpty} disabled={busy === "new" || !name.trim()}>
            建立
          </button>
          <button className="btn btn-sm" onClick={() => setMode("")}>取消</button>
        </div>
      ) : null}

      {busy && busy !== "new" ? (
        <span className="field-hint">大部头要十几秒：解 zip、拆章、抽封面都在本机做，没有上传到任何地方。</span>
      ) : null}
      {ok ? (
        <span className="field-hint">
          已导入《{ok.name}》{ok.chapters?.length ? ` · ${ok.chapters.length} 章` : " · 单篇"}
          {ok.cover ? " · 带封面" : ""}
        </span>
      ) : null}
      <ErrorNote error={error} what="导入" />
    </div>
  );
}
