import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { creationApi } from "../lib/creation-api.js";
import { PLATFORMS } from "../lib/platforms.js";
import { ErrorNote, Select, valueIcon } from "./ui.jsx";
import { IconCheck, IconChevronDown, IconUsers, IconWorld, IconX } from "./icons.jsx";
import "./creation.css";

/**
 * 选题库仍在使用的创建弹层。
 *
 * 访谈与素材起稿已经分别迁到通用 Skill、项目 Assistant + Candidate + Grounding；
 * 这里不再保留第二套 AI 工作流，只负责建立一条选题。
 */
export function CreationDialog({ open, onClose, onTopicCreated }) {
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState("公众号");
  const [viewpoint, setViewpoint] = useState("");
  const [audience, setAudience] = useState("");
  const [audiences, setAudiences] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const close = useCallback(() => onClose(), [onClose]);
  const boxRef = useDialog(open, close, { autoFocus: true });

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setPlatform("公众号");
    setViewpoint("");
    setAudience("");
    setBusy(false);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    creationApi.audiences()
      .then((result) => !cancelled && setAudiences(result.items || []))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  async function createTopic() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const value = audience.trim();
      const result = await creationApi.create({ kind: "topic", mode: "blank", title, platform, viewpoint, audience });
      if (value) creationApi.rememberAudience(value).catch(() => {});
      onTopicCreated?.(result.topic, result.project);
      close();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim scrim--center creation-scrim" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="creation" data-screen="topic" ref={boxRef} role="dialog" aria-modal="true" aria-label="新建选题">
        <header className="creation__head">
          <div><span className="eyebrow">CREATE</span><h2>新建选题</h2></div>
          <button className="icon-btn" onClick={close} aria-label="关闭" title="关闭（Esc）"><IconX aria-hidden="true" /></button>
        </header>
        <TopicForm
          title={title}
          setTitle={setTitle}
          platform={platform}
          setPlatform={setPlatform}
          viewpoint={viewpoint}
          setViewpoint={setViewpoint}
          audience={audience}
          setAudience={setAudience}
          audiences={audiences}
          busy={busy}
          onSubmit={createTopic}
        />
        <ErrorNote error={error} what="创建" />
      </section>
    </div>
  );
}

function PlatformSelect({ value, onChange }) {
  return (
    <span className="creation-platform">
      <Select
        value={value}
        options={PLATFORMS}
        onChange={onChange}
        ariaLabel="发布平台"
        title="选择发布平台"
        renderIcon={(item) => {
          const Icon = valueIcon(item, IconWorld);
          return <Icon size={15} stroke={1.8} aria-hidden="true" />;
        }}
      />
    </span>
  );
}

function AudienceField({ value, onChange, options = [], label = "目标读者", placeholder = "可选，写给谁看" }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(-1);
  const [place, setPlace] = useState(null);
  const ref = useRef(null);
  const boxRef = useRef(null);

  const typed = String(value || "").trim().toLowerCase();
  const list = useMemo(() => (typed ? options.filter((item) => item.toLowerCase().includes(typed)) : options), [options, typed]);

  function show() {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    const up = below < 240 && rect.top > below;
    setPlace({
      right: Math.round(window.innerWidth - rect.right),
      minWidth: Math.round(rect.width),
      top: up ? undefined : Math.round(rect.bottom + 6),
      bottom: up ? Math.round(window.innerHeight - rect.top + 6) : undefined,
    });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (event) => !ref.current?.contains(event.target) && setOpen(false);
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
      if (event.key === "Enter" && at < 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") {
        onChange(list[at]);
        setOpen(false);
        return;
      }
      const count = list.length;
      if (count) setAt((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
    };
    const onMove = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, at, list, onChange]);

  return (
    <div className="creation-brief-field creation-audience" ref={ref}>
      <span>{label}</span>
      <div className="creation-audience__box" ref={boxRef}>
        <input value={value} onChange={(event) => { onChange(event.target.value); setAt(-1); if (options.length) show(); }} onFocus={() => options.length && show()} placeholder={placeholder} />
        {options.length ? <button type="button" className="creation-audience__toggle" onClick={() => { setAt(-1); open ? setOpen(false) : show(); }} aria-expanded={open} aria-label="选一个用过的目标读者" title="选一个用过的目标读者"><IconChevronDown aria-hidden="true" /></button> : null}
      </div>
      {open && list.length && place ? <div className="select__pop creation-audience__pop" role="listbox" style={{ position: "fixed", left: "auto", right: place.right, minWidth: place.minWidth, top: place.top, bottom: place.bottom }}>
        {list.map((item, index) => <button key={item} type="button" data-at={index === at ? "1" : undefined} aria-selected={item === value} onMouseEnter={() => setAt(index)} onClick={() => { onChange(item); setOpen(false); }}><IconUsers size={15} stroke={1.8} aria-hidden="true" /><span>{item}</span>{item === value ? <IconCheck className="select__tick" size={15} aria-hidden="true" /> : null}</button>)}
      </div> : null}
    </div>
  );
}

function TopicForm({ title, setTitle, platform, setPlatform, viewpoint, setViewpoint, audience, setAudience, audiences, busy, onSubmit }) {
  return (
    <div className="creation-form creation-form--topic">
      <div className="creation-form__grid">
        <label className="field creation-form__wide"><span>选题标题</span><input data-autofocus="" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="这篇准备讨论什么" /></label>
        <label className="field"><span>发布平台</span><PlatformSelect value={platform} onChange={setPlatform} /></label>
        <AudienceField value={audience} onChange={setAudience} options={audiences} label="目标读者（可选）" placeholder="主要写给谁" />
        <label className="field creation-form__wide"><span>核心观点（可选）</span><textarea value={viewpoint} onChange={(event) => setViewpoint(event.target.value)} placeholder="希望读者最终记住什么" /></label>
      </div>
      <div className="creation-form__foot creation-form__foot--end"><button className="btn btn-primary" onClick={onSubmit} disabled={busy || !title.trim()}>{busy ? "建立中…" : "建立选题"}</button></div>
    </div>
  );
}
