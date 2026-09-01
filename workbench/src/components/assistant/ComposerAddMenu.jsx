import { useEffect, useRef } from "react";
import { IconAt, IconDatabase, IconFileText, IconLoader2, IconPaperclip, IconPlus, IconSparkles, IconUserStar } from "../icons.jsx";

/**
 * 输入框左下角那颗 `+`：**这一栏唯一的「往这轮对话里加东西」入口。**
 *
 * ⚠️ **上一版没有入口。** 想调专家要在正文里打 `@`，想调 Skill 要打 `/`——
 * 两个记号各是一套语义，而屏幕上没有任何东西说过它们存在；`+` 自己只开文件选择器。
 * 结果是三个能力里有两个只有知道的人才用得上，而知道的人也得先记住哪个记号对应哪个。
 *
 * 现在五件事排成一列：附件、知识库、提及文章、专家、Skill。**`@` 仍然能打**，
 * 但它只剩一个语义（提及），唤起的是同一个浮层——快捷键和入口指向同一个东西，
 * 不是两套并行的交互。
 */

/** 一级那四行。`kind: "attach"` 直接开文件选择器，其余进二级。 */
const ROOT_ITEMS = [
  { level: "attach", icon: IconPaperclip, label: "添加图片、PDF 或文件" },
  { level: "knowledge", kind: "knowledge", id: "knowledge-base", icon: IconDatabase, label: "知识库", hint: "检索持续维护的 Wiki 页面" },
  { level: "articles", icon: IconAt, label: "提及文章" },
  { level: "experts", icon: IconUserStar, label: "专家" },
  { level: "skills", icon: IconSparkles, label: "Skill" },
];

const KIND_ICONS = { article: IconFileText, expert: IconUserStar, skill: IconSparkles, knowledge: IconDatabase };

const LEVEL_PLACEHOLDER = { articles: "搜索文章…", experts: "搜索专家…", skills: "搜索 Skill…", mention: "搜索…" };

export function ComposerAddMenu({
  level,
  source,
  query,
  index,
  groups,
  loading,
  uploading,
  disabled,
  onLevel,
  onQuery,
  onIndex,
  onChoose,
  onClose,
  onAttach,
}) {
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const open = Boolean(level);
  const root = level === "root";
  /**
   * ⚠️ **扁平序号必须和渲染顺序一致。** 二级按「文章 / 专家」分组显示，
   * 而 ↑↓ 走的是一条扁平序号——分组渲染时忘了记住每一项的全局序号，
   * 键盘选中的就会是另一行。模型菜单分组时踩过同一个坑（见 AssistantComposer）。
   */
  const flat = root ? [] : groups.flatMap((group) => group.items);

  // 二级从 `+` 点进来时，焦点直接落进搜索框——这时用户手已经离开键盘位了，
  // 让他再点一下搜索框是白要一次操作。打字唤起的那条路焦点必须留在 textarea，不能抢。
  useEffect(() => {
    if (!open || root || source !== "button") return;
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, root, source, level]);

  // 点外面关掉。打字唤起的那条路不装这个监听：那时焦点在 textarea 里，
  // 关闭由输入内容自己决定（`@` 打没了就该关），装上只会互相打架。
  useEffect(() => {
    if (!open || source !== "button") return undefined;
    const close = (event) => {
      if (!wrapRef.current?.contains(event.target)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, source, onClose]);

  function chooseRoot(item) {
    if (item.level === "attach") { onClose(); onAttach(); return; }
    if (item.kind) { onChoose(item); return; }
    onLevel(item.level);
  }

  /** Esc 在二级是**回一级**，不是关掉整个浮层——退回上一步比推倒重来便宜。 */
  function back() {
    if (root || source === "typing") { onClose(); triggerRef.current?.focus(); return; }
    onLevel("root");
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function keyDown(event) {
    const items = root ? ROOT_ITEMS : flat;
    if (event.key === "Escape") { event.preventDefault(); back(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!items.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      onIndex((index + step + items.length) % items.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = items[index] || items[0];
      if (!item) return;
      if (root) chooseRoot(item);
      else onChoose(item);
    }
  }

  return <div className="assistant-add" ref={wrapRef}>
    <button
      type="button"
      ref={triggerRef}
      className="assistant-composer__attach"
      title={uploading ? "正在读取附件" : "添加附件、知识库、文章、专家或 Skill"}
      aria-label={uploading ? "正在读取附件" : "添加附件、知识库、文章、专家或 Skill"}
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled || uploading}
      onClick={() => (open ? onClose() : onLevel("root"))}
      onKeyDown={open ? keyDown : undefined}
    >
      {uploading ? <IconLoader2 className="assistant-add__spin" aria-hidden="true" /> : <IconPlus aria-hidden="true" />}
    </button>
    {/* ⚠️ **浮层锚在 `.assistant-add` 上，也就是触发器自己那层。**
        锚在 `> footer` 上的话它会铺满整行、底边贴在离按钮很远的地方，
        读不出是从哪颗按钮长出来的。这条在权限菜单上已经做对过一次，
        在模型菜单上来回过三次——不要再往上挂了。 */}
    {open ? <div className="assistant-add-menu" role="menu" onKeyDown={keyDown}>
      {root ? ROOT_ITEMS.map((item, position) => {
        const Icon = item.icon;
        return <button
          type="button"
          role="menuitem"
          key={item.level}
          aria-current={position === index ? "true" : undefined}
          onMouseEnter={() => onIndex(position)}
          onClick={() => chooseRoot(item)}
        ><Icon aria-hidden="true" /><span><b>{item.label}</b>{item.hint ? <small>{item.hint}</small> : null}</span></button>;
      }) : <>
        {/* 打字唤起时不画搜索框：要搜的字用户正打在 textarea 里，
            再给一个空搜索框等于问「你刚才打的不算数吗」。 */}
        {source === "button" ? <input
          ref={searchRef}
          className="assistant-add-menu__search"
          value={query}
          placeholder={LEVEL_PLACEHOLDER[level] || "搜索…"}
          onChange={(event) => onQuery(event.target.value)}
          aria-label={LEVEL_PLACEHOLDER[level] || "搜索"}
        /> : null}
        {loading ? <p className="assistant-add-menu__empty">正在读取…</p>
          : flat.length ? (() => {
            let position = -1;
            return groups.map((group) => <section className="assistant-add-menu__group" key={group.key}>
              {/* 只有一组时不写组名：这块面板是从「专家」那一行点进来的，
                  里面全是专家——再写一次组名是同义反复。 */}
              {groups.length > 1 ? <h4>{group.label}</h4> : null}
              {group.items.map((item) => {
                const Icon = KIND_ICONS[item.kind] || IconFileText;
                const current = (position += 1);
                return <button
                  type="button"
                  role="menuitem"
                  key={`${item.kind}:${item.id}`}
                  aria-current={current === index ? "true" : undefined}
                  onMouseEnter={() => onIndex(current)}
                  onClick={() => onChoose(item)}
                ><Icon aria-hidden="true" /><span><b>{item.label}</b>{item.hint ? <small>{item.hint}</small> : null}</span></button>;
              })}
            </section>);
          })() : <p className="assistant-add-menu__empty">没有匹配项</p>}
      </>}
    </div> : null}
  </div>;
}
