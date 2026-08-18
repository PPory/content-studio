/**
 * 设置面板里的两段提示词。
 *
 * **它们在左栏里就是分开的两项，不是同一段的两个小标题。** 理由只有一条，但很硬：
 * 「改完立刻生效」和「改完要部署才生效」是两种完全不同的东西。混在一起的必然结果是
 * 用户改完 Worker 的提示词、看到「已保存」、然后以为它生效了——而 Worker 那边照旧按
 * 老提示词跑，不报错、界面上也看不出来。
 *
 * 所以这个文件里两个组件的**保存按钮长得也不一样**：
 *   LocalPrompts    跟着面板底部那条动作条一起存（和改 .env 是同一次动作）
 *   PipelinePrompts **就地一个自己的保存按钮**，写的是另一个项目的文件，
 *                   存完常驻一条「还没部署」的横幅
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { MarkdownEditor } from "./MarkdownEditor.jsx";
import { ErrorNote, Note } from "./ui.jsx";
import { IconAlertTriangle, IconCheck, IconCopy, IconHistory, IconLoader2, IconShieldCheck } from "./icons.jsx";

/* ---------- 工作台自己的（改完立刻生效） ---------- */

export function LocalPrompts({ data, draft, onChange, guard }) {
  if (!data) return <div className="field-hint">读取中…</div>;
  const valueOf = (key) => draft[key] ?? dig(data.values, key) ?? "";
  return (
    <>
      {data.fields.map((f) => (
        <div className="set-field" key={f.key}>
          <label className="set-field__label" htmlFor={`p-${f.key}`}>
            {f.label}
            <button
              type="button"
              className="set-field__reset"
              onClick={() => onChange(f.key, dig(data.defaults, f.key) || "")}
              // 「恢复默认」不做二次确认：它只改输入框里的字，真正落盘还要点底下那个保存
              title="把这一段换回工作台自带的写法（还没保存，点底下的保存才算数）"
            >
              <IconHistory size={13} stroke={1.7} aria-hidden="true" />
              恢复默认
            </button>
          </label>
          <textarea
            id={`p-${f.key}`}
            className="set-field__input set-field__area"
            rows={f.rows || 6}
            spellCheck={false}
            value={valueOf(f.key)}
            onChange={(e) => onChange(f.key, e.target.value)}
          />
          {f.hint ? <div className="field-hint">{f.hint}</div> : null}
          {f.why ? (
            <details className="set-why">
              <summary>为什么</summary>
              <p>{f.why}</p>
            </details>
          ) : null}

          {/**
           * ⚠️ 安全约束只读展示，**不给改也不藏起来**。
           *
           * 不给改：对话通道 spawn 的是一个能读整个 vault 的 agent，而喂给它的网页标题、
           * 选中段落、附近正文全是外来的，里面完全可以有一句「忽略以上所有指令」。
           * 不藏起来：藏了的话用户以为自己改的那段就是全部，而实际发出去的比他看到的多一段。
           */}
          {f.guard ? (
            <div className="set-guard">
              <IconShieldCheck size={15} stroke={1.7} aria-hidden="true" />
              <div>
                <b>这一句会自动接在后面，改不掉：</b>
                <p>{guard || f.guard}</p>
                <span className="field-hint">
                  它挡的是提示词注入。这条通道能读你整个知识库，而喂给它的正文是外来的——
                  少了这句，正文里的一句话就能指挥它。
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}

const dig = (obj, key) => key.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

/* ---------- 流水线的（改完要部署） ---------- */

// 改过还没部署的文件。**存 localStorage**：拿不到 Worker 真实的部署时间，
// 所以只能记「我改过谁」，由用户点「我已经部署了」来销账。宁可多问一次，
// 也不能默认「大概生效了」——那正是这一段最容易骗人的地方。
const PENDING_KEY = "workbench:prompt-deploy:v1";
const loadPending = () => {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const savePending = (list) => {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式下写不了，本次会话内照样提示 */
  }
};

export function PipelinePrompts() {
  const [list, setList] = useState(null);
  const [activeId, setActiveId] = useState("");
  const [file, setFile] = useState(null); // { rel, text, stamp }
  const [drafts, setDrafts] = useState({}); // id → 改到一半的文本，**切文件不丢**
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [pending, setPending] = useState(loadPending);
  const [copied, setCopied] = useState(false);
  const loadedFor = useRef("");

  useEffect(() => {
    api.pipelinePrompts().then(setList).catch(setError);
  }, []);

  // 选中一个文件就去读它。**已经改到一半的不重新拉**，否则切走再切回来改动就没了
  useEffect(() => {
    if (!activeId || loadedFor.current === activeId) return;
    loadedFor.current = activeId;
    setFile(null);
    api.pipelinePrompt(activeId).then(setFile).catch(setError);
  }, [activeId]);

  const grouped = useMemo(() => {
    const m = new Map();
    for (const it of list?.items || []) {
      if (!m.has(it.group)) m.set(it.group, []);
      m.get(it.group).push(it);
    }
    return [...m.entries()];
  }, [list]);

  const text = drafts[activeId] ?? file?.text ?? "";
  const dirty = file && drafts[activeId] !== undefined && drafts[activeId] !== file.text;

  const onEdit = useCallback((v) => setDrafts((d) => ({ ...d, [activeId]: v })), [activeId]);

  const deployCmd = list?.deployCmd || "npx wrangler deploy";

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const saved = await api.savePipelinePrompt(activeId, text, file.stamp);
      setFile({ ...file, text, stamp: saved.stamp });
      setDrafts((d) => {
        const next = { ...d };
        delete next[activeId];
        return next;
      });
      // 记一笔「改过还没部署」。同一个文件改两次只记一条
      setPending((p) => {
        const next = [saved.rel, ...p.filter((r) => r !== saved.rel)];
        savePending(next);
        return next;
      });
      api.pipelinePrompts().then(setList).catch(() => {}); // 刷新大小和时间
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }

  const clearPending = () => {
    setPending([]);
    savePending([]);
  };

  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(deployCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(Object.assign(new Error("复制不了"), { hint: `手动敲一遍：${deployCmd}` }));
    }
  };

  if (!list) return <div className="field-hint">读取中…</div>;

  // 找不到 worker/ **不是错**：只单独跑 workbench 的人一样能用其余部分
  if (!list.exists) {
    return (
      <Note title="没找到 Worker 的提示词目录">
        期望在 <code>{list.root}</code>。{list.hint}
      </Note>
    );
  }

  return (
    <>
      {/* 常驻横幅：改过就一直挂着，点「我已经部署了」才消。**这是这一段最要紧的一件事** */}
      {pending.length ? (
        <div className="set-deploy">
          <IconAlertTriangle size={17} stroke={1.7} aria-hidden="true" />
          <div className="set-deploy__body">
            <b>{pending.length} 个提示词改过了，但还没生效</b>
            <p>
              它们打包在 Worker 里，要在 worker/ 目录跑一次部署才算数。改过的：
              {pending.join("、")}
            </p>
            <div className="set-deploy__acts">
              <code className="mono">{deployCmd}</code>
              <button className="sysrow__btn" onClick={copyCmd}>
                {copied ? <IconCheck size={14} stroke={2} aria-hidden="true" /> : <IconCopy size={14} stroke={1.7} aria-hidden="true" />}
                {copied ? "已复制" : "复制命令"}
              </button>
              <button className="sysrow__btn" onClick={clearPending}>
                我已经部署了
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ErrorNote error={error} what="提示词" />

      <div className="set-pp">
        {/* 文件清单。分组是为了让十几个文件不排成一堵墙 */}
        <div className="set-pp__list">
          {grouped.map(([group, items]) => (
            <div className="set-pp__group" key={group}>
              <div className="set-pp__group-name">{group}</div>
              {items.map((it) => (
                <button
                  key={it.id}
                  className="set-pp__item"
                  aria-current={it.id === activeId}
                  onClick={() => setActiveId(it.id)}
                  title={it.note || it.rel}
                >
                  <span className="set-pp__name">{it.name}</span>
                  {/* 改到一半的挂一个点：切文件不丢改动，但得看得出来哪个还没存 */}
                  {drafts[it.id] !== undefined ? <span className="set-pp__dot" aria-label="有未保存的改动" /> : null}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="set-pp__pane">
          {!activeId ? (
            <div className="set-pp__empty">
              <p>左边挑一个提示词。</p>
              <span className="field-hint">
                这些是 worker/ 的文件，初筛 / 每日整理 / 成稿 / 划词 AI 全按它们跑。
                改完要部署一次才生效，界面会提醒你。
              </span>
            </div>
          ) : !file ? (
            <div className="field-hint">
              <IconLoader2 size={14} stroke={1.7} aria-hidden="true" className="spinning" /> 读取中…
            </div>
          ) : (
            <>
              <div className="set-pp__head">
                <div>
                  <b>{file.rel}</b>
                  {file.note ? <span className="field-hint">{file.note}</span> : null}
                </div>
                {/**
                 * **就地保存，不跟着底下那条动作条走。** 这一下写的是另一个项目的文件、
                 * 而且要部署才生效——和「改 .env」不是同一件事，共用一个按钮的话，
                 * 按钮上就没法把话说准。
                 */}
                <button className="btn btn-sm btn-primary" onClick={save} disabled={!dirty || !!busy}>
                  {busy === "save" ? "写入中…" : dirty ? "保存到 worker/" : "没有改动"}
                </button>
              </div>
              <div className="set-pp__editor">
                <MarkdownEditor value={text} onChange={onEdit} ariaLabel={`提示词 ${file.rel}`} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
