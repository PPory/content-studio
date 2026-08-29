// 往书架里加一本书：导入书籍 / 建空书。
//
// ⚠️ **两种形态，一批 DOM 和一份逻辑**（`variant`）：
//   - `tile`（默认）：**封面墙末尾那个 `＋` 格**。加书这件事发生在书堆的尽头，
//     那儿正是「这儿还能再放一本」的位置——比页头右上角两颗按钮更像它自己。
//   - `buttons`：书架目录还没建时那段引导里用。那一刻墙不存在，`＋` 格无处可放。
//
// **别为了第二种形态再写一个组件**：导入的状态机（选文件 → 解析中 → 成功/失败）
// 只该有一份。这个项目的事故清一色是「同一件事写在两个地方」。
//
// ⚠️ **`＋` 只有一个，放在整面墙的末尾，不是每组一个。**
// 一本书导进来落在「藏书」还是「资料」，是由 `类型` 决定的（epub / pdf 一定是藏书），
// **不是由你点了哪个组的 `＋` 决定的**。每组一个的话，位置本身在暗示一个它保证不了的
// 去处——用户从「资料」那个 `＋` 导进一本 epub，它会出现在上面那组里。
//
// 导入收 md / txt / epub / pdf：**解析全在服务端**，浏览器只负责把字节发过去。
// epub 会按目录拆章、抽封面、抽插图；pdf 会把被排版切断的行拼回段落；
// md 里有三个以上一级标题也会拆章。这些规则在 server/lib/books.mjs 里，
// 界面这边不重复实现，也不预判——用户选完文件直接传，结果回来再显示拆了几章。

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import { SUPPORTED_BOOKS } from "../../lib/sources.js";
import { ErrorNote } from "../../components/ui.jsx";
import { IconFileImport, IconPlus } from "../../components/icons.jsx";

export function ShelfActions({ onDone, variant = "tile" }) {
  const [open, setOpen] = useState(false);  // tile 形态：菜单开着没有
  const [mode, setMode] = useState("");     // "" | "new"
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);   // 正在导入的文件名
  const [ok, setOk] = useState(null);
  const fileRef = useRef(null);
  const boxRef = useRef(null);
  const [flip, setFlip] = useState(false);   // 菜单要不要靠右对齐（见下面那个 effect）

  /**
   * 点外面 / Esc 都能收起。
   *
   * 只给 Esc 是不够的：一个浮层凭空出现在页面上，人的第一反应是点别处让它消失——
   * 那是所有浮层的默认预期。少了这一条，用户会以为界面卡住了。
   *
   * ⚠️ **正在解析时不收**：那是唯一显示「解析《x》…」和结果的地方，
   * 收掉等于用户点了导入之后再也看不到它到底成没成。
   */
  const listening = (variant === "tile" && open) || mode === "new";
  useEffect(() => {
    if (!listening) return;
    const close = () => {
      if (busy) return;
      setMode("");
      setOpen(false);
    };
    const onDown = (e) => !boxRef.current?.contains(e.target) && close();
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [listening, busy]);

  /**
   * ⚠️ **这个格子在最右一列时，左对齐的菜单会向右出界。**
   * 菜单 320px、格子只有 135px，而格子的位置是**跟着书的本数走的**——
   * 它可能落在任何一列，所以没法在 CSS 里写死一边。量一次，出界就翻到靠右对齐。
   * （`.select__pop` 那条「靠右的下拉要补 `right: 0; left: auto`」是同一个坑的静态版。）
   */
  useEffect(() => {
    if (variant !== "tile" || !open) return;
    const tile = boxRef.current;
    const wall = tile?.closest(".bookshelf");
    if (!tile || !wall) return;
    const t = tile.getBoundingClientRect();
    setFlip(t.left + 320 > wall.getBoundingClientRect().right);
  }, [variant, open]);

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
      setOpen(false);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const fileInput = (
    <input ref={fileRef} type="file" accept={SUPPORTED_BOOKS.join(",")} onChange={pick} style={{ display: "none" }} />
  );

  // 建空书的输入框：两种形态共用，别写两份
  const nameBox = (
    <div className="row-actions">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="书名（之后可以继续在本地工作区补充）"
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
  );

  // 进度和结果：两种形态共用。**导入大部头要十几秒，这几行是那段时间里唯一的反馈**
  const status = (
    <>
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
    </>
  );

  if (variant === "buttons") {
    return (
      <div className="shelf-actions">
        <div className="row-actions">
          {fileInput}
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
        <div ref={boxRef}>{mode === "new" ? nameBox : null}</div>
        {status}
      </div>
    );
  }

  return (
    <div className="add-book" ref={boxRef} data-flip={flip ? "" : undefined}>
      {fileInput}
      {/**
        * ⚠️ **格子本身不写「导入书籍 / 建空书」两行字。** 它和一排封面并列，
        * 塞进两行小字会让它在墙上比任何一本书都吵。一个 `＋` 就够——
        * 位置（书堆的尽头）已经说明了它是干什么的，点开再展开细节。
        */}
      <button
        className="add-book__tile"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="加一本书"
      >
        {busy && busy !== "new" ? <span className="add-book__busy">解析中…</span> : <IconPlus size={26} stroke={1.6} aria-hidden="true" />}
      </button>

      {open ? (
        <div className="add-book__pop">
          {mode === "new" ? (
            nameBox
          ) : (
            <>
              {/* 每一行都写清楚**这条路通向什么**，而不是只给一个动词 */}
              <button className="add-book__row" onClick={() => fileRef.current?.click()} disabled={!!busy}>
                <IconFileImport size={17} stroke={1.7} aria-hidden="true" />
                <span>
                  <b>{busy && busy !== "new" ? `解析《${busy}》…` : "导入书籍"}</b>
                  <em>{SUPPORTED_BOOKS.join(" / ")}；EPUB 会按目录拆章并带上封面</em>
                </span>
              </button>
              <button className="add-book__row" onClick={() => setMode("new")} disabled={!!busy}>
                <IconPlus size={17} stroke={1.8} aria-hidden="true" />
                <span>
                  <b>建空书</b>
                  <em>自己攒的资料，正文能边读边改</em>
                </span>
              </button>
            </>
          )}
          {status}
        </div>
      ) : null}
    </div>
  );
}
